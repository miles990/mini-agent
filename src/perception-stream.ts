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
import { eventBus, distinctUntilChanged } from './event-bus.js';
import { executePerception } from './perception.js';
import type { PerceptionResult, CustomPerception } from './perception.js';
import type { ComposePerception } from './types.js';
import { analyzePerceptions, isAnalysisAvailable } from './perception-analyzer.js';
import { slog } from './utils.js';

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
}

// Category → interval mapping
const INTERVALS: Record<string, number> = {
  workspace: 30_000,     // 30s
  chrome: 120_000,       // 120s
  telegram: 0,           // event-driven
  heartbeat: 30 * 60_000, // 30min
};

// Plugin name → category
const CATEGORY_MAP: Record<string, string> = {
  'state-changes': 'workspace',
  'tasks': 'workspace',
  'git-detail': 'workspace',
  'focus-context': 'workspace',
  'chrome': 'chrome',
  'web': 'chrome',
  'telegram-inbox': 'telegram',
  'mobile': 'workspace',
  'claude-code-inbox': 'workspace',
  'chat-room-inbox': 'workspace',
  'claude-code-sessions': 'workspace',
  'environment-sense': 'heartbeat',
};

function getCategory(name: string): string {
  return CATEGORY_MAP[name] ?? 'heartbeat';
}

// =============================================================================
// PerceptionStreamManager
// =============================================================================

class PerceptionStreamManager {
  private streams = new Map<string, StreamEntry>();
  private cwd = '';
  private running = false;
  private _version = 0;
  private lastBuildHashes = new Map<string, string>();

  get version(): number {
    return this._version;
  }

  start(perceptions: ComposePerception[], cwd: string): void {
    if (this.running) this.stop();
    this.cwd = cwd;
    this.running = true;

    for (const p of perceptions) {
      if (p.enabled === false) continue;

      const category = getCategory(p.name);
      const entry: StreamEntry = {
        perception: p,
        result: null,
        analysis: null,
        hash: null,
        updatedAt: null,
        timer: null,
        isChanged: distinctUntilChanged<string>(h => h),
        lastDurationMs: 0,
        timeoutCount: 0,
        totalRunMs: 0,
        runCount: 0,
      };

      this.streams.set(p.name, entry);

      // Initial run
      this.tick(entry);

      // Schedule by category
      if (category === 'telegram') {
        eventBus.on('trigger:telegram', () => this.tick(entry));
      } else {
        const interval = INTERVALS[category] ?? INTERVALS.heartbeat;
        entry.timer = setInterval(() => this.tick(entry), interval);
      }
    }

    if (this.streams.size > 0) {
      const cats = new Map<string, number>();
      for (const [name] of this.streams) {
        const cat = getCategory(name);
        cats.set(cat, (cats.get(cat) ?? 0) + 1);
      }
      const summary = [...cats.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
      slog('PERCEPTION', `Streams started: ${this.streams.size} plugins (${summary})`);
    }
  }

  stop(): void {
    for (const entry of this.streams.values()) {
      if (entry.timer) clearInterval(entry.timer);
    }
    this.streams.clear();
    this.running = false;
    // (debounce removed — perception changes no longer trigger cycles)
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

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      slog('PERCEPTION', `[degraded] ${entry.perception.name}: ${msg}`);
      entry.timeoutCount++;
      // 超時或錯誤：保留上次結果，不更新
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
