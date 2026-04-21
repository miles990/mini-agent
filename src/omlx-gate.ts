/**
 * oMLX Gate — 本地 LLM 預處理層
 *
 * 在 Claude CLI 呼叫前做快速判斷，減少不必要的 Claude 消耗。
 * 核心原則：oMLX 做 Gate（二元判斷），不做 Transform（內容轉換）。
 *
 * 八個替換點：
 * R1: Perception 精簡 — 降低 output_cap + 移除低引用 sections（純邏輯，不用 LLM）
 * R2: Skills 篩選 — 改進 mode/keyword matching（純邏輯，不用 LLM）
 * R3: Cron gate — content hash + 0.8B 二元分類，skip 空輪詢（mtime 被 auto-commit 打敗，改用 content hash）
 * R4: Context delta — volatile-stripped hash 比對，skip 無變化 cycle（純邏輯，不用 LLM）
 * R5: Context Profile — trigger 類型 → 預定義 section 載入策略（純邏輯）
 * R6: Memory Index — FTS5 relational matching（純邏輯，在 memory-index.ts）
 * R7: Keyword Extraction — 0.8B 從 trigger/inbox 提取關鍵字，改善 section matching
 * R8: Response Cache — 相同 context hash 快取，避免重複 Claude 呼叫
 *
 * 0.8B 實測結論（2026-03-14）：
 * ✅ 二元分類 (yes/no) — 可靠
 * ✅ 短摘要 (<500 chars input) — 可靠
 * ❌ 大摘要 (>2K input) — 幻覺風險，會建議刪檔案
 * ❌ 結構化輸出 — 不遵守格式
 * ❌ 多選評分 — 偏激進，漏選
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { eventBus } from './event-bus.js';
import { notifyTelegram } from './telegram.js';

// =============================================================================
// Types
// =============================================================================

export type CronGateResult = 'skip' | 'claude';

export interface GateStats {
  cronSkipped: number;
  cronPassed: number;
  contextDeltaSkipped: number;
  contextDeltaPassed: number;
  perceptionSectionsPruned: number;
  skillsReduced: number;
  totalSaved: number; // estimated chars saved
}

// =============================================================================
// State
// =============================================================================

const stats: GateStats = {
  cronSkipped: 0,
  cronPassed: 0,
  contextDeltaSkipped: 0,
  contextDeltaPassed: 0,
  perceptionSectionsPruned: 0,
  skillsReduced: 0,
  totalSaved: 0,
};

/** Last content hash of HEARTBEAT.md (replaces mtime — auto-commit defeats mtime check) */
let lastHeartbeatContentHash = '';

/** Last context hash for delta detection */
let lastContextHash = '';

/** oMLX base URL and API key */
const omlxUrl = () => process.env.LOCAL_LLM_URL || 'http://localhost:8000';
const omlxKey = () => process.env.LOCAL_LLM_KEY || 'local';

/** oMLX health check — consecutive timeout tracking */
let consecutiveTimeouts = 0;
let lastHealthAlertTs = 0;

// =============================================================================
// Volatile Content Stripping
// =============================================================================

/**
 * Strip timestamps and other volatile fields that change every cycle
 * but don't represent meaningful content changes.
 * Used by R3 (HEARTBEAT hash) and R4 (context delta).
 */
function stripVolatileTimestamps(text: string): string {
  return text
    // ISO timestamps: 2026-03-15T10:56:12...
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s\])}<]*/g, 'TS')
    // Slash timestamps: 2026/3/15 10:56:12
    .replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}:\d{2}/g, 'TS')
    // "Current time: ..." lines
    .replace(/Current time:.*$/gm, 'Current time: TS')
    // Instance IDs (change per restart, not per cycle, but strip for safety)
    .replace(/Instance:\s*[0-9a-f]{8}/g, 'Instance: ID')
    // Cycle count references
    .replace(/[Cc]ycle\s*#?\d+/g, 'cycle #N')
    // Unix timestamps (13-digit milliseconds)
    .replace(/\b\d{13}\b/g, 'UTS');
}

// =============================================================================
// R3: Cron HEARTBEAT Gate
// =============================================================================

