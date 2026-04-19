/**
 * Cycle State Persistence — Crash Resume, Work Journal, Trail
 *
 * Extracted from loop.ts for modularity.
 * All functions are fire-and-forget (catch errors silently).
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { getMemoryStateDir } from './memory.js';

// =============================================================================
// Cycle Checkpoint (Crash Resume)
// =============================================================================

export interface CycleCheckpoint {
  startedAt: string;
  mode: 'task' | 'autonomous' | 'idle';
  triggerReason: string | null;
  promptSnippet: string;
  partialOutput: string | null;
  lastAction: string | null;
  lastAutonomousActions: string[];
  // Side Effect Tracking (Layer 4)
  sideEffects?: string[];
  tagsProcessed?: string[];
  pendingPriorityInfo?: string | null;
}

function getCycleCheckpointPath(): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getInstanceDir(instanceId), 'cycle-state.json');
  } catch { return null; }
}

export function saveCycleCheckpoint(data: CycleCheckpoint): void {
  const filePath = getCycleCheckpointPath();
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch { /* fire-and-forget */ }
}

export function clearCycleCheckpoint(): void {
  const filePath = getCycleCheckpointPath();
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* fire-and-forget */ }
}

export function loadStaleCheckpoint(): { info: string; triggerReason: string | null; lastAction: string | null; lastAutonomousActions: string[]; sideEffects?: string[] } | null {
  const filePath = getCycleCheckpointPath();
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as CycleCheckpoint;

    // Only recover checkpoints < 1h old
    const age = Date.now() - new Date(data.startedAt).getTime();
    if (age > 3_600_000) {
      slog('RESUME', 'Stale checkpoint found but too old (>1h), ignoring');
      fs.unlinkSync(filePath);
      return null;
    }

    const partial = data.partialOutput ? ` Partial output: ${data.partialOutput.slice(0, 200)}` : '';
    const sideEffectHint = data.sideEffects?.length
      ? `\nAlready completed side effects (DO NOT repeat): ${data.sideEffects.join('; ')}`
      : '';
    const info = `Mode: ${data.mode}, Trigger: ${data.triggerReason ?? 'unknown'}, Prompt: ${data.promptSnippet}${partial}${sideEffectHint}`;

    slog('RESUME', `Detected interrupted cycle from ${data.startedAt}${data.sideEffects?.length ? ` (${data.sideEffects.length} side effects)` : ''}`);
    fs.unlinkSync(filePath);

    return {
      info,
      triggerReason: data.triggerReason,
      lastAction: data.lastAction,
      lastAutonomousActions: data.lastAutonomousActions,
      sideEffects: data.sideEffects,
    };
  } catch {
    // JSON parse failure or other error — degrade gracefully
    try { if (filePath) fs.unlinkSync(filePath); } catch { /* */ }
    return null;
  }
}

// =============================================================================
// Work Journal (cross-restart context continuity)
// =============================================================================

export interface WorkJournalEntry {
  ts: string;
  cycle: number;
  action: string;
  trigger: string | null;
  tags: string[];
  sideEffects: string[];
}

function getWorkJournalPath(): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getMemoryStateDir(), 'work-journal.jsonl');
  } catch { return null; }
}

export function writeWorkJournal(entry: WorkJournalEntry): void {
  const filePath = getWorkJournalPath();
  if (!filePath) return;
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    // Trim to last 50 entries to prevent unbounded growth
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 50) {
      fs.writeFileSync(filePath, lines.slice(-50).join('\n') + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

export function loadWorkJournal(limit: number = 5): WorkJournalEntry[] {
  const filePath = getWorkJournalPath();
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l) as WorkJournalEntry);
  } catch { return []; }
}

export function formatWorkJournalContext(entries: WorkJournalEntry[]): string {
  const lines = entries.map(e => {
    const tagsStr = e.tags.length > 0 ? ` [${e.tags.join(',')}]` : '';
    const effects = e.sideEffects.length > 0 ? ` → ${e.sideEffects.join('; ')}` : '';
    return `- #${e.cycle} (${e.trigger ?? 'auto'}): ${e.action.slice(0, 200)}${tagsStr}${effects}`;
  });
  return `Work journal from before restart (continue relevant work, honor commitments):\n${lines.join('\n')}`;
}

// =============================================================================
// Reasoning Continuity — Cross-cycle reasoning preservation
// =============================================================================

export interface ReasoningSnapshot {
  ts: string;
  cycle: number;
  trigger: string | null;
  decision: string;       // ## Decision section (chose/skipped/context)
  innerNotes: string | null;  // <kuro:inner> content if present
  keyInsights: string[];  // remember topics from this cycle
}

const REASONING_MAX_ENTRIES = 10;

