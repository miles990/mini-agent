import { describe, expect, it } from 'vitest';
import {
  assessConflicts,
  classifyConflictPath,
  mergeAppendOnlyText,
} from '../src/conflict-governance.js';

describe('conflict governance', () => {
  it('allows append-only memory conflicts to use append-union resolution', () => {
    expect(classifyConflictPath('memory/inner-notes.md')).toEqual(expect.objectContaining({
      class: 'append-only-memory',
      autoResolvable: true,
      resolution: 'append-union',
    }));
    expect(classifyConflictPath('memory/topics/kuro.md')).toEqual(expect.objectContaining({
      class: 'append-only-memory',
      autoResolvable: true,
    }));
  });

  it('requires manual review for code and config conflicts', () => {
    expect(classifyConflictPath('src/github.ts')).toEqual(expect.objectContaining({
      class: 'code',
      autoResolvable: false,
      resolution: 'manual-review',
    }));
    expect(classifyConflictPath('agent-compose.yaml')).toEqual(expect.objectContaining({
      class: 'config',
      autoResolvable: false,
    }));
  });

  it('classifies generated conflicts as regenerate, not auto merge', () => {
    expect(classifyConflictPath('dist/github.js')).toEqual(expect.objectContaining({
      class: 'generated',
      autoResolvable: false,
      resolution: 'regenerate',
    }));
  });

  it('blocks whenever unresolved conflicts exist and separates auto/manual sets', () => {
    const assessment = assessConflicts([
      'memory/inner-notes.md',
      'src/github.ts',
    ]);

    expect(assessment.shouldBlock).toBe(true);
    expect(assessment.autoResolvable.map(f => f.path)).toEqual(['memory/inner-notes.md']);
    expect(assessment.manual.map(f => f.path)).toEqual(['src/github.ts']);
  });

  it('merges append-only text by preserving both sides and deduplicating exact lines', () => {
    expect(mergeAppendOnlyText('a\nb\n', 'b\nc\n')).toBe('a\nb\nc\n');
  });
});
