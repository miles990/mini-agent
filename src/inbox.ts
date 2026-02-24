/**
 * Unified Inbox — 統一收件匣
 *
 * 所有訊息來源（Telegram、Chat Room、Claude Code、GitHub、Handoff）
 * 統一寫入 JSONL，規則化優先度分配，零 LLM 成本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { slog } from './utils.js';
import type { InboxItem } from './types.js';

// =============================================================================
// Path
// =============================================================================

function getInboxPath(): string {
  const instanceId = getCurrentInstanceId();
  return path.join(getInstanceDir(instanceId), 'inbox.jsonl');
}

// =============================================================================
// Priority Rules（純 TypeScript，零 LLM）
// =============================================================================

export function assignPriority(
  source: InboxItem['source'],
  from: string,
  content: string,
  meta?: Record<string, string>,
): 0 | 1 | 2 | 3 | 4 {
  // P0: Alex 的 Telegram 訊息
  if (source === 'telegram' && from === 'alex') return 0;

  // P1: Chat Room 提及 @kuro
  if (source === 'room' && content.includes('@kuro')) return 1;

  // P2: Claude Code 訊息
  if (source === 'claude-code') return 2;

  // P2: GitHub bug label
  if (source === 'github' && meta?.labels?.includes('bug')) return 2;

  // P2: Approved handoff
  if (source === 'handoff' && meta?.status === 'approved') return 2;

  // P3: Other GitHub
  if (source === 'github') return 3;

  // P4: Everything else
  return 4;
}

// =============================================================================
// Write
// =============================================================================

/** 5 分鐘去重窗口 */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * 寫入統一 inbox。自動分配 priority + 5min 去重。
 * 回傳 id，若去重跳過回傳 null。
 */
