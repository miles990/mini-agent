import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InstanceMemory } from '../src/memory.js';

// Use a temp dir for test isolation
let testDir: string;
let memory: InstanceMemory;

// Mock getCurrentInstanceId to use test instance
const TEST_INSTANCE_ID = 'test-instance';

describe('InstanceMemory', () => {
  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `mini-agent-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'daily'), { recursive: true });

    // Create memory with custom dir by setting env and mocking
    // We'll test the class directly by providing a known directory
    memory = new InstanceMemory(TEST_INSTANCE_ID, { hot: 5, warm: 10 });
    // Override memoryDir via internal property
    (memory as any).memoryDir = testDir;
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('readMemory / appendMemory', () => {
    it('should return empty string when no MEMORY.md exists', async () => {
      const result = await memory.readMemory();
      expect(result).toBe('');
    });

    it('should append to MEMORY.md with section', async () => {
      await memory.appendMemory('Test pattern', 'Learned Patterns');
      const content = await memory.readMemory();
      expect(content).toContain('## Learned Patterns');
      expect(content).toContain('Test pattern');
    });

    it('should append to existing section', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '# Memory\n\n## Learned Patterns\n- [2026-01-01] Old entry\n',
        'utf-8'
      );

      await memory.appendMemory('New pattern');
      const content = await memory.readMemory();
      expect(content).toContain('Old entry');
      expect(content).toContain('New pattern');
    });

    it('should create new section if not exists', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '# Memory\n\n## Existing\n- data\n',
        'utf-8'
      );

      await memory.appendMemory('Decision item', 'Decisions');
      const content = await memory.readMemory();
      expect(content).toContain('## Existing');
      expect(content).toContain('## Decisions');
      expect(content).toContain('Decision item');
    });
  });

  describe('readHeartbeat / updateHeartbeat / addTask', () => {
    it('should return empty when no HEARTBEAT.md', async () => {
      const result = await memory.readHeartbeat();
      expect(result).toBe('');
    });

    it('should write and read heartbeat content', async () => {
      await memory.updateHeartbeat('# HEARTBEAT\n\n## Active Tasks\n- [ ] Task 1\n');
      const content = await memory.readHeartbeat();
      expect(content).toContain('Task 1');
    });

    it('should add task to HEARTBEAT.md', async () => {
      await memory.addTask('Write tests', 'daily');
      const content = await memory.readHeartbeat();
      expect(content).toContain('- [ ] Write tests');
      expect(content).toContain('(daily)');
    });

    it('should add task to existing Active Tasks section', async () => {
      await fs.writeFile(
        path.join(testDir, 'HEARTBEAT.md'),
        '# HEARTBEAT\n\n## Active Tasks\n- [ ] Existing task\n',
        'utf-8'
      );

      await memory.addTask('New task');
      const content = await memory.readHeartbeat();
      expect(content).toContain('Existing task');
      expect(content).toContain('New task');
    });
  });

  describe('conversation management (Hot/Warm)', () => {
    it('should add to hot buffer', async () => {
      await memory.appendConversation('user', 'Hello');
      const hot = memory.getHotConversations();
      expect(hot).toHaveLength(1);
      expect(hot[0].role).toBe('user');
      expect(hot[0].content).toBe('Hello');
    });

    it('should rotate hot buffer when exceeding limit', async () => {
      // Hot limit is 5
      for (let i = 0; i < 7; i++) {
        await memory.appendConversation('user', `Message ${i}`);
      }

      const hot = memory.getHotConversations();
      expect(hot).toHaveLength(5);
      expect(hot[0].content).toBe('Message 2');
      expect(hot[4].content).toBe('Message 6');
    });

    it('should write to daily notes (warm)', async () => {
      await memory.appendConversation('user', 'Test message');
      const daily = await memory.readDailyNotes();
      expect(daily).toContain('User: Test message');
    });

    it('should clear hot buffer', async () => {
      await memory.appendConversation('user', 'Hello');
      expect(memory.getHotConversations()).toHaveLength(1);

      memory.clearHotBuffer();
      expect(memory.getHotConversations()).toHaveLength(0);
    });
  });

  describe('searchMemory', () => {
    it('should find content with grep', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '# Memory\n\n## Patterns\n- TypeScript is great\n- Python is good\n',
        'utf-8'
      );

      const results = await memory.searchMemory('TypeScript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('TypeScript');
    });

    it('should return empty array for no matches', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '# Memory\n\nNothing here\n',
        'utf-8'
      );

      const results = await memory.searchMemory('nonexistent-query-xyz');
      expect(results).toHaveLength(0);
    });
  });

  describe('buildContext', () => {
    it('should include memory, conversations, and heartbeat', async () => {
      await fs.writeFile(
        path.join(testDir, 'MEMORY.md'),
        '## Knowledge\n- Important fact\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(testDir, 'HEARTBEAT.md'),
        '## Active Tasks\n- [ ] Do something\n',
        'utf-8'
      );
      await memory.appendConversation('user', 'Hi there');

      const context = await memory.buildContext();
      expect(context).toContain('<memory>');
      expect(context).toContain('Important fact');
      expect(context).toContain('<recent_conversations>');
      expect(context).toContain('Hi there');
      expect(context).toContain('<heartbeat>');
      expect(context).toContain('Do something');
    });

    it('should show no conversations message when buffer is empty', async () => {
      const context = await memory.buildContext();
      expect(context).toContain('(No recent conversations)');
    });
  });

  describe('warm rotation', () => {
    it('should trim daily notes exceeding warm limit', async () => {
      // Warm limit is 10
      for (let i = 0; i < 15; i++) {
        await memory.appendDailyNote(`Entry ${i}`);
      }

      const daily = await memory.readDailyNotes();
      const entryLines = daily.split('\n').filter(l => l.match(/^\[/));
      expect(entryLines.length).toBeLessThanOrEqual(10);
      // Should keep the latest entries
      expect(daily).toContain('Entry 14');
    });
  });
});
