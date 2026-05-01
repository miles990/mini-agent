/**
 * Idea Qualify — Stage 2 of the Intake Pipeline.
 *
 * Pure code heuristics (no LLM). Scores ideas and routes them to
 * qualified (→ Stage 3) or parked (→ parking lot).
 *
 * Three-way consensus: CC + Akari + Kuro (KG discussions 385504ef, 5b9afc51, 14954f1f).
 */

import { updateMemoryIndexEntry, queryMemoryIndexSync, type MemoryIndexEntry } from './memory-index.js';
import { logMechanism } from './mechanism-log.js';

// =============================================================================
// Types
// =============================================================================

export interface QualifyResult {
  score: number;
  signals: string[];
  decision: 'qualified' | 'parked';
  park_reason?: string;
  confidence: number;
}

// =============================================================================
// Config
// =============================================================================

const QUALIFY_THRESHOLD = 0.1;

// Source-aware TTL (days)
const TTL_DAYS: Record<string, number> = {
  alex: 14,
  discovery: 7,
  cron: 3,
  system: 3,
};
const DEFAULT_TTL_DAYS = 14;

const PARKING_LOT_CAPACITY = 100;

// Hysteresis: re-entry requires score improvement
const HYSTERESIS_DELTA = 0.15;
const HYSTERESIS_FLOOR = 0.25;

// Burst detection
const BURST_WINDOW_MS = 60_000;
const BURST_LIMIT = 5;

// =============================================================================
// Action Verb Lists (seed — feedback-driven curation over time)
// =============================================================================

const ACTION_VERBS_ZH = [
  '做', '建', '改', '加', '修', '寫', '實作', '部署', '移除', '優化',
  '設計', '重構', '分析', '測試', '驗證', '確認', '整合', '遷移',
  '清理', '拆分', '合併', '更新', '升級', '調整', '實現', '開發',
];

const ACTION_VERBS_EN = [
  'create', 'build', 'fix', 'add', 'remove', 'deploy', 'implement',
  'refactor', 'analyze', 'test', 'verify', 'integrate', 'migrate',
  'clean', 'split', 'merge', 'update', 'upgrade', 'design', 'write',
  'investigate', 'debug', 'optimize', 'ship',
];

const VAGUE_MARKERS = [
  'somehow', 'maybe', 'might', 'figure out', 'eventually',
  '或許', '可能', '也許', '再說', '之後再',
];

const TECH_PATTERNS = /\.(ts|js|tsx|jsx|yaml|yml|json|md|sh|mjs)\b|src\/|config\/|scripts\/|memory\/|localhost:\d+/i;

const DEADLINE_PATTERNS = /deadline|before|by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|在.*之前|截止|期限|\d{1,2}\/\d{1,2}/i;

// =============================================================================
// Burst Detection State
// =============================================================================

const burstBuffer = new Map<string, number[]>();

function checkBurst(source: string): boolean {
  const now = Date.now();
  const key = source.split(':')[0]; // channel level
  const timestamps = burstBuffer.get(key) ?? [];
  const recent = timestamps.filter(t => now - t < BURST_WINDOW_MS);
  recent.push(now);
  burstBuffer.set(key, recent.slice(-BURST_LIMIT * 2));
  return recent.length > BURST_LIMIT;
}

// =============================================================================
// Core Scoring
// =============================================================================