/**
 * Gate a cron task — decide whether it needs Claude or can be skipped.
 *
 * Two-layer check:
 * 1. content hash: if HEARTBEAT.md content unchanged (ignoring timestamps) → skip (zero LLM)
 * 2. 0.8B classification: content changed → heuristic + binary yes/no for actionable tasks
 *
 * Only gates HEARTBEAT-related cron tasks. Others pass through.
 */
export function cronGate(taskDescription: string): CronGateResult {
  // Only gate HEARTBEAT-related tasks
  if (!taskDescription.toLowerCase().includes('heartbeat')) {
    return 'claude';
  }

  const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');

  // Read file once for both Layer 1 (content hash) and Layer 2 (heuristic + 0.8B)
  let content: string;
  try {
    content = fs.readFileSync(heartbeatPath, 'utf-8');
  } catch {
    // File doesn't exist → pass through to Claude
    return 'claude';
  }

  // Layer 1: content hash check — zero LLM cost
  // (replaces mtime check — auto-commit changes mtime every cycle, defeating the gate)
  const stableContent = stripVolatileTimestamps(content);
  const contentHash = createHash('md5').update(stableContent).digest('hex');

  if (contentHash === lastHeartbeatContentHash && lastHeartbeatContentHash !== '') {
    stats.cronSkipped++;
    stats.totalSaved += 13000;
    eventBus.emit('log:info', {
      tag: 'omlx-gate', msg: `R3: HEARTBEAT content unchanged (hash), skipping Claude call`,
    });
    return 'skip';
  }
  lastHeartbeatContentHash = contentHash;

  // Layer 2: Pure code classification — zero LLM, checks if unchecked tasks are actionable
  // (Replaced 0.8B call — frees omlx GPU for Akari)

  if (!content.includes('- [ ]') && !content.includes('- []')) {
    stats.cronSkipped++;
    stats.totalSaved += 13000;
    eventBus.emit('log:info', {
      tag: 'omlx-gate', msg: `R3: HEARTBEAT has no unchecked tasks, skipping`,
    });
    return 'skip';
  }

  // Has unchecked tasks — check if any have actionable verbs
  const lines = content.split('\n').filter(l => /^- \[ ?\]/.test(l.trim()));
  const ACTION_VERBS = /\b(fix|implement|add|create|build|deploy|write|send|check|review|update|research|investigate|refactor|merge|push|test|publish|run)\b|測試|發佈|部署|修復|建立|檢查|研究|撰寫|送出|執行|更新/i;
  const hasActionable = lines.some(l => ACTION_VERBS.test(l));

  if (!hasActionable) {
    stats.cronSkipped++;
    stats.totalSaved += 13000;
    eventBus.emit('log:info', {
      tag: 'omlx-gate', msg: `R3: HEARTBEAT has ${lines.length} unchecked tasks but none actionable (no action verbs), skipping`,
    });
    return 'skip';
  }

  stats.cronPassed++;
  return 'claude';
}

// =============================================================================
// R4: Context Delta Detection
// =============================================================================

/**
 * Check if context has meaningfully changed since last cycle.
 * Pure hash comparison — no LLM needed.
 *
 * Returns true if context changed (should proceed), false if unchanged (can skip).
 */
export function hasContextChanged(context: string): boolean {
  const hash = createHash('md5').update(stripVolatileTimestamps(context)).digest('hex');

  if (hash === lastContextHash && lastContextHash !== '') {
    stats.contextDeltaSkipped++;
    stats.totalSaved += context.length;
    eventBus.emit('log:info', {
      tag: 'omlx-gate', msg: `R4: Context unchanged (hash match), cycle can be skipped`,
    });
    return false;
  }

  lastContextHash = hash;
  stats.contextDeltaPassed++;
  return true;
}

// =============================================================================
// R1: Perception Section Pruning
// =============================================================================

/**
 * Data-driven pruning list loaded from perception-citations.json.
 * No static list — pruning decisions come entirely from 5000+ cycles of citation data.
 * Updated on first call and every 100 cycles.
 */
let dynamicPruneSet: Set<string> | null = null;
let lastPruneRefreshCycle = 0;

/**
 * Load low-citation sections from perception-citations.json.
 * Sections with < 0.1% citation rate over 500+ cycles are candidates for pruning.
 * Conservative threshold: prune only truly dead sections, prefer extra tokens over false pruning.
 * Returns empty set when data is insufficient.
 */
