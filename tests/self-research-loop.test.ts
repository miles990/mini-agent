import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSelfResearchPlan,
  formatSelfResearchPlan,
  saveSelfResearchPlan,
} from '../src/self-research-loop.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-self-research-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('self research loop', () => {
  it('creates artifact-required knowledge improvement plans', () => {
    const run = createSelfResearchPlan(tmpDir, {
      domain: 'knowledge',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(run).toEqual(expect.objectContaining({
      id: 'self-research-202605050000-knowledge_understanding',
      domain: 'knowledge',
      target: 'knowledge_understanding',
      intervention: 'concept_map',
      artifactRequired: true,
      artifactType: 'concept map markdown',
    }));
    expect(run.artifactPath).toBe(path.join(tmpDir, 'topics/self-research-202605050000-knowledge_understanding-knowledge-map.md'));
    expect(run.generateStep).toContain('concept map');
    expect(run.testStep).toContain('application question');
    expect(run.learning).toContain('KG');
    expect(run.kgLinks).toEqual(expect.arrayContaining(['knowledge-graph', 'concept-map']));
  });

  it('writes a markdown plan with artifact and learning sections', () => {
    const run = createSelfResearchPlan(tmpDir, {
      domain: 'interest',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    const filePath = saveSelfResearchPlan(tmpDir, run);
    const rendered = formatSelfResearchPlan(run);

    expect(filePath).toBe(path.join(tmpDir, 'proposals/self-research-202605050000-interest_deepening.md'));
    expect(rendered).toContain('## Required Artifact');
    expect(rendered).toContain('## Learning Return');
    expect(rendered).toContain('## Next Iteration');
    expect(rendered).toContain('artifact');
  });

  it('prioritizes system repair when pending improvements exist', () => {
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'state/pending-improvements.jsonl'),
      JSON.stringify({ kind: 'failed_delegation', status: 'pending' }) + '\n',
      'utf-8',
    );

    const run = createSelfResearchPlan(tmpDir, {
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(run.domain).toBe('system');
    expect(run.target).toBe('system_reliability');
    expect(run.baseline).toContain('pending_improvements=1');
  });

  it('chooses knowledge work when topic memory is rich and capability telemetry is present', () => {
    mkdirSync(path.join(tmpDir, 'topics'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(path.join(tmpDir, 'topics', `topic-${index}.md`), '# Topic\n', 'utf-8');
    }
    writeFileSync(
      path.join(tmpDir, 'index/brain-runs.jsonl'),
      [
        JSON.stringify({ kind: 'context_injected' }),
        JSON.stringify({ kind: 'context_injected' }),
        JSON.stringify({ kind: 'context_injected' }),
      ].join('\n') + '\n',
      'utf-8',
    );

    const run = createSelfResearchPlan(tmpDir, {
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(run.domain).toBe('knowledge');
    expect(run.target).toBe('knowledge_understanding');
    expect(run.baseline).toContain('topic_files=5');
  });
});
