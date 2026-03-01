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
import { getCurrentInstanceId, getInstanceDir, getDataDir } from './instance.js';
import { readPendingInbox, writeInboxItem, markInboxProcessed } from './inbox.js';
import { rebuildIndex } from './search.js';
import { slog } from './utils.js';
import { parseAllNextTasks, NEXT_MD_PATH } from './triage.js';
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
// Consolidate Old Inbox Sources（過渡期 dual-write）
// =============================================================================

/**
 * 掃描舊 inbox 檔案 → 寫入 unified inbox（過渡期使用）。
 */
export async function consolidateInboxSources(): Promise<void> {
  const dataDir = getDataDir();
  const oldInboxes = [
    { path: path.join(dataDir, 'telegram-inbox.md'), source: 'telegram' as const, from: 'alex' },
    { path: path.join(dataDir, 'chat-room-inbox.md'), source: 'room' as const, from: 'unknown' },
    { path: path.join(dataDir, 'claude-code-inbox.md'), source: 'claude-code' as const, from: 'claude-code' },
  ];

  for (const inbox of oldInboxes) {
    try {
      if (!fs.existsSync(inbox.path)) continue;
      const content = fs.readFileSync(inbox.path, 'utf-8');

      // Parse ## Pending section
      const pendingMatch = content.match(/## Pending\n([\s\S]*?)(?=## Processed|$)/);
      if (!pendingMatch) continue;

      const lines = pendingMatch[1].split('\n').filter(l => l.startsWith('- ['));
      for (const line of lines) {
        // Extract message content after timestamp and sender
        const msgMatch = line.match(/- \[[\d:. -]+\]\s*(?:\((\w+)\)\s*)?(?:↩\S+\s+)?(.+)/);
        if (!msgMatch) continue;

        const from = msgMatch[1] || inbox.from;
        const text = msgMatch[2].trim();
        if (!text) continue;

        writeInboxItem({
          source: inbox.source,
          from,
          content: text,
          meta: inbox.source === 'room' ? { origin: 'consolidation' } : undefined,
        });
      }
    } catch { /* non-critical */ }
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
const STALE_PENDING_CYCLES = 3;

/**
 * 清理 >7d replied items + pending >3 cycles 升級 priority。
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

      updated.push(line);
    } catch {
      updated.push(line);
    }
  }

  if (changed) {
    fs.writeFileSync(inboxPath, updated.join('\n') + '\n');
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
// Stale Task Decay — 任務衰減警告
// =============================================================================

export interface StaleTaskWarning {
  title: string;
  priority: string;
  created: string;
  ageDays: number;
  section: string;
  detectedAt: string;
}

/**
 * 掃描 NEXT.md 任務的 @created 日期，超齡的寫入 stale-tasks.json 警告。
 * P0 不衰減。P1 > 7天警告。P2/P3 > 14天警告。
 * Fire-and-forget，不自動移動任務（保持 Kuro 能動性）。
 */
export async function decayStaleTasks(): Promise<void> {
  try {
    if (!fs.existsSync(NEXT_MD_PATH)) return;
    const content = fs.readFileSync(NEXT_MD_PATH, 'utf-8');
    const tasks = parseAllNextTasks(content);

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const warnings: StaleTaskWarning[] = [];

    for (const task of tasks) {
      if (!task.created) continue;
      if (task.priority === 'P0') continue;

      const createdMs = new Date(task.created).getTime();
      if (isNaN(createdMs)) continue;

      const ageDays = Math.floor((now - createdMs) / DAY_MS);
      const threshold = task.priority === 'P1' ? 7 : 14; // P2/P3: 14 days

      if (ageDays > threshold) {
        warnings.push({
          title: task.title,
          priority: task.priority,
          created: task.created,
          ageDays,
          section: task.section,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Write warnings to instance dir (overwrite — current snapshot)
    const instanceId = getCurrentInstanceId();
    const stalePath = path.join(getInstanceDir(instanceId), 'stale-tasks.json');

    if (warnings.length > 0) {
      fs.writeFileSync(stalePath, JSON.stringify(warnings, null, 2));
      slog('HOUSEKEEPING', `${warnings.length} stale task(s) detected`);
    } else if (fs.existsSync(stalePath)) {
      // No warnings → clean up old file
      fs.unlinkSync(stalePath);
    }
  } catch { /* non-critical */ }
}

/**
 * Read stale task warnings for context injection.
 */
export function readStaleTaskWarnings(): StaleTaskWarning[] {
  try {
    const instanceId = getCurrentInstanceId();
    const stalePath = path.join(getInstanceDir(instanceId), 'stale-tasks.json');
    if (!fs.existsSync(stalePath)) return [];
    return JSON.parse(fs.readFileSync(stalePath, 'utf-8'));
  } catch {
    return [];
  }
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

  // NOTE: autoPushIfAhead() 已移到 loop.ts，鏈在 autoCommitMemory() 完成後。
  // 防止 push 在 commit 完成前觸發 CI/CD 的 git reset --hard 覆蓋未 commit 的改動。
  await consolidateInboxSources().catch(() => {});
  await refreshSearchIndex().catch(() => {});
  await expireOldInboxItems().catch(() => {});
  await syncHandoffStatus().catch(() => {});
  await decayStaleTasks().catch(() => {});

  // 低頻：每 10 cycle 才執行
  // Future: deduplicateMemory(), cleanupConversationThreads()
}