function refreshDynamicPruneList(): Set<string> {
  const pruneSet = new Set<string>();

  try {
    const citationsPath = path.join(process.cwd(), 'memory', 'state', 'perception-citations.json');
    if (!fs.existsSync(citationsPath)) return pruneSet;

    const data = JSON.parse(fs.readFileSync(citationsPath, 'utf-8'));
    const totalCycles = data.cycleCount ?? 0;
    if (totalCycles < 500) return pruneSet; // Need substantial data before pruning

    const citations: Record<string, number> = data.citations ?? {};
    for (const [section, count] of Object.entries(citations)) {
      const rate = count / totalCycles;
      if (rate < 0.001) { // < 0.1% — only truly dead sections
        pruneSet.add(section);
      }
    }
  } catch { /* no data = no pruning */ }

  return pruneSet;
}

/**
 * Check if a perception section should be pruned from context.
 * Uses citation data to identify sections Kuro never references.
 */
export function shouldPruneSection(sectionName: string, cycleCount: number): boolean {
  // Refresh dynamic list every 100 cycles
  if (!dynamicPruneSet || cycleCount - lastPruneRefreshCycle >= 100) {
    dynamicPruneSet = refreshDynamicPruneList();
    lastPruneRefreshCycle = cycleCount;
  }

  if (dynamicPruneSet.has(sectionName)) {
    stats.perceptionSectionsPruned++;
    return true;
  }

  return false;
}

/**
 * Get a reduced output cap for perception sections.
 * High-citation sections keep full cap, others get reduced.
 */
const HIGH_CITATION_SECTIONS = new Set([
  'inner-voice', 'inbox', 'chat-room-inbox',
  'rumination-digest', 'forgotten-knowledge', 'heartbeat',
  'decision-quality-warning',
]);

export function getEffectiveOutputCap(sectionName: string, defaultCap: number): number {
  // High-citation sections keep full cap
  if (HIGH_CITATION_SECTIONS.has(sectionName)) return defaultCap;

  // Medium sections: reduce to 60%
  return Math.floor(defaultCap * 0.6);
}

// =============================================================================
// R2: Skills Filtering Enhancement
// =============================================================================

/**
 * Enhanced skills filtering — tighter mode matching + keyword precision.
 * Pure logic, no LLM.
 *
 * Returns a set of skill NAMES to EXCLUDE (not include) — additive filter.
 * Skill names are without extension (e.g. 'discipline' not 'discipline.md').
 * This preserves the existing getSkillsPrompt logic and only narrows it.
 */
export function getSkillsExcludeSet(cycleMode: string | undefined, contextHint: string): Set<string> {
  const exclude = new Set<string>();

  // In 'learn' mode, exclude action-heavy skills that inflate context
  if (cycleMode === 'learn') {
    exclude.add('self-deploy');
    exclude.add('github-ops');
    exclude.add('publish-content');
    exclude.add('social-presence');
    exclude.add('grow-audience');
    exclude.add('community-engage');
  }

  // In 'reflect' mode, only need autonomous-behavior
  if (cycleMode === 'reflect') {
    exclude.add('self-deploy');
    exclude.add('github-ops');
    exclude.add('publish-content');
    exclude.add('social-presence');
    exclude.add('grow-audience');
    exclude.add('community-engage');
    exclude.add('delegation');
    exclude.add('web-learning');
    exclude.add('web-research');
  }

  // discipline is 31K — only load when quality/review-related context
  if (cycleMode && !contextHint.includes('review') && !contextHint.includes('quality')
    && !contextHint.includes('discipline') && !contextHint.includes('improve')) {
    exclude.add('discipline');
  }

  return exclude;
}

// =============================================================================
// R5: Context Profile System
// =============================================================================

/**
 * Context profiles define which sections to load for each trigger type.
 * Replaces scattered keyword/isLight checks with unified profile-based loading.
 *
 * Three tiers:
 * - core: always loaded regardless of profile
 * - standard: loaded for most profiles, skipped for lightweight ones
 * - conditional: only loaded when keyword-matched or profile explicitly includes
 */

export type ContextProfile = 'dm' | 'cron' | 'heartbeat' | 'workspace' | 'autonomous' | 'continuation';

