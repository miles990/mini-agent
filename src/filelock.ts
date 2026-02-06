/**
 * Simple File Lock
 *
 * Lightweight mutex for file write operations.
 * Uses per-path async queues to prevent concurrent writes.
 */

interface LockState {
  held: boolean;
  waiters: Array<() => void>;
}

const locks = new Map<string, LockState>();

/**
 * Acquire a lock for a file path, execute the operation, then release.
 * Operations on the same path are serialized; different paths run concurrently.
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  let state = locks.get(filePath);

  if (!state) {
    state = { held: false, waiters: [] };
    locks.set(filePath, state);
  }

  if (state.held) {
    // Wait for our turn
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }

  state.held = true;

  try {
    return await fn();
  } finally {
    if (state.waiters.length > 0) {
      const next = state.waiters.shift()!;
      // Keep held = true, the next waiter takes over
      next();
    } else {
      state.held = false;
      locks.delete(filePath);
    }
  }
}
