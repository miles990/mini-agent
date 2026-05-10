import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyHeartbeatCronActionability,
  cronGate,
  getGateStats,
  resetGateStats,
} from '../src/omlx-gate.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-omlx-gate-'));
  mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
  vi.stubEnv('MINI_AGENT_MEMORY_DIR', tmpDir);
  resetGateStats();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetGateStats();
});

describe('classifyHeartbeatCronActionability', () => {
  it('ignores blocked, waiting, and low-priority HEARTBEAT items for cron wakeups', () => {
    const result = classifyHeartbeatCronActionability([
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] **B3 Arena**: 需 Alex 觸發 c3 generation 拉 n。',
      '- [ ] P2: ai-trend Path 2 — add TrendRadar lane。等 Alex confirm scope 再動。',
      '- [ ] 深讀 ArXiv 1 篇 → research and form opinion。',
    ].join('\n'));

    expect(result.uncheckedLines).toHaveLength(3);
    expect(result.actionableLines).toEqual([]);
    expect(result.blockedLines).toHaveLength(2);
    expect(result.lowPriorityLines).toHaveLength(1);
  });

  it('allows only high-priority non-blocked executable items through to Claude', () => {
    const result = classifyHeartbeatCronActionability([
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] P1: fix duplicate scheduler dispatch and run tests.',
      '- [ ] P0 Repair autonomy closure: implement runtime-workspace guard.',
    ].join('\n'));

    expect(result.actionableLines).toHaveLength(2);
  });
});

describe('cronGate', () => {
  it('skips HEARTBEAT cron when unchecked items are not cron-actionable', () => {
    writeFileSync(path.join(tmpDir, 'HEARTBEAT.md'), [
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] **B3 Arena**: 需 Alex 觸發 c3 generation 拉 n。',
      '- [ ] P2: ai-trend Path 2 — update preview。等 Alex confirm scope 再動。',
    ].join('\n'), 'utf-8');

    expect(cronGate('Check HEARTBEAT.md for pending tasks and execute them if any')).toBe('skip');
    expect(getGateStats().cronSkipped).toBe(1);
  });

  it('passes high-priority executable HEARTBEAT tasks to Claude', () => {
    writeFileSync(path.join(tmpDir, 'HEARTBEAT.md'), [
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] P1: fix token routing gate and run pnpm test.',
    ].join('\n'), 'utf-8');

    expect(cronGate('Check HEARTBEAT.md for pending tasks and execute them if any')).toBe('claude');
    expect(getGateStats().cronPassed).toBe(1);
  });
});
