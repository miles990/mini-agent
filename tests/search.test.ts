import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSearchIndex, closeSearchIndex } from '../src/search.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('search enrichment', () => {
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
    dbPath = path.join(tmpDir, 'test-index.db');
  });

  afterEach(() => {
    closeSearchIndex();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create memory_fts with enriched column', () => {
    initSearchIndex(dbPath);
    const db = new Database(dbPath);
    const info = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
    const columns = info.map(r => r.name);
    expect(columns).toContain('enriched');
    db.close();
  });

  it('should migrate old schema missing enriched column', () => {
    // Create a DB with the old schema (no enriched column)
    const oldDb = new Database(dbPath);
    oldDb.pragma('journal_mode = WAL');
    oldDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source,
        date,
        content,
        tokenize="unicode61"
      );
    `);
    oldDb.prepare('INSERT INTO memory_fts (source, date, content) VALUES (?, ?, ?)').run('test.md', '2026-01-01', 'old entry');
    oldDb.close();

    // Now init with the new code — should migrate
    initSearchIndex(dbPath);
    const db = new Database(dbPath);
    const info = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
    const columns = info.map(r => r.name);
    expect(columns).toContain('enriched');
    db.close();
  });
});
