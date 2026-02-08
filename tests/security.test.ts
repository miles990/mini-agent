import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InstanceMemory } from '../src/memory.js';

let testDir: string;
let memory: InstanceMemory;

describe('Security', () => {
  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `mini-agent-security-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'daily'), { recursive: true });

    memory = new InstanceMemory('sec-test', { hot: 5, warm: 10 });
    (memory as any).memoryDir = testDir;

    // Create a file for search tests
    await fs.writeFile(
      path.join(testDir, 'MEMORY.md'),
      '# Memory\n\n## Data\n- Secret data here\n- Normal content\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('searchMemory input sanitization', () => {
    it('should handle normal queries safely', async () => {
      const results = await memory.searchMemory('Normal');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should sanitize shell metacharacters', async () => {
      // These should not cause command injection
      const maliciousQueries = [
        '"; rm -rf /',
        '$(whoami)',
        '`id`',
        'test; cat /etc/passwd',
        'test | ls',
        'test && echo pwned',
        'test || echo pwned',
      ];

      for (const query of maliciousQueries) {
        // Should not throw, just return empty or filtered results
        const results = await memory.searchMemory(query);
        expect(Array.isArray(results)).toBe(true);
      }
    });

    it('should return empty for empty sanitized query', async () => {
      const results = await memory.searchMemory('";$()');
      expect(results).toHaveLength(0);
    });

    it('should handle Chinese characters', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '# 記憶\n\n## 中文\n- 這是測試內容\n',
        'utf-8'
      );
      const results = await memory.searchMemory('測試');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
