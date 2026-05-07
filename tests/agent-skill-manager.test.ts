import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAgentSkillOrchestrationPrompt,
  listManagedSkills,
  recordSkillUsage,
  selectAgentSkills,
  summarizeSkillHealth,
  suggestPatternPromotions,
} from '../src/agent-skill-manager.js';

function registryFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-manager-registry-'));
  const registryPath = join(dir, 'agent-capabilities.json');
  writeFileSync(registryPath, JSON.stringify({
    version: 1,
    capabilities: [
      {
        service: 'kg',
        kind: 'api',
        defaultExpected: 'kg',
        expectedEnv: [],
        credentialEnv: [],
        readPolicy: 'internal-service',
        writePolicy: 'internal-service',
      },
      {
        service: 'constraint-texture-analysis',
        kind: 'workflow',
        defaultExpected: 'constraint-texture',
        expectedEnv: [],
        credentialEnv: [],
        capabilities: ['token-roi-analysis', 'capability-promotion'],
        trigger: {
          modes: ['reflect', 'task'],
          keywords: ['Constraint Texture', 'token', 'phantom', '空轉', 'tension', 'stakeholder', '取捨'],
          signals: ['token_waste', 'phantom_task', 'requirement_tension', 'stakeholder_conflict', 'understanding_bottleneck'],
          taskTypes: ['ops', 'design'],
        },
        requires: ['kg'],
        combinesWith: ['debug-loop', 'budget-escalation'],
        verifier: 'names thick/thin texture and records a promotion candidate',
        contextFabric: {
          sources: ['KG', 'skill-usage', 'task-events'],
          writes: ['constraint-texture-report', 'capability-promotion-candidate'],
          emergenceSignals: ['token_waste', 'thin_texture_cycle', 'requirement_tension', 'stakeholder_conflict', 'understanding_bottleneck', 'cross_skill_pattern'],
        },
        iteration: {
          ledger: 'memory/state/skill-usage.jsonl',
          minUses: 3,
          failureThreshold: 0.25,
          updatePolicy: 'self-edit-skill',
        },
        readPolicy: 'internal-service',
        writePolicy: 'internal-service',
      },
      {
        service: 'debug-loop',
        kind: 'skill',
        defaultExpected: 'debug-loop',
        expectedEnv: [],
        credentialEnv: [],
        capabilities: ['debug'],
        trigger: {
          modes: ['task'],
          keywords: ['bug', 'failure'],
          signals: ['test_failure'],
          taskTypes: ['debug'],
          minPriority: 1,
        },
        requires: ['kg'],
        combinesWith: ['budget-escalation'],
        verifier: 'reproduction plus regression test',
        contextFabric: {
          sources: ['KG', 'logs'],
          writes: ['root-cause', 'skill-usage'],
          learnsFrom: ['previous-diagnoses'],
          sharesWith: ['kg'],
          emergenceSignals: ['same_root_cause_family'],
        },
        iteration: {
          ledger: 'memory/state/skill-usage.jsonl',
          minUses: 2,
          failureThreshold: 0.5,
          updatePolicy: 'self-edit-skill',
        },
        readPolicy: 'internal-service',
        writePolicy: 'internal-service',
      },
      {
        service: 'budget-escalation',
        kind: 'workflow',
        defaultExpected: 'budget-escalation',
        expectedEnv: [],
        credentialEnv: [],
        trigger: {
          signals: ['max_turns_failure'],
          keywords: ['stuck'],
        },
        contextFabric: {
          emergenceSignals: ['repeated_failure_path'],
        },
        readPolicy: 'internal-service',
        writePolicy: 'internal-service',
      },
      {
        service: 'blocked-skill',
        kind: 'skill',
        defaultExpected: 'blocked-skill',
        expectedEnv: [],
        credentialEnv: [],
        trigger: { keywords: ['blocked'] },
        requires: ['missing-tool'],
        readPolicy: 'internal-service',
        writePolicy: 'internal-service',
      },
    ],
  }), 'utf-8');
  return registryPath;
}

