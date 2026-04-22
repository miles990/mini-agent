/**
 * Perception Stream Manager — Phase 4
 *
 * 每個 perception plugin 獨立運行，各自有 interval 和 distinctUntilChanged。
 * buildContext() 直接讀取 cache，不再每次執行 shell scripts。
 *
 * 分類：
 * - workspace: 60s（state-changes, tasks, git-detail）
 * - chrome: 120s（chrome, web）
 * - telegram: event-driven（trigger:telegram → immediate）
 * - heartbeat: 30min（其他全部）
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eventBus, distinctUntilChanged } from './event-bus.js';
import { executePerception } from './perception.js';
import type { PerceptionResult, CustomPerception } from './perception.js';
import type { ComposePerception } from './types.js';
import { analyzePerceptions, isAnalysisAvailable } from './perception-analyzer.js';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Perception Cache — persist across restarts
// =============================================================================

interface PerceptionCacheEntry {
  name: string;
  output: string | null;
  hash: string | null;
  updatedAt: string | null;
}

function getCachePath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'perception-cache.json');
}

function loadPerceptionCache(): Map<string, PerceptionCacheEntry> {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    const entries: PerceptionCacheEntry[] = JSON.parse(raw);
    const map = new Map<string, PerceptionCacheEntry>();
    for (const e of entries) {
      // Only use cache entries < 1 hour old
      if (e.updatedAt) {
        const age = Date.now() - new Date(e.updatedAt).getTime();
        if (age < 3_600_000) map.set(e.name, e);
      }
    }
    return map;
  } catch { return new Map(); }
}

function savePerceptionCache(streams: Map<string, StreamEntry>): void {
  try {
    const entries: PerceptionCacheEntry[] = [];
    for (const [name, entry] of streams) {
      if (entry.result?.output) {
        entries.push({
          name,
          output: entry.result.output,
          hash: entry.hash,
          updatedAt: entry.updatedAt?.toISOString() ?? null,
        });
      }
    }
    fs.writeFileSync(getCachePath(), JSON.stringify(entries), 'utf-8');
  } catch { /* fail-open */ }
}

// =============================================================================
// Types
// =============================================================================

interface StreamEntry {
  perception: ComposePerception;
  result: PerceptionResult | null;
  analysis: string | null;
  hash: string | null;
  updatedAt: Date | null;
  timer: ReturnType<typeof setInterval> | null;
  isChanged: (hash: string) => boolean;
  // ── Layer 1 backpressure metrics ──
  lastDurationMs: number;
  timeoutCount: number;
  totalRunMs: number;
  runCount: number;
  // ── Auto-restart tracking ──
  consecutiveFailures: number;
  restartCount: number;
  lastRestartAt: Date | null;
}

// Category → interval mapping
const INTERVALS: Record<string, number> = {
  workspace: 30_000,     // 30s
  chrome: 120_000,       // 120s
  telegram: 0,           // event-driven
  heartbeat: 30 * 60_000, // 30min
};

/** Parse interval string (e.g. "30s", "5m", "1h") to milliseconds */
function parseInterval(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  switch (match[2]) {
    case 's': return val * 1000;
    case 'm': return val * 60_000;
    case 'h': return val * 3_600_000;
    default: return null;
  }
}

// Plugin name → category
const CATEGORY_MAP: Record<string, string> = {
  'state-changes': 'workspace',
  'tasks': 'workspace',
  'git-detail': 'workspace',
  'focus-context': 'workspace',
  'chrome': 'chrome',
  'cdp-events': 'chrome',
  'web': 'chrome',
  'mobile': 'workspace',
  'claude-code-inbox': 'workspace',
  'chat-room-inbox': 'workspace',
  'claude-code-sessions': 'workspace',
  'environment-sense': 'heartbeat',
};

function getCategory(name: string): string {
  return CATEGORY_MAP[name] ?? 'heartbeat';
}

/**
 * 所有 lane（foreground, ask, etc.）在輕量 context 中應載入的 perception plugins。
 * 統一定義，避免各 lane 硬編碼不同清單。
 */
export const IMPORTANT_PERCEPTION_NAMES = [
  'state-changes',
  'tasks',
  'chat-room-inbox',
  'github-issues',
] as const;

// =============================================================================
// PerceptionStreamManager
// =============================================================================

class PerceptionStreamManager {
  private streams = new Map<string, StreamEntry>();
  private cwd = '';
  private running = false;
  private _version = 0;
  private lastBuildHashes = new Map<string, string>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  get version(): number {
    return this._version;
  }

