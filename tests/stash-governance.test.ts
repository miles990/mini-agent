import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyStash, governGitStashes, type GitStashRecord } from '../src/stash-governance.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

describe('stash governance', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-stash-governance-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('routes ai-trend generated stash conflicts to regeneration, not HTML merge', () => {
    const diagnostic = classifyStash(aiTrendStash());

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'regenerate-generated-artifacts',
      rootCause: expect.stringContaining('Generated ai-trend HTML'),
      mechanicalAction: 'rerender-ai-trend-from-current-source',
      fallbackTask: expect.objectContaining({
        verifyCommand: expect.stringContaining('build-ai-trend-preview.mjs'),
      }),
    }));
    expect(diagnostic.assessment.conflicted.map(file => file.class)).toEqual(['generated', 'generated', 'generated']);
  });

  it('classifies already-absorbed stashes as drop candidates without creating fallback work', () => {
    const diagnostic = classifyStash({
      ...aiTrendStash(),
      absorbed: true,
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'drop-absorbed',
      rootCause: expect.stringContaining('already matches'),
      mechanicalAction: 'drop-absorbed-stash',
      fallbackTask: null,
    }));
  });

  it('creates one scheduler-visible diagnostic task for a preserved generated stash', async () => {
    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state'), { recursive: true });
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', { encoding: 'utf-8', flag: 'w' });

    const first = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [aiTrendStash()],
    });
    const second = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [aiTrendStash()],
    });

    expect(first.createdTasks).toHaveLength(1);
    expect(second.createdTasks).toHaveLength(0);
    const tasks = queryMemoryIndexSync(memoryDir, { type: 'task' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(expect.objectContaining({
      status: 'pending',
      summary: expect.stringContaining('regenerate ai-trend artifact'),
    }));
    expect(tasks[0].payload).toEqual(expect.objectContaining({
      verify_command: expect.stringContaining('stash-governance.ts'),
      acceptance_criteria: expect.stringContaining('no generated HTML is manually merged'),
    }));
  });
});

function aiTrendStash(): GitStashRecord {
  return {
    ref: 'stash@{0}',
    message: 'On runtime/main: keep-ai-trend-dirty',
    files: [
      'kuro-portfolio/ai-trend/2026-05-08.html',
      'kuro-portfolio/ai-trend/index.html',
      'kuro-portfolio/ai-trend/preview.html',
    ],
  };
}
