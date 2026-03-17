/**
 * Sentinel — file-based event source → eventBus bridge
 *
 * Bridges the gap between API-driven events (already connected to eventBus)
 * and file-based events (external editors, shell scripts, Claude Code).
 *
 * Runs outside OODA cycles as a persistent watcher.
 */

import fs from 'node:fs';
import path from 'node:path';
import { eventBus, debounce } from './event-bus.js';
import { slog } from './utils.js';

/** Directories to watch recursively for file changes */
const WATCH_DIRS = [
  'memory/conversations',     // JSONL written by external tools
  'memory/handoffs',          // Handoff status changes
];

/** Individual files to watch */
const WATCH_FILES = [
  'memory/state/chat-room-inbox.md',   // Written by shell plugin
];

/** Start file watchers that emit events to the event bus */
export function startSentinel(workdir: string): void {
  let watchCount = 0;

  // Directory watchers (recursive)
  for (const rel of WATCH_DIRS) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;

    try {
      const emit = debounce((_eventType: string, filename: string | null) => {
        const filePath = path.join(rel, filename ?? '');
        slog('SENTINEL', `File change: ${filePath}`);
        eventBus.emit('trigger:workspace', {
          source: 'sentinel',
          path: filePath,
        });
      }, 500);

      fs.watch(abs, { recursive: true }, (eventType, filename) => {
        emit(eventType, filename);
      });
      watchCount++;
    } catch {
      // fs.watch can fail on some platforms/paths — non-fatal
    }
  }

  // Single file watchers
  for (const rel of WATCH_FILES) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;

    try {
      const emit = debounce(() => {
        slog('SENTINEL', `File change: ${rel}`);
        eventBus.emit('trigger:workspace', {
          source: 'sentinel',
          path: rel,
        });
      }, 500);

      fs.watch(abs, () => {
        emit();
      });
      watchCount++;
    } catch {
      // Non-fatal
    }
  }

  if (watchCount > 0) {
    slog('SENTINEL', `Watching ${watchCount} paths for file-based events`);
  }
}
