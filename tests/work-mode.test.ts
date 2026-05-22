import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkMode, resolveWorkMode, setWorkMode } from '../src/work-mode.js';

let tempDir = '';
const oldDataDir = process.env.MINI_AGENT_DATA_DIR;
const oldInstance = process.env.MINI_AGENT_INSTANCE;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-work-mode-'));
  process.env.MINI_AGENT_DATA_DIR = tempDir;
  process.env.MINI_AGENT_INSTANCE = 'test';
});

afterEach(() => {
  if (oldDataDir === undefined) delete process.env.MINI_AGENT_DATA_DIR;
  else process.env.MINI_AGENT_DATA_DIR = oldDataDir;
  if (oldInstance === undefined) delete process.env.MINI_AGENT_INSTANCE;
  else process.env.MINI_AGENT_INSTANCE = oldInstance;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('work mode', () => {
  it('defaults to maintenance mode', () => {
    const report = getWorkMode();

    expect(report.mode).toBe('maintenance');
    expect(report.baseMode).toBe('maintenance');
    expect(report.temporary).toBe(false);
  });

  it('temporarily switches creative mode to maintenance for urgent work, then returns', () => {
    setWorkMode('creative');

    const urgent = resolveWorkMode({ hasP0Event: true });
    expect(urgent.mode).toBe('maintenance');
    expect(urgent.baseMode).toBe('creative');
    expect(urgent.temporary).toBe(true);

    const cleared = resolveWorkMode({ hasP0Event: false, hasP0Tasks: false });
    expect(cleared.mode).toBe('creative');
    expect(cleared.baseMode).toBe('creative');
    expect(cleared.temporary).toBe(false);
  });
});
