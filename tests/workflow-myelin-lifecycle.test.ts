import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let previousMemoryDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-workflow-myelin-'));
  previousMemoryDir = process.env.MINI_AGENT_MEMORY_DIR;
  process.env.MINI_AGENT_MEMORY_DIR = tmpDir;
  vi.resetModules();
  writeWorkflowRules();
});

afterEach(() => {
  if (previousMemoryDir === undefined) delete process.env.MINI_AGENT_MEMORY_DIR;
  else process.env.MINI_AGENT_MEMORY_DIR = previousMemoryDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow myelin lifecycle integration', () => {
  it('records rule-hit workflow decisions into the configured memory root', async () => {
    const { triageWorkflowEvent } = await import('../src/myelin-fleet.js');
    const { getMyelinStatus } = await import('../src/myelin-status.js');

    const result = await triageWorkflowEvent({
      type: 'task-done',
      source: 'ooda-cycle',
      context: { verified: true, taskId: 'idx-test' },
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'mark-and-continue',
      method: 'rule',
    }));

    const log = readFileSync(path.join(tmpDir, 'myelin-workflow-decisions.jsonl'), 'utf-8');
    expect(log).toContain('"method":"rule"');
    expect(log).toContain('"action":"mark-and-continue"');
    expect(getMyelinStatus(tmpDir, 10).domains.find(domain => domain.name === 'workflow')?.health).toBe('effective');
  });

  it('feeds task creation into workflow rules instead of leaving workflow idle', async () => {
    const { appendMemoryIndexEntry } = await import('../src/memory-index.js');

    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'needs-decomposition',
      summary: '改善整套跨模組流程',
      refs: [],
      payload: { needs_decomposition: true },
    });

    const logPath = path.join(tmpDir, 'myelin-workflow-decisions.jsonl');
    await waitFor(() => existsSync(logPath) && readFileSync(logPath, 'utf-8').includes('"action":"write-proposal"'));

    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain('"method":"rule"');
    expect(log).toContain('"action":"write-proposal"');
  });
});

function writeWorkflowRules(): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, 'myelin-workflow-rules.json'), JSON.stringify([
    {
      id: 'workflow_proposal_gate',
      match: {
        type: 'task-start',
        source: 'ooda-cycle',
        context: {
          ideaClarity: 'vague',
          fileImpact: { gte: 3 },
        },
      },
      action: 'write-proposal',
      reason: 'vague task touching several files should write proposal',
      createdAt: '2026-05-07T00:00:00.000Z',
      hitCount: 0,
    },
    {
      id: 'workflow_immediate_completion',
      match: {
        type: 'task-done',
        source: 'ooda-cycle',
        context: { verified: true },
      },
      action: 'mark-and-continue',
      reason: 'verified completion should immediately mark and continue',
      createdAt: '2026-05-07T00:00:00.000Z',
      hitCount: 0,
    },
  ], null, 2), 'utf-8');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}
