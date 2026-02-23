/**
 * Search System - FTS5 Full-Text Search for Memory
 *
 * 用 better-sqlite3 + FTS5 提供 BM25 排序的全文搜尋，
 * 取代原有的 grep 精確匹配。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryEntry } from './types.js';

let db: Database.Database | null = null;

/**
 * 初始化 FTS5 搜尋索引
 */
export function initSearchIndex(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source,
        date,
        content,
        tokenize="unicode61"
      );
    `);
  } catch (error) {
    db = null;
    // Silently fail — grep fallback will handle search
  }
}

/**
 * 解析 topic markdown 檔案中的 entries
 * 格式：- [2026-02-23] 標題 — 內容
 */
function parseTopicEntries(filePath: string): Array<{ source: string; date: string; content: string }> {
  const entries: Array<{ source: string; date: string; content: string }> = [];
  const source = path.basename(filePath);

  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split('\n');
    const datedEntryRegex = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)/;
    const bulletRegex = /^- (.+)/;

    let currentEntry: { source: string; date: string; content: string } | null = null;

    for (const line of lines) {
      // Skip headers and separators
      if (line.startsWith('#') || line.startsWith('---')) {
        if (currentEntry) {
          entries.push(currentEntry);
          currentEntry = null;
        }
        continue;
      }

      // Dated entry: - [2026-02-23] content
      const datedMatch = line.match(datedEntryRegex);
      if (datedMatch) {
        if (currentEntry) entries.push(currentEntry);
        currentEntry = { source, date: datedMatch[1], content: datedMatch[2] };
        continue;
      }

      // Undated bullet: - content (common in topic files)
      const bulletMatch = line.match(bulletRegex);
      if (bulletMatch && !line.startsWith('- **')) {
        if (currentEntry) entries.push(currentEntry);
        currentEntry = { source, date: '', content: bulletMatch[1] };
        continue;
      }

      // Bold sub-bullet: - **label**: content (part of parent entry)
      if (line.startsWith('- **') && currentEntry) {
        currentEntry.content += ' ' + line.replace(/^- /, '').trim();
        continue;
      }

      // Continuation line (indented or same-level text)
      if (currentEntry && line.trim() && !line.startsWith('#')) {
        currentEntry.content += ' ' + line.trim();
      } else if (line.trim() === '' && currentEntry) {
        entries.push(currentEntry);
        currentEntry = null;
      }
    }

    if (currentEntry) entries.push(currentEntry);
  } catch {
    // Skip unreadable files
  }

  return entries;
}

/**
 * 解析 MEMORY.md 中的 entries
 */
function parseMemoryMd(filePath: string): Array<{ source: string; date: string; content: string }> {
  const entries: Array<{ source: string; date: string; content: string }> = [];
  const source = 'MEMORY.md';

  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const entryRegex = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)/gm;
    let match;

    while ((match = entryRegex.exec(text)) !== null) {
      entries.push({
        source,
        date: match[1],
        content: match[2],
      });
    }
  } catch {
    // Skip unreadable files
  }

  return entries;
}

/**
 * 索引 memory 目錄中的所有檔案
 */
export function indexMemoryFiles(memoryDir: string): number {
  if (!db) return 0;

  try {
    const allEntries: Array<{ source: string; date: string; content: string }> = [];

    // Parse topics/*.md
    const topicsDir = path.join(memoryDir, 'topics');
    if (fs.existsSync(topicsDir)) {
      const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        allEntries.push(...parseTopicEntries(path.join(topicsDir, file)));
      }
    }

    // Parse MEMORY.md
    const memoryMd = path.join(memoryDir, 'MEMORY.md');
    if (fs.existsSync(memoryMd)) {
      allEntries.push(...parseMemoryMd(memoryMd));
    }

    // Bulk insert with transaction
    const insert = db.prepare('INSERT INTO memory_fts (source, date, content) VALUES (?, ?, ?)');
    const insertAll = db.transaction((entries: typeof allEntries) => {
      for (const entry of entries) {
        insert.run(entry.source, entry.date, entry.content);
      }
    });

    insertAll(allEntries);
    return allEntries.length;
  } catch {
    return 0;
  }
}

/**
 * FTS5 BM25 排序搜尋
 */
export function searchMemoryFTS(query: string, limit = 5): MemoryEntry[] {
  if (!db) return [];

  try {
    // Sanitize: remove FTS5 special operators to prevent syntax errors
    const sanitized = query.replace(/["""*{}()^~[\]]/g, '').trim();
    if (!sanitized) return [];

    const rows = db.prepare(`
      SELECT source, date, content, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit) as Array<{ source: string; date: string; content: string; rank: number }>;

    return rows.map(row => ({
      source: row.source,
      date: row.date,
      content: row.content,
    }));
  } catch {
    return [];
  }
}

/**
 * 全量重建索引（刪表重建）
 */
export function rebuildIndex(memoryDir: string): number {
  if (!db) return 0;

  try {
    db.exec('DROP TABLE IF EXISTS memory_fts');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source,
        date,
        content,
        tokenize="unicode61"
      );
    `);
    return indexMemoryFiles(memoryDir);
  } catch {
    return 0;
  }
}

/**
 * 檢查索引是否已初始化且有資料
 */
export function isIndexReady(): boolean {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM memory_fts').get() as { count: number };
    return row.count > 0;
  } catch {
    return false;
  }
}

/**
 * 關閉資料庫連線
 */
export function closeSearchIndex(): void {
  if (db) {
    db.close();
    db = null;
  }
}
