import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rotateDecisionLogs } from '../src/decision-log-rotation.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-decision-rotation-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('rotateDecisionLogs', () => {
  it('archives old JSONL entries in compressed chunks and keeps the active file under the cap', () => {
    const file = 'myelin-decisions.jsonl';
    writeLines(file, Array.from({ length: 20 }, (_, i) => ({
      _type: 'decision',
      ts: `2026-05-07T00:${String(i).padStart(2, '0')}:00.000Z`,
      action: `action-${i}`,
      reason: 'x'.repeat(40),
    })));

    const [result] = rotateDecisionLogs({
      memoryDir: tmpDir,
      files: [file],
      maxBytes: 500,
      now: new Date('2026-05-07T01:02:03.000Z'),
    });

    expect(result.skipped).toBe(false);
    expect(result.archives.length).toBeGreaterThan(0);
    expect(result.archivedLines + result.keptLines).toBe(20);

    const activePath = path.join(tmpDir, file);
    expect(fs.statSync(activePath).size).toBeLessThanOrEqual(500);
    const activeLines = fs.readFileSync(activePath, 'utf-8').trim().split('\n');
    expect(activeLines.at(-1)).toContain('action-19');

    const archivedText = result.archives
      .map(archive => gunzipSync(fs.readFileSync(archive)).toString('utf-8'))
      .join('');
    expect(archivedText).toContain('action-0');
    expect(result.archives[0]).toContain('myelin-decisions-20260507T010203Z-part01.jsonl.gz');
  });

  it('skips files already below the cap', () => {
    writeLines('research-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-07T00:00:00.000Z', action: 'normal' },
    ]);

    const [result] = rotateDecisionLogs({
      memoryDir: tmpDir,
      files: ['research-decisions.jsonl'],
      maxBytes: 10_000,
    });

    expect(result.skipped).toBe(true);
    expect(result.archives).toEqual([]);
  });
});

function writeLines(file: string, records: unknown[]): void {
  const filePath = path.join(tmpDir, file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
}
