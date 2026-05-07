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

  it('completes emitted expression tasks and releases expired holds', async () => {
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
