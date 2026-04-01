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

const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was', 'one', 'our', 'out',
  'is', 'it', 'in', 'to', 'of', 'on', 'at', 'an', 'or', 'if', 'no', 'so', 'do', 'my', 'up', 'this',
  'that', 'with', 'from', 'have', 'been', 'will', 'into', 'more', 'when', 'some', 'them', 'than',
  'its', 'also', 'each', 'which', 'their', 'what', 'about', 'would', 'there', 'could', 'other',
  'just', 'then', 'kuro', 'alex',
]);

interface ConversationFtsEntry {
  id: string;
  source: string;
  sender: string;
  text: string;
  ts: string;
  replyTo: string;
}

function ensureConversationTable(): void {
  if (!db) return;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      id UNINDEXED,
      source UNINDEXED,
      sender,
      text,
      ts UNINDEXED,
      reply_to UNINDEXED,
      tokenize="unicode61"
    );
  `);
}

function ensureConversationIndexStateTable(): void {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_fts_state (
      source TEXT PRIMARY KEY,
      indexed_lines INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

function getConversationRowCount(): number {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM conversation_fts').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

/**
 * 初始化 FTS5 搜尋索引
 */
export function initSearchIndex(dbPath: string, memoryDir?: string): void {
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
        enriched,
        tokenize="unicode61"
      );
    `);

    // Schema migration: detect missing enriched column → rebuild
    try {
      const cols = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some(c => c.name === 'enriched')) {
        db.exec('DROP TABLE IF EXISTS memory_fts');
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
            source, date, content, enriched,
            tokenize="unicode61"
          );
        `);
        if (memoryDir) indexMemoryFiles(memoryDir);
      }
    } catch { /* FTS5 PRAGMA may fail — ignore, CREATE IF NOT EXISTS handles it */ }

    ensureConversationTable();
    ensureConversationIndexStateTable();

    // Conversation index bootstrap: first startup with empty table.
    if (memoryDir && getConversationRowCount() === 0) {
      indexConversationsIncremental(memoryDir);
    }
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

    // Parse cold-storage.md (migrated entries should remain searchable)
    const coldStorage = path.join(memoryDir, 'cold-storage.md');
    if (fs.existsSync(coldStorage)) {
      allEntries.push(...parseMemoryMd(coldStorage));
    }

    // Parse HEARTBEAT.md (active tasks — searchable for context)
    const heartbeatMd = path.join(memoryDir, 'HEARTBEAT.md');
    if (fs.existsSync(heartbeatMd)) {
      allEntries.push(...parseTopicEntries(heartbeatMd));
    }

    // Parse proposals/*.md (strategic decisions)
    const proposalsDir = path.join(memoryDir, 'proposals');
    if (fs.existsSync(proposalsDir)) {
      const proposalFiles = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.md'));
      for (const file of proposalFiles) {
        const filePath = path.join(proposalsDir, file);
        try {
          const text = fs.readFileSync(filePath, 'utf-8');
          // Extract date from filename (YYYY-MM-DD-title.md)
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
          const date = dateMatch ? dateMatch[1] : '';
          // Index the whole proposal as one entry (truncated to 2000 chars)
          const content = text.replace(/^#.*\n/gm, '').trim().slice(0, 2000);
          if (content.length > 20) {
            allEntries.push({ source: `proposals/${file}`, date, content });
          }
        } catch { /* skip */ }
      }
    }

    // Bulk insert with transaction
    const insert = db.prepare('INSERT INTO memory_fts (source, date, content, enriched) VALUES (?, ?, ?, ?)');
    const insertAll = db.transaction((entries: typeof allEntries) => {
      for (const entry of entries) {
        insert.run(entry.source, entry.date, entry.content, '');
      }
    });

    insertAll(allEntries);
    return allEntries.length;
  } catch {
    return 0;
  }
}

/** Sanitize query for FTS5: strip special operators, normalize whitespace */
function sanitizeFTS5Query(query: string): string {
  return query.replace(/["""*{}()^~[\]/\\:\-+]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractFTSKeywords(query: string, maxWords = 15): string[] {
  const sanitized = sanitizeFTS5Query(query);
  if (!sanitized) return [];
  return sanitized
    .split(' ')
    .filter(w => w.length >= 2 && !SEARCH_STOP_WORDS.has(w.toLowerCase()))
    .slice(0, maxWords);
}

function parseConversationEntries(memoryDir: string): ConversationFtsEntry[] {
  const conversationsDir = path.join(memoryDir, 'conversations');
  if (!fs.existsSync(conversationsDir)) return [];

  const entries: ConversationFtsEntry[] = [];
  const files = fs.readdirSync(conversationsDir)
    .filter(file => file.endsWith('.jsonl'))
    .sort();

  for (const file of files) {
    const filePath = path.join(conversationsDir, file);
    const fileDate = file.replace(/\.jsonl$/, '');
    const fallbackTs = `${fileDate}T00:00:00.000Z`;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const id = typeof parsed.id === 'string' ? parsed.id : '';
          const sender = typeof parsed.from === 'string' ? parsed.from : '';
          const text = typeof parsed.text === 'string' ? parsed.text : '';
          const tsValue = typeof parsed.ts === 'string'
            ? parsed.ts
            : typeof parsed.timestamp === 'string'
              ? parsed.timestamp
              : fallbackTs;
          const replyTo = typeof parsed.replyTo === 'string' ? parsed.replyTo : '';
          if (!id || !sender || !text.trim()) continue;
          entries.push({
            id,
            source: file,
            sender,
            text,
            ts: tsValue,
            replyTo,
          });
        } catch {
          // Skip malformed JSONL line
        }
      }
    } catch {
      // Skip unreadable file
    }
  }

  return entries;
}

function reindexConversations(memoryDir: string): number {
  if (!db) return 0;
  ensureConversationTable();
  ensureConversationIndexStateTable();

  try {
    const entries = parseConversationEntries(memoryDir);
    const clear = db.prepare('DELETE FROM conversation_fts');
    const insert = db.prepare(`
      INSERT INTO conversation_fts (id, source, sender, text, ts, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((rows: ConversationFtsEntry[]) => {
      clear.run();
      for (const row of rows) {
        insert.run(row.id, row.source, row.sender, row.text, row.ts, row.replyTo);
      }
      db!.prepare('DELETE FROM conversation_fts_state').run();
      const upsertState = db!.prepare(`
        INSERT INTO conversation_fts_state (source, indexed_lines, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          indexed_lines = excluded.indexed_lines,
          updated_at = excluded.updated_at
      `);
      const nowIso = new Date().toISOString();
      const lineCountBySource = new Map<string, number>();
      for (const row of rows) {
        lineCountBySource.set(row.source, (lineCountBySource.get(row.source) ?? 0) + 1);
      }
      for (const [source, count] of lineCountBySource) {
        upsertState.run(source, count, nowIso);
      }
    });
    tx(entries);
    return entries.length;
  } catch {
    return 0;
  }
}

