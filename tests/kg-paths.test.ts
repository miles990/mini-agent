import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getKgLiveIngestPaths } from '../src/kg-live-ingest.js';
import { getCachePathForAgent } from '../src/kg-memory.js';

const originalMemoryDir = process.env.MINI_AGENT_MEMORY_DIR;

afterEach(() => {
  if (originalMemoryDir === undefined) delete process.env.MINI_AGENT_MEMORY_DIR;
  else process.env.MINI_AGENT_MEMORY_DIR = originalMemoryDir;
});

describe('KG path placement', () => {
  it('places live ingest logs under the configured external memory index', () => {
    const paths = getKgLiveIngestPaths('/external/memory');

    expect(paths.logPath).toBe(path.join('/external/memory', 'index', 'live-ingest-log.jsonl'));
    expect(paths.errorsPath).toBe(path.join('/external/memory', 'index', 'ingest-errors.jsonl'));
    expect(paths.pushStatePath).toBe(path.join('/external/memory', 'index', 'kg-push-state.json'));
  });

  it('uses MINI_AGENT_MEMORY_DIR for kuro KG cache instead of the runtime checkout', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-memory-'));
    process.env.MINI_AGENT_MEMORY_DIR = memoryDir;

    expect(getCachePathForAgent('kuro')).toBe(path.join(memoryDir, 'state', 'kg-memory-cache.jsonl'));

    rmSync(memoryDir, { recursive: true, force: true });
  });
});
