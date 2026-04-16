/**
 * Housekeeping — 機械性管理 pipeline
 *
 * 全部 fire-and-forget，post-cycle 執行。
 * 零 LLM 成本，純 TypeScript 機械操作。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { readPendingInbox, markInboxProcessed, inboxCache } from './inbox.js';
import { rebuildIndex } from './search.js';
import { slog } from './utils.js';
import {
  auditStaleTasks as auditStaleTasksFromIndex,
  queryMemoryIndexSync,
  updateMemoryIndexEntry,
  deleteMemoryIndexEntry,
} from './memory-index.js';
import { migrateToColdStorage } from './context-optimizer.js';
import { scanContradictions } from './contradiction-scanner.js';
import { shouldTriggerKGIngest, markKGIngestTriggered } from './kg-live-ingest.js';
import { spawnDelegation } from './delegation.js';
import type { MemoryIndexEntry } from './memory-index.js';
import type { InboxItem, ParsedTags } from './types.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Task Progress Tracking
// =============================================================================

function getTaskProgressDir(): string {
  const instanceId = getCurrentInstanceId();
  return path.join(getInstanceDir(instanceId), 'task-progress');
}

/**
 * 從 <kuro:progress> tags 寫入對應 task progress 檔案。
 * Fire-and-forget，每項 append 到 task-progress/{task}.md。
 */
export function trackTaskProgress(tags: ParsedTags): void {
  if (tags.progresses.length === 0) return;

  const dir = getTaskProgressDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const now = new Date().toISOString().slice(0, 16);

  for (const p of tags.progresses) {
    const safeName = p.task.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const filePath = path.join(dir, `${safeName}.md`);

    const entry = `- [${now}] ${p.content}\n`;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# Task: ${p.task}\n${entry}`);
    } else {
      fs.appendFileSync(filePath, entry);
      // Auto-prune: >50 lines → keep header + last 30
      pruneProgressFile(filePath, 50, 30);
    }
  }

  slog('HOUSEKEEPING', `tracked ${tags.progresses.length} progress update(s)`);
}

/**
 * <kuro:done> tag → 寫入對應 task-progress 檔案的完成記錄。
 * 匹配規則：done content 中的關鍵字 match task-progress/ 下的檔案名。
 */
export function markTaskProgressDone(doneContent: string): void {
  const dir = getTaskProgressDir();
  if (!fs.existsSync(dir)) return;

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    const lowerContent = doneContent.toLowerCase();

    for (const file of files) {
      const stem = file.replace(/\.md$/, '');
      // Match if done content contains task filename keywords
      const keywords = stem.split('-').filter(k => k.length >= 3);
      const matched = keywords.some(k => lowerContent.includes(k));

      if (matched) {
        const filePath = path.join(dir, file);
        const entry = `- [${new Date().toISOString().slice(0, 16)}] ✅ COMPLETED — ${doneContent}\n`;
        fs.appendFileSync(filePath, entry);
        slog('HOUSEKEEPING', `marked task-progress/${file} as completed`);
        break; // 一個 done 只匹配一個 task
      }
    }
  } catch { /* non-critical */ }
}

function pruneProgressFile(filePath: string, maxLines: number, keepLines: number): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= maxLines) return;

    // Keep header (first line starting with #) + last N lines
    const header = lines[0].startsWith('#') ? lines[0] : '';
    const tail = lines.filter(l => l.trim()).slice(-keepLines);
    const pruned = header ? [header, ...tail] : tail;
    fs.writeFileSync(filePath, pruned.join('\n') + '\n');
  } catch { /* non-critical */ }
}

// =============================================================================
// Task Progress Context（for buildContext）
// =============================================================================

/**
 * 讀取相關的 task progress，注入到 context。
 * 每個檔案最多 500 chars，最近 5 行。
 */