export function scoreIdea(rawText: string, source: string): { score: number; signals: string[]; confidence: number } {
  let score = 0;
  const signals: string[] = [];
  let confidence = 0.5;

  // Positive signals
  if (source.includes(':alex') || source === 'alex') {
    score += 0.5;
    signals.push('source_alex:+0.5');
  }

  const textLower = rawText.toLowerCase();

  const hasZhVerb = ACTION_VERBS_ZH.some(v => rawText.includes(v));
  const hasEnVerb = ACTION_VERBS_EN.some(v => textLower.includes(v));
  if (hasZhVerb || hasEnVerb) {
    score += 0.3;
    signals.push('has_action_verb:+0.3');
  }

  if (TECH_PATTERNS.test(rawText)) {
    score += 0.2;
    signals.push('has_target:+0.2');
  }

  if (source.includes('kg')) {
    score += 0.2;
    signals.push('from_kg:+0.2');
  }

  if (DEADLINE_PATTERNS.test(rawText)) {
    score += 0.15;
    signals.push('has_deadline:+0.15');
  }

  // Negative signals
  const isPureQuestion = rawText.endsWith('？') || rawText.endsWith('?');
  if (isPureQuestion && !hasZhVerb && !hasEnVerb) {
    score -= 0.2;
    signals.push('pure_question:-0.2');
  }

  if (rawText.length < 10 && !TECH_PATTERNS.test(rawText)) {
    score -= 0.15;
    signals.push('too_vague:-0.15');
  }

  const hasVagueMarker = VAGUE_MARKERS.some(v => textLower.includes(v));
  if (hasVagueMarker) {
    score -= 0.2;
    signals.push('vague_marker:-0.2');
  }

  // Confidence: low context → lower confidence
  if (rawText.length < 20) confidence = 0.3;
  else if (rawText.length < 50) confidence = 0.5;
  else confidence = 0.7;

  // Alex source → minimum score 0.5, always qualified (but still log signals)
  if (source.includes(':alex') || source === 'alex') {
    score = Math.max(score, 0.5);
  }

  return { score: Math.max(0, Math.min(1, score)), signals, confidence };
}

// =============================================================================
// Qualify (with side effects: updates entry status + payload)
// =============================================================================

export function qualifyIdea(memoryDir: string, entry: MemoryIndexEntry): QualifyResult {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const rawText = (payload.raw_text as string) ?? entry.summary ?? '';
  const source = (payload.source as string) ?? entry.source ?? '';

  // Burst detection
  if (checkBurst(source)) {
    const result: QualifyResult = {
      score: 0,
      signals: ['burst_throttle'],
      decision: 'parked',
      park_reason: `burst: ${source} exceeded ${BURST_LIMIT}/${BURST_WINDOW_MS}ms`,
      confidence: 1.0,
    };
    applyQualifyResult(memoryDir, entry, result);
    return result;
  }

  const { score, signals, confidence } = scoreIdea(rawText, source);

  // Hysteresis: if this content_hash was previously parked, require higher score
  let effectiveThreshold = QUALIFY_THRESHOLD;
  const contentHash = payload.content_hash as string;
  if (contentHash && payload.prev_stale_reason) {
    const prevScore = (payload.prev_qualify_score as number) ?? 0;
    effectiveThreshold = Math.max(prevScore + HYSTERESIS_DELTA, HYSTERESIS_FLOOR);
    signals.push(`hysteresis:threshold=${effectiveThreshold.toFixed(2)}`);
  }

  // Duplicate near-match (trigram check against existing qualified/parked ideas)
  const nearDup = checkNearDuplicate(memoryDir, rawText, contentHash, signals);
  if (nearDup) {
    const result: QualifyResult = {
      score,
      signals: [...signals, `duplicate_near:-0.3 (similar to ${nearDup.slice(0, 12)})`],
      decision: 'parked',
      park_reason: `near-duplicate of ${nearDup.slice(0, 12)}`,
      confidence: 0.8,
    };
    applyQualifyResult(memoryDir, entry, result);
    return result;
  }

  const decision = score >= effectiveThreshold ? 'qualified' : 'parked';
  const parkReason = decision === 'parked'
    ? `score ${score.toFixed(2)} < threshold ${effectiveThreshold.toFixed(2)}`
    : undefined;

  const result: QualifyResult = { score, signals, decision, park_reason: parkReason, confidence };
  applyQualifyResult(memoryDir, entry, result);
  return result;
}

function applyQualifyResult(memoryDir: string, entry: MemoryIndexEntry, result: QualifyResult): void {
  const source = ((entry.payload as Record<string, unknown>)?.source as string) ?? '';
  const ttlDays = getTTLForSource(source);

  updateMemoryIndexEntry(memoryDir, entry.id, {
    status: result.decision,
    payload: {
      ...(entry.payload as Record<string, unknown>),
      qualify_score: result.score,
      qualify_signals: result.signals,
      qualify_decision: result.decision,
      qualify_confidence: result.confidence,
      ...(result.park_reason ? { park_reason: result.park_reason } : {}),
      ttl_days: ttlDays,
      qualify_at: new Date().toISOString(),
    },
  }).catch((err) => {
    logMechanism(memoryDir, {
      mechanism: 'idea-intake',
      action: 'qualify-write-failed',
      reason: `failed to update ${entry.id.slice(0, 12)}: ${err}`,
    });
  });
}

