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

    expect(result.selected.map(item => item.service)).toEqual(['debug-loop', 'budget-escalation']);
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
    expect(prompt).toContain('context=KG,logs');
  });

  it('lists only active skill and workflow capabilities as managed skills', () => {
    const env = { KURO_AGENT_CAPABILITIES_PATH: registryFile() } as NodeJS.ProcessEnv;
    expect(listManagedSkills(env).map(skill => skill.service)).toEqual(expect.arrayContaining([
      'debug-loop',
      'budget-escalation',
    ]));
  });
});
