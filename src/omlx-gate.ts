/**
 * oMLX Gate — 本地 LLM 預處理層
 *
 * 在 Claude CLI 呼叫前做快速判斷，減少不必要的 Claude 消耗。
 * 核心原則：oMLX 做 Gate（二元判斷），不做 Transform（內容轉換）。
 *
 * 四個替換點：
 * R1: Perception 精簡 — 降低 output_cap + 移除低引用 sections（純邏輯，不用 LLM）
 * R2: Skills 篩選 — 改進 mode/keyword matching（純邏輯，不用 LLM）
 * R3: Cron gate — mtime 檢查 + 0.8B 二元分類，skip 空輪詢
 * R4: Context delta — hash 比對，skip 無變化 cycle（純邏輯，不用 LLM）
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

/** Last known mtime of HEARTBEAT.md */
let lastHeartbeatMtime = 0;

/** Last context hash for delta detection */
let lastContextHash = '';

/** oMLX base URL and API key */
const omlxUrl = () => process.env.LOCAL_LLM_URL || 'http://localhost:8000';
const omlxKey = () => process.env.LOCAL_LLM_KEY || 'local';

// =============================================================================
// R3: Cron HEARTBEAT Gate
// =============================================================================

/**
 * Gate a cron task — decide whether it needs Claude or can be skipped.
 *
 * Two-layer check:
 * 1. mtime check: if HEARTBEAT.md unchanged since last check → skip (zero LLM)
 * 2. 0.8B classification: read file content, binary yes/no for actionable tasks
 *
 * Only gates HEARTBEAT-related cron tasks. Others pass through.
 */
export function cronGate(taskDescription: string): CronGateResult {
  // Only gate HEARTBEAT-related tasks
  if (!taskDescription.toLowerCase().includes('heartbeat')) {
    return 'claude';
  }

  const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');

  // Layer 1: mtime check — zero cost
  try {
    const stat = fs.statSync(heartbeatPath);
    const mtime = stat.mtimeMs;

    if (mtime === lastHeartbeatMtime && lastHeartbeatMtime > 0) {
      // File unchanged since last check → skip
      stats.cronSkipped++;
      stats.totalSaved += 13000; // ~13K chars per HEARTBEAT Claude call
      eventBus.emit('log:info', {
        message: `[omlx-gate] R3: HEARTBEAT unchanged (mtime), skipping Claude call`,
      });
      return 'skip';
    }

    lastHeartbeatMtime = mtime;
  } catch {
    // File doesn't exist or can't stat → pass through to Claude
    return 'claude';
  }

  // Layer 2: 0.8B binary classification — file changed, check content
  try {
    const content = fs.readFileSync(heartbeatPath, 'utf-8');

    // Quick heuristic: no unchecked tasks marker → skip without LLM
    if (!content.includes('- [ ]') && !content.includes('- []')) {
      // No unchecked task markers in file
      stats.cronSkipped++;
      stats.totalSaved += 13000;
      eventBus.emit('log:info', {
        message: `[omlx-gate] R3: HEARTBEAT has no unchecked tasks (heuristic), skipping`,
      });
      return 'skip';
    }

    // Has task markers — use 0.8B to check if any are actionable
    const prompt = `You are a task classifier. Look at the HEARTBEAT content below.
Does it contain UNCHECKED tasks (lines starting with "- [ ]") that should be executed NOW?
Ignore completed tasks (lines with "- [x]").

HEARTBEAT:
${content.slice(0, 2000)}

Answer with ONLY "yes" or "no".`;

    const result = callLocalFast(prompt, 64);
    const answer = result.trim().toLowerCase();

    if (answer.startsWith('no')) {
      stats.cronSkipped++;
      stats.totalSaved += 13000;
      eventBus.emit('log:info', {
        message: `[omlx-gate] R3: HEARTBEAT tasks not actionable (0.8B), skipping`,
      });
      return 'skip';
    }

    // 0.8B says yes → pass through to Claude
    stats.cronPassed++;
    return 'claude';
  } catch (err) {
    // LLM call failed → pass through (fail-open)
    eventBus.emit('log:info', {
      message: `[omlx-gate] R3: 0.8B call failed, passing through to Claude: ${err instanceof Error ? err.message : err}`,
    });
    stats.cronPassed++;
    return 'claude';
  }
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
  const hash = createHash('md5').update(context).digest('hex');

  if (hash === lastContextHash && lastContextHash !== '') {
    stats.contextDeltaSkipped++;
    stats.totalSaved += context.length;
    eventBus.emit('log:info', {
      message: `[omlx-gate] R4: Context unchanged (hash match), cycle can be skipped`,
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

/** Perception sections with citation rate < 1% over 2,454 cycles — safe to prune */
const LOW_CITATION_SECTIONS = new Set([
  'achievements',
  'claude-code-inbox',
  'claude-code-sessions',
  'cdp-events',
  'mushi-value-proof',
  'problem-alignment',
  'anima-sync',
  'line-web-live',
]);

/**
 * Dynamic pruning list loaded from perception-citations.json.
 * Updated on first call and every 100 cycles.
 */
let dynamicPruneSet: Set<string> | null = null;
let lastPruneRefreshCycle = 0;

/**
 * Load low-citation sections from perception-citations.json.
 * Sections with < 0.5% citation rate over 100+ cycles are candidates for pruning.
 */
function refreshDynamicPruneList(): Set<string> {
  const staticSet = new Set(LOW_CITATION_SECTIONS);

  try {
    const citationsPath = path.join(process.cwd(), 'memory', 'state', 'perception-citations.json');
    if (!fs.existsSync(citationsPath)) return staticSet;

    const data = JSON.parse(fs.readFileSync(citationsPath, 'utf-8'));
    const totalCycles = data.totalCycles ?? 0;
    if (totalCycles < 100) return staticSet; // Not enough data

    const citations: Record<string, number> = data.citations ?? {};
    for (const [section, count] of Object.entries(citations)) {
      const rate = count / totalCycles;
      if (rate < 0.005) { // < 0.5%
        staticSet.add(section);
      }
    }
  } catch { /* use static list */ }

  return staticSet;
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
  'telegram-inbox', 'inner-voice', 'inbox', 'chat-room-inbox',
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
    stdout = execFileSync('curl', args, opts);
  }
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
 * Call 9B for short generative tasks (summaries, rewrites).
 * Synchronous — blocks for up to timeoutMs.
 */
export function callLocalSmart(prompt: string, maxTokens: number, timeoutMs = 15_000): string {
  return callLocalLLM('Qwen3.5-9B-MLX-4bit', prompt, maxTokens, timeoutMs);
}
