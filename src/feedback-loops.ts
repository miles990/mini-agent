/**
 * Intelligent Feedback Loops — Phase 2 Self-Learning
 *
 * 四個 fire-and-forget 回饋迴路：
 * - Loop A: 錯誤模式識別 → 自動建修復任務
 * - Loop B: 感知引用追蹤 → 動態調頻
 * - Loop C: 決策品質自我審計
 * - Loop E: CRS Baseline — 每 cycle 記錄 context/citation/score 數據
 *
 * 全部 fire-and-forget，不影響 OODA cycle。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { getMemoryRootDir, resolveMemoryPath } from './memory-paths.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';  // getInstanceDir kept for features.json (ephemeral)
import { getLogger } from './logging.js';
import { perceptionStreams } from './perception-stream.js';
import { slog, readJsonFile } from './utils.js';
import { getMemory, getMemoryStateDir, invalidateFlagCache } from './memory.js';

// =============================================================================
// Types
// =============================================================================

interface ErrorPatternState {
  [key: string]: {
    count: number;
    taskCreated: boolean;
    lastSeen: string;
    lastMessage?: string;
    resolvedAt?: string;
    resolvedBy?: string;
  };
}

interface PerceptionCitationState {
  cycleCount: number;
  citations: Record<string, number>;
  /** Sliding window: each entry = set of section names cited in that cycle */
  recentWindow: string[][];
  /** Persisted interval adjustments (survives restart) */
  adjustedIntervals: Record<string, number>;
  lastAdjusted: string;
}

interface DecisionQualityState {
  recentScores: number[];
  avgScore: number;
  warningInjected: boolean;
  lastWarningAt: string | null;
  lastEscalationAt: string | null;
  consecutiveWarningCycles: number;
  // Self-Challenge tracking
  challengeTotal: number;
  challengeCompliant: number;
  lastChallengeWarningAt: string | null;
}

// =============================================================================
// Helpers — in-memory state cache + dirty flag
// =============================================================================

const stateCache = new Map<string, { data: unknown; dirty: boolean }>();

function getStatePath(filename: string): string {
  return path.join(getMemoryStateDir(), filename);
}

export function readState<T>(filename: string, fallback: T): T {
  const cached = stateCache.get(filename);
  if (cached) return cached.data as T;

  const data = readJsonFile(getStatePath(filename), fallback);
  stateCache.set(filename, { data, dirty: false });
  return data;
}

export function writeState(filename: string, data: unknown): void {
  stateCache.set(filename, { data, dirty: true });
}

/** Flush all dirty state files to disk. Call once at cycle end. */
export function flushFeedbackState(): void {
  for (const [filename, entry] of stateCache) {
    if (entry.dirty) {
      const p = getStatePath(filename);
      const dir = path.dirname(p);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      try {
        writeFileSync(p, JSON.stringify(entry.data, null, 2), 'utf-8');
      } catch { /* best effort */ }
      entry.dirty = false;
    }
  }
}

// =============================================================================
// Loop A: Error Pattern Detection
// =============================================================================

/**
 * Subtypes 代表「保護機制正常工作」而非 bug — 不該進入 recurring-error task 通道。
 * 這些 event 仍會計入 metrics.recurringErrorCount 作為觀察面 signal，但不建 P1 fix task。
 *   - memory_guard: agent.ts:670 pre-spawn OOM prevention (freeMemMB < 500MB deferral)
 *   - max_turns: agent runaway prevention
 *   - sigterm_preempt / sigterm_foreground_preempt: user/pipeline 主動中斷 (normal flow)
 *   - sigterm_shutdown: server graceful shutdown 連帶 kill subprocess
 *   - sigterm_progress / sigterm_hard / sigterm_circuit_breaker: 我們自己的 timeout/circuit 主動 kill
 * 高頻發生本身是 system-pressure signal，需看 metric 不看 bug list。
 * 註：`sigterm_external` 保留在 recurring-errors 通道 — 那代表 launchd-triggered ungraceful crash，仍需追蹤。
 */
export const PROTECTIVE_SUBTYPES = new Set([
  'memory_guard',
  'max_turns',
  'sigterm_preempt',
  'sigterm_foreground_preempt',
  'sigterm_shutdown',
  'sigterm_progress',
  'sigterm_hard',
  'sigterm_circuit_breaker',
  // Issue #370: budget cap and user-initiated abort are expected, non-error terminations
  'budget_exceeded',
  'user_abort',
]);

/**
 * 從錯誤訊息抽取 subtype hint — 讓多型 TIMEOUT/UNKNOWN bucket 分成具體 failure mode，
 * 避免 memory_guard / econnrefused / sigterm / signal / real_timeout 被混成單一 bucket，
 * 造成 recurring-errors 提示無法指向具體成因。signal 來自 agent.ts classifyError 的訊息模板。
 */
