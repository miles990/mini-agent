/**
 * Event WAL — Persist pending priority events across restarts
 *
 * When shutdown interrupts P0/P1 event processing, this module saves
 * the pending state to disk. On startup, it's restored and re-injected.
 *
 * Works alongside inbox.jsonl (which persists message content) — inbox
 * is the source of truth for message data, WAL preserves the priority
 * routing state that would otherwise be lost (in-memory only).
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface PendingPriorityState {
  reason: string;
  arrivedAt: number;
  messageCount: number;
}

interface EventWalState {
  pendingPriority: PendingPriorityState;
  directMessageWakeQueue: number;
  savedAt: string;
}

// =============================================================================
// Path
// =============================================================================

function getWalPath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'event-wal.json');
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Save pending priority state to disk. Called during:
 * - stop(): pendingPriority still set when loop stops
 * - tryDrainPriority(): drain can't run because !this.running
 *
 * Only writes if there's actual pending state. Overwrites previous WAL.
 */
export function savePendingState(
  pendingPriority: PendingPriorityState | null,
  directMessageWakeQueue: number,
): void {
  if (!pendingPriority) return;

  try {
    const state: EventWalState = {
      pendingPriority,
      directMessageWakeQueue,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(getWalPath(), JSON.stringify(state) + '\n');
    slog('EVENT-WAL', `Saved: ${pendingPriority.reason} (${pendingPriority.messageCount} msg, ${directMessageWakeQueue} DM queued)`);
  } catch (err) {
    slog('EVENT-WAL', `Save failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Load and clear pending state from disk. Called during startup.
 * File is deleted after reading to prevent double-replay.
 * State older than 1h is ignored (messages too old to be urgent).
 */
export function loadAndClearPendingState(): EventWalState | null {
  const walPath = getWalPath();
  try {
    if (!fs.existsSync(walPath)) return null;

    const raw = fs.readFileSync(walPath, 'utf-8').trim();
    fs.unlinkSync(walPath); // Delete immediately to prevent double-replay

    if (!raw) return null;
    const state = JSON.parse(raw) as EventWalState;

    // Ignore state older than 1h
    const age = Date.now() - new Date(state.savedAt).getTime();
    if (age > 3_600_000) {
      slog('EVENT-WAL', `Stale state found (${Math.round(age / 60000)}min old), ignoring`);
      return null;
    }

    slog('EVENT-WAL', `Restored: ${state.pendingPriority.reason} (${state.pendingPriority.messageCount} msg, saved ${Math.round(age / 1000)}s ago)`);
    return state;
  } catch (err) {
    slog('EVENT-WAL', `Load failed: ${err instanceof Error ? err.message : err}`);
    // Clean up corrupted file
    try { fs.unlinkSync(walPath); } catch { /* ignore */ }
    return null;
  }
}