  start(perceptions: ComposePerception[], cwd: string): void {
    if (this.running) this.stop();
    this.cwd = cwd;
    this.running = true;

    // Load cached perception data from previous run (warm start)
    const cache = loadPerceptionCache();
    let warmCount = 0;

    let staggerIndex = 0;
    for (const p of perceptions) {
      if (p.enabled === false) continue;

      const category = getCategory(p.name);
      const cached = cache.get(p.name);
      const entry: StreamEntry = {
        perception: p,
        result: cached ? { name: p.name, output: cached.output, error: undefined, durationMs: 0 } : null,
        analysis: null,
        hash: cached?.hash ?? null,
        updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
        timer: null,
        isChanged: distinctUntilChanged<string>(h => h),
        lastDurationMs: 0,
        timeoutCount: 0,
        totalRunMs: 0,
        runCount: 0,
        consecutiveFailures: 0,
        restartCount: 0,
        lastRestartAt: null,
      };
      if (cached) warmCount++;

      this.streams.set(p.name, entry);

      // Initial run — staggered to avoid thundering herd at startup
      // Warm-cached plugins use longer stagger (they already have data)
      const delay = cached
        ? (staggerIndex++ * 1000) + 2000  // cached: start after 2s, 1s apart (low priority)
        : staggerIndex++ * 500;            // cold: start immediately, 500ms apart
      if (delay === 0) this.tick(entry);
      else setTimeout(() => this.tick(entry), delay);

      // Schedule by category (per-plugin interval override from compose takes priority)
      if (category === 'telegram') {
        eventBus.on('trigger:telegram', () => this.tick(entry));
      } else {
        const pluginInterval = p.interval ? parseInterval(p.interval) : null;
        const interval = pluginInterval ?? INTERVALS[category] ?? INTERVALS.heartbeat;
        entry.timer = setInterval(() => this.tick(entry), interval);
      }
    }

    // Apply persisted interval adjustments from citation tracking (survives restarts)
    try {
      const statePath = path.join(process.cwd(), 'memory', 'state', 'perception-citations.json');
      if (fs.existsSync(statePath)) {
        const stateData = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const adjusted = stateData.adjustedIntervals ?? {};
        let appliedCount = 0;
        for (const [name, interval] of Object.entries(adjusted)) {
          if (this.streams.has(name) && typeof interval === 'number') {
            this.adjustInterval(name, interval);
            appliedCount++;
          }
        }
        if (appliedCount > 0) {
          slog('PERCEPTION', `Applied ${appliedCount} persisted interval adjustments from citation tracking`);
        }
      }
    } catch { /* first run or no adjustments */ }

    if (this.streams.size > 0) {
      const cats = new Map<string, number>();
      for (const [name] of this.streams) {
        const cat = getCategory(name);
        cats.set(cat, (cats.get(cat) ?? 0) + 1);
      }
      const summary = [...cats.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
      const warmMsg = warmCount > 0 ? `, ${warmCount} warm from cache` : '';
      slog('PERCEPTION', `Streams started: ${this.streams.size} plugins (${summary}${warmMsg})`);
    }

    // Health check: detect stale plugins and auto-restart (every 5 min)
    // Also saves perception cache periodically (crash-safe — no clean stop needed)
    this.healthCheckTimer = setInterval(() => {
      this.healthCheck();
      savePerceptionCache(this.streams);
    }, 5 * 60_000);
  }

  stop(): void {
    // Persist perception cache for warm restart
    if (this.streams.size > 0) {
      savePerceptionCache(this.streams);
    }
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
    for (const entry of this.streams.values()) {
      if (entry.timer) clearInterval(entry.timer);
    }
    this.streams.clear();
    this.running = false;
  }

  isActive(): boolean {
    return this.running && this.streams.size > 0;
  }

  /**
   * Get cached results for buildContext.
   * Returns only perceptions that have output.
   */
  getCachedResults(): PerceptionResult[] {
    return [...this.streams.values()]
      .filter(e => e.result?.output)
      .map(e => e.result!);
  }

  /**
   * Get cached analysis report (if analyzer was available).
   * Returns combined analysis from all streams, or null.
   */
  getCachedReport(): string | null {
    const analyses = [...this.streams.values()]
      .filter(e => e.analysis)
      .map(e => `## ${e.perception.name}\n${e.analysis}`);

    return analyses.length > 0 ? analyses.join('\n\n') : null;
  }

  /**
   * Check if a plugin's output changed since last context build.
   */
  hasChangedSinceLastBuild(name: string): boolean {
    const entry = this.streams.get(name);
    if (!entry?.hash) return true;
    return this.lastBuildHashes.get(name) !== entry.hash;
  }

  /**
   * Mark current hashes as "seen" — call after building context.
   */
  markContextBuilt(): void {
    for (const [name, entry] of this.streams) {
      if (entry.hash) {
        this.lastBuildHashes.set(name, entry.hash);
      }
    }
    // Prune hashes for plugins no longer in streams (prevent unbounded growth)
    for (const key of this.lastBuildHashes.keys()) {
      if (!this.streams.has(key)) {
        this.lastBuildHashes.delete(key);
      }
    }
  }

  /**
   * Restore a perception's interval to its category default.
   * Used by feedback Loop B when citation rate recovers.
   */
  restoreDefaultInterval(name: string): void {
    const category = getCategory(name);
    const defaultInterval = INTERVALS[category] ?? INTERVALS.heartbeat;
    this.adjustInterval(name, defaultInterval);
    slog('PERCEPTION', `Interval restored to default: ${name} → ${Math.round(defaultInterval / 1000)}s`);
  }

  /**
   * Dynamically adjust a perception's update interval.
   * Used by feedback loops to increase/decrease polling frequency.
   */
  adjustInterval(name: string, newInterval: number): void {
    const entry = this.streams.get(name);
    if (!entry || !entry.timer) return;
    // Enforce bounds: min 30s, max 30min
    const bounded = Math.max(30_000, Math.min(30 * 60_000, newInterval));
    clearInterval(entry.timer);
    entry.timer = setInterval(() => this.tick(entry), bounded);
    slog('PERCEPTION', `Interval adjusted: ${name} → ${Math.round(bounded / 1000)}s`);
  }

  /**
   * Get performance stats for all perception streams.
   */
  getStats(): Array<{ name: string; avgMs: number; timeouts: number; interval: number }> {
    return [...this.streams.entries()].map(([name, e]) => ({
      name,
      avgMs: e.runCount > 0 ? Math.round(e.totalRunMs / e.runCount) : 0,
      timeouts: e.timeoutCount,
      interval: INTERVALS[getCategory(name)] ?? 30_000,
    }));
  }

  /**
   * Force immediate refresh of all active streams.
   * Used by concurrent-action to refresh perception caches during callClaude await.
   */
  async refreshAll(): Promise<void> {
    if (!this.running) return;
    const promises = [...this.streams.values()].map(entry =>
      this.tick(entry).catch(() => {})
    );
    await Promise.allSettled(promises);
  }

  /**
   * Count how many perception sections changed since last context build.
   * More changes = more likely the next cycle will be productive.
   */
  getChangedCount(): number {
    let count = 0;
    for (const [name, entry] of this.streams) {
      if (!entry.hash) continue;
      if (this.lastBuildHashes.get(name) !== entry.hash) count++;
    }
    return count;
  }

  /**
   * Get detailed status for all perception streams (for dashboard/API).
   */
  getStatus(): Array<{
    name: string;
    category: string;
    interval: number;
    updatedAt: string | null;
    ageMs: number | null;
    avgMs: number;
    timeouts: number;
    runCount: number;
    restarts: number;
    healthy: boolean;
  }> {
    const now = Date.now();
    return [...this.streams.entries()].map(([name, e]) => {
      const category = getCategory(name);
      const interval = INTERVALS[category] ?? 30_000;
      const ageMs = e.updatedAt ? now - e.updatedAt.getTime() : null;
      // Healthy if: has run at least once AND no recent timeouts AND age < 3x interval (or event-driven)
      const healthy = e.runCount > 0 && e.timeoutCount < 3 &&
        (interval === 0 || ageMs === null || ageMs < interval * 3);
      return {
        name,
        category,
        interval,
        updatedAt: e.updatedAt?.toISOString() ?? null,
        ageMs,
        avgMs: e.runCount > 0 ? Math.round(e.totalRunMs / e.runCount) : 0,
        timeouts: e.timeoutCount,
        runCount: e.runCount,
        restarts: e.restartCount,
        healthy,
      };
    });
  }

  /**
   * Detect if the machine is likely sleeping (macOS suspend).
   * Returns true if ALL non-event-driven perceptions are stale beyond threshold.
   * When true, Claude CLI calls would be wasted (SIGTERM → exit 143).
   */
  isMachineSleeping(thresholdMs = 5 * 60_000): boolean {
    const now = Date.now();
    let checked = 0;

    for (const [, entry] of this.streams) {
      const category = getCategory(entry.perception.name);
      if (category === 'telegram') continue; // event-driven, skip

      checked++;
      const ageMs = entry.updatedAt ? now - entry.updatedAt.getTime() : Infinity;
      // If ANY non-event-driven stream updated recently, machine is awake
      if (ageMs < thresholdMs) return false;
    }

    return checked > 0; // true only if we checked streams and all are stale
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Periodic health check — detect stale plugins and auto-restart.
   * A plugin is stale if it hasn't successfully updated in 5x its interval (min 5 min).
   * Max 3 restarts per plugin to prevent restart storms.
   */
  private healthCheck(): void {
    const now = Date.now();
    for (const [name, entry] of this.streams) {
      const category = getCategory(name);
      const interval = INTERVALS[category] ?? INTERVALS.heartbeat;
      if (interval === 0) continue; // skip event-driven plugins

      const ageMs = entry.updatedAt ? now - entry.updatedAt.getTime() : now;
      const staleThreshold = Math.max(interval * 5, 5 * 60_000);

      if (ageMs > staleThreshold && entry.restartCount < 3) {
        slog('PERCEPTION', `[auto-restart] ${name}: stale for ${Math.round(ageMs / 1000)}s, restarting (attempt ${entry.restartCount + 1}/3)`);
        this.restartPlugin(name);
      } else if (ageMs > staleThreshold && entry.restartCount >= 3) {
        // Already exhausted restarts — log once at debug level, don't spam
      }
    }
  }

  /**
   * Restart a stale plugin: clear old timer, reset failure counters,
   * restore default interval, and do an immediate tick.
   */
  private restartPlugin(name: string): void {
    const entry = this.streams.get(name);
    if (!entry) return;

    if (entry.timer) clearInterval(entry.timer);

    entry.timeoutCount = 0;
    entry.consecutiveFailures = 0;
    entry.restartCount++;
    entry.lastRestartAt = new Date();

    // Immediate tick
    this.tick(entry);

    // Restore default interval
    const category = getCategory(name);
    const interval = INTERVALS[category] ?? INTERVALS.heartbeat;
    if (interval > 0) {
      entry.timer = setInterval(() => this.tick(entry), interval);
    }
  }

  private async tick(entry: StreamEntry): Promise<void> {
    if (!this.running) return;

    // Circuit breaker: 3 consecutive timeouts → double interval
    if (entry.timeoutCount >= 3) {
      const currentInterval = INTERVALS[getCategory(entry.perception.name)] ?? 30_000;
      this.adjustInterval(entry.perception.name, currentInterval * 2);
      entry.timeoutCount = 0;
      slog('PERCEPTION', `[circuit-breaker] ${entry.perception.name}: 3 consecutive timeouts → interval doubled`);
      return;
    }

    const timeoutMs = entry.perception.timeout ?? 10_000; // 預設 10s
    let result: PerceptionResult;

    const start = Date.now();
    try {
      result = await Promise.race([
        executePerception(entry.perception as CustomPerception, this.cwd),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Plugin ${entry.perception.name} timed out (${timeoutMs}ms)`)), timeoutMs),
        ),
      ]);
      entry.timeoutCount = 0; // reset on success
      // Recovery: if plugin was failing, restore default interval
      if (entry.consecutiveFailures > 0) {
        const prevFailures = entry.consecutiveFailures;
        entry.consecutiveFailures = 0;
        this.restoreDefaultInterval(entry.perception.name);
        slog('PERCEPTION', `[recovered] ${entry.perception.name} after ${prevFailures} consecutive failures`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      slog('PERCEPTION', `[degraded] ${entry.perception.name}: ${msg}`);
      entry.timeoutCount++;
      entry.consecutiveFailures++;
      return;
    }
    entry.lastDurationMs = Date.now() - start;
    entry.totalRunMs += entry.lastDurationMs;
    entry.runCount++;

    const hash = crypto.createHash('md5')
      .update(result.output ?? '')
      .digest('hex');

    entry.result = result;
    entry.updatedAt = new Date();

    if (entry.isChanged(hash)) {
      entry.hash = hash;
      this._version++;

      // Re-analyze if changed and analyzer available
      if (isAnalysisAvailable() && result.output) {
        try {
          const { report } = await analyzePerceptions([result]);
          entry.analysis = report;
        } catch {
          entry.analysis = null;
        }
      }

      // Note: perception changes do NOT trigger cycles — data is cached and
      // consumed by the next scheduled cycle or direct-message-triggered cycle.
      // Previously emitted trigger:workspace here, but it caused continuous
      // cycling (~every 30s) since workspace plugins detect changes frequently.
    }
  }
}

// Singleton
export const perceptionStreams = new PerceptionStreamManager();