export function extractErrorSubtype(errorMsg: string): string {
  // Defensive: TS signature is `string` but runtime callers may pass undefined
  // when error objects lack `.message`. Recurring "Cannot read properties of unde::loop.runCycle"
  // (72× through 2026-04-25) — see memory/topics/tolowercase-throw-site-findings.md.
  const lower = (errorMsg ?? '').toLowerCase();
  if (lower.includes('memory guard') || lower.includes('pre-spawn memory') || lower.includes('memory pressure') || lower.includes('system memory too low') || lower.includes('deferring to prevent')) return 'memory_guard';
  // ENOTFOUND/getaddrinfo = DNS lookup failure (api.anthropic.com unresolvable, often correlated
  // with mac sleep → DNS resolver flap). Split from econnrefused so recurring-errors panel surfaces
  // the actual cause; both are 無法連線-shaped but the fix is different (DNS = wait/check resolver,
  // refused = check server). 2026-05-05: 23×/day were all ENOTFOUND mislabeled as econnrefused.
  if (lower.includes('enotfound') || lower.includes('getaddrinfo') || lower.includes('eai_again') || lower.includes('unable to connect to api')) return 'dns_lookup_failed';
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('unreachable') || lower.includes('無法連線')) return 'econnrefused';
  if (lower.includes('exit 143') || lower.includes('sigterm')) {
    // Split by reason (source: agent.ts classifyError appends `reason=${exitReason}` when available)
    if (lower.includes('reason=preempt')) return 'sigterm_preempt';
    if (lower.includes('reason=foreground-preempt')) return 'sigterm_foreground_preempt';
    if (lower.includes('reason=shutdown')) return 'sigterm_shutdown';
    if (lower.includes('reason=progress')) return 'sigterm_progress';
    if (lower.includes('reason=hard')) return 'sigterm_hard';
    if (lower.includes('reason=circuit-breaker')) return 'sigterm_circuit_breaker';
    if (lower.includes('reason=external')) return 'sigterm_external';
    return 'sigterm_external'; // no reason tag = pre-fix events or non-143 sigterm keyword match
  }
  if (lower.includes('killed by signal') || lower.includes('被信號')) return 'signal_killed';
  if (lower.includes('oom') || lower.includes('killed by oom')) return 'oom';
  if (lower.includes('took too long') || lower.includes('處理超時')) return 'real_timeout';
  if (lower.includes('max_turns') || lower.includes('maximum number of turns')) return 'max_turns';
  // Issue #370 (2026-05-08): budget-cap and user-abort exits were silently mislabeled as
  // silent_exit_void because agent.ts appends stderr AFTER the 靜默中斷 prefix, so the
  // budget/abort signal was present but no branch caught it before line 205.
  // Both are non-retryable, non-error terminations — own buckets so frequency is surfaced.
  if (lower.includes('reached maximum budget')) return 'budget_exceeded';
  if (lower.includes('aborted by user')) return 'user_abort';
  if (lower.includes('accomplish timed out') || lower.includes('middleware offline')) return 'middleware_timeout';
  // 2026-04-20: paired with delegation.ts:294 Promise.race wrapper — converts silent
  // 600s hang_no_diag (when /plan endpoint blocks) into its own actionable bucket.
  if (lower.includes('plan_rpc_unreachable') || lower.includes('middleware /plan timed out')) return 'plan_rpc_unreachable';
  // agent.ts:187 fallback — CLI exited with no stderr and no classifiable signal.
  // Fast-death (<1s) often means auth/rate-limit/config issue; slower generic = truly unknown.
  // 2026-04-17 (cycle #16): classifyError now appends `[dur=Xs, signal=..., killed=true]` suffix
  // so we can split the opaque `no_diag` into actionable sub-buckets:
  //   - killed_no_diag: explicit kill/signal → supervisor or OS pressure
  //   - hang_no_diag: long duration w/o signal → Claude CLI stuck before any stderr
  //   - fast_death_no_diag: <1s → auth/rate-limit/config
  if (lower.includes('處理訊息時發生錯誤') || lower.includes('without diagnostic')) {
    const fast = /(\d+)ms this attempt/.exec(errorMsg);
    if (fast && Number(fast[1]) < 1000) return 'fast_death_no_diag';
    if (lower.includes('killed=true') || /signal=[^,\]]+/.test(lower)) return 'killed_no_diag';
    const durMatch = /dur=(\d+)s/.exec(lower);
    if (durMatch && Number(durMatch[1]) >= 600) return 'hang_no_diag';
    // 2026-05-06: 處理訊息時發生錯誤 with dur 1-59s = Anthropic localized server error
    // returned quickly (overload/rate-limit pattern); distinct from genuine no_diag.
    // 61 occurrences today, all in 1-19s band — clear bimodal gap from hang_no_diag (≥600s).
    //
    // 2026-05-08 (Issue #318): Subdivide the 1-59s band into fast/slow at 10s threshold.
    //   - fast-band (<10s):  transient_fast_band — API errored quickly then we retry; the
    //                         "wait it out" assumption (90s baseDelay from #166/ceefde2e)
    //                         doesn't apply here. Different gate: circuit-breaker, not backoff.
    //   - slow-band (10-59s): transient_slow_band — the original 1-19s pattern that #166
    //                         targeted; 90s baseDelay window is correct here.
    // Keep the legacy `transient_no_diag` label as a fallback for ill-formed durations so
    // the bucket never silently disappears from the recurring-errors panel.
    if (durMatch) {
      const dur = Number(durMatch[1]);
      if (dur < 10) return 'transient_fast_band';
      if (dur < 60) return 'transient_slow_band';
    }
    // 2026-05-06 (later same day): mid-band 60-599s = partial-stream failure
    // (request started, response began, then errored mid-flight). Distinct from
    // both transient (fail-fast) and hang (full timeout). Splitting this off
    // leaves `no_diag` to mean "no dur= suffix at all" — a different class of
    // upstream classifyError bug. count=34 in no_diag today motivated this split.
    if (durMatch && Number(durMatch[1]) < 600) return 'midband_no_diag';
    // 2026-05-07 (Issue #168): dur=unknown means classifyError reached the fallback path but
    // the throw site did not attach a duration property (pre-spawn errors, Local LLM throws,
    // Promise.race timeout paths in delegation.ts). Distinct from the numbered-dur sub-buckets
    // above — surfaces as its own actionable bucket instead of silently landing in no_diag.
    if (lower.includes('dur=unknown')) return 'unknown_dur_no_diag';
    return 'no_diag';
  }
  // 2026-04-20: agent.ts:224 silent_exit message template (shipped 3039f4a3) — complete the label
  // chain so TIMEOUT:generic fallthrough becomes TIMEOUT:silent_exit in recurring-errors.
  if (lower.includes('靜默中斷') || lower.includes('靜默溢位') || lower.includes('silent exit')) {
    if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('401')) return 'silent_exit_auth';
    if (lower.includes('overloaded') || lower.includes('529')) return 'silent_exit_overload';
    if (lower.includes('stdout=empty')) {
      // 2026-05-08 (Issue #370 + arxiv 2605.05724 4-class typed-failure schema):
      // silent_exit_void splits into 4 typed failure classes. Each class needs its own
      // recovery recipe (paper's "lineage feedback on typed failures" insight — typed
      // labels that drive different recipe edits, not collapse into one opaque bucket):
      //   - #191 HTTP-stall:       ~970-1007s, prompt 13-16K  => budget-overrun (non-retryable)
      //   - #233 prompt-bloat:     ~357s,      prompt >= 35K  => size-fail      (pre-flight drained)
      //   - #370 midprompt-stall:  ~300-799s,  prompt 20-35K  => first-token stall (NEW bucket)
      //   - #77  baseline:         ~260s,      prompt 22-25K  => crash-class    (retryable)
      //
      // Bucket by promptChars extracted from the logged error message
      // (format: "prompt NNN chars" from agent.ts:2010 logger call).
      // This produces distinct error-patterns.json keys per class so each gets its own
      // P1 task instead of all collapsing to TIMEOUT:silent_exit_void::callClaude.
      //
      // Duration band also extracted where present:
      //   >=800s => silent_exit_void_http        (HTTP-stall / #191 class, non-retryable server hold)
      //   <800s + >=35K chars => silent_exit_void_40k  (prompt-bloat stall / #233 new class)
      //   <800s + 20-35K chars + >=300s => silent_exit_void_midprompt  (#370 first-token stall)
      //   <800s + <35K chars => silent_exit_void        (CLI internal hang / #77 baseline)
      const promptMatch = /prompt (\d+) chars/.exec(errorMsg);
      const promptChars = promptMatch ? Number(promptMatch[1]) : 0;
      const durationMsMatch = /(\d+)ms total/.exec(errorMsg);
      const durationMs = durationMsMatch ? Number(durationMsMatch[1]) : 0;
      // Also parse duration from classified.message format: "Xs 無 stderr"
      const durSecMatch = /(\d+)s \u7121 stderr/.exec(errorMsg);
      const durSec = durSecMatch ? Number(durSecMatch[1]) : 0;
      const totalMs = durationMs || durSec * 1000;
      if (totalMs >= 800_000) return 'silent_exit_void_http';
      if (promptChars >= 35_000) return 'silent_exit_void_40k';
      // Issue #370 (2026-05-08): 24K-prompt @ ~365s cluster (count=10 on instance 03bbc29a).
      // Distinct from #77 baseline (~260s) — the longer 300-800s duration band with mid-size
      // prompt (20K-35K) signals a first-token stall pattern, not the CLI internal hang.
      // Separating gives this class its own error-patterns key so recovery (e.g. lower
      // pre-flight drain threshold from 35K to 20K conditional on >=300s history) can be tuned
      // independently without affecting #77 baseline retry behavior.
      if (promptChars >= 20_000 && totalMs >= 300_000) return 'silent_exit_void_midprompt';
      return 'silent_exit_void';
    }
    return 'silent_exit';
  }
  return 'generic';
}

