import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendKGPromotionRecord,
  buildKGPromotionCandidates,
  candidateToKGTriple,
  readKGPromotionRecords,
  summarizeKGPromotions,
} from '../src/kg-promotion.js';
import { buildMemoryRepoHealthReport } from '../src/memory-repo-policy.js';

describe('KG memory promotion', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-kg-promotion-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('promotes only curated markdown candidates from memory repo policy', () => {
    writeFileSync(path.join(tmpDir, 'MEMORY.md'), '# Durable Memory\n\nThis memory contains reusable context for future behavior and decisions.\n');
    writeFileSync(path.join(tmpDir, 'live-ingest-log.jsonl'), '{"raw":true}\n');
    const report = buildMemoryRepoHealthReport(tmpDir, [
      { relPath: 'MEMORY.md', bytes: 86 },
      { relPath: 'live-ingest-log.jsonl', bytes: 13 },
    ], '2026-05-06T00:00:00.000Z');

    const candidates = buildKGPromotionCandidates(tmpDir, report.kgCandidates, 10);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      relPath: 'MEMORY.md',
      title: 'Durable Memory',
      scope: 'private',
      confidence: 0.85,
    });
  });

  it('preserves provenance, confidence, and epistemic status in triples', () => {
    writeFileSync(path.join(tmpDir, 'topic.md'), '# KG Fabric\n\nThis note explains how memory becomes reliable context through provenance.\n');
    const candidate = buildKGPromotionCandidates(tmpDir, [{
      relPath: 'topic.md',
      bytes: 86,
      klass: 'curated-knowledge',
      track: true,
      reason: 'test',
    }], 1)[0];

    const triple = candidateToKGTriple(candidate, { namespace: 'shared', sourceAgent: 'kuro' });

    expect(triple.predicate).toBe('context_anchor_for');
    expect(triple.namespace).toBe('shared');
    expect(triple.properties).toMatchObject({
      source_file: 'topic.md',
      provenance: 'memory-repo',
      epistemic_status: 'candidate',
      memory_type: 'curated-markdown',
    });
    expect(typeof triple.properties.source_sha1).toBe('string');
  });

  it('writes an observable promotion ledger summary', () => {
    appendKGPromotionRecord(tmpDir, {
      ts: '2026-05-06T01:00:00.000Z',
      status: 'promoted',
      relPath: 'MEMORY.md',
      title: 'Memory',
      sha1: 'abc',
      confidence: 0.85,
      scope: 'private',
    });
    appendKGPromotionRecord(tmpDir, {
      ts: '2026-05-06T01:01:00.000Z',
      status: 'failed',
      relPath: 'topics/kg.md',
      title: 'KG',
      sha1: 'def',
      confidence: 0.72,
      scope: 'private',
      error: 'offline',
    });

    const records = readKGPromotionRecords(tmpDir, 10);
    const summary = summarizeKGPromotions(records);

    expect(records.map(record => record.relPath)).toEqual(['topics/kg.md', 'MEMORY.md']);
    expect(summary).toMatchObject({ total: 2, promoted: 1, failed: 1 });
    expect(summary.latestAt).toBe('2026-05-06T01:01:00.000Z');
  });
});
