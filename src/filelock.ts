/**
 * Cross-Process File Lock
 *
 * Dual-layer locking: in-process async queue + cross-process atomic mkdir.
 * Zero external dependencies — uses mkdir atomicity guarantee.
 * API unchanged: withFileLock(path, fn) — drop-in replacement.
 */

import fs from 'node:fs';

interface LockState {
  held: boolean;
  waiters: Array<() => void>;
}

const inProcessLocks = new Map<string, LockState>();

const LOCK_STALE_MS = 30_000;  // Consider lock stale after 30s
const MAX_RETRIES = 10;
const MIN_BACKOFF = 50;
const MAX_BACKOFF = 150;

/**
 * Acquire both in-process and cross-process locks, execute fn, then release.
 * In-process queue prevents thundering herd on the filesystem lock.
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // --- Layer 1: In-process serialization ---
  let state = inProcessLocks.get(filePath);
  if (!state) {
    state = { held: false, waiters: [] };
    inProcessLocks.set(filePath, state);
  }

  if (state.held) {
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }
  state.held = true;

  const lockDir = `${filePath}.lock`;

  try {
    // --- Layer 2: Cross-process lock via atomic mkdir ---
    await acquireDirLock(lockDir);

    try {
      return await fn();
    } finally {
      releaseDirLock(lockDir);
    }
  } finally {
    // --- Release in-process lock ---
    if (state.waiters.length > 0) {
      const next = state.waiters.shift()!;
      next();
    } else {
      state.held = false;
      inProcessLocks.delete(filePath);
    }
  }
}

/**
 * Acquire cross-process lock using atomic mkdir.
 * mkdir is atomic on POSIX — only one process succeeds when racing.
 */
async function acquireDirLock(lockDir: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      // Won the race — write our PID + timestamp
      writeLockMeta(lockDir);
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Lock dir exists — check if stale
      if (isLockStale(lockDir)) {
        // Stale lock — force remove and retry immediately
        removeLockDir(lockDir);
        continue;
      }

      // Lock is held by another live process — back off and retry
      const backoff = MIN_BACKOFF + Math.random() * (MAX_BACKOFF - MIN_BACKOFF);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  // Last resort: force-break potentially stuck lock
  removeLockDir(lockDir);
  fs.mkdirSync(lockDir);
  writeLockMeta(lockDir);
}

function writeLockMeta(lockDir: string): void {
  try {
    fs.writeFileSync(`${lockDir}/pid`, String(process.pid));
    fs.writeFileSync(`${lockDir}/ts`, String(Date.now()));
  } catch { /* non-fatal — lock is still held via dir existence */ }
}

function isLockStale(lockDir: string): boolean {
  try {
    // Check timestamp
    const tsStr = fs.readFileSync(`${lockDir}/ts`, 'utf-8');
    const ts = Number(tsStr);
    if (Date.now() - ts > LOCK_STALE_MS) return true;

    // Check PID liveness
    const pidStr = fs.readFileSync(`${lockDir}/pid`, 'utf-8');
    const pid = Number(pidStr);
    if (pid === process.pid) return false; // Our own lock (shouldn't happen with in-process layer)
    try {
      process.kill(pid, 0); // Signal 0 = liveness check
      return false; // Process is alive
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return false; // Alive but no permission
      return true; // Process is dead
    }
  } catch {
    // Can't read metadata — treat as stale
    return true;
  }
}

function releaseDirLock(lockDir: string): void {
  removeLockDir(lockDir);
}

function removeLockDir(lockDir: string): void {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch { /* best effort */ }
}
