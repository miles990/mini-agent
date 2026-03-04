/**
 * Activity Journal — 跨 Lane 統一活動日誌
 *
 * 所有 lane（OODA / Foreground / Background / Ask）寫入同一個 ring buffer，
 * 所有 context mode 讀取。解決「問 Kuro 剛剛做了什麼」時跨 lane 看不見的問題。
 *
 * 雙層快取：記憶體（零 I/O 讀取）+ 檔案（crash recovery）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export interface ActivityEntry {
  ts: string;            // ISO timestamp
  lane: 'ooda' | 'foreground' | 'background' | 'ask';
  summary: string;       // max 200 chars
  trigger?: string;      // 觸發來源
  tags?: string[];       // 處理的 kuro:* tags
  duration?: number;     // ms
}

// =============================================================================
// State
// =============================================================================

const MAX_ENTRIES = 50;
const READ_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

let entries: ActivityEntry[] = [];
let journalPath: string | null = null;

// =============================================================================
// Init
// =============================================================================

/**
 * 啟動時從檔案載入到記憶體（call once）。
 */
export function initActivityJournal(): void {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return;
    journalPath = path.join(getInstanceDir(instanceId), 'activity-journal.jsonl');

    if (fs.existsSync(journalPath)) {
      const lines = fs.readFileSync(journalPath, 'utf-8').trim().split('\n').filter(Boolean);
      entries = [];
      for (const line of lines.slice(-MAX_ENTRIES)) {
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Write
// =============================================================================

/**
 * Fire-and-forget 寫入。同時寫記憶體 + 檔案。
 */
export function writeActivity(entry: Omit<ActivityEntry, 'ts'> & { ts?: string }): void {
  try {
    const full: ActivityEntry = {
      ts: entry.ts || new Date().toISOString(),
      lane: entry.lane,
      summary: entry.summary.slice(0, 200),
      ...(entry.trigger ? { trigger: entry.trigger } : {}),
      ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
      ...(entry.duration != null ? { duration: entry.duration } : {}),
    };

    entries.push(full);

    if (!journalPath) return;
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
      fs.writeFileSync(journalPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    } else {
      fs.appendFileSync(journalPath, JSON.stringify(full) + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Read
// =============================================================================

/**
 * 從記憶體讀取最近 2h 內的活動（零 I/O）。
 */
export function readRecentActivity(limit = 20): ActivityEntry[] {
  const cutoff = new Date(Date.now() - READ_WINDOW_MS).toISOString();
  return entries.filter(e => e.ts >= cutoff).slice(-limit);
}

/**
 * 格式化 <recent-activity> section 內容。
 * @param charCap 字元上限（預設 1500）
 */
export function formatActivityJournal(charCap = 1500): string | null {
  const recent = readRecentActivity();
  if (recent.length === 0) return null;

  const lines: string[] = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    const time = e.ts.slice(11, 19); // HH:MM:SS
    const dur = e.duration != null ? ` (${Math.round(e.duration / 1000)}s)` : '';
    const tagStr = e.tags && e.tags.length > 0 ? ` [${e.tags.join(',')}]` : '';
    const line = `${time} [${e.lane}] ${e.summary}${dur}${tagStr}`;

    if (totalChars + line.length > charCap) break;
    lines.unshift(line);
    totalChars += line.length + 1;
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