export function buildTaskProgressSection(inboxItems: InboxItem[]): string {
  const dir = getTaskProgressDir();
  if (!fs.existsSync(dir)) return '';

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    if (files.length === 0) return '';

    // 收集 inbox 關鍵字
    const inboxKeywords = inboxItems
      .map(i => i.content.toLowerCase())
      .join(' ');

    const sections: string[] = [];
    for (const file of files) {
      const stem = file.replace(/\.md$/, '');
      const keywords = stem.split('-').filter(k => k.length >= 3);

      // 載入有 inbox 相關的 + 最近修改的（top 3 by mtime）
      const isRelevant = keywords.some(k => inboxKeywords.includes(k));
      if (!isRelevant && sections.length >= 3) continue;

      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.startsWith('- ['));
      const recent = lines.slice(-5);

      if (recent.length > 0) {
        const preview = recent.join('\n').slice(0, 500);
        sections.push(`## ${stem}\n${preview}`);
      }

      if (sections.length >= 5) break;
    }

    return sections.join('\n\n');
  } catch {
    return '';
  }
}


// =============================================================================
// Refresh Search Index
// =============================================================================

/**
 * 偵測 topics/*.md mtime > last index time → rebuildIndex()。
 */
export async function refreshSearchIndex(): Promise<void> {
  const memoryDir = path.join(process.cwd(), 'memory');
  const topicsDir = path.join(memoryDir, 'topics');
  if (!fs.existsSync(topicsDir)) return;

  const instanceId = getCurrentInstanceId();
  const stampPath = path.join(getInstanceDir(instanceId), '.search-index-stamp');

  let lastIndexTime = 0;
  try {
    if (fs.existsSync(stampPath)) {
      lastIndexTime = parseInt(fs.readFileSync(stampPath, 'utf-8').trim(), 10) || 0;
    }
  } catch { /* non-critical */ }

  // Check if any topic file is newer than last index
  const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md'));
  let needsRebuild = false;
  for (const file of files) {
    try {
      const stat = fs.statSync(path.join(topicsDir, file));
      if (stat.mtimeMs > lastIndexTime) {
        needsRebuild = true;
        break;
      }
    } catch { /* skip */ }
  }

  // Also check MEMORY.md
  try {
    const memStat = fs.statSync(path.join(memoryDir, 'MEMORY.md'));
    if (memStat.mtimeMs > lastIndexTime) needsRebuild = true;
  } catch { /* skip */ }

  if (!needsRebuild) return;

  const count = rebuildIndex(memoryDir);
  fs.writeFileSync(stampPath, String(Date.now()));
  if (count > 0) {
    slog('HOUSEKEEPING', `rebuilt search index: ${count} entries`);
  }
}

// =============================================================================
// Expire Old Inbox Items
// =============================================================================

const EXPIRE_REPLIED_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EXPIRE_SEEN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const ESCALATE_STEP_MS = 30 * 60 * 1000; // 30 min per priority level

/**
 * 清理 >7d replied items + >3d seen items。
 * 升級長期 pending items 的 priority（每 30min 升一級，上限 P1 — P0 保留給 Alex）。
 */
export async function expireOldInboxItems(): Promise<void> {
  const instanceId = getCurrentInstanceId();
  const inboxPath = path.join(getInstanceDir(instanceId), 'inbox.jsonl');
  if (!fs.existsSync(inboxPath)) return;

  const now = Date.now();
  const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
  const updated: string[] = [];
  let changed = false;

  for (const line of lines) {
    try {
      const item = JSON.parse(line) as InboxItem;
      const age = now - new Date(item.ts).getTime();

      // Remove old replied items
      if (item.status === 'replied' && age > EXPIRE_REPLIED_MS) {
        changed = true;
        continue; // drop
      }

      // Remove old seen items
      if (item.status === 'seen' && age > EXPIRE_SEEN_MS) {
        changed = true;
        continue; // drop
      }

      // Escalate pending items ignored too long — P0 reserved for Alex, cap at P1.
      if (item.status === 'pending' && item.priority > 1) {
        const steps = Math.floor(age / ESCALATE_STEP_MS);
        if (steps > 0) {
          const newPriority = Math.max(1, item.priority - steps) as InboxItem['priority'];
          if (newPriority < item.priority) {
            item.priority = newPriority;
            updated.push(JSON.stringify(item));
            changed = true;
            continue;
          }
        }
      }

      updated.push(line);
    } catch {
      updated.push(line);
    }
  }

  if (changed) {
    fs.writeFileSync(inboxPath, updated.join('\n') + '\n');
    inboxCache.invalidate();
  }
}

// =============================================================================
// Sync Handoff Status
// =============================================================================

const closedIssues = new Set<string>();

