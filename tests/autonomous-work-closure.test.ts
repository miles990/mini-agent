import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendMemoryIndexEntry, queryMemoryIndexSync } from '../src/memory-index.js';
import { sweepAutonomousWorkClosure, verifyAiTrendClosure } from '../src/autonomous-work-closure.js';

let memoryDir: string;
let repoRoot: string;

beforeEach(() => {
  memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-work-closure-memory-'));
  repoRoot = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-work-closure-repo-'));
});

afterEach(() => {
  rmSync(memoryDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('autonomous work closure', () => {
  it('detects ai-trend source/html closure gaps and queues an observable repair task', async () => {
    const date = taipeiDate();
    writeAiTrendState(repoRoot, date, {
      hn: ['HN 中文 claim'],
      latent: ['Latent 中文 claim'],
      arxiv: ['arXiv 中文 claim'],
      github: ['GitHub 中文 claim'],
      x: ['X 中文 claim'],
    });
    writeHtml(repoRoot, date, 'HN 中文 claim\nX / 社群熱議');
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'AI 簡報每篇加中文簡介/摘要',
      source: 'room',
      payload: { roomMsgId: 'room-1' },
    });

    expect(verifyAiTrendClosure(repoRoot).status).toBe('fail');
    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot });

    expect(result.productRepairsQueued).toBe(1);
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], source: 'autonomous-work-closure' })[0])
      .toEqual(expect.objectContaining({
        status: 'pending',
        summary: expect.stringContaining('Repair AI trend closure'),
        payload: expect.objectContaining({
          verify_command: expect.stringContaining('ai-trend-enrich-fallback.mjs'),
        }),
      }));
  });

  it('completes emitted expression tasks and releases non-provider expired holds back to pending', async () => {
    const now = new Date('2026-05-07T06:00:00.000Z');
    const expression = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'in_progress',
      source: 'room-promoted',
      summary: '[表達意圖] AI 簡報 → https://kuro.page/ai-trend/2026-05-07.html',
    });
    const hold = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'hold',
      source: 'middleware-self-healing',
      summary: 'Hold claude middleware delegation until provider quota resets',
      payload: { holdCondition: { type: 'date-after', value: '2026-05-07T05:00:00.000Z' } },
    });

    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot, now });

    expect(result.completedExpressionTasks).toBe(1);
    expect(result.releasedHolds).toBe(1);
    expect(queryMemoryIndexSync(memoryDir, { id: expression.id })[0].status).toBe('completed');
    expect(queryMemoryIndexSync(memoryDir, { id: hold.id })[0].status).toBe('pending');
  });

  it('completes elapsed provider quota holds instead of returning them to the P0 queue', async () => {
    const now = new Date('2026-05-08T06:00:00.000Z');
    const hold = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'hold',
      source: 'middleware-self-healing',
      summary: 'Hold claude middleware delegation until provider quota resets',
      payload: {
        holdCondition: { type: 'date-after', value: '2026-05-08T05:00:00.000Z' },
        provider_resource_hold: {
          type: 'provider-quota',
          provider: 'claude',
          resumeAt: '2026-05-08T05:00:00.000Z',
          reason: 'claude provider quota/resource exhausted; retry after 2026-05-08T05:00:00.000Z',
        },
      },
    });

    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot, now });

    expect(result.releasedHolds).toBe(1);
    expect(result.completedElapsedProviderHolds).toBe(0);
    expect(queryMemoryIndexSync(memoryDir, { id: hold.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
      payload: expect.objectContaining({
        completed_by: 'autonomous-work-closure',
        completed_reason: expect.stringContaining('should not return to the P0 queue'),
      }),
    }));
  });

  it('closes provider quota holds that were already released to pending', async () => {
    const now = new Date('2026-05-08T06:00:00.000Z');
    const hold = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      source: 'middleware-self-healing',
      summary: 'Hold claude middleware delegation until provider quota resets',
      payload: {
        provider_resource_hold: {
          type: 'provider-quota',
          provider: 'claude',
          resumeAt: '2026-05-08T05:00:00.000Z',
          reason: 'claude provider quota/resource exhausted; retry after 2026-05-08T05:00:00.000Z',
        },
        hold_released_by: 'autonomous-work-closure',
      },
    });

    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot, now });

    expect(result.completedElapsedProviderHolds).toBe(1);
    expect(queryMemoryIndexSync(memoryDir, { id: hold.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
      payload: expect.objectContaining({
        completed_reason: expect.stringContaining('already released'),
      }),
    }));
  });

  it('deduplicates active held correction tasks instead of letting P0 holds accumulate', async () => {
    const olderHold = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'hold',
      source: 'scheduler',
      summary: 'P0 correction gate: resolve low-responsiveness',
      payload: { origin: 'scheduler', priority: 0, correction_reason_type: 'low-responsiveness' },
    });
    const newerPending = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      source: 'scheduler',
      summary: 'P0 correction gate: resolve low-responsiveness',
      payload: { origin: 'scheduler', priority: 0, correction_reason_type: 'low-responsiveness' },
    });

    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot });

    expect(result.deduplicatedTasks).toBe(1);
    expect(queryMemoryIndexSync(memoryDir, { id: newerPending.id })[0].status).toBe('pending');
    expect(queryMemoryIndexSync(memoryDir, { id: olderHold.id })[0]).toEqual(expect.objectContaining({
      status: 'abandoned',
      payload: expect.objectContaining({
        pruned_reason: 'duplicate-active-work',
        canonical_task_id: newerPending.id,
      }),
    }));
  });

  it('closes product repair tasks once the verifier passes', async () => {
    const date = taipeiDate();
    writeAiTrendState(repoRoot, date, {
      hn: ['HN 中文 claim'],
      latent: ['Latent 中文 claim'],
      arxiv: ['arXiv 中文 claim'],
      github: ['GitHub 中文 claim'],
      x: ['X 中文 claim'],
    });
    writeHtml(repoRoot, date, 'HN 中文 claim\nLatent 中文 claim\narXiv 中文 claim\nGitHub 中文 claim\nX 中文 claim\nX / 社群熱議');
    const repair = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: `Repair AI trend closure: render all enriched source items for ${date}`,
      source: 'autonomous-work-closure',
      payload: { origin: 'autonomous-work-closure', product: 'ai-trend' },
    });

    const result = await sweepAutonomousWorkClosure(memoryDir, { repoRoot });

    expect(result.productRepairsClosed).toBe(1);
    expect(queryMemoryIndexSync(memoryDir, { id: repair.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
      payload: expect.objectContaining({ completed_by: 'autonomous-work-closure' }),
    }));
  });
});

function taipeiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function writeAiTrendState(repo: string, date: string, sources: Record<string, string[]>): void {
  const dirs: Record<string, string> = {
    hn: 'hn-ai-trend',
    latent: 'latent-space-trend',
    arxiv: 'arxiv-trend',
    github: 'github-trend',
    x: 'x-trend',
  };
  for (const [source, claims] of Object.entries(sources)) {
    const dir = path.join(repo, 'memory/state', dirs[source]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${date}.json`), JSON.stringify({
      run_at: new Date().toISOString(),
      posts: claims.map((claim, index) => ({
        title: `${source}-${index}`,
        url: `https://example.com/${source}/${index}`,
        summary: { claim },
      })),
    }), 'utf-8');
  }
}

function writeHtml(repo: string, date: string, body: string): void {
  const dir = path.join(repo, 'kuro-portfolio/ai-trend');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${date}.html`), `<html><body>${body}</body></html>`, 'utf-8');
}
