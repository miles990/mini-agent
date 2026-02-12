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
}

// Category → interval mapping
const INTERVALS: Record<string, number> = {
  workspace: 60_000,     // 60s
  chrome: 120_000,       // 120s
  telegram: 0,           // event-driven
  heartbeat: 30 * 60_000, // 30min
};

// Plugin name → category
const CATEGORY_MAP: Record<string, string> = {
  'state-changes': 'workspace',
  'tasks': 'workspace',
  'git-detail': 'workspace',
  'chrome': 'chrome',
  'web': 'chrome',
  'telegram-inbox': 'telegram',
  'mobile': 'workspace',
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

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async tick(entry: StreamEntry): Promise<void> {
    if (!this.running) return;

    const result = await executePerception(
      entry.perception as CustomPerception,
      this.cwd,
    );

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

      // Emit change trigger (may drive loop cycle)
      const category = getCategory(entry.perception.name);
      if (category === 'workspace') {
        eventBus.emit('trigger:workspace', { source: entry.perception.name });
      }
    }
  }
}

// Singleton
export const perceptionStreams = new PerceptionStreamManager();
