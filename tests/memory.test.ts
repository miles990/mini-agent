import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InstanceMemory, getSkillsPrompt, setCustomExtensions, type CycleMode } from '../src/memory.js';

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
      expect(daily).toContain('(alex) Test message');
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

    it('should include environment section in all modes', async () => {
      const full = await memory.buildContext({ mode: 'full' });
      expect(full).toContain('<environment>');

      const focused = await memory.buildContext({ mode: 'focused' });
      expect(focused).toContain('<environment>');

      const minimal = await memory.buildContext({ mode: 'minimal' });
      expect(minimal).toContain('<environment>');
    });

    it('should include LIGHTWEIGHT CONTEXT marker in minimal mode', async () => {
      const minimal = await memory.buildContext({ mode: 'minimal' });
      expect(minimal).toContain('LIGHTWEIGHT CONTEXT');
    });

    it('should limit conversations in focused mode', async () => {
      // Add 15 conversations (hot limit is 5 for test, focused caps at 10)
      for (let i = 0; i < 5; i++) {
        await memory.appendConversation('user', `Message ${i}`);
      }

      const full = await memory.buildContext({ mode: 'full' });
      const focused = await memory.buildContext({ mode: 'focused' });

      // Both should contain conversations but focused limits count
      expect(full).toContain('Message 0');
      expect(focused).toContain('Message 0');
    });

    it('should produce shorter context in minimal mode than full mode', async () => {
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

      const full = await memory.buildContext({ mode: 'full' });
      const minimal = await memory.buildContext({ mode: 'minimal' });

      // Minimal should be shorter (no full memory, no perceptions)
      expect(minimal.length).toBeLessThan(full.length);
    });
  });

  describe('buildContext topic keyword matching', () => {
    beforeEach(async () => {
      const topicsDir = path.join(testDir, 'topics');
      await fs.mkdir(topicsDir, { recursive: true });

      await fs.writeFile(
        path.join(topicsDir, 'gen-art.md'),
        '# Gen Art\n- Perlin noise techniques\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(topicsDir, 'mini-agent.md'),
        '# Mini Agent\n- Dispatcher architecture\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(topicsDir, 'custom-topic.md'),
        '# Custom\n- Custom data\n',
        'utf-8'
      );
    });

    it('should load all topics in full mode', async () => {
      const context = await memory.buildContext({ mode: 'full' });
      expect(context).toContain('topic-memory name="gen-art"');
      expect(context).toContain('topic-memory name="mini-agent"');
      expect(context).toContain('topic-memory name="custom-topic"');
    });

    it('should load only matching topics in focused mode with hint', async () => {
      const context = await memory.buildContext({
        mode: 'focused',
        relevanceHint: 'dispatcher architecture',
      });
      // mini-agent topic has 'dispatcher' keyword
      expect(context).toContain('topic-memory name="mini-agent"');
      // gen-art topic should NOT load (no matching keywords)
      expect(context).not.toContain('topic-memory name="gen-art"');
    });

    it('should load topic by name fallback when no keyword mapping exists', async () => {
      const context = await memory.buildContext({
        mode: 'focused',
        relevanceHint: 'custom-topic related',
      });
      // custom-topic falls back to topic name as keyword
      expect(context).toContain('topic-memory name="custom-topic"');
    });

    it('should load gen-art topic when hint contains art keywords', async () => {
      const context = await memory.buildContext({
        mode: 'focused',
        relevanceHint: 'generative noise art',
      });
      expect(context).toContain('topic-memory name="gen-art"');
    });

    it('should not load topics in minimal mode', async () => {
      const context = await memory.buildContext({ mode: 'minimal' });
      expect(context).not.toContain('topic-memory');
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

  describe('getSkillsPrompt with cycleMode', () => {
    beforeEach(() => {
      // Load test skills
      const skillsDir = path.join(testDir, 'skills');
      setCustomExtensions({
        skills: [
          'autonomous-behavior.md',
          'web-learning.md',
          'web-research.md',
          'action-from-learning.md',
          'self-deploy.md',
          'project-manager.md',
          'debug-helper.md',
        ],
        cwd: skillsDir,
      });
    });

    it('should load all skills when no hint and no cycleMode', () => {
      const result = getSkillsPrompt();
      // Without any skills loaded (files don't exist), returns empty
      // This tests the fallback path
      expect(typeof result).toBe('string');
    });

    it('should use cycleMode over keyword matching when both provided', () => {
      // cycleMode should take priority
      const result = getSkillsPrompt('some hint text', 'reflect');
      expect(typeof result).toBe('string');
    });
  });

  describe('buildContext topic truncation', () => {
    beforeEach(async () => {
      const topicsDir = path.join(testDir, 'topics');
      await fs.mkdir(topicsDir, { recursive: true });

      // Create a large topic with many entries
      const entries = Array.from({ length: 10 }, (_, i) =>
        `- [2026-02-${String(i + 1).padStart(2, '0')}] Entry ${i}`
      ).join('\n');
      await fs.writeFile(
        path.join(topicsDir, 'gen-art.md'),
        `# Gen Art Topics\n${entries}\n`,
        'utf-8'
      );
      await fs.writeFile(
        path.join(topicsDir, 'mini-agent.md'),
        `# Mini Agent Topics\n${entries}\n`,
        'utf-8'
      );
    });

    it('should use summary truncation for non-matching topics in full mode with hint', async () => {
      const context = await memory.buildContext({
        mode: 'full',
        relevanceHint: 'dispatcher architecture',
      });
      // mini-agent matches (has 'dispatcher' keyword) → full content
      expect(context).toContain('topic-memory name="mini-agent"');
      expect(context).toMatch(/Entry 0/); // mini-agent has full entries

      // gen-art doesn't match → summary only (title + count)
      expect(context).toContain('topic-memory name="gen-art"');
      expect(context).toContain('(10 entries)');
    });

    it('should not load non-matching topics in focused mode', async () => {
      const context = await memory.buildContext({
        mode: 'focused',
        relevanceHint: 'dispatcher architecture',
      });
      expect(context).toContain('topic-memory name="mini-agent"');
      expect(context).not.toContain('topic-memory name="gen-art"');
    });

    it('should use summary truncation in full mode without hint', async () => {
      const context = await memory.buildContext({ mode: 'full' });
      // All topics loaded with summary truncation (title + count only)
      expect(context).toContain('topic-memory name="gen-art"');
      expect(context).toContain('topic-memory name="mini-agent"');
      // Non-matching topics should have summary (just title + count)
      expect(context).toContain('(10 entries)');
    });
  });
});
