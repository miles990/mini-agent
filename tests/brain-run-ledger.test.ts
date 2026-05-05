import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendBrainRunEvent,
  getBrainRunLedgerPath,
  readBrainRunEventsSync,
  readBrainRunStatesSync,
} from '../src/brain-run-ledger.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-brain-runs-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('brain run ledger', () => {
  it('appends observable multi-brain state as JSONL records', () => {
    const event = appendBrainRunEvent(tmpDir, {
      id: 'evt-1',
      taskId: 'del-1',
      event: 'actor_started',
      status: 'running',
      actor: 'codex',
      role: 'reviewer',
      mode: 'panel',
      primary: 'kuro',
      rationale: 'review due to arbitration',
      contextSources: ['myelin'],
      contextPreview: ['routing: prefer foreground'],
      createdAt: '2026-05-05T00:00:00.000Z',
    });

    expect(getBrainRunLedgerPath(tmpDir)).toBe(path.join(tmpDir, 'index', 'brain-runs.jsonl'));
    expect(readBrainRunEventsSync(tmpDir)).toEqual([event]);
  });

  it('queries by task, actor, event, and status', () => {
    appendBrainRunEvent(tmpDir, {
      id: 'evt-1',
      taskId: 'del-1',
      event: 'actor_finished',
      status: 'success',
      actor: 'claude',
      role: 'reviewer',
      createdAt: '2026-05-05T00:00:00.000Z',
    });
    appendBrainRunEvent(tmpDir, {
      id: 'evt-2',
      taskId: 'del-2',
      event: 'actor_finished',
      status: 'failed',
      actor: 'codex',
      role: 'reviewer',
      createdAt: '2026-05-05T00:01:00.000Z',
    });

    expect(readBrainRunEventsSync(tmpDir, { taskId: 'del-1' })).toEqual([
      expect.objectContaining({ id: 'evt-1' }),
    ]);
    expect(readBrainRunEventsSync(tmpDir, { actor: 'codex' })).toEqual([
      expect.objectContaining({ id: 'evt-2' }),
    ]);
    expect(readBrainRunEventsSync(tmpDir, { event: 'actor_finished', status: 'success' })).toEqual([
      expect.objectContaining({ id: 'evt-1' }),
    ]);
  });

  it('reconstructs latest observable state instead of treating historical running events as current', () => {
    appendBrainRunEvent(tmpDir, {
      id: 'evt-1',
      taskId: 'del-1',
      event: 'actor_started',
      status: 'running',
      actor: 'codex',
      role: 'reviewer',
      createdAt: '2026-05-05T00:00:00.000Z',
    });
    appendBrainRunEvent(tmpDir, {
      id: 'evt-2',
      taskId: 'del-1',
      event: 'actor_finished',
      status: 'success',
      actor: 'codex',
      role: 'reviewer',
      createdAt: '2026-05-05T00:01:00.000Z',
    });

    expect(readBrainRunStatesSync(tmpDir, { actor: 'codex' })).toEqual([
      expect.objectContaining({
        key: 'del-1:codex',
        status: 'success',
        lastEvent: 'actor_finished',
      }),
    ]);
    expect(readBrainRunStatesSync(tmpDir, { actor: 'codex', status: 'running' })).toEqual([]);
  });
});
