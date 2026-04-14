/**
 * Memory Layer v3 — EntriesStore invariants & integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EntriesStore, computeContentHash, generateEntryId, resetEntriesStore, getEntriesStore } from '../src/entries.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entries-test-'));
  fs.mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
  resetEntriesStore();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('entries — basic', () => {
  it('generates unique ids', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateEntryId());
    expect(set.size).toBe(100);
  });

  it('computes stable content hash ignoring surrounding whitespace', () => {
    expect(computeContentHash('hello world')).toBe(computeContentHash('  hello world  '));
    expect(computeContentHash('hello world')).not.toBe(computeContentHash('hello  world'));
  });

  it('appends a simple entry and reads it back', () => {
    const store = new EntriesStore(tmpDir);
    const entry = store.append({
      content: 'triage is the system 1 layer',
      source: 'topics/mushi.md',
      concepts: ['mushi', 'triage'],
      attribution: 'kuro',
    });
    expect(entry).not.toBeNull();
    expect(entry!.id).toMatch(/^entry-[0-9a-f]{16}$/);
    expect(entry!.attribution).toBe('kuro');
    expect(entry!.content_hash).toMatch(/^sha256:/);
    expect(entry!.supersedes).toEqual([]);
    expect(entry!.superseded_by).toBeNull();
    expect(entry!.confidence).toBe(1.0);

    const reopened = new EntriesStore(tmpDir);
    const found = reopened.findById(entry!.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe(entry!.content);
  });
});

describe('entries — invariants', () => {
  it('rejects empty attribution', () => {
    const store = new EntriesStore(tmpDir);
    expect(() => store.append({
      content: 'x',
      source: 'MEMORY.md',
      attribution: '',
    })).toThrow(/attribution/);
    expect(() => store.append({
      content: 'x',
      source: 'MEMORY.md',
      attribution: '   ',
    })).toThrow(/attribution/);
  });

  it('rejects empty content', () => {
    const store = new EntriesStore(tmpDir);
    expect(() => store.append({
      content: '',
      source: 'MEMORY.md',
      attribution: 'kuro',
    })).toThrow(/content/);
  });

  it('dedups by content_hash (returns null, does not throw)', () => {
    const store = new EntriesStore(tmpDir);
    const first = store.append({
      content: 'same content',
      source: 'MEMORY.md',
      attribution: 'kuro',
    });
    expect(first).not.toBeNull();
    const second = store.append({
      content: '  same content  ',  // whitespace-normalized
      source: 'MEMORY.md',
      attribution: 'kuro',
    });
    expect(second).toBeNull();
    expect(store.all()).toHaveLength(1);
  });

  it('rejects supersede target that does not exist', () => {
    const store = new EntriesStore(tmpDir);
    expect(() => store.append({
      content: 'replacement',
      source: 'MEMORY.md',
      attribution: 'kuro',
      supersedes: ['entry-nonexistent'],
      stale_reason: 'testing',
    })).toThrow(/not found/);
  });

  it('requires stale_reason when supersedes is non-empty', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({
      content: 'original',
      source: 'MEMORY.md',
      attribution: 'kuro',
    })!;
    expect(() => store.append({
      content: 'replacement',
      source: 'MEMORY.md',
      attribution: 'kuro',
      supersedes: [a.id],
      stale_reason: '',
    })).toThrow(/stale_reason/);
    expect(() => store.append({
      content: 'replacement',
      source: 'MEMORY.md',
      attribution: 'kuro',
      supersedes: [a.id],
      stale_reason: '   ',
    })).toThrow(/stale_reason/);
  });

  it('immutability — file never rewritten, only appended', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({ content: 'first', source: 'M', attribution: 'kuro' })!;
    const filePath = path.join(tmpDir, 'index', 'entries.jsonl');
    const sizeA = fs.statSync(filePath).size;

    // Supersede should NOT rewrite existing lines
    const b = store.append({
      content: 'replacement of first',
      source: 'M',
      attribution: 'kuro',
      supersedes: [a.id],
      stale_reason: 'updated per review',
    })!;
    expect(b).not.toBeNull();

    const rawAfter = fs.readFileSync(filePath, 'utf8');
    // File has exactly 2 entries (both appended; nothing rewritten)
    const lines = rawAfter.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(2);
    // First line must still be the original entry (byte-identical at start)
    const firstLine = JSON.parse(lines[0]);
    expect(firstLine.id).toBe(a.id);
    expect(firstLine.superseded_by).toBeNull(); // NOT persisted, even after supersede
    expect(fs.statSync(filePath).size).toBeGreaterThan(sizeA); // appended, not shrunk
  });

  it('derives superseded_by at read time (in-memory)', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({ content: 'first', source: 'M', attribution: 'kuro' })!;
    const b = store.append({
      content: 'second',
      source: 'M',
      attribution: 'kuro',
      supersedes: [a.id],
      stale_reason: 'newer data',
    })!;
    // After reload, superseded_by must be reconstructed in memory
    const reopened = new EntriesStore(tmpDir);
    const aRead = reopened.findById(a.id);
    expect(aRead!.superseded_by).toBe(b.id);
  });

  it('circular supersede is blocked', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({ content: 'a', source: 'M', attribution: 'kuro' })!;
    const b = store.append({
      content: 'b',
      source: 'M',
      attribution: 'kuro',
      supersedes: [a.id],
      stale_reason: 'b supersedes a',
    })!;
    // Direct cycle would require mutating b to supersede itself via a — forbidden by content dedup,
    // so simulate by another supersede chain: try to make c supersede b while b.superseded_by chain
    // leads back to c. Since new c hasn't been written yet, the current implementation detects
    // pre-existing cycles. Ensure the guard fires when we fake one by writing to the file directly.
    const filePath = path.join(tmpDir, 'index', 'entries.jsonl');
    const c: any = {
      id: 'entry-0000000000000001',
      source: 'M',
      content_hash: computeContentHash('c'),
      content: 'c',
      concepts: [],
      type: 'fact',
      created_at: new Date().toISOString(),
      last_validated_at: new Date().toISOString(),
      confidence: 1.0,
      supersedes: [b.id],
      superseded_by: a.id, // deliberate pre-existing cycle pointing back to a
      stale_reason: 'test cycle',
      attribution: 'kuro',
    };
    fs.appendFileSync(filePath, JSON.stringify(c) + '\n');

    // Reload picks up the corrupted chain; detectCircular must refuse further supersedes
    const reopened = new EntriesStore(tmpDir);
    expect(() => reopened.append({
      content: 'd trying to join cycle',
      source: 'M',
      attribution: 'kuro',
      supersedes: [c.id],
      stale_reason: 'should be rejected',
    })).toThrow(/circular/);
  });
});

describe('entries — exclusion', () => {
  it('exclude appends to exclusions.jsonl without mutating entries', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({ content: 'wrong content', source: 'M', attribution: 'worker:x' })!;
    const entriesPath = path.join(tmpDir, 'index', 'entries.jsonl');
    const sizeBefore = fs.statSync(entriesPath).size;

    store.exclude(a.id, 'compiler error — not a real fact', 'kuro');
    expect(fs.statSync(entriesPath).size).toBe(sizeBefore); // entries.jsonl untouched
    expect(fs.existsSync(path.join(tmpDir, 'index', 'exclusions.jsonl'))).toBe(true);
    expect(store.isExcluded(a.id)).toBe(true);

    const stats = store.getStats();
    expect(stats.excluded).toBe(1);
    expect(stats.active).toBe(0);
  });

  it('exclude requires non-empty reason and attribution', () => {
    const store = new EntriesStore(tmpDir);
    const a = store.append({ content: 'x', source: 'M', attribution: 'kuro' })!;
    expect(() => store.exclude(a.id, '', 'kuro')).toThrow(/reason/);
    expect(() => store.exclude(a.id, 'r', '')).toThrow(/attribution/);
  });
});

describe('entries — round-trip (defends escape bug from relations.jsonl #067)', () => {
  it('handles nested quotes and backslashes', () => {
    const store = new EntriesStore(tmpDir);
    const trickyContent = 'Telegram reply: "💬 Kuro 想跟你聊聊：\\"nested\\""';
    const entry = store.append({
      content: trickyContent,
      source: 'M',
      attribution: 'kuro',
    });
    expect(entry).not.toBeNull();

    // Read raw file, parse each line — must be valid JSON
    const filePath = path.join(tmpDir, 'index', 'entries.jsonl');
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split('\n').filter(l => l.trim())) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const reopened = new EntriesStore(tmpDir);
    const found = reopened.findById(entry!.id);
    expect(found!.content).toBe(trickyContent);
  });

  it('round-trips 100 random high-risk strings', () => {
    const store = new EntriesStore(tmpDir);
    const samples: string[] = [];
    for (let i = 0; i < 100; i++) {
      const quote = i % 2 === 0 ? '"' : "'";
      const backslash = i % 3 === 0 ? '\\' : '';
      const unicode = i % 4 === 0 ? '🎯✨💬' : '';
      samples.push(`sample ${i} ${quote}nested${quote} ${backslash}bs ${unicode} line\nbreak`);
    }
    const ids: string[] = [];
    for (const s of samples) {
      const e = store.append({ content: s, source: 'M', attribution: 'kuro' });
      if (e) ids.push(e.id);
    }
    expect(ids).toHaveLength(samples.length);

    const reopened = new EntriesStore(tmpDir);
    for (let i = 0; i < samples.length; i++) {
      const found = reopened.findById(ids[i]);
      expect(found!.content).toBe(samples[i]);
    }
  });
});

describe('entries — singleton helpers', () => {
  it('getEntriesStore returns per-dir singleton', () => {
    const a = getEntriesStore(tmpDir);
    const b = getEntriesStore(tmpDir);
    expect(a).toBe(b);
    resetEntriesStore();
    const c = getEntriesStore(tmpDir);
    expect(c).not.toBe(a);
  });
});