export function writeInboxItem(
  item: Omit<InboxItem, 'id' | 'ts' | 'status' | 'priority'>,
): string | null {
  try {
    const inboxPath = getInboxPath();
    const dir = path.dirname(inboxPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const now = new Date();
    const ts = now.toISOString();

    // 5min 去重：same content + from → skip
    if (fs.existsSync(inboxPath)) {
      const cutoff = now.getTime() - DEDUP_WINDOW_MS;
      const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
      // 只檢查最近 20 行（效能）
      const recentLines = lines.slice(-20);
      for (const line of recentLines) {
        try {
          const existing = JSON.parse(line) as InboxItem;
          if (
            existing.from === item.from &&
            existing.content === item.content &&
            new Date(existing.ts).getTime() > cutoff
          ) {
            return null; // 去重
          }
        } catch { /* malformed line, skip */ }
      }
    }

    const id = `${ts.slice(0, 10)}-${ts.slice(11, 13)}${ts.slice(14, 16)}${ts.slice(17, 19)}-${item.source.slice(0, 3)}`;
    const priority = assignPriority(item.source, item.from, item.content, item.meta);

    const entry: InboxItem = {
      id,
      source: item.source,
      from: item.from,
      priority,
      content: item.content,
      ts,
      status: 'pending',
      meta: item.meta,
    };

    fs.appendFileSync(inboxPath, JSON.stringify(entry) + '\n');
    return id;
  } catch (err) {
    slog('INBOX', `writeInboxItem failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// =============================================================================
// Read
// =============================================================================

/**
 * 讀取所有 pending items，按 priority 排序（P0 first）。
 */
export function readPendingInbox(): InboxItem[] {
  try {
    const inboxPath = getInboxPath();
    if (!fs.existsSync(inboxPath)) return [];

    const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
    const items: InboxItem[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line) as InboxItem;
        if (item.status === 'pending') {
          items.push(item);
        }
      } catch { /* malformed line, skip */ }
    }

    // Sort: priority asc, then ts asc (oldest first within same priority)
    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.ts.localeCompare(b.ts);
    });

    return items;
  } catch {
    return [];
  }
}

// =============================================================================
// Mark Processed
// =============================================================================

/**
 * 批次標記 inbox items 為 seen 或 replied。
 * 使用 in-place rewrite（JSONL 不支援隨機寫入）。
 */
export function markInboxProcessed(ids: string[], status: 'seen' | 'replied'): void {
  try {
    const inboxPath = getInboxPath();
    if (!fs.existsSync(inboxPath)) return;

    const idSet = new Set(ids);
    const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
    const updated: string[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line) as InboxItem;
        if (idSet.has(item.id)) {
          item.status = status;
          updated.push(JSON.stringify(item));
        } else {
          updated.push(line);
        }
      } catch {
        updated.push(line); // preserve malformed lines
      }
    }

    fs.writeFileSync(inboxPath, updated.join('\n') + '\n');
  } catch (err) {
    slog('INBOX', `markInboxProcessed failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 檢查是否有近期未回覆的 telegram 訊息（status: 'seen'）。
 * 用於啟動時判斷是否應優先處理 telegram 而非跑 generic 自主 cycle。
 */
export function hasRecentUnrepliedTelegram(hoursBack: number = 4): boolean {
  try {
    const inboxPath = getInboxPath();
    if (!fs.existsSync(inboxPath)) return false;
    const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as InboxItem;
        if (item.source === 'telegram' && item.status === 'seen' && item.ts >= cutoff) {
          return true;
        }
      } catch { /* skip malformed */ }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 標記所有 pending items。
 */
export function markAllInboxProcessed(status: 'seen' | 'replied'): void {
  const pending = readPendingInbox();
  if (pending.length === 0) return;
  markInboxProcessed(pending.map(i => i.id), status);
}

// =============================================================================
// Cycle Mode Detection（替代 Haiku triageCycleIntent）
// =============================================================================

export type CycleMode = 'respond' | 'task' | 'act' | 'reflect' | 'learn';

/**
 * 從 inbox + trigger reason 規則判斷 cycle mode。
 * 零 LLM 成本，替代 triageCycleIntent()。
 */
export function detectModeFromInbox(
  items: InboxItem[],
  triggerReason: string | null,
): { mode: CycleMode; reason: string; focus?: string } {
  // telegram-user → always respond
  if (triggerReason?.startsWith('telegram-user')) {
    return { mode: 'respond', reason: 'Alex Telegram message' };
  }

  // P0 or P1 → respond
  const highPri = items.filter(i => i.priority <= 1);
  if (highPri.length > 0) {
    const top = highPri[0];
    return {
      mode: 'respond',
      reason: `P${top.priority} from ${top.from}`,
      focus: top.content.slice(0, 80),
    };
  }

  // P2 handoff → task
  const handoffs = items.filter(i => i.source === 'handoff' && i.priority <= 2);
  if (handoffs.length > 0) {
    return { mode: 'task', reason: 'approved handoff', focus: handoffs[0].content.slice(0, 80) };
  }

  // P2 items → act
  const p2 = items.filter(i => i.priority === 2);
  if (p2.length > 0) {
    return { mode: 'act', reason: `${p2.length} P2 item(s)` };
  }

  // heartbeat with no pending → reflect or learn
  if (triggerReason?.includes('heartbeat') && items.length === 0) {
    return { mode: 'reflect', reason: 'heartbeat, no pending items' };
  }

  return { mode: 'act', reason: 'default' };
}

// =============================================================================
// Formatting（for buildContext）
// =============================================================================

/**
 * 格式化 inbox items 為簡潔文字，注入到 context。
 */
export function formatInboxSection(items: InboxItem[]): string {
  if (items.length === 0) return '';

  const lines = items.slice(0, 15).map(i => {
    const time = i.ts.slice(11, 16); // HH:MM
    const sourceTag = i.source === 'telegram' ? `telegram:${i.from}`
      : i.source === 'room' ? `room:${i.from}`
      : i.source === 'github' ? `github:${i.meta?.issueNumber ? '#' + i.meta.issueNumber : 'issue'}`
      : i.source === 'handoff' ? `handoff`
      : `${i.source}:${i.from}`;
    const preview = i.content.replace(/\n/g, ' ').slice(0, 120);
    return `P${i.priority} [${sourceTag}] ${time} — ${preview}`;
  });

  return lines.join('\n');
}