describe('agent skill manager', () => {
  it('selects matching skills and declared collaborators', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const result = selectAgentSkills({
      hint: 'debug this bug failure',
      mode: 'task',
      signals: ['test_failure'],
      taskType: 'debug',
      priority: 0,
    }, env);

    expect(result.selected.map(item => item.service)).toEqual(expect.arrayContaining(['debug-loop', 'budget-escalation']));
    expect(result.selected[0]).toEqual(expect.objectContaining({
      verifier: 'reproduction plus regression test',
      contextFabric: expect.objectContaining({
        sources: ['KG', 'logs'],
        writes: ['root-cause', 'skill-usage'],
      }),
    }));
  });

  it('uses KG/context emergence signals as trigger input', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const result = selectAgentSkills({
      contextSignals: ['same_root_cause_family'],
    }, env);

    expect(result.selected[0]).toEqual(expect.objectContaining({
      service: 'debug-loop',
      reasons: expect.arrayContaining(['context:same_root_cause_family']),
    }));
  });

  it('selects Constraint Texture for token waste and phantom task analysis', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const result = selectAgentSkills({
      hint: 'Constraint Texture 看 token 浪費和 phantom task',
      mode: 'reflect',
      signals: ['token_waste', 'phantom_task'],
      taskType: 'ops',
    }, env);

    expect(result.selected.map(item => item.service)).toEqual(expect.arrayContaining([
      'constraint-texture-analysis',
      'debug-loop',
      'budget-escalation',
    ]));
    expect(result.selected[0]).toEqual(expect.objectContaining({
      service: 'constraint-texture-analysis',
      contextFabric: expect.objectContaining({
        writes: ['constraint-texture-report', 'capability-promotion-candidate'],
      }),
    }));
  });

  it('selects Constraint Texture when requirements are in tension', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const result = selectAgentSkills({
      hint: 'stakeholder tension and 需求取捨，需要理解瓶頸',
      mode: 'reflect',
      signals: ['requirement_tension', 'stakeholder_conflict', 'understanding_bottleneck'],
      taskType: 'design',
    }, env);

    expect(result.selected[0]).toEqual(expect.objectContaining({
      service: 'constraint-texture-analysis',
      reasons: expect.arrayContaining([
        'signal:requirement_tension',
        'context:stakeholder_conflict',
      ]),
    }));
  });

  it('reports blocked skills with missing dependencies', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const result = selectAgentSkills({ hint: 'blocked' }, env);

    expect(result.selected.some(item => item.service === 'blocked-skill')).toBe(false);
    expect(result.blocked).toEqual(expect.arrayContaining([
      { service: 'blocked-skill', missing: ['missing-tool'] },
    ]));
  });

  it('summarizes usage health for self-iteration', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const memoryDir = mkdtempSync(join(tmpdir(), 'skill-manager-memory-'));

    recordSkillUsage(memoryDir, { skill: 'debug-loop', outcome: 'failure', note: 'no reproduction' });
    recordSkillUsage(memoryDir, { skill: 'debug-loop', outcome: 'blocked', note: 'missing logs' });

    expect(summarizeSkillHealth(memoryDir, env)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skill: 'debug-loop',
        uses: 2,
        status: 'iterate',
        suggestion: expect.stringContaining('revise the skill/workflow instructions'),
      }),
    ]));
  });

  it('renders skill orchestration prompt with context fabric', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const prompt = buildAgentSkillOrchestrationPrompt(env);

    expect(prompt).toContain('AI-Native Skill Orchestration');
    expect(prompt).toContain('KG and file context are the context fabric');
    expect(prompt).toContain('debug-loop');
    expect(prompt).toContain('constraint-texture-analysis');
    expect(prompt).toContain('context=KG,logs');
    expect(prompt).toContain('Promotion rule');
  });

  it('lists only active skill and workflow capabilities as managed skills', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    expect(listManagedSkills(env).map(skill => skill.service)).toEqual(expect.arrayContaining([
      'constraint-texture-analysis',
      'debug-loop',
      'budget-escalation',
    ]));
  });

  it('promotes repeated deterministic patterns into script or CLI candidates', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const memoryDir = mkdtempSync(join(tmpdir(), 'skill-manager-memory-'));

    for (let i = 0; i < 3; i += 1) {
      recordSkillUsage(memoryDir, {
        skill: 'constraint-texture-analysis',
        outcome: 'success',
        pattern: 'deterministic git deploy lock health snapshot',
        savedTokensEstimate: 4_000,
        savedMinutesEstimate: 12,
        combinedWith: ['budget-escalation'],
        note: 'repeatable shell/git/json health snapshot',
      });
    }

    expect(suggestPatternPromotions(memoryDir, env)[0]).toEqual(expect.objectContaining({
      pattern: 'deterministic git deploy lock health snapshot',
      recommendedKind: 'cli',
      suggestedCapability: expect.objectContaining({
        service: 'pattern-deterministic-git-deploy-lock-health-snapshot',
        kind: 'tool',
        requires: expect.arrayContaining(['constraint-texture-analysis', 'budget-escalation']),
      }),
    }));
  });

  it('promotes repeated always-on guardrail patterns into runtime code candidates', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    const memoryDir = mkdtempSync(join(tmpdir(), 'skill-manager-memory-'));

    for (let i = 0; i < 3; i += 1) {
      recordSkillUsage(memoryDir, {
        skill: 'constraint-texture-analysis',
        outcome: 'success',
        pattern: 'always-on autonomy health gate for phantom task suppression',
        savedTokensEstimate: 2_000,
        combinedWith: ['debug-loop', 'budget-escalation'],
        note: 'runtime gate should close loop automatically',
      });
    }

    expect(suggestPatternPromotions(memoryDir, env)[0]).toEqual(expect.objectContaining({
      recommendedKind: 'code',
      suggestedCapability: expect.objectContaining({
        kind: 'tool',
        verifier: expect.stringContaining('successRate >= 0.67'),
      }),
    }));
  });
});
