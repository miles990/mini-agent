/**
 * Metabolism — 全自動新陳代謝系統
 *
 * 吸收（Pattern Detection）→ 內化（Auto-Promote）→ 排泄（Stale Archive）→ 偵測（Friction Detection）
 *
 * 設計原則：
 * - 零瓶頸：高信心自動執行，低信心寫 log，不阻塞任何流程
 * - 並行運行：掛在 runConcurrentTasks()，跟 perception refresh 並行
 * - 自帶節流：每個掃描有獨立的觸發條件，避免每 cycle 都重算
 * - Fail-open：mushi 離線 → 跳過 clustering，不影響正常運作
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './filelock.js';
import { MUSHI_DEDUP_URL } from './mushi-client.js';
import { createHash } from 'node:crypto';
import { getMemory, getMemoryStateDir } from './memory.js';
import { getCurrentInstanceId } from './instance.js';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// State — 節流控制
// =============================================================================

let lastPatternScanAt = 0;
let lastStaleScanAt = 0;
let newRememberSinceLastScan = false;

// Track topic content hashes to skip unchanged topics (survives in-memory across cycles,
// and prevents re-scanning after restart since content hasn't changed)
const topicContentHashes = new Map<string, string>();

const STALE_SCAN_INTERVAL = 6 * 60 * 60_000; // 6h
const STALE_THRESHOLD_DAYS = 30;
const HIGH_SIMILARITY = 0.85;

// =============================================================================
// Public API
// =============================================================================

/** Listen for new REMEMBER events to trigger pattern detection */
export function initMetabolism(): void {
  eventBus.on('action:memory', () => {
    newRememberSinceLastScan = true;
  });
  slog('METABOLISM', 'Initialized — listening for memory events');
}

/**
 * Main entry point — called from runConcurrentTasks() every cycle.
 * All three scans run in parallel, each with independent throttling.
 */