/**
 * 從錯誤訊息抽取穩定的 error code（TIMEOUT/UNKNOWN/...），取代依賴 regex anchor 的脆弱邏輯。
 * 原 `/^[A-Z_]+/` 碰到 "claude CLI TIMEOUT ..." 這種 lowercase 開頭訊息永遠 miss，
 * 導致 fallback 用 `msg.slice(0,30)` 切出 duration-dependent 的隨機字串（每個 duration = 新桶）。
 */
export function extractErrorCode(errorMsg: string): string {
  const m = errorMsg.match(/\b(TIMEOUT|UNKNOWN|NOT_FOUND|MAX_BUFFER|RATE_LIMIT|PERMISSION)\b/);
  if (m) return m[1];
  const mErr = errorMsg.match(/\b(\w+Error)\b/);
  if (mErr) return mErr[1];
  return errorMsg.slice(0, 30);
}

/**
 * Issue #333: Circuit-breaker gate for transient_fast_band errors.
 *
 * Fast-band = API errored back in <10s. Sleeping 90s and retrying gives upstream
 * nothing to recover from (these are likely deterministic provider-side rejections —
 * auth/rate-limit/payload — not transient capacity gaps). Exponential backoff (#166)
 * targets slow-band only; fast-band needs fail-fast so caller can switch model /
 * route to delegation / report blocker.
 *
 * Returns true ONLY for the first attempt — once we're past attempt 0 we've already
 * paid the retry cost and want the existing path to run to completion.
 *
 * Threshold tunable via env: KURO_FAST_FAIL_THRESHOLD_MS (default 10_000).
 */
export function shouldFastFailFastBand(args: {
  attempt: number;
  attemptDurationMs: number;
  errorMsg: string;
  thresholdMs?: number;
}): boolean {
  const threshold =
    args.thresholdMs ?? (Number(process.env.KURO_FAST_FAIL_THRESHOLD_MS) || 10_000);
  if (args.attempt !== 0) return false;
  if (args.attemptDurationMs >= threshold) return false;
  return extractErrorSubtype(args.errorMsg) === 'transient_fast_band';
}

/**
 * 掃描今天的 error log，按 (code + subtype + context) 分群。
 * 同模式 >= 3 次 → 寫入 HEARTBEAT.md 作為 P1 task。
 * 已建過的模式不重複建。
 */
export async function detectErrorPatterns(): Promise<void> {
  const logger = getLogger();
  // Scope to today — mirror pulse.ts ca881b13 fix. Rolling N-entry slices caused
  // resolved patterns to keep refreshing lastSeen=today (old events still in window),
  // blocking the 7-day cleanup and keeping stale P1 tasks alive. Lesson: recurrence
  // is recency, not magnitude. See heartbeat archive 2026-04-18 cycle #10.
  const today = new Date().toISOString().split('T')[0];
  const errors = logger.queryErrorLogs(today, 200);
  if (errors.length === 0) return;

  const state = readState<ErrorPatternState>('error-patterns.json', {});

  // Group by (context + error code + subtype) — subtype splits polymorphic TIMEOUT/UNKNOWN buckets.
  // sampleMsg captures first error string per bucket (240ch) — restores postmortem visibility for
  // opaque buckets like silent_exit_void / no_diag where lastSeen+count alone gave zero diagnostic.
  const groups = new Map<string, { count: number; sampleMsg: string }>();
  for (const err of errors) {
    const context = err.data.context ?? 'unknown';
    const errorMsg = err.data.error ?? '';
    const code = extractErrorCode(errorMsg);
    const subtype = extractErrorSubtype(errorMsg);
    const key = `${code}:${subtype}::${context}`;
    const cur = groups.get(key) ?? { count: 0, sampleMsg: '' };
    cur.count += 1;
    if (!cur.sampleMsg && errorMsg) cur.sampleMsg = errorMsg.slice(0, 240);
    groups.set(key, cur);
  }

  let changed = false;

  // Subtype-rename migration: drop today's orphan keys absent from current groups.
  // Without this, renaming a subtype (e.g. econnrefused -> dns_lookup_failed) leaves
  // the old key with stale today-counts; 7-day TTL won't clean it because lastSeen=today.
  for (const key of Object.keys(state)) {
    if (state[key].lastSeen === today && !groups.has(key)) {
      slog('FEEDBACK', `Error pattern orphaned by subtype rename: ${key}`);
      delete state[key];
      changed = true;
    }
  }

  for (const [key, { count, sampleMsg }] of groups) {
    if (count < 3) continue;

    const existing = state[key];
    if (existing) {
      existing.count = count;
      existing.lastSeen = today;
      if (sampleMsg) existing.lastMessage = sampleMsg;
      changed = true;
      continue;
    }

    // Observation only — pulse.ts owns task creation via its own state.
    // taskCreated here is just a "seen" flag to prevent re-logging.
    state[key] = { count, taskCreated: false, lastSeen: today, lastMessage: sampleMsg };
    changed = true;
    slog('FEEDBACK', `Error pattern detected: ${key} (${count}×)`);
  }

  // Clean up patterns not seen in 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
  for (const key of Object.keys(state)) {
    if (state[key].lastSeen < sevenDaysAgo) {
      slog('FEEDBACK', `Error pattern resolved (no recurrence in 7d): ${key}`);
      delete state[key];
      changed = true;
    }
  }

  if (changed) writeState('error-patterns.json', state);
}

// =============================================================================
// Loop B: Perception Citation Tracking
// =============================================================================

const CITATION_WINDOW_SIZE = 50;

/**
 * 從 response 文字中提取引用的 <section-name>，用滑動窗口追蹤引用率。
 * 每 50 cycle 根據最近 50 cycles 的引用率調整 perception stream intervals。
 * 調整結果持久化到 state file，重啟後由 perception-stream 讀取並套用。
 */