/**
 * 掃描 handoffs/ 的 completed status → 自動 close 對應 GitHub issue。
 * 已 close 的 issue 不重複處理（檔案內 Issue-Closed 標記 + memory Set）。
 */
export async function syncHandoffStatus(): Promise<void> {
  const handoffsDir = path.join(process.cwd(), 'memory', 'handoffs');
  if (!fs.existsSync(handoffsDir)) return;

  try {
    const files = fs.readdirSync(handoffsDir).filter(f => f.endsWith('.md') && f !== 'active.md');
    for (const file of files) {
      const filePath = path.join(handoffsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const statusMatch = content.match(/Status:\s*(completed)/i);
      const issueMatch = content.match(/GitHub-Issue:\s*#?(\d+)/i);

      if (!statusMatch || !issueMatch) continue;

      const issueNum = issueMatch[1];

      // Skip if already marked as closed in file or in-memory
      if (content.includes('Issue-Closed: true') || closedIssues.has(issueNum)) continue;

      // Try to close the GitHub issue
      try {
        await execFileAsync('gh', ['issue', 'close', issueNum, '-c', `Completed via handoff ${file}`], {
          cwd: process.cwd(), encoding: 'utf-8', timeout: 15000,
        });
        slog('HOUSEKEEPING', `closed issue #${issueNum} (handoff ${file} completed)`);
      } catch {
        // Issue may already be closed or gh not available — mark anyway to stop retrying
        slog('HOUSEKEEPING', `issue #${issueNum} close skipped (already closed or gh unavailable)`);
      }

      // Mark in file so it never retries across restarts
      const updated = content.replace(
        /(GitHub-Issue:\s*#?\d+)/i,
        `$1\n- Issue-Closed: true`,
      );
      fs.writeFileSync(filePath, updated);
      closedIssues.add(issueNum);
    }
  } catch { /* non-critical */ }
}

// =============================================================================
// Auto Push — 機械化部署
// =============================================================================

const NO_DEPLOY_FLAG = '.no-deploy';

/**
 * @DANGEROUS _reason: pushes commits to remote origin — visible to others, cannot be easily undone without force-push
 *
 * 如果 local ahead of origin/main → git push origin main。
 * 安全護欄：只 push main、.no-deploy flag 可阻止、fire-and-forget。
 */
export async function autoPushIfAhead(): Promise<void> {
  const cwd = process.cwd();

  // .no-deploy flag 阻止
  if (fs.existsSync(path.join(cwd, NO_DEPLOY_FLAG))) return;

  try {
    // 確認在 main branch
    const { stdout: branch } = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );
    if (branch.trim() !== 'main') return;

    // 檢查是否 ahead of remote
    const { stdout: revList } = await execFileAsync(
      'git', ['rev-list', '--count', 'origin/main..HEAD'],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );
    const ahead = parseInt(revList.trim(), 10);
    if (!ahead || ahead === 0) return;

    // Stash any uncommitted changes before rebase (Claude Code edits, etc.)
    let stashed = false;
    try {
      const { stdout: stashOut } = await execFileAsync(
        'git', ['stash', 'push', '-u', '-m', 'auto-push: pre-rebase stash'],
        { cwd, encoding: 'utf-8', timeout: 10000 },
      );
      stashed = !stashOut.includes('No local changes');
    } catch { /* no changes to stash — fine */ }

    // Rebase on remote first to avoid non-fast-forward rejection
    // -X theirs: auto-resolve conflicts with remote version (state files change every cycle)
    try {
      await execFileAsync(
        'git', ['pull', '--rebase', '-X', 'theirs', 'origin', 'main'],
        { cwd, encoding: 'utf-8', timeout: 30000 },
      );
    } catch {
      // Rebase failed — abort and skip this push (next cycle will retry)
      try { await execFileAsync('git', ['rebase', '--abort'], { cwd, timeout: 5000 }); } catch { /* already clean */ }
      if (stashed) { try { await execFileAsync('git', ['stash', 'pop'], { cwd, timeout: 10000 }); } catch { /* conflict — stash stays */ } }
      slog('HOUSEKEEPING', 'auto-push skipped: rebase failed, will retry next cycle');
      return;
    }

    // Restore stashed changes
    if (stashed) {
      try {
        await execFileAsync('git', ['stash', 'pop'], { cwd, encoding: 'utf-8', timeout: 10000 });
      } catch {
        slog('HOUSEKEEPING', 'stash pop had conflicts — changes preserved in stash');
      }
    }

    // Push
    await execFileAsync(
      'git', ['push', 'origin', 'main'],
      { cwd, encoding: 'utf-8', timeout: 30000 },
    );
    slog('HOUSEKEEPING', `auto-pushed ${ahead} commit(s) to origin/main`);
  } catch (err) {
    slog('HOUSEKEEPING', `auto-push failed: ${err instanceof Error ? err.message : err}`);
  }
}

// =============================================================================
// Smart Task Cleanup — 四層自動清理（替換 decayStaleTasks）
// =============================================================================

export interface CleanupResult {
  layer: 1 | 2 | 3 | 4;
  id: string;
  summary: string;
  action: 'completed' | 'abandoned' | 'deleted';
  reason: string;
}

const REPLY_TASK_PATTERN = /回覆\s*(alex|Alex)/i;
const JUNK_TASK_PATTERN = /^(SSE test|SSE-realtime-test|delete me|test|debug|測試)/i;
const DAY_MS = 86_400_000;

/**
 * @DANGEROUS _reason: permanently deletes or status-changes tasks in relations.jsonl — changes are append-only but semantically irreversible
 *
 * 四層智能清理：
 * L1: 回覆類 tasks — roomMsgId 匹配 OR >48h → completed
 * L2: 垃圾 tasks — pattern match + >24h → abandoned
 * L3: Stale tasks — pending >7d / in_progress >14d（用最後更新時間）→ abandoned
 * L4: 歸檔清理 — completed/abandoned >30d → tombstone 刪除
 *
 * 排除：goals 不受 L3、pinned 不清理、有部分通過 verify 的不自動清
 */
export async function cleanStaleTasks(dryRun = false): Promise<CleanupResult[]> {
  const memDir = path.join(process.cwd(), 'memory');
  const results: CleanupResult[] = [];
  const now = Date.now();

  // --- Layer 1: 回覆類 tasks ---
  const activeTasks = queryMemoryIndexSync(memDir, {
    type: 'task',
    status: ['pending', 'in_progress'],
  });

  // Load recent Chat Room conversations for reply matching
  const replyMsgIds = loadRecentChatRoomReplies(memDir);

  for (const task of activeTasks) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    if (payload.pinned) continue;

    const isReplyTask = REPLY_TASK_PATTERN.test(task.summary ?? '');
    if (!isReplyTask) continue;

    const roomMsgId = payload.roomMsgId as string | undefined;
    const taskAge = now - new Date(task.ts).getTime();
    let matched = false;
    let reason = '';

    // Precise match: roomMsgId exists → check if Kuro replied to it
    if (roomMsgId && replyMsgIds.has(roomMsgId)) {
      matched = true;
      reason = `roomMsgId ${roomMsgId} has been replied`;
    }
    // Time fallback: >24h → topic is stale
    else if (taskAge > 24 * 60 * 60 * 1000) {
      matched = true;
      reason = `reply task >24h (${Math.floor(taskAge / DAY_MS)}d), topic expired`;
    }

    if (matched) {
      if (!dryRun) {
        await updateMemoryIndexEntry(memDir, task.id, { status: 'completed' }).catch(() => {});
      }
      results.push({ layer: 1, id: task.id, summary: task.summary ?? task.id, action: 'completed', reason });
    }
  }

  // --- Layer 2: 垃圾 tasks ---
  // Re-query because L1 may have changed some
  const remainingActive = dryRun ? activeTasks : queryMemoryIndexSync(memDir, {
    type: 'task',
    status: ['pending', 'in_progress'],
  });

  for (const task of remainingActive) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    if (payload.pinned) continue;
    // Skip tasks already handled by L1
    if (results.some(r => r.id === task.id)) continue;

    if (JUNK_TASK_PATTERN.test(task.summary ?? '')) {
      const taskAge = now - new Date(task.ts).getTime();
      if (taskAge > DAY_MS) {
        if (!dryRun) {
          await updateMemoryIndexEntry(memDir, task.id, { status: 'abandoned' }).catch(() => {});
        }
        results.push({ layer: 2, id: task.id, summary: task.summary ?? task.id, action: 'abandoned', reason: 'junk pattern match + >24h' });
      }
    }
  }

  // --- Layer 3: Decay 兜底 ---
  const allActive = dryRun ? activeTasks : queryMemoryIndexSync(memDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });

  for (const task of allActive) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    if (payload.pinned) continue;
    if (task.type === 'goal') continue; // goals exempt from L3
    if (results.some(r => r.id === task.id)) continue;

    // Check partial verify pass — exempt if any verify passed
    const verify = payload.verify as Array<{ status: string }> | undefined;
    if (verify && verify.some(v => v.status === 'pass')) continue;

    // Use last update time (ts), not creation time
    const lastUpdate = new Date(task.ts).getTime();
    const age = now - lastUpdate;

    const threshold = task.status === 'in_progress' ? 30 * DAY_MS : 14 * DAY_MS;
    if (age > threshold) {
      if (!dryRun) {
        await updateMemoryIndexEntry(memDir, task.id, { status: 'abandoned' }).catch(() => {});
      }
      const label = task.status === 'in_progress' ? 'in_progress >14d' : 'pending >7d';
      results.push({ layer: 3, id: task.id, summary: task.summary ?? task.id, action: 'abandoned', reason: `${label} (last update: ${Math.floor(age / DAY_MS)}d ago)` });
    }
  }

  // --- Layer 4: 歸檔清理 (tombstone) ---
  const closedTasks = queryMemoryIndexSync(memDir, {
    type: ['task', 'goal'],
    status: ['completed', 'abandoned'],
  });

  for (const task of closedTasks) {
    const age = now - new Date(task.ts).getTime();
    if (age > 30 * DAY_MS) {
      if (!dryRun) {
        await deleteMemoryIndexEntry(memDir, task.id).catch(() => {});
      }
      results.push({ layer: 4, id: task.id, summary: task.summary ?? task.id, action: 'deleted', reason: `closed >30d (${Math.floor(age / DAY_MS)}d)` });
    }
  }

  // Log results
  if (results.length > 0) {
    const byLayer = [1, 2, 3, 4].map(l => {
      const items = results.filter(r => r.layer === l);
      return items.length > 0 ? `L${l}:${items.length}` : null;
    }).filter(Boolean).join(' ');
    const mode = dryRun ? '[DRY-RUN] ' : '';
    slog('HOUSEKEEPING', `${mode}cleanStaleTasks: ${results.length} tasks (${byLayer})`);
  }

  // Write results to instance dir for inspection
  const instanceId = getCurrentInstanceId();
  const resultPath = path.join(getInstanceDir(instanceId), 'task-cleanup-results.json');
  if (results.length > 0) {
    fs.writeFileSync(resultPath, JSON.stringify({ dryRun, ts: new Date().toISOString(), results }, null, 2));
  } else if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }

  return results;
}

