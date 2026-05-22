import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDesignArtifactTemplate,
  evaluateDesignGovernance,
} from '../src/design-governance.js';
import type { MemoryIndexEntry } from '../src/memory-index.js';

describe('design governance', () => {
  it('blocks active high-risk implementation without a design artifact', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'in_progress',
        summary: 'P1 autonomy closure: repair scheduler data flow convergence',
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('blocked');
    expect(report.missingArtifacts[0]).toEqual(expect.objectContaining({
      taskId: 'idx-design-test',
      depth: 'deep',
    }));
    expect(report.evidence[0]).toContain('missing design artifact');
  });

  it('warns pending high-risk work so planning happens before implementation', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'pending',
        summary: 'P1 middleware workflow repair',
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('warn');
    expect(report.summary).toBe('1 missing and 0 incomplete design artifact(s)');
  });

  it('accepts a complete design artifact with diagrams and executable closure sections', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const artifactDir = path.join(memoryDir, 'proposals', 'design-artifacts');
    mkdirSync(artifactDir, { recursive: true });
    const entry = task({
      status: 'in_progress',
      summary: 'P1 KG context fabric state machine repair',
      tags: ['kg', 'state-machine'],
      payload: { priority: 1 },
    });
    writeFileSync(
      path.join(artifactDir, `${entry.id}.md`),
      buildDesignArtifactTemplate(entry),
      'utf-8',
    );

    const report = evaluateDesignGovernance(memoryDir, [entry]);

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('1 high-risk task(s) have design governance');
  });

  it('flags incomplete artifacts instead of treating any markdown as sufficient', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const artifactDir = path.join(memoryDir, 'proposals', 'design-artifacts');
    mkdirSync(artifactDir, { recursive: true });
    const entry = task({
      status: 'in_progress',
      summary: 'P1 dashboard state machine redesign',
      payload: { priority: 1 },
    });
    writeFileSync(path.join(artifactDir, `${entry.id}.md`), `# ${entry.summary}\n\nTask: ${entry.id}\n`, 'utf-8');

    const report = evaluateDesignGovernance(memoryDir, [entry]);

    expect(report.status).toBe('blocked');
    expect(report.incompleteArtifacts[0].missingSections).toEqual(expect.arrayContaining([
      'Constraint Texture',
      'Mermaid Diagram',
      'Effect Backtest',
    ]));
  });

  it('allows explicit trivial exemptions for one-line work', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'in_progress',
        summary: 'P1 scheduler typo fix',
        payload: { priority: 1, design_depth: 'trivial' },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.missingArtifacts).toHaveLength(0);
  });

  it('exempts middleware-self-healing origin tasks from design governance', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'pending',
        summary: 'Create fallback for middleware task after provider budget hold',
        tags: ['middleware', 'self-healing', 'budget-or-quota'],
        payload: { origin: 'middleware-self-healing', priority: 1 },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.missingArtifacts).toHaveLength(0);
  });

  it('does not treat bounded holds as active implementation unless explicitly required', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'hold',
        summary: 'Hold middleware delegation until provider quota resets',
        tags: ['middleware'],
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('0 high-risk task(s) have design governance');
  });

  it('does not require design artifacts for preserved-stash triage tasks that mention memory paths', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'pending',
        summary: 'stash-280388f16424: diagnose preserved stash stash@{7}: kuro-portfolio/ai-trend/index.html, memory/inner-notes.md',
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.missingArtifacts).toHaveLength(0);
  });

  it('does not require design artifacts for completed PR deploy status reports', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'in_progress',
        summary: '@kuro PR #536 已 merge + deploy run 26261288212 success; dist/stash-governance.js confirmed deployed',
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.missingArtifacts).toHaveLength(0);
  });

  it('does not require deep design artifacts for local Claude tooling guardrails', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        id: 'idx-e0378a58-7965-4fc0-9d69-4f0626408eb4',
        status: 'in_progress',
        summary: '@kuro 我要改 .claude/settings.json 加兩個 PreToolUse hook（runtime/main commit 守衛 + git add -A/--no-verify 守衛），並新增 .claude/agents/field-consistency-reviewer.md 與 .claude/skills/persist-check/SKILL.md。走 forge',
        tags: ['room'],
        payload: { ticksSinceLastProgress: 5 },
      }),
    ]);

    expect(report.status).toBe('ok');
    expect(report.missingArtifacts).toHaveLength(0);
  });

  it('still requires design artifacts when local Claude tooling touches runtime source', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-design-governance-'));
    const report = evaluateDesignGovernance(memoryDir, [
      task({
        status: 'in_progress',
        summary: 'Update .claude/settings.json PreToolUse hook and src/dispatcher.ts workflow state machine',
        payload: { priority: 1 },
      }),
    ]);

    expect(report.status).toBe('blocked');
    expect(report.missingArtifacts[0]).toEqual(expect.objectContaining({
      taskId: 'idx-design-test',
    }));
  });
});

function task(overrides: Partial<MemoryIndexEntry>): MemoryIndexEntry {
  return {
    id: 'idx-design-test',
    ts: '2026-05-10T00:00:00.000Z',
    type: 'task',
    status: 'pending',
    summary: 'test task',
    refs: [],
    ...overrides,
  };
}
