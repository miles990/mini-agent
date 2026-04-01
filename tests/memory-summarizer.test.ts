import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTopicManifest } from '../src/memory-summarizer.js';

// =============================================================================
// Memory Summarizer Tests — buildTopicManifest (pure file ops, no LLM)
// =============================================================================

const TEST_DIR = '/tmp/test-memory-summarizer';
const TOPICS_DIR = path.join(TEST_DIR, 'topics');

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
}

function writeTopicFile(name: string, content: string) {
  fs.writeFileSync(path.join(TOPICS_DIR, `${name}.md`), content, 'utf-8');
}

beforeEach(() => {
  cleanup();
  fs.mkdirSync(TOPICS_DIR, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe('buildTopicManifest', () => {
  it('returns empty array when topics dir does not exist', () => {
    const result = buildTopicManifest('/tmp/nonexistent-memory-dir');
    expect(result).toEqual([]);
  });

  it('returns empty array when topics dir has no .md files', () => {
    fs.writeFileSync(path.join(TOPICS_DIR, 'readme.txt'), 'not a topic');
    const result = buildTopicManifest(TEST_DIR);
    expect(result).toEqual([]);
  });

  it('parses a simple topic file', () => {
    writeTopicFile('test-topic', `# test-topic

- [2026-03-15] First entry about something
- [2026-03-20] Second entry about another thing
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe('test-topic');
    expect(result[0].entryCount).toBe(2);
    expect(result[0].lastDate).toBe('2026-03-20');
    expect(result[0].charCount).toBeGreaterThan(0);
    expect(result[0].preview).toContain('Second entry');
  });

  it('handles YAML frontmatter correctly', () => {
    writeTopicFile('with-frontmatter', `---
related: [other-topic]
keywords: [test]
---
# with-frontmatter

- [2026-01-10] Entry after frontmatter
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].entryCount).toBe(1);
    expect(result[0].lastDate).toBe('2026-01-10');
  });

  it('sorts by lastDate descending (most recent first)', () => {
    writeTopicFile('old-topic', `# old-topic

- [2025-06-01] Old entry
`);

    writeTopicFile('new-topic', `# new-topic

- [2026-04-01] New entry
`);

    writeTopicFile('mid-topic', `# mid-topic

- [2026-01-15] Middle entry
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result).toHaveLength(3);
    expect(result[0].topic).toBe('new-topic');
    expect(result[1].topic).toBe('mid-topic');
    expect(result[2].topic).toBe('old-topic');
  });

  it('preview contains last 2 entries and is max 200 chars', () => {
    writeTopicFile('many-entries', `# many-entries

- [2026-01-01] First entry
- [2026-01-02] Second entry
- [2026-01-03] Third entry is here
- [2026-01-04] Fourth and final entry
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result[0].preview).toContain('Third entry');
    expect(result[0].preview).toContain('Fourth and final');
    expect(result[0].preview.length).toBeLessThanOrEqual(200);
  });

  it('truncates long preview to 200 chars', () => {
    const longEntry = 'A'.repeat(150);
    writeTopicFile('long-preview', `# long-preview

- [2026-01-01] ${longEntry}
- [2026-01-02] ${longEntry}
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result[0].preview.length).toBeLessThanOrEqual(200);
    expect(result[0].preview).toMatch(/\.\.\.$/);
  });

  it('counts entries correctly with multi-line entries', () => {
    writeTopicFile('multiline', `# multiline

- [2026-01-01] Entry one that spans
  multiple lines of text
- [2026-01-02] Entry two also has
  continuation here
- [2026-01-03] Short entry
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result[0].entryCount).toBe(3);
  });

  it('handles topic file with no dates (uses file mtime)', () => {
    writeTopicFile('no-dates', `# no-dates

- Entry without a date
- Another entry without a date
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('skips hidden files (dotfiles)', () => {
    writeTopicFile('.hidden', `# hidden

- [2026-01-01] Should be skipped
`);
    // Also write the dotfile via direct fs since writeTopicFile adds .md
    fs.writeFileSync(path.join(TOPICS_DIR, '.hidden-file.md'), '# hidden\n- entry');

    writeTopicFile('visible', `# visible

- [2026-01-01] Should be included
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe('visible');
  });

  it('returns correct structure for all fields', () => {
    writeTopicFile('structure-test', `---
related: [other]
---
# structure-test

- [2026-02-10] First item about testing structure
- [2026-02-15] Second item with more details
- [2026-02-20] Third item wrapping up
`);

    const result = buildTopicManifest(TEST_DIR);
    const entry = result[0];

    expect(entry).toHaveProperty('topic');
    expect(entry).toHaveProperty('entryCount');
    expect(entry).toHaveProperty('preview');
    expect(entry).toHaveProperty('lastDate');
    expect(entry).toHaveProperty('charCount');

    expect(typeof entry.topic).toBe('string');
    expect(typeof entry.entryCount).toBe('number');
    expect(typeof entry.preview).toBe('string');
    expect(typeof entry.lastDate).toBe('string');
    expect(typeof entry.charCount).toBe('number');

    expect(entry.topic).toBe('structure-test');
    expect(entry.entryCount).toBe(3);
    expect(entry.lastDate).toBe('2026-02-20');
  });

  it('handles topic with section headers mixed with entries', () => {
    writeTopicFile('sections', `# sections

## Section A
- [2026-01-01] Entry under A

## Section B
- [2026-02-01] Entry under B
- [2026-03-01] Another under B
`);

    const result = buildTopicManifest(TEST_DIR);
    expect(result[0].entryCount).toBe(3);
    expect(result[0].lastDate).toBe('2026-03-01');
  });
});
