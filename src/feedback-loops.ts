/**
 * Intelligent Feedback Loops — Phase 2 Self-Learning
 *
 * 三個 fire-and-forget 回饋迴路：
 * - Loop A: 錯誤模式識別 → 自動建修復任務
 * - Loop B: 感知引用追蹤 → 動態調頻
 * - Loop C: 決策品質自我審計
 *
 * 全部 fire-and-forget，不影響 OODA cycle。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { getLogger } from './logging.js';
import { perceptionStreams } from './perception-stream.js';
import { slog } from './utils.js';
import { getMemory } from './memory.js';

// =============================================================================
// Types
// =============================================================================

interface ErrorPatternState {
  [key: string]: {
    count: number;
    taskCreated: boolean;
    lastSeen: string;
  };
}

interface PerceptionCitationState {
  cycleCount: number;
  citations: Record<string, number>;
  lastAdjusted: string;
}

interface DecisionQualityState {
  recentScores: number[];
  avgScore: number;
  warningInjected: boolean;
  lastWarningAt: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function getStatePath(filename: string): string {
  const dir = getInstanceDir(getCurrentInstanceId());
  return path.join(dir, filename);
}

function readState<T>(filename: string, fallback: T): T {
  const p = getStatePath(filename);
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeState(filename: string, data: unknown): void {
  const p = getStatePath(filename);
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

// =============================================================================
// Loop A: Error Pattern Detection
// =============================================================================

/**
 * 掃描今天的 error log，按 (code + context) 分群。
 * 同模式 >= 3 次 → 寫入 HEARTBEAT.md 作為 P1 task。
 * 已建過的模式不重複建。
 */