export async function metabolismScan(): Promise<void> {
  const now = Date.now();
  const tasks: Promise<void>[] = [];

  // 吸收：event-driven（有新 REMEMBER 才真正計算）
  if (newRememberSinceLastScan) {
    newRememberSinceLastScan = false;
    lastPatternScanAt = now;
    tasks.push(detectPatterns().catch(err => {
      slog('METABOLISM', `detectPatterns error: ${err instanceof Error ? err.message : err}`);
    }));
  }

  // 排泄：每 6h
  if (now - lastStaleScanAt >= STALE_SCAN_INTERVAL) {
    lastStaleScanAt = now;
    tasks.push(detectStaleKnowledge().catch(err => {
      slog('METABOLISM', `detectStaleKnowledge error: ${err instanceof Error ? err.message : err}`);
    }));
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

// =============================================================================
// Phase 1: Pattern Detection — 吸收 + 內化
// =============================================================================


interface SimilarityResult {
  isDuplicate: boolean;
  similarity: number;
  matchedEntry?: string;
}

async function checkSimilarity(text: string, existing: string[]): Promise<SimilarityResult | null> {
  if (existing.length === 0) return null;
  try {
    const res = await fetch(MUSHI_DEDUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, existing }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json() as SimilarityResult;
  } catch {
    return null; // fail-open
  }
}

async function detectPatterns(): Promise<void> {
  const memory = getMemory();
  const topics = await memory.listTopics();
  if (topics.length === 0) return;

  let totalPromoted = 0;
  const logEntries: string[] = [];

  for (const topic of topics) {
    // Hash-check: skip topics whose content hasn't changed since last scan
    const content = await memory.readTopicMemory(topic);
    const contentHash = createHash('md5').update(content).digest('hex');
    if (topicContentHashes.get(topic) === contentHash) continue;

    const bullets = content.split('\n').filter(l => l.startsWith('- ')).slice(-50);
    if (bullets.length < 3) {
      topicContentHashes.set(topic, contentHash);
      continue;
    }

    // Pairwise similarity check: compare each bullet against others
    // Use a simple approach: check each bullet against the rest, find clusters
    const promoted = new Set<number>();

    for (let i = 0; i < bullets.length && i < 30; i++) {
      if (promoted.has(i)) continue;

      const others = bullets.filter((_, j) => j !== i && !promoted.has(j));
      if (others.length === 0) continue;

      const result = await checkSimilarity(bullets[i], others);
      if (!result) continue; // mushi offline

      if (result.similarity >= HIGH_SIMILARITY && result.matchedEntry) {
        // High confidence: auto-promote (merge duplicates)
        const matchIdx = bullets.indexOf(result.matchedEntry);
        if (matchIdx >= 0) promoted.add(matchIdx);
        promoted.add(i);

        // Keep the longer entry (more context), mark shorter for removal
        const keep = bullets[i].length >= (result.matchedEntry?.length ?? 0) ? bullets[i] : result.matchedEntry;
        const remove = keep === bullets[i] ? result.matchedEntry : bullets[i];

        logEntries.push(JSON.stringify({
          action: 'auto-promote',
          topic,
          kept: keep.slice(0, 100),
          removed: remove.slice(0, 100),
          similarity: result.similarity,
          ts: new Date().toISOString(),
        }));

        // Remove the duplicate from topic file
        await removeBulletFromTopic(topic, remove);
        totalPromoted++;

        slog('METABOLISM', `[absorb] Merged duplicate in ${topic} (sim=${result.similarity.toFixed(2)}): ${remove.slice(0, 60)}`);
      } else if (result.similarity >= 0.6 && result.similarity < HIGH_SIMILARITY) {
        // Fuzzy zone: log for natural review (not blocking)
        logEntries.push(JSON.stringify({
          action: 'flag-similar',
          topic,
          a: bullets[i].slice(0, 100),
          b: result.matchedEntry?.slice(0, 100),
          similarity: result.similarity,
          ts: new Date().toISOString(),
        }));
      }
    }

    // Update hash after processing — re-read because removeBulletFromTopic may have changed the file
    const updatedContent = await memory.readTopicMemory(topic);
    topicContentHashes.set(topic, createHash('md5').update(updatedContent).digest('hex'));
  }

  // Write metabolism log
  if (logEntries.length > 0) {
    const logPath = path.join(getMemoryStateDir(), 'metabolism-log.jsonl');
    await fs.appendFile(logPath, logEntries.join('\n') + '\n', 'utf-8');
  }

  if (totalPromoted > 0) {
    slog('METABOLISM', `Pattern scan complete: ${totalPromoted} duplicates merged`);
    eventBus.emit('log:info', { tag: 'metabolism', msg: `merged ${totalPromoted} duplicates` });
  }
}

async function removeBulletFromTopic(topic: string, bullet: string): Promise<void> {
  const memory = getMemory();
  const topicPath = path.join(process.cwd(), 'memory', 'topics', `${topic}.md`);

  await withFileLock(topicPath, async () => {
    const content = await memory.readTopicMemory(topic);
    if (!content) return;

    const lines = content.split('\n');
    const filtered = lines.filter(line => line.trim() !== bullet.trim());

    if (filtered.length < lines.length) {
      await fs.writeFile(topicPath, filtered.join('\n'), 'utf-8');
    }
  });
}

// =============================================================================
// Phase 3: Stale Knowledge Detection — 排泄
// =============================================================================

async function detectStaleKnowledge(): Promise<void> {
  const memory = getMemory();
  const topics = await memory.listTopics();
  if (topics.length === 0) return;

  const now = Date.now();
  const thresholdMs = STALE_THRESHOLD_DAYS * 24 * 60 * 60_000;
  let totalArchived = 0;
  const logEntries: string[] = [];

  for (const topic of topics) {
    const content = await memory.readTopicMemory(topic);
    if (!content) continue;

    const lines = content.split('\n');
    const staleLines: string[] = [];

    for (const line of lines) {
      if (!line.startsWith('- ')) continue;

      // Extract date from bullet: - [YYYY-MM-DD] ...
      const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})\]/);
      if (!dateMatch) continue;

      const entryDate = new Date(dateMatch[1]).getTime();
      if (isNaN(entryDate)) continue;

      const age = now - entryDate;
      if (age < thresholdMs) continue;

      // Check if referenced anywhere (simple grep across memory/)
      const snippet = line.slice(0, 60).replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '').trim();
      if (snippet.length < 10) continue;

      const isReferenced = await isEntryReferenced(snippet);
      if (!isReferenced) {
        staleLines.push(line);
      }
    }

    if (staleLines.length === 0) continue;

    // Auto-archive: remove stale lines from topic file (locked to prevent race with appendTopicMemory)
    const topicPath = path.join(process.cwd(), 'memory', 'topics', `${topic}.md`);
    await withFileLock(topicPath, async () => {
      // Re-read inside lock to avoid TOCTOU
      const freshContent = await memory.readTopicMemory(topic);
      if (!freshContent) return;
      const freshLines = freshContent.split('\n');
      const filtered = freshLines.filter(l => !staleLines.includes(l));
      await fs.writeFile(topicPath, filtered.join('\n'), 'utf-8');
    });

    for (const stale of staleLines) {
      logEntries.push(JSON.stringify({
        action: 'auto-archive',
        topic,
        entry: stale.slice(0, 150),
        ts: new Date().toISOString(),
      }));
      totalArchived++;
    }

    if (staleLines.length > 0) {
      slog('METABOLISM', `[excrete] Archived ${staleLines.length} stale entries from ${topic}`);
    }
  }

  if (logEntries.length > 0) {
    const logPath = path.join(getMemoryStateDir(), 'metabolism-log.jsonl');
    await fs.appendFile(logPath, logEntries.join('\n') + '\n', 'utf-8');
  }

  if (totalArchived > 0) {
    slog('METABOLISM', `Stale scan complete: ${totalArchived} entries archived`);
    eventBus.emit('log:info', { tag: 'metabolism', msg: `archived ${totalArchived} stale entries` });
  }
}

async function isEntryReferenced(snippet: string): Promise<boolean> {
  // Quick grep across memory/ for the snippet (first 30 chars as search key)
  const searchKey = snippet.slice(0, 30);
  if (searchKey.length < 5) return true; // too short to search, assume referenced

  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    const { stdout: result } = await execAsync(
      `grep -rl "${searchKey.replace(/"/g, '\\"')}" memory/ 2>/dev/null | head -2`,
      { cwd: process.cwd(), timeout: 3000, encoding: 'utf-8' },
    );
    // If found in more than 1 file (the topic file itself + another), it's referenced
    const files = result.trim().split('\n').filter(Boolean);
    return files.length > 1;
  } catch {
    return true; // grep failed or no match — assume referenced (conservative)
  }
}

// =============================================================================
