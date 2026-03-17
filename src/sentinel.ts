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

/** Directories to watch recursively — conversations get P0 (trigger:room), others get P2 (trigger:workspace) */
const WATCH_DIRS_P0 = [
  'memory/conversations',     // JSONL — room messages written by external tools
];

const WATCH_DIRS_P2 = [
  'memory/handoffs',          // Handoff status changes
  'memory/state',             // State files (inbox, metrics, etc.)
];

/** Individual files to watch (outside WATCH_DIRS coverage) */
const WATCH_FILES: string[] = [
  // chat-room-inbox.md is now covered by WATCH_DIRS_P2 'memory/state/'
];

/** Start file watchers that emit events to the event bus */
export function startSentinel(workdir: string): void {
  let watchCount = 0;

  // P0 directory watchers — conversations get trigger:room for instant wake
  for (const rel of WATCH_DIRS_P0) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;

    try {
      const emit = debounce((_eventType: string, filename: string | null) => {
        const filePath = path.join(rel, filename ?? '');
        slog('SENTINEL', `Room file change: ${filePath}`);
        eventBus.emit('trigger:room', {
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

  // P2 directory watchers — general workspace events
  for (const rel of WATCH_DIRS_P2) {
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
