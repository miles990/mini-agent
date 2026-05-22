import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inboxCache, markInboxProcessed, readPendingInbox, readUnrepliedInbox, writeInboxItem } from '../src/inbox.js';

describe('unified inbox unreplied recovery', () => {
  let dataDir: string;
  const oldDataDir = process.env.MINI_AGENT_DATA_DIR;
  const oldInstance = process.env.MINI_AGENT_INSTANCE;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-inbox-unreplied-'));
    process.env.MINI_AGENT_DATA_DIR = dataDir;
    process.env.MINI_AGENT_INSTANCE = 'test';
    inboxCache.invalidate();
  });

  afterEach(async () => {
    if (oldDataDir === undefined) delete process.env.MINI_AGENT_DATA_DIR;
    else process.env.MINI_AGENT_DATA_DIR = oldDataDir;
    if (oldInstance === undefined) delete process.env.MINI_AGENT_INSTANCE;
    else process.env.MINI_AGENT_INSTANCE = oldInstance;
    inboxCache.invalidate();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('keeps seen direct messages in the unreplied recovery set', async () => {
    const id = writeInboxItem({
      source: 'room',
      from: 'alex',
      content: '剛剛看到這個 https://example.com/art',
    });
    expect(id).toBeTruthy();

    markInboxProcessed([id!], 'seen');

    expect(readPendingInbox()).toEqual([]);
    expect(readUnrepliedInbox({ hoursBack: 4, sources: ['room'] }).map(i => i.id)).toEqual([id]);
  });
});