export interface ProfileConfig {
  /** Max conversations to include */
  maxConversations: number;
  /** Topic memory budget in chars */
  topicBudget: number;
  /** Whether to load deep context (threads, inner-voice, conversation-threads, trail) */
  loadDeepContext: boolean;
  /** Extra keywords to inject into contextHint for section matching */
  extraHints: string[];
  /** Sections to force-skip even if keyword-matched */
  skipSections: Set<string>;
  /** Context budget in chars. Empirical: prompts <35K → 0% EXIT143, >50K → 100% EXIT143. */
  contextBudget: number;
}

const CONTEXT_PROFILES: Record<ContextProfile, ProfileConfig> = {
  dm: {
    maxConversations: 15,
    topicBudget: 10000,
    loadDeepContext: true,
    extraHints: [],
    skipSections: new Set(),
    contextBudget: 35_000, // DM needs rich context but must stay within CLI stability limit
  },
  heartbeat: {
    maxConversations: 3,
    topicBudget: 2000,
    loadDeepContext: false,
    extraHints: ['task', 'schedule', 'heartbeat'],
    skipSections: new Set(['temporal', 'trail', 'achievements', 'route-efficiency', 'commitments']),
    contextBudget: 18_000, // heartbeat = routine check, minimal context needed
  },
  cron: {
    maxConversations: 3,
    topicBudget: 2000,
    loadDeepContext: false,
    extraHints: ['cron', 'schedule', 'task'],
    skipSections: new Set(['temporal', 'trail', 'achievements', 'route-efficiency', 'commitments']),
    contextBudget: 20_000, // cron tasks are scoped, moderate context
  },
  workspace: {
    maxConversations: 5,
    topicBudget: 3000,
    loadDeepContext: false,
    extraHints: ['workspace', 'git', 'file', 'change'],
    skipSections: new Set(['temporal', 'achievements', 'commitments']),
    contextBudget: 22_000, // workspace changes need code context but not full history
  },
  autonomous: {
    maxConversations: 8,
    topicBudget: 8000,
    loadDeepContext: true,
    extraHints: [],
    skipSections: new Set(),
    contextBudget: 32_000, // autonomous cycles need broad awareness
  },
  continuation: {
    maxConversations: 3,
    topicBudget: 2000,
    loadDeepContext: false,
    extraHints: [],
    skipSections: new Set(['temporal', 'trail', 'achievements', 'route-efficiency', 'stale-tasks']),
    contextBudget: 18_000, // continuation = focused follow-up, lean context
  },
};

/**
 * Classify a trigger string into a context profile.
 * Pure logic — no LLM needed.
 */
export function classifyContextProfile(trigger: string | undefined): ContextProfile {
  if (!trigger) return 'autonomous';
  const t = trigger.toLowerCase();

  // DM triggers — load everything
  if (t.startsWith('telegram-user') || t.startsWith('room') || t.startsWith('chat')
    || t.startsWith('direct-message') || t.startsWith('foreground')) return 'dm';

  // Cron triggers
  if (t.startsWith('cron:') || t.startsWith('cron(')) return 'cron';

  // Heartbeat
  if (t.includes('heartbeat')) return 'heartbeat';

  // Workspace changes
  if (t.startsWith('workspace') || t.startsWith('file-change') || t.startsWith('git-')) return 'workspace';

  // Continuation from previous cycle
  if (t.startsWith('continuation') || t === 'now') return 'continuation';

  // Delegation results — absorb output, doesn't need full CLAUDE.md
  if (t.startsWith('delegation-complete') || t.startsWith('delegation-batch')) return 'continuation';

  // Startup / alert — treat as heartbeat (Tier 1)
  if (t.startsWith('startup') || t.startsWith('alert')) return 'heartbeat';

  return 'autonomous';
}

/**
 * Get the profile config for a trigger.
 */
export function getContextProfileConfig(trigger: string | undefined): ProfileConfig {
  const profile = classifyContextProfile(trigger);
  return CONTEXT_PROFILES[profile];
}

/**
 * Check if a section should be loaded for the current profile.
 * Returns false if the profile explicitly skips this section.
 */
export function shouldLoadForProfile(section: string, trigger: string | undefined): boolean {
  const profile = classifyContextProfile(trigger);
  const config = CONTEXT_PROFILES[profile];
  return !config.skipSections.has(section);
}

