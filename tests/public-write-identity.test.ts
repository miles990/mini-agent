import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluatePublicWriteIdentity,
  publicWriteLedgerPath,
  recordPublicWriteProvenance,
} from '../src/public-write-identity.js';

describe('public write identity provenance', () => {
  it('blocks Kuro-intended public writes made by Alex-owned GitHub identity', () => {
    const memoryDir = mkMemoryDir();
    recordPublicWriteProvenance(memoryDir, {
      service: 'github',
      action: 'pr.create',
      subject: 'PR #261',
      actualActor: 'miles990',
      expectedActor: 'kuro-agent',
      source: 'codex-github-connector',
    });

    const snapshot = evaluatePublicWriteIdentity(memoryDir, {
      KURO_GITHUB_LOGIN: 'kuro-agent',
    } as NodeJS.ProcessEnv);

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.openMismatches[0]).toEqual(expect.objectContaining({
      service: 'github',
      actualActor: 'miles990',
      expectedActor: 'kuro-agent',
    }));
  });

  it('does not block resolved historical mismatches after the mechanism records resolution', () => {
    const memoryDir = mkMemoryDir();
    recordPublicWriteProvenance(memoryDir, {
      service: 'github',
      action: 'pr.create',
      subject: 'PR #261',
      actualActor: 'miles990',
      expectedActor: 'kuro-agent',
      source: 'codex-github-connector',
      status: 'resolved',
      resolution: 'connector path retired; future writes use Kuro-owned gh token',
    });

    const snapshot = evaluatePublicWriteIdentity(memoryDir, {
      KURO_GITHUB_LOGIN: 'kuro-agent',
    } as NodeJS.ProcessEnv);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.openMismatches).toHaveLength(0);
    expect(snapshot.recent).toHaveLength(1);
  });

  it('normalizes GitHub profile URLs and creates the ledger path', () => {
    const memoryDir = mkMemoryDir();
    const record = recordPublicWriteProvenance(memoryDir, {
      service: 'github',
      action: 'issue.create',
      subject: 'https://github.com/miles990/mini-agent/issues/1',
      actualActor: 'https://github.com/kuro-agent/',
      expectedActor: 'kuro-agent',
    });

    expect(record.actualActor).toBe('kuro-agent');
    expect(evaluatePublicWriteIdentity(memoryDir).status).toBe('ok');
    expect(publicWriteLedgerPath(memoryDir)).toContain('public-write-provenance.jsonl');
  });
});

function mkMemoryDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-public-write-'));
  mkdirSync(path.join(dir, 'index'), { recursive: true });
  return dir;
}