export async function trackPerceptionCitations(action: string | null, response?: string | null, context?: string | null): Promise<void> {
  const scoringText = response ?? action;
  if (!scoringText) return;

  const state = readState<PerceptionCitationState>('perception-citations.json', {
    cycleCount: 0,
    citations: {},
    recentWindow: [],
    adjustedIntervals: {},
    lastAdjusted: '',
  });
  if (!state.recentWindow) state.recentWindow = [];
  if (!state.adjustedIntervals) state.adjustedIntervals = {};

  const skipTags = new Set(['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol',
    'code', 'pre', 'em', 'strong', 'hr', 'tr', 'td', 'th', 'table', 'h1', 'h2', 'h3']);
  const sectionNames = new Set<string>();
  if (context) {
    for (const m of context.matchAll(/<([\w][\w-]{3,})>/g)) {
      const tag = m[1];
      if (!skipTags.has(tag) && !tag.startsWith('kuro:')) {
        sectionNames.add(tag);
      }
    }
  }

  const lowerText = (scoringText ?? '').toLowerCase();
  const citedSections: string[] = [];
  for (const name of sectionNames) {
    const lower = name.toLowerCase();
    if (lowerText.includes(lower) || lowerText.includes(lower.replace(/-/g, ' '))) {
      citedSections.push(name);
    }
  }

  // Update cumulative citations (for long-term visibility)
  for (const name of citedSections) {
    state.citations[name] = (state.citations[name] ?? 0) + 1;
  }

  // Update sliding window (for adjustment decisions)
  state.recentWindow.push(citedSections);
  if (state.recentWindow.length > CITATION_WINDOW_SIZE) {
    state.recentWindow = state.recentWindow.slice(-CITATION_WINDOW_SIZE);
  }

  state.cycleCount++;

  // Every 50 cycles, evaluate based on RECENT window (not cumulative)
  if (state.cycleCount % CITATION_WINDOW_SIZE === 0 && state.cycleCount > 0) {
    const window = state.recentWindow;
    const windowSize = window.length;
    if (windowSize > 0) {
      // Count in how many of the last 50 cycles each section was cited
      const windowCounts: Record<string, number> = {};
      for (const cycleCitations of window) {
        for (const name of cycleCitations) {
          windowCounts[name] = (windowCounts[name] ?? 0) + 1;
        }
      }

      const corePerceptions = new Set([
        'environment', 'telegram', 'soul-core', 'soul-traits', 'soul-other', 'self', 'workspace',
        'temporal', 'capabilities',
      ]);
      const exploratoryPerceptions = new Set([
        'x-feed', 'x-digest', 'scout-digest',
      ]);

      // Also check all sections that have adjustments (in case they recovered)
      const allSections = new Set([
        ...Object.keys(windowCounts),
        ...Object.keys(state.adjustedIntervals),
      ]);

      for (const name of allSections) {
        if (corePerceptions.has(name)) continue;

        const count = windowCounts[name] ?? 0;
        const rate = count / windowSize;

        if (rate < 0.05) {
          if (exploratoryPerceptions.has(name)) continue;
          const newInterval = 30 * 60_000;
          perceptionStreams.adjustInterval(name, newInterval);
          state.adjustedIntervals[name] = newInterval;
          slog('FEEDBACK', `Low citation rate: ${name} (${(rate * 100).toFixed(1)}% in last ${windowSize} cycles) → interval 30min`);
        } else if (rate >= 0.15) {
          perceptionStreams.restoreDefaultInterval(name);
          delete state.adjustedIntervals[name];
          slog('FEEDBACK', `Citation rate recovered: ${name} (${(rate * 100).toFixed(1)}%) → interval restored`);
        }
      }

      state.lastAdjusted = new Date().toISOString().split('T')[0];
    }
  }

  writeState('perception-citations.json', state);

  // Feed citation data to context optimizer
  try {
    const { getContextOptimizer } = await import('./context-optimizer.js');
    const opt = getContextOptimizer();
    opt.recordCycle({ citedSections });
    opt.save();
  } catch { /* ignore */ }
}

/** Read persisted interval adjustments (for perception-stream startup). */
export function getPersistedIntervalAdjustments(): Record<string, number> {
  try {
    const p = path.join(getMemoryStateDir(), 'perception-citations.json');
    if (!existsSync(p)) return {};
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    return data.adjustedIntervals ?? {};
  } catch { return {}; }
}

// =============================================================================
// Loop C: Decision Quality Audit
// =============================================================================

const QUALITY_WARNING_FILE = 'decision-quality-warning.flag';
const QUALITY_WINDOW = 20;

/**
 * 檢查最近 action 的決策完整性。
 * 追蹤滑動窗口 20 cycle 的平均 observabilityScore。
 * 品質下降時注入提醒到下個 cycle 的 prompt。
 */
