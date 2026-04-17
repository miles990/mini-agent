/**
 * CQRS Read Cache — Cognitive Mesh Phase 2
 *
 * In-memory file cache with fs.watch invalidation.
 * Multiple instances can read shared files without redundant disk I/O.
 * Cache is automatically invalidated when files change (via fswatch ~10-50ms).
 *
 * Usage: cachedReadFile(path) instead of fs.readFileSync(path, 'utf-8')
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';

interface CacheEntry {
  content: string;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();
const watchers = new Map<string, fs.FSWatcher>();

/**
 * Read a file with in-memory caching.
 * Returns cached content if file hasn't changed (checked via mtime).
 * Falls back to direct read on any error.
 */
export function cachedReadFile(filePath: string): string {
  const absPath = path.resolve(filePath);

  try {
    // D23: time statSync — sync syscall on every cache hit. Under memory
    // pressure, filesystem metadata pages can be swapped out; statSync
    // then triggers page fault + disk read.
    const statStart = Date.now();
    const stat = fs.statSync(absPath);
    const statMs = Date.now() - statStart;
    if (statMs > 100) {
      slog('PROFILE', `cachedReadFile.statSync ${statMs}ms ${filePath}`);
    }
    const cached = cache.get(absPath);

    if (cached && cached.mtimeMs >= stat.mtimeMs) {
      return cached.content;
    }

    const readStart = Date.now();
    const content = fs.readFileSync(absPath, 'utf-8');
    const readMs = Date.now() - readStart;
    if (readMs > 100) {
      slog('PROFILE', `cachedReadFile.readFileSync ${readMs}ms size=${content.length} ${filePath}`);
    }
    cache.set(absPath, { content, mtimeMs: stat.mtimeMs });

    // Start watching this file's directory if not already
    ensureWatching(absPath);

    return content;
  } catch {
    // File doesn't exist or read error — remove from cache
    cache.delete(absPath);
    return '';
  }
}

/**
 * Explicitly invalidate a cached file (e.g., after writing).
 */
export function invalidateCache(filePath: string): void {
  cache.delete(path.resolve(filePath));
}

/**
 * Invalidate all cached files in a directory.
 */
export function invalidateCacheDir(dirPath: string): void {
  const absDir = path.resolve(dirPath);
  for (const key of cache.keys()) {
    if (key.startsWith(absDir)) {
      cache.delete(key);
    }
  }
}

/**
 * Get cache statistics for observability.
 */
export function getCacheStats(): { entries: number; watchedDirs: number } {
  return {
    entries: cache.size,
    watchedDirs: watchers.size,
  };
}

/**
 * Stop all watchers and clear cache. Call on shutdown.
 */
export function stopMemoryCache(): void {
  for (const w of watchers.values()) {
    try { w.close(); } catch { /* ok */ }
  }
  watchers.clear();
  cache.clear();
}

// ── Internal ──

/**
 * Watch the directory containing this file for changes.
 * When any file in the directory changes, invalidate its cache entry.
 */
function ensureWatching(filePath: string): void {
  const dir = path.dirname(filePath);
  if (watchers.has(dir)) return;

  try {
    const watcher = fs.watch(dir, (eventType, filename) => {
      if (!filename) return;
      const changed = path.join(dir, filename);
      cache.delete(changed);
    });

    watcher.on('error', () => {
      // Non-fatal — cache will just miss more often
      watchers.delete(dir);
    });

    watchers.set(dir, watcher);
  } catch {
    // fs.watch not supported — cache still works, just no auto-invalidation
  }
}