function getReasoningPath(): string | null {
  try {
    return path.join(getMemoryStateDir(), 'reasoning-history.jsonl');
  } catch { return null; }
}

/** Extract ## Decision section from Claude response */
export function extractDecisionSection(response: string): string {
  // Try inside <kuro:action> first
  const actionMatch = response.match(/<kuro:action>([\s\S]*?)<\/kuro:action>/);
  const searchIn = actionMatch ? actionMatch[1] : response;

  // Extract from ## Decision to next ## header or end
  const decisionMatch = searchIn.match(/## Decision\n([\s\S]*?)(?=\n## |\n<kuro:|$)/);
  if (decisionMatch) return decisionMatch[1].trim().slice(0, 500);

  // Fallback: extract chose/skipped lines
  const choseMatch = searchIn.match(/chose:\s*(.+)/);
  const skippedMatch = searchIn.match(/skipped:\s*(.+)/);
  const contextMatch = searchIn.match(/context:\s*(.+)/);
  const parts: string[] = [];
  if (choseMatch) parts.push(`chose: ${choseMatch[1].trim()}`);
  if (skippedMatch) parts.push(`skipped: ${skippedMatch[1].trim()}`);
  if (contextMatch) parts.push(`context: ${contextMatch[1].trim()}`);
  return parts.join('\n').slice(0, 500) || '';
}

/** Extract <kuro:inner> content from response */
export function extractInnerNotes(response: string): string | null {
  const match = response.match(/<kuro:inner>([\s\S]*?)<\/kuro:inner>/);
  return match ? match[1].trim().slice(0, 800) : null;
}

export function saveReasoningSnapshot(entry: ReasoningSnapshot): void {
  const filePath = getReasoningPath();
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    // Ring buffer
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > REASONING_MAX_ENTRIES) {
      fs.writeFileSync(filePath, lines.slice(-REASONING_MAX_ENTRIES).join('\n') + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

export function loadReasoningHistory(limit: number = 3): ReasoningSnapshot[] {
  const filePath = getReasoningPath();
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l) as ReasoningSnapshot);
  } catch { return []; }
}

export function formatReasoningContext(entries: ReasoningSnapshot[]): string {
  if (entries.length === 0) return '';
  const sections = entries.map(e => {
    const lines: string[] = [`**Cycle #${e.cycle}** (${e.trigger ?? 'auto'}, ${new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })})`];
    if (e.decision) lines.push(e.decision);
    if (e.keyInsights.length > 0) lines.push(`Saved: ${e.keyInsights.join(', ')}`);
    if (e.innerNotes) lines.push(`Working memory: ${e.innerNotes.slice(0, 200)}`);
    return lines.join('\n');
  });
  return `<reasoning-continuity>
Your reasoning from recent cycles — use this to maintain thought continuity and avoid repeating decisions:

${sections.join('\n---\n')}
</reasoning-continuity>`;
}

// =============================================================================
// Stimulus Fingerprint — Cross-cycle duplicate-response prevention
// =============================================================================

export interface StimulusFingerprintEntry {
  ts: string;
  fingerprint: string;
  trigger: string | null;
  action: string | null;
  topics: string[];
}

const STIMULUS_FINGERPRINT_MAX_ENTRIES = 200;
const STIMULUS_FINGERPRINT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

function getStimulusFingerprintPath(): string | null {
  try {
    return path.join(getMemoryStateDir(), 'stimulus-fingerprints.jsonl');
  } catch { return null; }
}

export function buildStimulusFingerprint(
  triggerReason: string | null,
  loadedTopics: string[],
): string {
  try {
    const triggerBase = (triggerReason ?? 'auto').split(/[:(]/)[0]?.trim().toLowerCase() || 'auto';
    const normalizedTopics = [...new Set(loadedTopics.map(t => t.trim().toLowerCase()).filter(Boolean))].sort();
    return `${triggerBase}|${normalizedTopics.join(',')}`;
  } catch {
    return 'auto|';
  }
}

export function hasRecentStimulusFingerprint(fingerprint: string): boolean {
  const filePath = getStimulusFingerprintPath();
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) return false;

    const now = Date.now();
    for (const line of lines.slice(-50).reverse()) {
      try {
        const entry = JSON.parse(line) as StimulusFingerprintEntry;
        const age = now - new Date(entry.ts).getTime();
        if (age > STIMULUS_FINGERPRINT_WINDOW_MS) break;
        if (entry.fingerprint === fingerprint) return true;
      } catch { continue; }
    }
    return false;
  } catch { return false; }
}

