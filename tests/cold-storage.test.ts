import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock feedback-loops and utils (required by context-optimizer)
vi.mock('../src/feedback-loops.js', () => {
  const store = new Map<string, unknown>();
  return {
    readState: <T>(_filename: string, fallback: T): T => {
      const data = store.get(_filename);
      return (data as T) ?? fallback;
    },
    writeState: (filename: string, data: unknown): void => {
      store.set(filename, structuredClone(data));
    },
  };
});

vi.mock('../src/utils.js', () => ({
  slog: () => {},
}));

import { identifyColdEntries, migrateToColdStorage } from '../src/context-optimizer.js';

describe('Cold Storage Migration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper to build a date string N days ago
  function daysAgo(n: number): string {
    const d = new Date(Date.now() - n * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  describe('identifyColdEntries', () => {
    it('identifies entries older than maxAgeDays in non-protected sections', () => {
      const content = [
        '# Long-term Memory',
        '',
        '## Learned Patterns',
        `- [${daysAgo(60)}] Old pattern A`,
        `- [${daysAgo(45)}] Old pattern B`,
        `- [${daysAgo(10)}] Recent pattern C`,
        '',
        '## TODO',
        `- [${daysAgo(50)}] Old todo`,
      ].join('\n');

      const cold = identifyColdEntries(content, 30);

      expect(cold).toHaveLength(3);
      expect(cold[0]).toContain('Old pattern A');
      expect(cold[1]).toContain('Old pattern B');
      expect(cold[2]).toContain('Old todo');
    });

    it('does NOT identify entries in protected sections', () => {
      const content = [
        '# Long-term Memory',
        '',
        '## User Preferences',
        `- [${daysAgo(90)}] Very old preference`,
        `- [${daysAgo(60)}] Old preference`,
        '',
        '## Important Decisions',
        `- [${daysAgo(120)}] Ancient decision`,
        '',
        '## Important Facts',
        `- [${daysAgo(100)}] Old fact`,
        '',
        '## Learned Patterns',
        `- [${daysAgo(50)}] Old pattern`,
      ].join('\n');

      const cold = identifyColdEntries(content, 30);

      expect(cold).toHaveLength(1);
      expect(cold[0]).toContain('Old pattern');
    });

    it('does NOT identify recent entries', () => {
      const content = [
        '## Learned Patterns',
        `- [${daysAgo(5)}] Recent A`,
        `- [${daysAgo(15)}] Recent B`,
        `- [${daysAgo(29)}] Still recent C`,
      ].join('\n');

      const cold = identifyColdEntries(content, 30);

      expect(cold).toHaveLength(0);
    });

    it('handles empty content', () => {
      const cold = identifyColdEntries('', 30);
      expect(cold).toHaveLength(0);
    });

    it('handles content with no dated entries', () => {
      const content = '# Memory\n\n## Notes\n\nSome random text\n';
      const cold = identifyColdEntries(content, 30);
      expect(cold).toHaveLength(0);
    });
  });

  describe('migrateToColdStorage', () => {
    it('removes old entries from MEMORY.md and adds to cold-storage.md', () => {
      const memoryContent = [
        '# Long-term Memory',
        '',
        '## Learned Patterns',
        `- [${daysAgo(60)}] Old entry one`,
        `- [${daysAgo(10)}] Recent entry`,
        `- [${daysAgo(45)}] Old entry two`,
      ].join('\n');

      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      const result = migrateToColdStorage(tmpDir, 30);

      expect(result.migrated).toBe(2);

      // MEMORY.md should only have the recent entry
      const updated = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
      expect(updated).toContain('Recent entry');
      expect(updated).not.toContain('Old entry one');
      expect(updated).not.toContain('Old entry two');

      // cold-storage.md should have the old entries
      const cold = fs.readFileSync(path.join(tmpDir, 'cold-storage.md'), 'utf-8');
      expect(cold).toContain('Old entry one');
      expect(cold).toContain('Old entry two');
    });

    it('returns correct count', () => {
      const memoryContent = [
        '## Learned Patterns',
        `- [${daysAgo(60)}] A`,
        `- [${daysAgo(45)}] B`,
        `- [${daysAgo(35)}] C`,
        `- [${daysAgo(10)}] D`,
      ].join('\n');

      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      const result = migrateToColdStorage(tmpDir, 30);
      expect(result.migrated).toBe(3);
    });

    it('creates cold-storage.md with header if it does not exist', () => {
      const memoryContent = [
        '## Notes',
        `- [${daysAgo(60)}] Old note`,
      ].join('\n');

      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      expect(fs.existsSync(path.join(tmpDir, 'cold-storage.md'))).toBe(false);

      migrateToColdStorage(tmpDir, 30);

      const cold = fs.readFileSync(path.join(tmpDir, 'cold-storage.md'), 'utf-8');
      expect(cold).toContain('# Cold Storage');
      expect(cold).toContain('Entries migrated from MEMORY.md (still searchable via FTS5)');
      expect(cold).toContain('Old note');
    });

    it('appends to existing cold-storage.md without duplicating header', () => {
      const existingCold = '# Cold Storage\n\nEntries migrated from MEMORY.md (still searchable via FTS5).\n\n## Migrated 2026-01-01\n- [2025-12-01] Previous entry\n';
      fs.writeFileSync(path.join(tmpDir, 'cold-storage.md'), existingCold);

      const memoryContent = [
        '## Notes',
        `- [${daysAgo(60)}] New old note`,
      ].join('\n');
      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      migrateToColdStorage(tmpDir, 30);

      const cold = fs.readFileSync(path.join(tmpDir, 'cold-storage.md'), 'utf-8');
      // Should not have duplicate header
      const headerCount = (cold.match(/# Cold Storage/g) || []).length;
      expect(headerCount).toBe(1);
      // Should have both old and new entries
      expect(cold).toContain('Previous entry');
      expect(cold).toContain('New old note');
    });

    it('returns { migrated: 0 } when MEMORY.md does not exist', () => {
      const result = migrateToColdStorage(tmpDir, 30);
      expect(result.migrated).toBe(0);
    });

    it('returns { migrated: 0 } when no entries are old enough', () => {
      const memoryContent = [
        '## Notes',
        `- [${daysAgo(5)}] Recent A`,
        `- [${daysAgo(10)}] Recent B`,
      ].join('\n');
      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      const result = migrateToColdStorage(tmpDir, 30);
      expect(result.migrated).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, 'cold-storage.md'))).toBe(false);
    });

    it('preserves protected section entries in MEMORY.md', () => {
      const memoryContent = [
        '# Long-term Memory',
        '',
        '## User Preferences',
        `- [${daysAgo(90)}] Old preference that should stay`,
        '',
        '## Learned Patterns',
        `- [${daysAgo(90)}] Old pattern to migrate`,
        `- [${daysAgo(5)}] Recent pattern to keep`,
      ].join('\n');

      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), memoryContent);

      const result = migrateToColdStorage(tmpDir, 30);

      expect(result.migrated).toBe(1);

      const updated = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
      expect(updated).toContain('Old preference that should stay');
      expect(updated).toContain('Recent pattern to keep');
      expect(updated).not.toContain('Old pattern to migrate');
    });
  });
});
