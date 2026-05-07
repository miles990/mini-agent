import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_CAPABILITY_REGISTRY,
  assertAgentOwnedIdentity,
  buildAgentOwnedIdentityPrompt,
  buildAgentRelationshipPrompt,
  getAgentOwnedIdentity,
  listAgentCapabilities,
  loadAgentCapabilityRegistry,
  loadAgentRelationshipRegistry,
} from '../src/agent-owned-identity.js';

describe('agent-owned identity boundary', () => {
  it('separates delegated read observation from fail-closed outbound writes', () => {
    const identity = getAgentOwnedIdentity('gmail', {
      KURO_GOOGLE_EMAIL: 'kuro.ai.agent@gmail.com',
    } as NodeJS.ProcessEnv);

    expect(identity).toEqual(expect.objectContaining({
      expected: 'kuro.ai.agent@gmail.com',
      inboundReads: 'delegated-observation-ok',
      outboundWrites: 'kuro-owned-required',
    }));
  });

  it('rejects outbound action identity mismatch', () => {
    expect(() => assertAgentOwnedIdentity('github', 'miles990', {
      KURO_GITHUB_LOGIN: 'kuro-agent',
    } as NodeJS.ProcessEnv)).toThrow(/expected kuro-agent, got miles990/);
  });

  it('renders the read/write split into the autonomous prompt contract', () => {
    const prompt = buildAgentOwnedIdentityPrompt({
      KURO_GITHUB_LOGIN: 'kuro-agent',
      KURO_GOOGLE_EMAIL: 'kuro.ai.agent@gmail.com',
    } as NodeJS.ProcessEnv);

    expect(prompt).toContain('Read/observe and write/act are different permissions');
    expect(prompt).toContain('It is OK to observe through Alex-authorized accounts');
    expect(prompt).toContain('It is NOT OK to publish');
    expect(prompt).toContain('writes=kuro-owned-required');
    expect(prompt).toContain('All services, servers, APIs, accounts, and API keys Kuro uses must be added to this registry first');
    expect(prompt).toContain('New capability rule: before using a new external/internal service');
    expect(prompt).toContain('arsenal/tool room');
  });

  it('centralizes account and API capability metadata', () => {
    expect(AGENT_CAPABILITY_REGISTRY.map(item => item.service)).toContain('github');
    const services = loadAgentCapabilityRegistry().map(item => item.service);
    expect(services).toEqual(expect.arrayContaining([
      'github',
      'gmail',
      'x',
      'devto',
      'mastodon',
      'agora',
      'kg',
      'local-llm',
      'claude-code-cli',
      'codex-cli',
      'browser-cdp',
      'middleware',
    ]));

    const kg = getAgentOwnedIdentity('kg', { KG_BASE_URL: 'http://localhost:3300' } as NodeJS.ProcessEnv);
    expect(kg).toEqual(expect.objectContaining({
      kind: 'api',
      status: 'active',
      inboundReads: 'internal-service',
      outboundWrites: 'internal-service',
      credentialEnv: expect.arrayContaining(['KG_BASE_URL', 'KG_API_KEY']),
    }));
  });

  it('lists configured capabilities using env overrides', () => {
    const caps = listAgentCapabilities({
      KURO_DEVTO_USERNAME: 'kuro_writer',
      KURO_LOCAL_LLM_IDENTITY: 'mlx-local',
    } as NodeJS.ProcessEnv);

    expect(caps.find(cap => cap.service === 'devto')?.expected).toBe('kuro_writer');
    expect(caps.find(cap => cap.service === 'local-llm')?.expected).toBe('mlx-local');
  });

  it('loads dynamic registry overlays for new services without code changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kuro-capabilities-'));
    const registryPath = join(dir, 'agent-capabilities.json');
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      relationships: [
        {
          id: 'researcher-ai',
          kind: 'ai-agent',
          displayName: 'Researcher AI',
          role: 'research collaborator',
          relationship: 'Can receive delegated research tasks but cannot publish as Kuro.',
          accounts: { github: 'researcher-ai' },
          permissions: { observe: true, delegate: true, publishAs: false, approve: false },
        },
      ],
      capabilities: [
        {
          service: 'linkedin',
          kind: 'account',
          defaultExpected: 'kuro-agent',
          expectedEnv: ['KURO_LINKEDIN_HANDLE'],
          credentialEnv: ['KURO_LINKEDIN_SESSION'],
          readPolicy: 'delegated-observation-ok',
          writePolicy: 'kuro-owned-required',
          profileUrl: 'https://www.linkedin.com/in/kuro-agent',
        },
        {
          service: 'playwright',
          kind: 'tool',
          defaultExpected: 'playwright-local',
          expectedEnv: [],
          credentialEnv: [],
          entrypoint: 'pnpm exec playwright',
          capabilities: ['browser-test', 'screenshot'],
          readPolicy: 'internal-service',
          writePolicy: 'internal-service',
        },
        {
          service: 'telegram',
          kind: 'account',
          status: 'deleted',
          defaultExpected: 'unused',
          expectedEnv: [],
          credentialEnv: [],
          readPolicy: 'delegated-observation-ok',
          writePolicy: 'kuro-owned-required',
        },
        {
          service: 'github',
          kind: 'account',
          defaultExpected: 'kuro-ci-agent',
          expectedEnv: ['KURO_GITHUB_LOGIN'],
          credentialEnv: ['KURO_GITHUB_TOKEN'],
          readPolicy: 'delegated-observation-ok',
          writePolicy: 'kuro-owned-required',
        },
      ],
    }), 'utf-8');

    const env = { KURO_AGENT_CAPABILITIES_PATH: registryPath } as NodeJS.ProcessEnv;

    expect(loadAgentCapabilityRegistry(env).some(cap => cap.service === 'linkedin')).toBe(true);
    expect(loadAgentCapabilityRegistry(env).some(cap => cap.service === 'telegram')).toBe(false);
    expect(getAgentOwnedIdentity('playwright', env)).toEqual(expect.objectContaining({
      kind: 'tool',
      entrypoint: 'pnpm exec playwright',
      capabilities: ['browser-test', 'screenshot'],
    }));
    expect(getAgentOwnedIdentity('linkedin', env)).toEqual(expect.objectContaining({
      expected: 'kuro-agent',
      credentialEnv: ['KURO_LINKEDIN_SESSION'],
      outboundWrites: 'kuro-owned-required',
    }));
    expect(getAgentOwnedIdentity('github', env).expected).toBe('kuro-ci-agent');
    expect(loadAgentRelationshipRegistry(env)).toEqual([
      expect.objectContaining({
        id: 'researcher-ai',
        kind: 'ai-agent',
        permissions: expect.objectContaining({ delegate: true, publishAs: false }),
      }),
    ]);
  });

  it('renders relationship boundaries into the prompt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kuro-relationships-'));
    const registryPath = join(dir, 'agent-capabilities.json');
    writeFileSync(registryPath, JSON.stringify({
      version: 1,
      relationships: [
        {
          id: 'alex',
          kind: 'human',
          displayName: 'Alex',
          role: 'owner',
          relationship: 'Observe/approve only.',
          accounts: { github: 'miles990' },
          permissions: { observe: true, approve: true, publishAs: false },
        },
      ],
    }), 'utf-8');

    const prompt = buildAgentRelationshipPrompt({ KURO_AGENT_CAPABILITIES_PATH: registryPath } as NodeJS.ProcessEnv);

    expect(prompt).toContain('Agent Relationship Boundary');
    expect(prompt).toContain('alex: kind=human');
    expect(prompt).toContain('accounts=github:miles990');
    expect(prompt).toContain('Never publish as another person/AI/account unless publishAs=true');
  });
});
