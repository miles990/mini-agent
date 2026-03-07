/**
 * Cross-Instance IPC Event Bus
 *
 * File-based event channel for multi-instance communication.
 * Each instance watches ~/.mini-agent/events/ for new event files.
 * Consumed events are deleted. Stale events are cleaned on startup.
 *
 * Uses Node's built-in fs.watch — zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import type { AgentEventType } from './event-bus.js';
import type { IPCEvent } from './types.js';
import { getDataDir } from './instance.js';

const IPC_DIR_NAME = 'events';
const STALE_EVENT_MS = 60_000; // 1 min — events older than this are cleaned up

let ipcDir: string | null = null;
let instanceId: string | null = null;
let watcher: fs.FSWatcher | null = null;

/**
 * Get or create the IPC events directory
 */
function getIPCDir(): string {
  if (!ipcDir) {
    ipcDir = path.join(getDataDir(), IPC_DIR_NAME);
    if (!fs.existsSync(ipcDir)) {
      fs.mkdirSync(ipcDir, { recursive: true });
    }
  }
  return ipcDir;
}

/**
 * Initialize IPC bus for this instance.
 * Cleans stale events, then starts watching for new ones.
 */
export function initIPCBus(myInstanceId: string): void {
  instanceId = myInstanceId;
  const dir = getIPCDir();

  // Clean stale events from previous runs
  cleanStaleEvents(dir);

  // Watch for new event files
  try {
    watcher = fs.watch(dir, (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.endsWith('.json')) {
        const filePath = path.join(dir, filename);
        // Small delay to ensure file is fully written
        setTimeout(() => handleNewEvent(filePath), 20);
      }
    });

    watcher.on('error', () => {
      // Silent — directory watch errors are non-fatal
    });
  } catch {
    // fs.watch not supported or dir issue — IPC degrades gracefully
  }
}

/**
 * Emit an event to both in-process and cross-process buses.
 */
export function emitIPC(type: AgentEventType, data: Record<string, unknown> = {}): void {
  // Always emit locally
  eventBus.emit(type, data);

  // Write IPC file for other instances
  if (!instanceId) return;

  const dir = getIPCDir();
  const event: IPCEvent = {
    type,
    data,
    from: instanceId,
    ts: Date.now(),
  };

  const filename = `${instanceId}-${Date.now()}-${type.replace(/:/g, '_')}.json`;
  try {
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(event));
  } catch {
    // Non-fatal — IPC write failure doesn't affect local operation
  }
}

/**
 * Handle a new event file from another instance.
 */
function handleNewEvent(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const event: IPCEvent = JSON.parse(raw);

    // Ignore our own events
    if (event.from === instanceId) {
      try { fs.unlinkSync(filePath); } catch { /* ok */ }
      return;
    }

    // Relay to local event bus with IPC metadata
    eventBus.emit(event.type as AgentEventType, {
      ...event.data,
      _ipc: true,
      _from: event.from,
    });

    // Consume: delete the event file
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
  } catch {
    // Malformed event file — delete and move on
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
  }
}

/**
 * Clean up stale event files older than STALE_EVENT_MS.
 */
function cleanStaleEvents(dir: string): void {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > STALE_EVENT_MS) {
          fs.unlinkSync(filePath);
        }
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist yet — fine */ }
}

/**
 * Stop watching for IPC events. Call on shutdown.
 */
export function stopIPCBus(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