// =============================================================================
// Near-Duplicate Detection (trigram Jaccard)
// =============================================================================

function trigrams(text: string): Set<string> {
  const s = new Set<string>();
  const normalized = text.trim().toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i <= normalized.length - 3; i++) {
    s.add(normalized.slice(i, i + 3));
  }
  return s;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

const NEAR_DUP_THRESHOLD = 0.7;

function checkNearDuplicate(
  memoryDir: string, rawText: string, excludeHash?: string, signals?: string[],
): string | null {
  const existing = queryMemoryIndexSync(memoryDir, {
    type: ['idea'], status: ['qualified', 'pending', 'parked'],
  });
  const inputTrigrams = trigrams(rawText);
  if (inputTrigrams.size < 3) return null;

  for (const e of existing) {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    if (excludeHash && payload.content_hash === excludeHash) continue;
    const existingText = (payload.raw_text as string) ?? e.summary ?? '';
    const sim = jaccardSimilarity(inputTrigrams, trigrams(existingText));
    if (sim >= NEAR_DUP_THRESHOLD) {
      if (e.status === 'parked') {
        signals?.push(`near_dup_parked:${e.id.slice(0, 12)} (sim=${sim.toFixed(2)})`);
      }
      return e.id;
    }
  }
  return null;
}

// =============================================================================
// Parking Lot Maintenance
// =============================================================================

export function getTTLForSource(source: string): number {
  if (source.includes(':alex') || source === 'alex') return TTL_DAYS.alex;
  if (source.includes('discovery')) return TTL_DAYS.discovery;
  if (source.includes('cron') || source.includes('system')) return TTL_DAYS.cron;
  return DEFAULT_TTL_DAYS;
}

export async function cleanParkingLot(memoryDir: string): Promise<{ staled: number; evicted: number }> {
  const parked = queryMemoryIndexSync(memoryDir, { type: ['idea'], status: ['parked'] });
  const now = Date.now();
  let staled = 0;
  let evicted = 0;

  // TTL-based stale decay
  for (const entry of parked) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const qualifyAt = payload.qualify_at as string;
    const ttlDays = (payload.ttl_days as number) ?? DEFAULT_TTL_DAYS;

    if (qualifyAt) {
      const ageMs = now - new Date(qualifyAt).getTime();
      const ageDays = ageMs / 86_400_000;
      if (ageDays >= ttlDays) {
        await updateMemoryIndexEntry(memoryDir, entry.id, {
          status: 'stale',
          payload: {
            ...payload,
            stale_reason: payload.park_reason ?? 'TTL expired, no action taken',
            staled_at: new Date().toISOString(),
          },
        });
        staled++;
      }
    }
  }

  // Capacity-based eviction (LRU, prefer TTL-past-half)
  const remaining = queryMemoryIndexSync(memoryDir, { type: ['idea'], status: ['parked'] });
  if (remaining.length > PARKING_LOT_CAPACITY) {
    const sorted = remaining.sort((a, b) => {
      const pa = (a.payload ?? {}) as Record<string, unknown>;
      const pb = (b.payload ?? {}) as Record<string, unknown>;
      const qa = pa.qualify_at as string ?? a.ts;
      const qb = pb.qualify_at as string ?? b.ts;
      const ttlA = (pa.ttl_days as number) ?? DEFAULT_TTL_DAYS;
      const ttlB = (pb.ttl_days as number) ?? DEFAULT_TTL_DAYS;
      const ageA = (now - new Date(qa).getTime()) / 86_400_000;
      const ageB = (now - new Date(qb).getTime()) / 86_400_000;
      const ratioA = ageA / ttlA;
      const ratioB = ageB / ttlB;
      return ratioB - ratioA; // higher ratio = closer to TTL = evict first
    });

    const toEvict = sorted.slice(0, remaining.length - PARKING_LOT_CAPACITY);
    for (const entry of toEvict) {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      await updateMemoryIndexEntry(memoryDir, entry.id, {
        status: 'stale',
        payload: {
          ...payload,
          stale_reason: 'capacity_eviction',
          staled_at: new Date().toISOString(),
        },
      });
      evicted++;
    }
  }

  return { staled, evicted };
}