// =============================================================================
// R7: oMLX Keyword Extraction
// =============================================================================

/** Cache for extracted keywords — one per cycle, keyed by input hash */
let keywordCache: { hash: string; keywords: string[] } | null = null;

/**
 * Extract keywords from trigger/inbox text using oMLX 0.8B.
 * Returns extracted keywords or falls back to simple word extraction.
 * Results are cached within the same cycle (same input = same output).
 */
/**
 * R7: Pure code keyword extraction — zero LLM (frees omlx GPU for Akari)
 * Uses TF-IDF-like scoring: filter stop words, prefer longer/rarer words
 */
const STOP_WORDS = new Set(['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','has','have','from','with','they','been','this','that','will','each','make','like','into','than','them','then','some','what','when','which','their','about','would','there','these','other','could','after','should','also','just','more','only','very','most','same','still','back','well','much','even','know','over','here','take','only','come','made','need','does','said','going','being','before','where','between','while','though','really','those','since','right','thing','doing','little','getting','during','looking','without','through','first','think','might','every','because','another','something','already','using','actually','possible','currently'])

export function extractKeywordsWithOMLX(text: string): string[] {
  if (text.length < 20) {
    return text.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  }

  const hash = createHash('md5').update(text).digest('hex').slice(0, 8);
  if (keywordCache?.hash === hash) return keywordCache.keywords;

  const input = text.slice(0, 400).toLowerCase();

  // Extract words, filter stop words, score by length + uniqueness
  const words = input
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  // Score: longer words + moderate frequency preferred
  const scored = [...freq.entries()]
    .map(([word, count]) => ({ word, score: word.length * Math.min(count, 3) }))
    .sort((a, b) => b.score - a.score);

  const keywords = scored.slice(0, 5).map(s => s.word);

  keywordCache = { hash, keywords };
  stats.totalSaved += 500;
  eventBus.emit('log:info', {
    tag: 'omlx-gate', msg: `R7: Extracted ${keywords.length} keywords: ${keywords.join(', ')}`,
  });
  return keywords;
}

// =============================================================================
// R8: Response Cache
// =============================================================================

interface CachedResponse {
  response: string;
  timestamp: number;
}

/** Context hash → cached response. Only for non-DM triggers. */
const responseCache = new Map<string, CachedResponse>();

/** Cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Max cache entries */
const CACHE_MAX_SIZE = 20;

/**
 * Check if we have a cached response for this context.
 * Only caches non-DM cycles (cron, heartbeat, autonomous).
 */
export function getCachedResponse(contextHash: string, trigger: string | undefined): string | null {
  // Never cache DM responses
  const profile = classifyContextProfile(trigger);
  if (profile === 'dm') return null;

  const cached = responseCache.get(contextHash);
  if (!cached) return null;

  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    responseCache.delete(contextHash);
    return null;
  }

  stats.totalSaved += cached.response.length;
  eventBus.emit('log:info', {
    tag: 'omlx-gate', msg: `R8: Cache hit for context hash ${contextHash.slice(0, 8)}, saved ~${Math.round(cached.response.length / 1000)}K`,
  });
  return cached.response;
}

/**
 * Store a response in cache for future identical contexts.
 */
export function cacheResponse(contextHash: string, response: string, trigger: string | undefined): void {
  const profile = classifyContextProfile(trigger);
  if (profile === 'dm') return;

  // Evict old entries if at capacity
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const oldest = [...responseCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }

  responseCache.set(contextHash, { response, timestamp: Date.now() });
}

/**
 * Generate a hash for the full context (for cache keying).
 */
export function hashContext(context: string): string {
  return createHash('md5').update(context).digest('hex');
}

// =============================================================================
// Stats & Observability
// =============================================================================

export function getGateStats(): GateStats {
  return { ...stats };
}

export function resetGateStats(): void {
  Object.assign(stats, {
    cronSkipped: 0, cronPassed: 0,
    contextDeltaSkipped: 0, contextDeltaPassed: 0,
    perceptionSectionsPruned: 0, skillsReduced: 0,
    totalSaved: 0,
  });
}

/**
 * Format gate stats for perception/observability injection.
 */
