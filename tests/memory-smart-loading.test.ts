import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initSearchIndex,
  indexMemoryFiles,
  searchMemoryEntries,
  closeSearchIndex,
} from '../src/search.js';

let testDir: string;
let dbPath: string;

describe('searchMemoryEntries', () => {
  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `mini-agent-search-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test-index.db');

    // Create a MEMORY.md with diverse entries
    fs.writeFileSync(
      path.join(testDir, 'MEMORY.md'),
      [
        '# Long-term Memory',
        '',
        '## Learned Patterns',
        '- [2026-02-09] CI/CD 已啟用。self-hosted runner online，push main 自動觸發部署。',
        '- [2026-02-09] 不要在未驗證的情況下做結論。必須用工具驗證。',
        '- [2026-02-26] 抽象要貫徹到底：創建共享抽象後，必須搜尋所有 hardcoded 舊邏輯。',
        '- [2026-02-26] 命名攜帶假設：變數用途泛化時名字必須同步更新。',
        '- [2026-03-01] TypeScript strict mode 很重要，field names 跨 endpoints 一致。',
        '',
        '## User Preferences',
        '- [2026-02-05] 用戶偏好使用 TypeScript 寫程式',
        '',
        '## Important Decisions',
        '- [2026-02-09] 三方協作模型：Alex + Claude Code + Kuro。',
        '',
        '## TODO / Future Improvements',
        '- [2026-03-01] 改善 perception plugin 的效能',
        '- [2026-02-20] 加入 voice transcription 到 mobile app',
        '',
      ].join('\n'),
      'utf-8',
    );

    // Init index and populate
    initSearchIndex(dbPath);
    indexMemoryFiles(testDir);
  });

  afterEach(() => {
    closeSearchIndex();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should return entries matching a relevant query', () => {
    const results = searchMemoryEntries(testDir, 'runner self-hosted');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes('runner'))).toBe(true);
    expect(results.every(r => r.source === 'MEMORY.md')).toBe(true);
  });

  it('should return entries for TypeScript query', () => {
    const results = searchMemoryEntries(testDir, 'TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes('TypeScript'))).toBe(true);
  });

  it('should return empty for unrelated queries', () => {
    const results = searchMemoryEntries(testDir, 'quantum computing blockchain');
    expect(results).toHaveLength(0);
  });

  it('should respect the limit parameter', () => {
    const results = searchMemoryEntries(testDir, 'TypeScript deploy 抽象 命名 perception', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should return entries with source, date, and content fields', () => {
    const results = searchMemoryEntries(testDir, 'CI/CD');
    expect(results.length).toBeGreaterThan(0);
    const entry = results[0];
    expect(entry).toHaveProperty('source');
    expect(entry).toHaveProperty('date');
    expect(entry).toHaveProperty('content');
    expect(entry.source).toBe('MEMORY.md');
  });

  it('should auto-index when index is empty', () => {
    // Close and reinit with empty index
    closeSearchIndex();
    const freshDbPath = path.join(testDir, 'fresh-index.db');
    initSearchIndex(freshDbPath);

    // Should auto-index and still find results
    const results = searchMemoryEntries(testDir, 'CI/CD');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle empty query gracefully', () => {
    const results = searchMemoryEntries(testDir, '');
    expect(results).toHaveLength(0);
  });

  it('should handle special characters in query', () => {
    const results = searchMemoryEntries(testDir, '"test" (query) [brackets]');
    // Should not throw, returns empty or results
    expect(Array.isArray(results)).toBe(true);
  });
});