/**
 * Load recent Chat Room conversations and build a set of message IDs
 * that Kuro has replied to (via replyTo field).
 */
function loadRecentChatRoomReplies(memDir: string): Set<string> {
  const repliedTo = new Set<string>();
  const convDir = path.join(memDir, 'conversations');
  if (!fs.existsSync(convDir)) return repliedTo;

  try {
    const files = fs.readdirSync(convDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-7); // Last 7 days

    for (const file of files) {
      const content = fs.readFileSync(path.join(convDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { from?: string; replyTo?: string; mentions?: string[] };
          // Kuro's messages that reply to something
          if (msg.from === 'kuro' && msg.replyTo) {
            repliedTo.add(msg.replyTo);
          }
          // Also: any Kuro message mentioning alex counts as a reply
          if (msg.from === 'kuro' && msg.mentions?.includes('alex')) {
            // Can't precisely match, but these are "reply" signals
          }
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* non-critical */ }

  return repliedTo;
}

// Dry-run flag — set to false after first successful dry-run reviewed by Alex
let cleanupDryRunMode = false;

/** Set dry-run mode for task cleanup (called after Alex approves first run) */
export function setCleanupDryRunMode(enabled: boolean): void {
  cleanupDryRunMode = enabled;
}

/** Get current dry-run mode */
export function isCleanupDryRun(): boolean {
  return cleanupDryRunMode;
}

// --- Legacy compatibility ---

export interface StaleTaskWarning {
  title: string;
  priority: string;
  created: string;
  ageDays: number;
  section: string;
  detectedAt: string;
}

export function readStaleTaskWarnings(): StaleTaskWarning[] {
  // Read from task-cleanup-results.json (written by cleanStaleTasks)
  try {
    const instanceId = getCurrentInstanceId();
    const resultPath = path.join(getInstanceDir(instanceId), 'task-cleanup-results.json');
    if (!fs.existsSync(resultPath)) return [];
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as {
      ts: string; results: CleanupResult[];
    };
    // Only show results from last 24h
    if (Date.now() - new Date(data.ts).getTime() > 24 * 60 * 60 * 1000) return [];
    return data.results.map(r => ({
      title: r.summary,
      priority: `L${r.layer}`,
      created: data.ts,
      ageDays: 0,
      section: r.action,
      detectedAt: data.ts,
    }));
  } catch { return []; }
}

/** @deprecated Use cleanStaleTasks() instead */
export async function decayStaleTasks(): Promise<void> {
  await cleanStaleTasks(cleanupDryRunMode);
}

// =============================================================================
// Pipeline Runner
// =============================================================================

let cycleCounter = 0;

/**
 * 主 housekeeping pipeline。Post-cycle fire-and-forget。
 */
export async function runHousekeeping(): Promise<void> {
  cycleCounter++;

  // NOTE: autoPushIfAhead() 已移到 loop.ts，鏈在 autoCommitMemoryFiles() 完成後。
  // 防止 push 在 commit 完成前觸發 CI/CD 的 git reset --hard 覆蓋未 commit 的改動。
  await refreshSearchIndex().catch(() => {});
  await expireOldInboxItems().catch(() => {});
  await syncHandoffStatus().catch(() => {});
  await decayStaleTasks().catch(() => {});

  // KG auto-ingest: check every 5 cycles if enough new writes have accumulated
  if (cycleCounter % 5 === 0) {
    dispatchKGIngestIfNeeded();
  }

  // 低頻：每 10 cycle 掃描 instance 目錄下的過期臨時資源
  if (cycleCounter % 10 === 0) {
    await sweepInstanceDir().catch(() => {});
    // P1-5: Memory consolidation — migrate old entries to cold storage
    await consolidateMemory().catch(() => {});
    // Contradiction scan — fire-and-forget, non-blocking
    scanContradictions().catch(() => {});
  }
}

// =============================================================================
// KG Auto-Ingest — dispatch KG rebuild via middleware when data accumulates
// =============================================================================

function dispatchKGIngestIfNeeded(): void {
  try {
    const { should, newWrites, reason } = shouldTriggerKGIngest();
    if (!should) return;

    const workdir = process.cwd();
    slog('KG-INGEST', `Triggering auto-ingest: ${reason}`);

    spawnDelegation({
      type: 'graphify',
      prompt: [
        `KG incremental rebuild: ${newWrites} new memory writes detected.`,
        'Run the following pipeline in order:',
        `cd ${workdir}`,
        '1. pnpm tsx scripts/kg-extract-chunks.ts --write',
        '2. pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
        '3. pnpm tsx scripts/kg-extract-edges.ts --write --limit 100',
        '4. pnpm tsx scripts/kg-build-cooccurrence.ts --replace',
        '5. pnpm tsx scripts/kg-build-frontmatter-edges.ts --write',
        '6. pnpm tsx scripts/kg-detect-conflicts.ts --write',
        '7. pnpm tsx scripts/kg-viz.ts',
        'Report: entity count, edge count, new conflicts.',
      ].join('\n'),
      workdir,
      acceptance: 'KG entities.jsonl and edges.jsonl updated with new data from recent memory writes; manifest.json last_incremental timestamp refreshed',
    });

    markKGIngestTriggered();
  } catch (err) {
    slog('KG-INGEST', `trigger error: ${(err as Error).message}`);
  }
}

// =============================================================================
// Memory Consolidation — AutoDream-inspired Prune Phase
// =============================================================================

const CONSOLIDATION_LOCK_TTL = 24 * 60 * 60 * 1000; // Run at most once per 24h
const MEMORY_MAX_LINES = 200; // AutoDream's enforced cap

/**
 * Memory consolidation: migrate cold entries + enforce MEMORY.md line cap.
 * Runs every 10 housekeeping cycles (gated by 24h lock).
 */
async function consolidateMemory(): Promise<void> {
  const instanceId = getCurrentInstanceId();
  const instDir = getInstanceDir(instanceId);
  const lockPath = path.join(instDir, '.consolidation-lock');

  // 24h gate: skip if already ran recently
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < CONSOLIDATION_LOCK_TTL) return;
  } catch { /* no lock file — proceed */ }

  // Use project memory dir, not instance dir (MEMORY.md lives in project/memory/)
  const memoryDir = path.join(process.cwd(), 'memory');
  let actions = 0;

  // Phase 1: Cold storage migration (entries >30 days in non-protected sections)
  try {
    const { migrated } = migrateToColdStorage(memoryDir, 30);
    if (migrated > 0) {
      slog('CONSOLIDATE', `migrated ${migrated} cold entries to cold-storage.md`);
      actions += migrated;
    }
  } catch (err) {
    slog('CONSOLIDATE', `cold storage migration failed: ${err}`);
  }

  // Phase 2: Enforce MEMORY.md line cap
  try {
    const memoryPath = path.join(memoryDir, 'MEMORY.md');
    if (fs.existsSync(memoryPath)) {
      const content = fs.readFileSync(memoryPath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > MEMORY_MAX_LINES) {
        // Keep header + section structure, remove oldest bullet entries
        // Strategy: find bullet lines (- [...]), remove oldest ones first
        const headerLines: string[] = [];
        const bulletEntries: { idx: number; line: string }[] = [];
        const otherLines: { idx: number; line: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('- [')) {
            bulletEntries.push({ idx: i, line: lines[i] });
          } else if (lines[i].startsWith('#') || lines[i].trim() === '' || !lines[i].startsWith('- ')) {
            otherLines.push({ idx: i, line: lines[i] });
          } else {
            bulletEntries.push({ idx: i, line: lines[i] });
          }
        }

        // Calculate how many bullets to remove
        const nonBulletCount = otherLines.length;
        const maxBullets = MEMORY_MAX_LINES - nonBulletCount;
        if (maxBullets > 0 && bulletEntries.length > maxBullets) {
          // Keep newest bullets (at the end), remove oldest (at the start)
          const keepBullets = new Set(
            bulletEntries.slice(-maxBullets).map(b => b.idx)
          );
          const trimmed = lines.filter((_, i) =>
            !bulletEntries.some(b => b.idx === i) || keepBullets.has(i)
          );
          fs.writeFileSync(memoryPath, trimmed.join('\n'));
          slog('CONSOLIDATE', `MEMORY.md trimmed: ${lines.length} → ${trimmed.length} lines (removed ${bulletEntries.length - maxBullets} oldest entries)`);
          actions++;
        }
      }
    }
  } catch (err) {
    slog('CONSOLIDATE', `MEMORY.md trim failed: ${err}`);
  }

  // Update lock
  fs.writeFileSync(lockPath, new Date().toISOString());
  if (actions > 0) {
    slog('CONSOLIDATE', `consolidation complete: ${actions} action(s)`);
  }
}