export function formatGateStats(): string {
  const total = stats.cronSkipped + stats.cronPassed;
  if (total === 0 && stats.perceptionSectionsPruned === 0) return '';

  const cronRate = total > 0 ? Math.round((stats.cronSkipped / total) * 100) : 0;
  const parts: string[] = [];
  if (total > 0) parts.push(`Cron gate: ${stats.cronSkipped}/${total} skipped (${cronRate}%)`);
  if (stats.contextDeltaSkipped > 0) parts.push(`Context delta: ${stats.contextDeltaSkipped} unchanged cycles detected`);
  if (stats.perceptionSectionsPruned > 0) parts.push(`Perception pruned: ${stats.perceptionSectionsPruned} low-citation sections`);
  if (stats.totalSaved > 0) parts.push(`Est. saved: ~${Math.round(stats.totalSaved / 1000)}K chars`);

  return parts.join(' | ');
}

// =============================================================================
// Local LLM Helper
// =============================================================================

/**
 * Call local LLM via curl (sync). ~10ms overhead vs ~800ms for Node.js subprocess.
 * Falls back gracefully on timeout/error (callers catch exceptions).
 * Retries once on timeout — data shows second attempt often succeeds in <1s (model warm-up).
 */
function callLocalLLM(model: string, prompt: string, maxTokens: number, timeoutMs: number): string {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  const args = [
    '-sf',
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${omlxKey()}`,
    '-d', '@-',
    `${omlxUrl()}/v1/chat/completions`,
  ];
  const opts = { encoding: 'utf-8' as const, timeout: timeoutMs + 1000, input: body };
  let stdout: string;
  try {
    stdout = execFileSync('curl', args, opts);
  } catch {
    // Retry once — oMLX often responds fast on second attempt after cold-start timeout
    try {
      stdout = execFileSync('curl', args, opts);
    } catch {
      consecutiveTimeouts++;
      // Alert on 3 consecutive timeouts, throttle to once per 10 minutes
      if (consecutiveTimeouts >= 3 && Date.now() - lastHealthAlertTs > 600_000) {
        lastHealthAlertTs = Date.now();
        notifyTelegram(`⚠️ oMLX health: ${consecutiveTimeouts} consecutive timeouts on ${model}`).catch(() => {});
      }
      throw new Error(`oMLX timeout (consecutive: ${consecutiveTimeouts})`);
    }
  }
  consecutiveTimeouts = 0; // reset on success
  const data = JSON.parse(stdout);
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Call 0.8B for binary classification (yes/no).
 * Synchronous — blocks for up to timeoutMs.
 */
export function callLocalFast(prompt: string, maxTokens: number, timeoutMs = 15_000): string {
  return callLocalLLM('Qwen3.5-0.8B-MLX-4bit', prompt, maxTokens, timeoutMs);
}

/**
 * Call 4B for short generative tasks (summaries, rewrites).
 * Synchronous — blocks for up to timeoutMs.
 */
export function callLocalSmart(prompt: string, maxTokens: number, timeoutMs = 15_000): string {
  return callLocalLLM('Qwen3.5-4B-MLX-4bit', prompt, maxTokens, timeoutMs);
}

// =============================================================================
// Async Local LLM — Phase B concurrent infrastructure
// =============================================================================

/**
 * Circuit breaker state for async calls.
 * 3 consecutive failures → 10 min cooldown (fail-open during cooldown).
 */
let circuitBreakerFailures = 0;
let circuitBreakerOpenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function isCircuitOpen(): boolean {
  if (circuitBreakerOpenUntil === 0) return false;
  if (Date.now() >= circuitBreakerOpenUntil) {
    // Cooldown expired — half-open: allow one attempt
    circuitBreakerOpenUntil = 0;
    circuitBreakerFailures = 0;
    eventBus.emit('log:info', { tag: 'omlx-gate', msg: 'Circuit breaker: half-open, allowing attempt' });
    return false;
  }
  return true;
}

function recordCircuitSuccess(): void {
  circuitBreakerFailures = 0;
  circuitBreakerOpenUntil = 0;
}

function recordCircuitFailure(): void {
  circuitBreakerFailures++;
  if (circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    eventBus.emit('log:info', {
      tag: 'omlx-gate', msg: `Circuit breaker OPEN: ${circuitBreakerFailures} consecutive failures, cooldown ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`,
    });
    notifyTelegram(`⚠️ oMLX circuit breaker open: ${circuitBreakerFailures} failures, 10min cooldown`).catch(() => {});
  }
}

/** Get circuit breaker status for observability */
export function getCircuitBreakerStatus(): { open: boolean; failures: number; cooldownRemaining: number } {
  return {
    open: isCircuitOpen(),
    failures: circuitBreakerFailures,
    cooldownRemaining: Math.max(0, circuitBreakerOpenUntil - Date.now()),
  };
}

/**
 * Async call to local LLM via fetch (non-blocking).
 * Uses circuit breaker — returns null when circuit is open (fail-open).
 * Retries once on failure (same as sync version).
 */
async function callLocalLLMAsync(
  model: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  if (isCircuitOpen()) {
    eventBus.emit('log:info', { tag: 'omlx-gate', msg: 'Circuit breaker open, skipping async call' });
    return null;
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  });

  const doFetch = async (): Promise<string> => {
    const res = await fetch(`${omlxUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${omlxKey()}`,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`oMLX HTTP ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  };

  try {
    const result = await doFetch();
    return result;
  } catch {
    // Retry once
    try {
      const result = await doFetch();
      return result;
    } catch {
      return null;
    }
  }
}

/**
 * Async call to 0.8B. Returns null on failure (fail-open).
 */
export async function callLocalFastAsync(prompt: string, maxTokens: number, timeoutMs = 15_000): Promise<string | null> {
  return callLocalLLMAsync('Qwen3.5-0.8B-MLX-4bit', prompt, maxTokens, timeoutMs);
}

// =============================================================================
// Concurrent Execution
// =============================================================================

export interface LocalLLMTask {
  id: string;
  prompt: string;
  maxTokens: number;
  timeoutMs?: number;
}

export interface LocalLLMResult {
  id: string;
  content: string | null;
  latencyMs: number;
  error?: string;
}

/**
 * Run multiple 0.8B tasks concurrently with a concurrency limit.
 * Sweet spot: 2-3 concurrent (benchmark: 3 concurrent ~200ms, 15.1 req/s).
 *
 * Returns results in the same order as input tasks.
 * Failed tasks have content=null and error set.
 * Circuit breaker applies — if open, all tasks return null immediately.
 */
export async function callLocalConcurrent(
  tasks: LocalLLMTask[],
  maxConcurrency: number = 3,
): Promise<LocalLLMResult[]> {
  if (tasks.length === 0) return [];

  // Circuit breaker short-circuit: all tasks fail-open
  if (isCircuitOpen()) {
    return tasks.map(t => ({
      id: t.id,
      content: null,
      latencyMs: 0,
      error: 'circuit-breaker-open',
    }));
  }

  const results: LocalLLMResult[] = new Array(tasks.length);
  let nextIdx = 0;

  const runTask = async (taskIdx: number): Promise<void> => {
    const task = tasks[taskIdx];
    const start = Date.now();
    try {
      const content = await callLocalFastAsync(task.prompt, task.maxTokens, task.timeoutMs ?? 15_000);
      results[taskIdx] = {
        id: task.id,
        content,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      results[taskIdx] = {
        id: task.id,
        content: null,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Semaphore-based concurrency control
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(maxConcurrency, tasks.length); i++) {
    workers.push((async () => {
      while (nextIdx < tasks.length) {
        const idx = nextIdx++;
        await runTask(idx);
      }
    })());
  }

  await Promise.all(workers);

  // Batch-level circuit breaker accounting — one event per batch, not per concurrent call.
  // Prevents a single slow batch (N tasks all timeout) from firing N recordCircuitFailure() calls.
  const succeeded = results.filter(r => r.content !== null).length;
  if (succeeded > 0) {
    recordCircuitSuccess();
  } else {
    recordCircuitFailure(); // counts as 1 bad batch, not N
  }

  const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
  const avgLatency = tasks.length > 0 ? Math.round(totalLatency / tasks.length) : 0;
  eventBus.emit('log:info', {
    tag: 'omlx-gate', msg: `Concurrent: ${succeeded}/${tasks.length} ok, avg ${avgLatency}ms, max-concurrency ${maxConcurrency}`,
  });

  return results;
}