export async function auditDecisionQuality(action: string | null, triggerReason?: string | null, response?: string | null): Promise<void> {
  if (!action && !response) return;

  // Noop cycles ARE quality signals — extended noop streaks need warnings, not silence.
  // Scoring noop as 0 naturally drags the average below threshold and triggers the warning.

  const state = readState<DecisionQualityState>('decision-quality.json', {
    recentScores: [],
    avgScore: 0,
    warningInjected: false,
    lastWarningAt: null,
    lastEscalationAt: null,
    consecutiveWarningCycles: 0,
    challengeTotal: 0,
    challengeCompliant: 0,
    lastChallengeWarningAt: null,
  });

  // Use full response for scoring — ## Decision and verification are outside <kuro:action> tags
  const scoringText = response ?? action ?? '';

  // Fast cycle detection: inbox-recovery, alert, delegation-complete, hard-skip → floor score 2/6
  // Exception: noop spiral cycles (action=null + short text) get score 0 — don't mask the problem
  const fastCyclePatterns = /inbox-recovery|alert|delegation-complete|hard-skip/i;
  const isNoopCycle = !action && scoringText.length < 200;
  const isFastCycle = !isNoopCycle && (
    (triggerReason && fastCyclePatterns.test(triggerReason)) ||
    scoringText.length < 200
  );

  // Check if external tasks are available — only penalize noop when external work exists
  let hasExternalTasks = false;
  try {
    const { queryMemoryIndexSync } = await import('./memory-index.js');
    const memDir = getMemoryRootDir();
    const tasks = queryMemoryIndexSync(memDir, { type: ['task', 'goal'], status: ['pending', 'in_progress'] });
    hasExternalTasks = tasks.some(t => {
      const p = (t.payload ?? {}) as Record<string, unknown>;
      return p.source === 'alex' || p.source === 'discovery' || p.origin === 'pipeline';
    });
  } catch { /* fail-open */ }

  let score: number;
  if (isNoopCycle && hasExternalTasks) {
    score = 0;
  } else if (isNoopCycle) {
    score = 2; // no external tasks available → internal-only cycle is neutral
  } else if (isFastCycle) {
    // Fast cycles get floor score — they did the right thing by being fast
    score = 2;
  } else {
    // Behavior-based scoring (0-6): measures actual decision quality via kuro tags + reasoning,
    // not format compliance (markdown headers). Kuro's natural output uses <kuro:*> tags.
    const hasAnyTag = /<kuro:\w+/.test(scoringText);
    const hasVisibleOutput = /<kuro:(?:chat|show|done|ask|delegate)/.test(scoringText);
    const hasActionReport = /<kuro:action/.test(scoringText);
    const hasReasoning = /##\s*Decision|\[DECISION\]|chose:|skipped:|problem-level:|收斂條件|serving:/i.test(scoringText);
    const hasEvidence = /\d+(?:\.\d+)?(?:MB|GB|ms|KB|%|bytes|chars|lines|port)|\.(?:ts|md|json|sh)\b|commit\b|path\b/i.test(scoringText);
    const hasFollowUp = /<kuro:(?:schedule|task|delegate|goal)/.test(scoringText) || /next[:\s]|收斂|follow.?up/i.test(scoringText);

    score = [hasAnyTag, hasVisibleOutput, hasActionReport, hasReasoning, hasEvidence, hasFollowUp]
      .filter(Boolean).length;
  }

  // Low-score provenance — log WHY a cycle scored poorly so patterns can be diagnosed
  if (score <= 1) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        score,
        trigger: triggerReason?.slice(0, 100) ?? null,
        isNoopCycle,
        isFastCycle,
        textLen: scoringText.length,
        criteria: isNoopCycle ? null : {
          tag: /<kuro:\w+/.test(scoringText),
          visible: /<kuro:(?:chat|show|done|ask|delegate)/.test(scoringText),
          action: /<kuro:action/.test(scoringText),
          reasoning: /##\s*Decision|\[DECISION\]|chose:|skipped:|problem-level:/i.test(scoringText),
          evidence: /\d+(?:\.\d+)?(?:MB|GB|ms|KB|%|bytes|chars|lines|port)/i.test(scoringText),
          followUp: /<kuro:(?:schedule|task|delegate|goal)/.test(scoringText),
        },
        snippet: scoringText.slice(0, 150).replace(/\n/g, ' '),
      };
      const diagPath = getStatePath('dq-low-scores.jsonl');
      appendFileSync(diagPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch { /* fire-and-forget */ }
  }

  // Sliding window
  state.recentScores.push(score);
  if (state.recentScores.length > QUALITY_WINDOW) {
    state.recentScores = state.recentScores.slice(-QUALITY_WINDOW);
  }

  // Calculate average
  state.avgScore = state.recentScores.length > 0
    ? Number((state.recentScores.reduce((s, v) => s + v, 0) / state.recentScores.length).toFixed(2))
    : 0;

  const flagPath = getStatePath(QUALITY_WARNING_FILE);
  const now = Date.now();

  // Check if warning is needed (avg < 2.0 and cooldown > 12h)
  const cooldownOk = !state.lastWarningAt ||
    (now - new Date(state.lastWarningAt).getTime()) > 12 * 3600_000;

  // DQ telemetry: log score trends but don't inject warnings into prompt.
  // Warning file write removed — harness trusts SOUL + KG for self-correction.
  if (state.avgScore < 2.0 && state.recentScores.length >= 10 && cooldownOk) {
    const zeroCount = state.recentScores.filter(s => s === 0).length;
    const noopPercent = Math.round(zeroCount / state.recentScores.length * 100);
    slog('FEEDBACK', `[telemetry] DQ avg ${state.avgScore}/6, noop ${noopPercent}% — no prompt injection`);
  } else if (state.avgScore >= 2.5) {
    state.consecutiveWarningCycles = 0;
  }

  if (state.avgScore >= 2.5 && state.warningInjected) {
    // Quality recovered — clear warning (was 4.0, too high — warnings lingered forever)
    if (existsSync(flagPath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(flagPath);
      invalidateFlagCache(flagPath);
    }
    state.warningInjected = false;
    slog('FEEDBACK', `Decision quality recovered (avg ${state.avgScore}/6) — warning cleared`);
  }

  // ── Self-Challenge compliance tracking ──
  const isAlexFacing = triggerReason?.startsWith('telegram-user') ?? false;
  if (isAlexFacing && scoringText.includes('<kuro:chat>')) {
    state.challengeTotal++;
    const hasChallenge = /##\s*Challenge.*?checked/i.test(scoringText);
    if (hasChallenge) {
      state.challengeCompliant++;
    } else {
      // Missing challenge — log for visibility
      slog('FEEDBACK', `[challenge] Alex-facing response without ## Challenge (${state.challengeCompliant}/${state.challengeTotal} compliant)`);

      // If compliance drops below 50% after 5+ responses, inject warning
      const rate = state.challengeTotal >= 5
        ? state.challengeCompliant / state.challengeTotal : 1;
      const challengeCooldownOk = !state.lastChallengeWarningAt ||
        (Date.now() - new Date(state.lastChallengeWarningAt).getTime()) > 12 * 3600_000;

      if (rate < 0.5 && challengeCooldownOk) {
        const challengeFlagPath = getStatePath('challenge-warning.flag');
        const warning = `你回覆 Alex 時的自我質疑率偏低（${state.challengeCompliant}/${state.challengeTotal}）。提醒：回覆前先做三個檢查 — 來源廣度、根因 vs 症狀、反例搜尋。`;
        writeFileSync(challengeFlagPath, warning, 'utf-8');
        invalidateFlagCache(challengeFlagPath);
        state.lastChallengeWarningAt = new Date().toISOString();
        slog('FEEDBACK', `[challenge] Warning injected: compliance ${Math.round(rate * 100)}%`);
      }
    }
  }

  writeState('decision-quality.json', state);
}

// =============================================================================
// Loop D: System Health Audit (Output Quality Monitoring)
// =============================================================================

interface PerceptionHealthEntry {
  avgOutputLen: number;
  minOutputLen: number;
  emptyCount: number;
  totalChecks: number;
  lastAlertAt: string | null;
}

interface SystemHealthState {
  perceptions: Record<string, PerceptionHealthEntry>;
  fetchHealth: {
    restrictedDomains: string[];
    lastCheckedAt: string | null;
  };
  cyclesSinceLastCheck: number;
}

const HEALTH_CHECK_INTERVAL = 10; // Every 10 cycles

/**
 * 通用系統健康審計 — 偵測靜默失敗。
 * 不只看「有沒有錯誤」，而是看「輸出品質有沒有下降」。
 *
 * 檢查項目：
 * 1. Perception 輸出品質（長度趨勢、空輸出率）
 * 2. Web fetch 品質（限制域名偵測）
 * 3. 學習腐化偵測（learned behavior 與實際結果不符）
 */