export function writeStimulusFingerprint(entry: StimulusFingerprintEntry): void {
  const filePath = getStimulusFingerprintPath();
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > STIMULUS_FINGERPRINT_MAX_ENTRIES) {
      fs.writeFileSync(filePath, lines.slice(-STIMULUS_FINGERPRINT_MAX_ENTRIES).join('\n') + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Trail — Shared Attention History (Chemical Gradient)
// =============================================================================

export interface TrailEntry {
  ts: string;
  agent: 'kuro' | 'mushi';
  type: 'focus' | 'cite' | 'triage' | 'scout';
  decision?: 'wake' | 'skip' | 'quick';
  topics: string[];
  detail: string;
  decay_h: number;
}

const TRAIL_MAX_ENTRIES = 500; // ~24h at normal cycle rate

export function getTrailPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.mini-agent', 'trail.jsonl');
}

export function writeTrailEntry(entry: TrailEntry): void {
  const filePath = getTrailPath();
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

    // Ring buffer: trim to TRAIL_MAX_ENTRIES
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > TRAIL_MAX_ENTRIES) {
      fs.writeFileSync(filePath, lines.slice(-TRAIL_MAX_ENTRIES).join('\n') + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

export function extractTrailTopics(
  triggerReason: string | null,
  topicList: string[],
  sideEffects: string[],
  action: string | null,
): string[] {
  const topics = new Set<string>();

  // From trigger reason (e.g., "telegram-user", "workspace", "heartbeat:cron")
  if (triggerReason) {
    const triggerBase = triggerReason.split(/[:\s]/)[0];
    if (triggerBase) topics.add(triggerBase);
  }

  // From remember topics
  for (const t of topicList) topics.add(t);

  // From side effects (e.g., "remember:mushi", "chat:...")
  for (const se of sideEffects) {
    const [type, target] = se.split(':');
    if (type === 'remember' && target) topics.add(target);
  }

  // From action text — extract mentioned topic-like keywords
  if (action) {
    const knownTopics = ['mushi', 'portfolio', 'inner-voice', 'x-twitter', 'github', 'devto', 'learning'];
    for (const kw of knownTopics) {
      if (action.toLowerCase().includes(kw)) topics.add(kw);
    }
  }

  return [...topics];
}

// =============================================================================
// Research Loop Gate — detect consecutive research-only cycles
// =============================================================================

/** Check if a work journal entry represents research/learn-only activity (no concrete output) */
function isResearchOnlyAction(entry: WorkJournalEntry): boolean {
  const action = entry.action.toLowerCase();
  const effects = entry.sideEffects;

  // Has code/create delegation? → concrete output
  if (effects.some(e => e.startsWith('delegate:code') || e.startsWith('delegate:create'))) return false;

  // Concrete output keywords in action text
  const concretePatterns = [
    'commit', 'push', 'deploy', 'pr ', 'pull request',
    'wrote', 'created', 'fixed', 'implemented', 'refactor',
    'build', 'pipeline', 'generated', 'publish',
    '生成', '建立', '修復', '實作', '部署', '寫了', '改了',
  ];
  if (concretePatterns.some(p => action.includes(p))) return false;

  // Research/learn indicators
  const researchPatterns = [
    'research', 'learn', 'read', 'fetch', 'summarize', 'study',
    'explore', 'investigate', 'analyze', 'review', 'scan',
    '研究', '分析', '探索', '學習', '調查', '掃描',
  ];
  const hasResearch = researchPatterns.some(p => action.includes(p));

  // Only passive effects (remember, chat, research/learn delegation)
  const hasOnlyPassiveEffects = effects.length > 0 && effects.every(e =>
    e.startsWith('remember:') || e.startsWith('chat:') ||
    e.startsWith('delegate:research') || e.startsWith('delegate:learn'),
  );

  return hasResearch || hasOnlyPassiveEffects;
}

export interface ResearchLoopResult {
  warning: string;
  count: number;
}

/**
 * Detect consecutive active cycles with only research/learn actions.
 * Returns structured result with warning + count if 3+ consecutive research-only cycles detected.
 * The count enables escalation: 3+ = prompt warning, mode also forced to 'act' by loop.ts.
 */
export function detectResearchLoop(limit: number = 10): ResearchLoopResult | null {
  const entries = loadWorkJournal(limit);
  // Filter to active cycles (skip no-action)
  const active = entries.filter(e => e.action !== 'no-action');
  if (active.length < 3) return null;

  let consecutive = 0;
  for (let i = active.length - 1; i >= 0; i--) {
    if (isResearchOnlyAction(active[i])) {
      consecutive++;
    } else {
      break;
    }
  }

  if (consecutive >= 3) {
    const hard = consecutive >= 5 ? ' 連續研究太久了 — 這些研究產出了什麼可見結果？' : '';
    return {
      warning: `⚠️ ${consecutive} 個連續研究 cycle。收斂條件：這些研究推進了什麼具體目標？${hard}`,
      count: consecutive,
    };
  }
  return null;
}