// =============================================================================
// Instance Directory Sweep — 通用過期資源清理
// =============================================================================

const SWEEP_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

/**
 * 掃描 instance 目錄下已知的臨時子目錄，刪除過期檔案/目錄。
 * Catch-all 防護：即使個別模組的清理邏輯有遺漏，也能在這裡兜底。
 */
async function sweepInstanceDir(): Promise<void> {
  const instanceId = getCurrentInstanceId();
  const instDir = getInstanceDir(instanceId);
  const cutoff = Date.now() - SWEEP_MAX_AGE_MS;

  // 需要掃描的臨時子目錄及其 entry 前綴
  const targets = [
    { subdir: 'delegations', prefix: 'del-' },
    { subdir: 'lane-output', prefix: '' },
    { subdir: 'task-progress', prefix: '' },
  ];

  let swept = 0;
  for (const { subdir, prefix } of targets) {
    const dir = path.join(instDir, subdir);
    if (!fs.existsSync(dir)) continue;

    try {
      for (const entry of fs.readdirSync(dir)) {
        if (prefix && !entry.startsWith(prefix)) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullPath);
            }
            swept++;
          }
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  if (swept > 0) {
    slog('HOUSEKEEPING', `swept ${swept} stale temp resource(s) from instance dir`);
  }
}