export async function auditSystemHealth(): Promise<void> {
  const state = readState<SystemHealthState>('system-health.json', {
    perceptions: {},
    fetchHealth: { restrictedDomains: [], lastCheckedAt: null },
    cyclesSinceLastCheck: 0,
  });

  state.cyclesSinceLastCheck++;

  // Only do full check every N cycles
  if (state.cyclesSinceLastCheck < HEALTH_CHECK_INTERVAL) {
    writeState('system-health.json', state);
    return;
  }
  state.cyclesSinceLastCheck = 0;

  // ── Check 1: Perception output quality ──
  const stats = perceptionStreams.getStats();
  for (const s of stats) {
    const entry = state.perceptions[s.name] ?? {
      avgOutputLen: 0, minOutputLen: Infinity, emptyCount: 0,
      totalChecks: 0, lastAlertAt: null,
    };

    entry.totalChecks++;

    // High timeout rate is a problem
    if (s.timeouts >= 3) {
      const cooldownOk = !entry.lastAlertAt ||
        (Date.now() - new Date(entry.lastAlertAt).getTime()) > 24 * 3600_000;

      if (cooldownOk) {
        const memory = getMemory();
        const dueDate = new Date(Date.now() + 2 * 86400_000).toISOString().split('T')[0];
        await memory.addTask(
          `P2: 感知健康 — ${s.name} 連續 ${s.timeouts} 次 timeout（avg ${s.avgMs}ms）@due:${dueDate}`,
        );
        entry.lastAlertAt = new Date().toISOString();
        slog('FEEDBACK', `[health] Perception ${s.name}: ${s.timeouts} timeouts → task created`);
      }
    }

    state.perceptions[s.name] = entry;
  }

  // ── Check 2: Fetch health (scan cdp.jsonl for patterns) ──
  try {
    const { existsSync: exists, readFileSync: readFile } = await import('node:fs');
    const cdpLog = path.join(process.env.HOME ?? '', '.mini-agent', 'cdp.jsonl');
    if (exists(cdpLog)) {
      const lines = readFile(cdpLog, 'utf-8').split('\n').filter(Boolean).slice(-100);
      const domainRestrictions = new Map<string, number>();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.op === 'fetch' && entry.result === 'content_restricted') {
            const url = new URL(entry.url ?? '');
            const count = domainRestrictions.get(url.hostname) ?? 0;
            domainRestrictions.set(url.hostname, count + 1);
          }
        } catch { /* skip bad lines */ }
      }

      // Domains with 3+ restrictions
      const problematic = [...domainRestrictions.entries()]
        .filter(([, count]) => count >= 3)
        .map(([domain]) => domain);

      if (problematic.length > 0) {
        const newDomains = problematic.filter(d => !state.fetchHealth.restrictedDomains.includes(d));
        if (newDomains.length > 0) {
          slog('FEEDBACK', `[health] Fetch restrictions detected: ${newDomains.join(', ')}`);
          state.fetchHealth.restrictedDomains = problematic;
        }
      }
      state.fetchHealth.lastCheckedAt = new Date().toISOString();
    }
  } catch { /* best effort */ }

  writeState('system-health.json', state);
}

// =============================================================================
// Loop E: CRS Baseline Recording
// =============================================================================

interface BaselineCycleRecord {
  timestamp: string;
  contextLength: number;
  sections: Array<{ name: string; chars: number }>;
  citations: string[];
  observabilityScore: number;
  estimatedTokens: number;
  triggerReason: string | null;
  model?: 'opus' | 'sonnet';
}

/**
 * CRS Phase 1: 記錄每個 cycle 的 context baseline 數據。
 * 不改變 context，只記錄 — 用於建立 50 cycle 的 baseline。
 * 數據寫入 instance dir 的 crs-baseline.jsonl。
 */