export async function detectErrorPatterns(): Promise<void> {
  const logger = getLogger();
  const errors = logger.queryErrorLogs(undefined, 200);
  if (errors.length === 0) return;

  const state = readState<ErrorPatternState>('error-patterns.json', {});
  const today = new Date().toISOString().split('T')[0];

  // Group by (context + error code/message prefix)
  const groups = new Map<string, number>();
  for (const err of errors) {
    const context = err.data.context ?? 'unknown';
    const errorMsg = err.data.error ?? '';
    // Extract error code or first meaningful word
    const codeMatch = errorMsg.match(/^([A-Z_]+(?::[A-Z_]+)?)|^(\w+Error)/);
    const code = codeMatch?.[0] ?? errorMsg.slice(0, 30);
    const key = `${code}::${context}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  let changed = false;
  const memory = getMemory();

  for (const [key, count] of groups) {
    if (count < 3) continue;

    const existing = state[key];
    if (existing?.taskCreated) {
      // Update count + lastSeen but don't create another task
      existing.count = count;
      existing.lastSeen = today;
      changed = true;
      continue;
    }

    // New pattern or not yet tasked
    state[key] = { count, taskCreated: true, lastSeen: today };
    changed = true;

    const [code, context] = key.split('::');
    const dueDate = new Date(Date.now() + 3 * 86400_000).toISOString().split('T')[0];
    const taskText = `P1: 修復重複錯誤 — ${code} in ${context}（${count} 次）@due:${dueDate}`;
    await memory.addTask(taskText);
    slog('FEEDBACK', `Error pattern detected: ${key} (${count}×) → task created`);
  }

  // Clean up patterns not seen in 7 days — explicit resolution tracking
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
  for (const key of Object.keys(state)) {
    if (state[key].lastSeen < sevenDaysAgo) {
      if (state[key].taskCreated) {
        slog('FEEDBACK', `Error pattern resolved (no recurrence in 7d): ${key}`);
      }
      delete state[key];
      changed = true;
    }
  }

  if (changed) writeState('error-patterns.json', state);
}

// =============================================================================
// Loop B: Perception Citation Tracking
// =============================================================================

/**
 * 從 action 文字中提取引用的 <section-name>，累計統計。
 * 每 50 cycle 重新計算引用率，調整 perception stream intervals。
 */
export async function trackPerceptionCitations(action: string | null): Promise<void> {
  if (!action) return;

  const state = readState<PerceptionCitationState>('perception-citations.json', {
    cycleCount: 0,
    citations: {},
    lastAdjusted: '',
  });

  // Extract referenced <section-name> from action text
  const refs = action.matchAll(/<(\w[\w-]+)>/g);
  for (const m of refs) {
    const name = m[1];
    // Skip common XML-like tags that aren't perception sections
    if (['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol'].includes(name)) continue;
    state.citations[name] = (state.citations[name] ?? 0) + 1;
  }

  state.cycleCount++;

  // Every 50 cycles, evaluate and adjust
  if (state.cycleCount % 50 === 0 && state.cycleCount > 0) {
    const total = Object.values(state.citations).reduce((s, v) => s + v, 0);
    if (total > 0) {
      // Core perceptions that should never be adjusted
      const corePerceptions = new Set([
        'environment', 'telegram', 'soul', 'self', 'workspace',
        'temporal', 'capabilities',
      ]);

      for (const [name, count] of Object.entries(state.citations)) {
        if (corePerceptions.has(name)) continue;

        const rate = count / total;
        if (rate < 0.05) {
          // Low citation: slow down (cap at 30min)
          perceptionStreams.adjustInterval(name, 30 * 60_000);
          slog('FEEDBACK', `Low citation rate: ${name} (${(rate * 100).toFixed(1)}%) → interval increased`);
        } else if (rate >= 0.15) {
          // High citation: restore to category default
          perceptionStreams.restoreDefaultInterval(name);
          slog('FEEDBACK', `Citation rate recovered: ${name} (${(rate * 100).toFixed(1)}%) → interval restored`);
        }
      }

      state.lastAdjusted = new Date().toISOString().split('T')[0];
    }
  }

  writeState('perception-citations.json', state);
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
export async function auditDecisionQuality(action: string | null): Promise<void> {
  if (!action) return;

  const state = readState<DecisionQualityState>('decision-quality.json', {
    recentScores: [],
    avgScore: 0,
    warningInjected: false,
    lastWarningAt: null,
  });

  // Score current action's observability (0-6)
  const hasDecision = /##\s*Decision|\[DECISION\]/i.test(action);
  const hasWhat = /##\s*What|\*\*What/i.test(action);
  const hasWhy = /##\s*Why|\*\*Why/i.test(action);
  const hasThinking = /##\s*Thinking|\*\*Thinking/i.test(action);
  const hasChanged = /##\s*Changed|\*\*Changed/i.test(action);
  const hasVerified = /##\s*Verified|\*\*Verified/i.test(action);

  const score = [hasDecision, hasWhat, hasWhy, hasThinking, hasChanged, hasVerified]
    .filter(Boolean).length;

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

  // Check if warning is needed (avg < 3.0 and cooldown > 24h)
  const cooldownOk = !state.lastWarningAt ||
    (now - new Date(state.lastWarningAt).getTime()) > 24 * 3600_000;

  if (state.avgScore < 3.0 && state.recentScores.length >= 10 && cooldownOk) {
    // Inject warning
    const warning = `你最近 ${state.recentScores.length} 個 cycle 的決策完整度偏低（avg ${state.avgScore}/6）。建議放慢節奏，每個決策都寫 Why + Verified。`;
    writeFileSync(flagPath, warning, 'utf-8');
    state.warningInjected = true;
    state.lastWarningAt = new Date().toISOString();
    slog('FEEDBACK', `Decision quality warning injected (avg ${state.avgScore}/6)`);
  } else if (state.avgScore >= 4.0 && state.warningInjected) {
    // Quality recovered — clear warning
    if (existsSync(flagPath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(flagPath);
    }
    state.warningInjected = false;
    slog('FEEDBACK', `Decision quality recovered (avg ${state.avgScore}/6) — warning cleared`);
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
// Unified Entry Point
// =============================================================================

export async function runFeedbackLoops(action: string | null): Promise<void> {
  await detectErrorPatterns().catch(() => {});
  await trackPerceptionCitations(action).catch(() => {});
  await auditDecisionQuality(action).catch(() => {});
  await auditSystemHealth().catch(() => {});
}
