import { describe, expect, it } from 'vitest';

import {
  buildMemoryRepoHealthReport,
  classifyMemoryRepoPath,
  CONTEXT_FABRIC_DESIGN,
  formatMemoryRepoHealthMarkdown,
} from '../src/memory-repo-policy.js';

describe('memory repo policy', () => {
  it('keeps runtime state, context checkpoints, raw logs, and caches out of tracked memory', () => {
    expect(classifyMemoryRepoPath('state/activity-journal.jsonl')).toMatchObject({
      klass: 'runtime-state',
      track: false,
    });
    expect(classifyMemoryRepoPath('context-checkpoints/2026-05-06.jsonl')).toMatchObject({
      klass: 'cache',
      track: false,
    });
    expect(classifyMemoryRepoPath('logs/api.jsonl')).toMatchObject({
      klass: 'raw-log',
      track: false,
    });
    expect(classifyMemoryRepoPath('MEMORY.md')).toMatchObject({
      klass: 'curated-knowledge',
      track: true,
    });
  });

  it('surfaces curated Markdown as KG candidates for shared semantic memory', () => {
    const report = buildMemoryRepoHealthReport('/memory', [
      { relPath: 'MEMORY.md', bytes: 1200 },
      { relPath: 'topics/kg.md', bytes: 2400 },
      { relPath: 'context-checkpoints/2026-05-06.jsonl', bytes: 9000 },
      { relPath: 'state/activity-journal.jsonl', bytes: 5000 },
    ], '2026-05-06T00:00:00.000Z');

    expect(report.totals.trackableFiles).toBe(2);
    expect(report.totals.ignoredFiles).toBe(2);
    expect(report.kgCandidates.map(file => file.relPath)).toEqual(['topics/kg.md', 'MEMORY.md']);

    const markdown = formatMemoryRepoHealthMarkdown(report);
    expect(markdown).toContain('## KG Candidates');
    expect(markdown).toContain('topics/kg.md');
  });

  it('documents that context promotion to memory requires provenance and confidence', () => {
    expect(CONTEXT_FABRIC_DESIGN).toContain('Context can become memory only after');
    expect(CONTEXT_FABRIC_DESIGN).toContain('provenance');
    expect(CONTEXT_FABRIC_DESIGN).toContain('confidence');
    expect(CONTEXT_FABRIC_DESIGN).toContain('Low-confidence or conflicting memories');
  });
});