function parseConversationLines(
  sourceFile: string,
  lines: string[],
  startLine: number,
): ConversationFtsEntry[] {
  const fileDate = sourceFile.replace(/\.jsonl$/, '');
  const fallbackTs = `${fileDate}T00:00:00.000Z`;
  const entries: ConversationFtsEntry[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = typeof parsed.id === 'string' ? parsed.id : '';
      const sender = typeof parsed.from === 'string' ? parsed.from : '';
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      const tsValue = typeof parsed.ts === 'string'
        ? parsed.ts
        : typeof parsed.timestamp === 'string'
          ? parsed.timestamp
          : fallbackTs;
      const replyTo = typeof parsed.replyTo === 'string' ? parsed.replyTo : '';
      if (!id || !sender || !text.trim()) continue;
      entries.push({
        id,
        source: sourceFile,
        sender,
        text,
        ts: tsValue,
        replyTo,
      });
    } catch {
      // Skip malformed JSONL line
    }
  }

  return entries;
}

export function indexConversationsIncremental(memoryDir: string): number {
  if (!db) return 0;
  ensureConversationTable();
  ensureConversationIndexStateTable();

  const conversationsDir = path.join(memoryDir, 'conversations');
  if (!fs.existsSync(conversationsDir)) return 0;

  try {
    const files = fs.readdirSync(conversationsDir)
      .filter(file => file.endsWith('.jsonl'))
      .sort();

    const getState = db.prepare(
      'SELECT indexed_lines FROM conversation_fts_state WHERE source = ?',
    );
    const deleteSource = db.prepare('DELETE FROM conversation_fts WHERE source = ?');
    const insert = db.prepare(`
      INSERT INTO conversation_fts (id, source, sender, text, ts, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsertState = db.prepare(`
      INSERT INTO conversation_fts_state (source, indexed_lines, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        indexed_lines = excluded.indexed_lines,
        updated_at = excluded.updated_at
    `);
    const deleteState = db.prepare('DELETE FROM conversation_fts_state WHERE source = ?');

    const tx = db.transaction((jsonlFiles: string[]) => {
      let insertedTotal = 0;
      const liveFiles = new Set(jsonlFiles);
      const existingStateRows = db!.prepare('SELECT source FROM conversation_fts_state').all() as Array<{ source: string }>;
      for (const row of existingStateRows) {
        if (!liveFiles.has(row.source)) {
          deleteSource.run(row.source);
          deleteState.run(row.source);
        }
      }

      for (const file of jsonlFiles) {
        const filePath = path.join(conversationsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter(line => line.length > 0);

        const state = getState.get(file) as { indexed_lines: number } | undefined;
        let startLine = state?.indexed_lines ?? 0;
        const totalLines = lines.length;

        // File truncated or rotated: rebuild this source.
        if (startLine > totalLines) {
          deleteSource.run(file);
          startLine = 0;
        }

        if (startLine < totalLines) {
          const rows = parseConversationLines(file, lines, startLine);
          for (const row of rows) {
            insert.run(row.id, row.source, row.sender, row.text, row.ts, row.replyTo);
            insertedTotal++;
          }
        }

        upsertState.run(file, totalLines, new Date().toISOString());
      }

      return insertedTotal;
    });

    return tx(files) as number;
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
    const sanitized = sanitizeFTS5Query(query);
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
 * Search MEMORY.md entries specifically, with auto-index on first call.
 * Used by buildContext() for smart MEMORY.md loading.
 *
 * Extracts top keywords from query and uses FTS5 OR to match any of them,
 * avoiding implicit AND which fails with long contextHint strings.
 */
export function searchMemoryEntries(
  memoryDir: string,
  query: string,
  limit = 10,
): Array<{ source: string; date: string; content: string }> {
  if (!db) return [];

  // Auto-index if empty
  if (!isIndexReady()) {
    indexMemoryFiles(memoryDir);
  }

  try {
    const words = extractFTSKeywords(query, 15);
    if (words.length === 0) return [];

    // Use OR to match any keyword (not implicit AND which requires all)
    const ftsQuery = words.join(' OR ');

    const rows = db.prepare(`
      SELECT source, date, content, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
        AND source = 'MEMORY.md'
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{ source: string; date: string; content: string; rank: number }>;

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
 * Search chat-room conversation history with FTS5.
 * Auto-creates and lazily refreshes index when conversation JSONL files change.
 */
export function searchConversations(
  memoryDir: string,
  query: string,
  limit = 5,
): Array<{ id: string; from: string; text: string; ts: string; replyTo?: string; source: string }> {
  if (!db) return [];
  ensureConversationTable();
  ensureConversationIndexStateTable();
  indexConversationsIncremental(memoryDir);

  try {
    const words = extractFTSKeywords(query, 20);
    if (words.length === 0) return [];
    const ftsQuery = words.join(' OR ');

    const rows = db.prepare(`
      SELECT id, source, sender, text, ts, reply_to, rank
      FROM conversation_fts
      WHERE conversation_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{
      id: string;
      source: string;
      sender: string;
      text: string;
      ts: string;
      reply_to: string;
      rank: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      from: row.sender,
      text: row.text,
      ts: row.ts,
      ...(row.reply_to ? { replyTo: row.reply_to } : {}),
      source: row.source,
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
    db.exec('DROP TABLE IF EXISTS conversation_fts');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source,
        date,
        content,
        enriched,
        tokenize="unicode61"
      );
    `);
    ensureConversationTable();
    ensureConversationIndexStateTable();
    db.exec('DELETE FROM conversation_fts_state');
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
 * 關閉資料庫連線（test cleanup 用）
 */
export function closeSearchIndex(): void {
  if (db) {
    db.close();
    db = null;
  }
}

