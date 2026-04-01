import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initSearchIndex,
  closeSearchIndex,
  updateEnrichment,
  enrichMemoryEntry,
  searchMemoryFTS,
} from '../src/search.js';
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

  describe('updateEnrichment', () => {
    it('should update enriched column and make entry searchable by enriched terms', () => {
      initSearchIndex(dbPath);

      // Insert a test entry directly via the DB
      const db = new Database(dbPath);
      db.prepare('INSERT INTO memory_fts (source, date, content, enriched) VALUES (?, ?, ?, ?)')
        .run('MEMORY.md', '2026-04-01', '部署失敗了，CI pipeline timeout', '');
      db.close();

      // Update enrichment
      const result = updateEnrichment('MEMORY.md', '部署失敗了', 'deploy fail failure 上線 出錯 錯誤 release error');
      expect(result).toBe(true);

      // Verify: search by an enriched term should find the entry
      const hits = searchMemoryFTS('deploy');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].content).toContain('部署失敗了');
    });

    it('should return false when no matching entry exists', () => {
      initSearchIndex(dbPath);
      const result = updateEnrichment('nonexistent.md', 'no such content', 'enriched terms');
      expect(result).toBe(false);
    });

    it('should return false for empty enriched string', () => {
      initSearchIndex(dbPath);
      const result = updateEnrichment('MEMORY.md', 'some content', '   ');
      expect(result).toBe(false);
    });

    it('should return false when db is not initialized', () => {
      // Don't call initSearchIndex — db is null
      const result = updateEnrichment('MEMORY.md', 'content', 'enriched');
      expect(result).toBe(false);
    });
  });

  describe('enrichMemoryEntry', () => {
    it('should return empty string for short content (< 10 chars)', async () => {
      const result = await enrichMemoryEntry('short');
      expect(result).toBe('');
    });

    it('should return empty string for empty content', async () => {
      const result = await enrichMemoryEntry('');
      expect(result).toBe('');
    });
  });
});