function recordBaselineCycle(
  action: string | null,
  context: string | null,
  triggerReason?: string | null,
  model?: 'opus' | 'sonnet',
): void {
  if (!context) return;

  // Parse section sizes from context XML tags
  const sections: Array<{ name: string; chars: number }> = [];
  for (const m of context.matchAll(/<(\S+?)[\s>][\s\S]*?<\/\1>/g)) {
    sections.push({ name: m[1], chars: m[0].length });
  }

  // Extract which sections were cited in the action
  const citations: string[] = [];
  if (action) {
    const sectionNames = new Set(sections.map(s => s.name));

    // Method 1: Direct <section-name> tag references in action text
    for (const m of action.matchAll(/<(\w[\w-]+)>/g)) {
      if (sectionNames.has(m[1]) && !citations.includes(m[1])) {
        citations.push(m[1]);
      }
    }

    // Method 2: Section name keyword matching (hyphenated → space)
    const actionLower = (action ?? '').toLowerCase();
    for (const s of sections) {
      if (citations.includes(s.name)) continue;
      const keyword = s.name.replace(/-/g, ' ');
      if (keyword.length > 3 && actionLower.includes(keyword)) {
        citations.push(s.name);
      }
    }
  }

  // Score action observability (same rubric as Loop C)
  let score = 0;
  if (action) {
    if (/##\s*Decision|\[DECISION\]/i.test(action)) score++;
    if (/##\s*What|\*\*What/i.test(action)) score++;
    if (/##\s*Why|\*\*Why/i.test(action)) score++;
    if (/##\s*Thinking|\*\*Thinking/i.test(action)) score++;
    if (/##\s*Changed|\*\*Changed/i.test(action)) score++;
    if (/##\s*Verified|\*\*Verified/i.test(action)) score++;
  }

  const record: BaselineCycleRecord = {
    timestamp: new Date().toISOString(),
    contextLength: context.length,
    sections,
    citations: [...new Set(citations)],
    observabilityScore: score,
    estimatedTokens: Math.round(context.length / 4),
    triggerReason: triggerReason ?? null,
    model,
  };

  const p = getStatePath('crs-baseline.jsonl');
  appendFileSync(p, JSON.stringify(record) + '\n');
}

// =============================================================================
// Loop F: Structural Health Audit (Operational Hygiene)
// =============================================================================

/**
 * 偵測 structural absence — 該存在但不存在的東西。
 * 補足 Loop A-E 只看行為指標的盲區。
 *
 * 四個檢查維度：
 * 1. Feature Flag Hygiene — disabled 太久未 review
 * 2. Task Hygiene — memory-index 積壓或過期
 * 3. DQ Root Cause — 按 trigger 分類，區分正常低分和真正低品質
 * 4. Milestone Communication — 重大變更未通知 Alex
 *
 * 每 10 cycles 執行，結果寫入 structural-health-warning.flag。
 */

interface StructuralHealthState {
  cyclesSinceLastCheck: number;
  lastCheckAt: string | null;
  lastWarnings: string[];
}

const STRUCTURAL_CHECK_INTERVAL = 10;
const STRUCTURAL_WARNING_FILE = 'structural-health-warning.flag';

export async function auditStructuralHealth(triggerReason?: string | null): Promise<void> {
  const state = readState<StructuralHealthState>('structural-health.json', {
    cyclesSinceLastCheck: 0,
    lastCheckAt: null,
    lastWarnings: [],
  });

  state.cyclesSinceLastCheck++;
  if (state.cyclesSinceLastCheck < STRUCTURAL_CHECK_INTERVAL) {
    writeState('structural-health.json', state);
    return;
  }
  state.cyclesSinceLastCheck = 0;

  const warnings: string[] = [];

  // ── Check 1: Feature Flag Hygiene ──
  try {
    const featuresPath = path.join(getInstanceDir(getCurrentInstanceId()), 'features.json');
    if (existsSync(featuresPath)) {
      const features = JSON.parse(readFileSync(featuresPath, 'utf-8'));
      // Find features that are disabled
      const disabledNames: string[] = [];
      for (const [name, val] of Object.entries(features)) {
        if (val && typeof val === 'object' && 'enabled' in val && !(val as { enabled: boolean }).enabled) {
          disabledNames.push(name);
        }
      }

      if (disabledNames.length > 0) {
        // Check if any disabled feature has stats suggesting it was used recently
        // If disabled and no recent activity → flag for review
        warnings.push(`Feature flags disabled (review needed): ${disabledNames.join(', ')}`);
      }
    }
  } catch { /* ignore */ }

  // ── Check 2: Task Hygiene (memory-index) ──
  try {
    const { getTaskHygieneInfo } = await import('./memory-index.js');
    const memDir = getMemoryRootDir();
    const { pendingCount, staleCount } = getTaskHygieneInfo(memDir);

    if (pendingCount > 8) {
      warnings.push(`Task 積壓: ${pendingCount} 個未完成項目 (建議清理到 ≤5)`);
    }
    if (staleCount > 0) {
      warnings.push(`Tasks: ${staleCount} 項任務超過 14 天未推進`);
    }
  } catch { /* ignore */ }

  // ── Check 3: DQ Root Cause Decomposition ──
  try {
    const dqState = readState<DecisionQualityState>('decision-quality.json', {
      recentScores: [], avgScore: 0, warningInjected: false,
      lastWarningAt: null, lastEscalationAt: null, consecutiveWarningCycles: 0,
      challengeTotal: 0, challengeCompliant: 0,
      lastChallengeWarningAt: null,
    });

    if (dqState.avgScore < 2.5 && dqState.recentScores.length >= 10) {
      // Read CRS baseline to decompose by trigger type
      const crsPath = getStatePath('crs-baseline.jsonl');
      if (existsSync(crsPath)) {
        const lines = readFileSync(crsPath, 'utf-8').split('\n').filter(Boolean).slice(-20);
        let lightCycles = 0;
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            const trigger = record.triggerReason ?? '';
            // Light cycles: cron, heartbeat, workspace changes (not direct messages)
            if (/^cron|^heartbeat|^workspace/.test(trigger)) lightCycles++;
          } catch { /* skip */ }
        }
        const lightRatio = lightCycles / Math.max(lines.length, 1);

        if (lightRatio > 0.5) {
          warnings.push(`DQ ${dqState.avgScore}/6: ${Math.round(lightRatio * 100)}% 是 light cycles (cron/heartbeat) — mushi 應更積極 skip`);
        } else {
          warnings.push(`DQ ${dqState.avgScore}/6: 非 light cycle 仍低分 — 思考深度不足`);
        }
      }
    }
  } catch { /* ignore */ }

  // ── Check 4: Milestone Communication ──
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    // Check for src/ changes in last 24h without corresponding notification
    const { stdout: recentRaw } = await execAsync(
      'git log --since="24 hours ago" --oneline -- src/ 2>/dev/null | head -5',
      { encoding: 'utf-8', timeout: 5000 },
    );
    const recentSrcChanges = recentRaw.trim();

    if (recentSrcChanges && recentSrcChanges.split('\n').length >= 3) {
      // Check if there was a Telegram notification or upgrade report
      const reportsDir = resolveMemoryPath('evolution-tracks', 'reports');
      const today = new Date().toISOString().slice(0, 10);
      let hasReport = false;
      try {
        const { readdirSync } = await import('node:fs');
        const files = readdirSync(reportsDir);
        hasReport = files.some(f => f.startsWith(today));
      } catch { /* no reports dir yet */ }

      if (!hasReport) {
        const commitCount = recentSrcChanges.split('\n').length;
        warnings.push(`src/ 有 ${commitCount} 個 commits (24h) 但無升級報告`);
      }
    }
  } catch { /* ignore */ }

  // ── Write results ──
  state.lastCheckAt = new Date().toISOString();
  state.lastWarnings = warnings;
  writeState('structural-health.json', state);

  const flagPath = getStatePath(STRUCTURAL_WARNING_FILE);
  if (warnings.length > 0) {
    const content = warnings.map(w => `⚠️ ${w}`).join('\n');
    writeFileSync(flagPath, content, 'utf-8');
    invalidateFlagCache(flagPath);
    slog('FEEDBACK', `[structural-health] ${warnings.length} warnings: ${warnings.join(' | ')}`);
  } else {
    // Clear flag if no warnings
    try {
      if (existsSync(flagPath)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(flagPath);
        invalidateFlagCache(flagPath);
      }
    } catch { /* ignore */ }
  }
}

// =============================================================================
// Loop G: Compound Interest Score (Cross-Topic Citation Tracking)
// =============================================================================

interface CompoundScoreState {
  lastScanCycle: number;
  /** topic → list of other topics that reference it */
  referencedBy: Record<string, string[]>;
  /** topic → compound interest score (number of unique cross-references) */
  scores: Record<string, number>;
  /** Top compound topics (sorted desc by score) */
  topCompound: string[];
}

const COMPOUND_SCAN_INTERVAL = 20;

/**
 * 掃描 topics/*.md 的跨主題引用，計算複利分數。
 * 被越多不同主題引用的知識 = 越高複利 = 越值得優先載入。
 * 每 20 cycles 執行一次全量掃描。
 */
export async function trackCompoundInterest(cycleCount: number): Promise<void> {
  const state = readState<CompoundScoreState>('compound-scores.json', {
    lastScanCycle: 0,
    referencedBy: {},
    scores: {},
    topCompound: [],
  });

  if (cycleCount - state.lastScanCycle < COMPOUND_SCAN_INTERVAL) return;

  const topicsDir = resolveMemoryPath('topics');
  if (!existsSync(topicsDir)) return;

  const { readdirSync } = await import('node:fs');
  const topicFiles = readdirSync(topicsDir).filter((f: string) => f.endsWith('.md'));
  const topicNames = topicFiles.map((f: string) => f.replace('.md', ''));

  // Read all topic contents
  const topicContents: Record<string, string> = {};
  for (const file of topicFiles) {
    try {
      topicContents[file.replace('.md', '')] = readFileSync(
        path.join(topicsDir, file), 'utf-8',
      ).toLowerCase();
    } catch { /* skip unreadable */ }
  }

  // Build cross-reference map: for each topic, which other topics mention it?
  const referencedBy: Record<string, string[]> = {};
  for (const name of topicNames) {
    referencedBy[name] = [];
  }

  for (const [sourceTopic, content] of Object.entries(topicContents)) {
    for (const targetTopic of topicNames) {
      if (sourceTopic === targetTopic) continue;

      // Check if source content mentions target topic name
      const variants = [
        targetTopic,                      // "agent-architecture"
        targetTopic.replace(/-/g, ' '),   // "agent architecture"
      ];

      if (variants.some(v => content.includes(v))) {
        if (!referencedBy[targetTopic].includes(sourceTopic)) {
          referencedBy[targetTopic].push(sourceTopic);
        }
      }
    }
  }

  // Calculate scores
  const scores: Record<string, number> = {};
  for (const [topic, refs] of Object.entries(referencedBy)) {
    scores[topic] = refs.length;
  }

  // Top compound topics (2+ cross-references)
  const topCompound = Object.entries(scores)
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  state.lastScanCycle = cycleCount;
  state.referencedBy = referencedBy;
  state.scores = scores;
  state.topCompound = topCompound;

  writeState('compound-scores.json', state);

  if (topCompound.length > 0) {
    slog('FEEDBACK', `[compound] Top cross-referenced: ${topCompound.slice(0, 5).map(t => `${t}(${scores[t]})`).join(', ')}`);
  }
}

/** Get compound scores for topic loading prioritization */
export function getCompoundScores(): Record<string, number> {
  const state = readState<CompoundScoreState>('compound-scores.json', {
    lastScanCycle: 0, referencedBy: {}, scores: {}, topCompound: [],
  });
  return state.scores;
}

// =============================================================================
// Loop H: Problem Alignment Audit (Am I solving the right problem?)
// =============================================================================

interface ProblemAlignmentState {
  cyclesSinceLastCheck: number;
  lastCheckAt: string | null;
  alignmentHistory: number[];
  warningActive: boolean;
  lastWarningAt: string | null;
}

const ALIGNMENT_CHECK_INTERVAL = 10;
const ALIGNMENT_WARNING_FILE = 'problem-alignment-warning.flag';
const ALIGNMENT_WINDOW = 5; // Track last 5 checks

/**
 * 偵測行動是否和 stated priorities 對齊。
 * 讀取 memory-index in_progress 任務的優先事項，比對最近 action 文字。
 * 持續低對齊 → 注入「你在回答正確的問題嗎？」校正提醒。
 * 每 10 cycles 執行。
 */
export async function auditProblemAlignment(action: string | null): Promise<void> {
  const state = readState<ProblemAlignmentState>('problem-alignment.json', {
    cyclesSinceLastCheck: 0,
    lastCheckAt: null,
    alignmentHistory: [],
    warningActive: false,
    lastWarningAt: null,
  });

  state.cyclesSinceLastCheck++;
  if (state.cyclesSinceLastCheck < ALIGNMENT_CHECK_INTERVAL) {
    writeState('problem-alignment.json', state);
    return;
  }
  state.cyclesSinceLastCheck = 0;

  // ── Extract priority keywords from memory-index in_progress tasks ──
  let priorityKeywords: string[] = [];
  try {
    const { getPriorityKeywords } = await import('./memory-index.js');
    const memDir = getMemoryRootDir();
    priorityKeywords = getPriorityKeywords(memDir);
  } catch { /* ignore */ }

  if (priorityKeywords.length === 0) {
    writeState('problem-alignment.json', state);
    return;
  }

  // ── Build action text from current action + recent CRS baselines ──
  let actionText = '';
  if (action) actionText += ' ' + action.toLowerCase();

  // Read recent CRS baselines for citation context
  try {
    const crsPath = getStatePath('crs-baseline.jsonl');
    if (existsSync(crsPath)) {
      const lines = readFileSync(crsPath, 'utf-8').split('\n').filter(Boolean).slice(-10);
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record.citations) actionText += ' ' + (record.citations as string[]).join(' ');
          if (record.triggerReason) actionText += ' ' + record.triggerReason;
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }

  // ── Calculate alignment score ──
  let matches = 0;
  for (const keyword of priorityKeywords) {
    if (actionText.includes(keyword)) matches++;
  }
  const score = priorityKeywords.length > 0 ? matches / priorityKeywords.length : 1;

  // Track alignment over time
  state.alignmentHistory.push(Number(score.toFixed(2)));
  if (state.alignmentHistory.length > ALIGNMENT_WINDOW) {
    state.alignmentHistory = state.alignmentHistory.slice(-ALIGNMENT_WINDOW);
  }

  // Average alignment over window
  const avgAlignment = state.alignmentHistory.length > 0
    ? state.alignmentHistory.reduce((s, v) => s + v, 0) / state.alignmentHistory.length
    : 1;

  state.lastCheckAt = new Date().toISOString();

  const flagPath = getStatePath(ALIGNMENT_WARNING_FILE);
  const cooldownOk = !state.lastWarningAt ||
    (Date.now() - new Date(state.lastWarningAt).getTime()) > 12 * 3600_000;

  if (avgAlignment < 0.15 && state.alignmentHistory.length >= 3 && cooldownOk) {
    // Sustained low alignment — inject correction prompt
    const warning = `問題校正：最近的行動和任務優先事項對齊度偏低（${Math.round(avgAlignment * 100)}%）。\n問自己：「我在回答正確的問題嗎？」\n當前優先：${priorityKeywords.slice(0, 5).join(', ')}`;
    writeFileSync(flagPath, warning, 'utf-8');
    invalidateFlagCache(flagPath);
    state.warningActive = true;
    state.lastWarningAt = new Date().toISOString();
    slog('FEEDBACK', `[alignment] Problem misalignment: avg ${Math.round(avgAlignment * 100)}% — warning injected`);
  } else if (avgAlignment >= 0.3 && state.warningActive) {
    // Alignment recovered — clear warning
    try {
      if (existsSync(flagPath)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(flagPath);
        invalidateFlagCache(flagPath);
      }
    } catch { /* ignore */ }
    state.warningActive = false;
    slog('FEEDBACK', `[alignment] Problem alignment recovered: ${Math.round(avgAlignment * 100)}%`);
  }

  writeState('problem-alignment.json', state);
}

// =============================================================================
// Unified Entry Point
// =============================================================================

export async function runFeedbackLoops(
  action: string | null,
  triggerReason?: string | null,
  context?: string | null,
  cycleCount?: number,
  model?: 'opus' | 'sonnet',
  response?: string | null,
): Promise<void> {
  await detectErrorPatterns().catch(() => {});
  await trackPerceptionCitations(action, response, context).catch(() => {});
  await auditDecisionQuality(action, triggerReason, response).catch(() => {});
  await auditSystemHealth().catch(() => {});
  await auditStructuralHealth(triggerReason).catch(() => {});
  // Loop G: Compound interest scoring (cross-topic citation tracking)
  if (cycleCount) await trackCompoundInterest(cycleCount).catch(() => {});
  // Loop H: Problem alignment audit (am I solving the right problem?)
  await auditProblemAlignment(action).catch(() => {});
  // Capability gap scan (every 50 cycles)
  if (cycleCount && cycleCount % 50 === 0) {
    try { const { scanCapabilityGaps } = await import('./evolution.js'); await scanCapabilityGaps(); } catch { /* ignore */ }
  }
  // Route-based pruning (every 50 cycles, slime mold model)
  if (cycleCount && cycleCount % 50 === 0) {
    try { const { applyRoutePruning } = await import('./route-tracker.js'); applyRoutePruning(); } catch { /* ignore */ }
  }
  // CRS baseline recording (sync, fire-and-forget)
  try { recordBaselineCycle(action, context ?? null, triggerReason, model); } catch { /* ignore */ }
  // Achievement system (fire-and-forget)
  try { const { checkAchievements } = await import('./achievements.js'); await checkAchievements(action, cycleCount ?? 0); } catch { /* ignore */ }
}
