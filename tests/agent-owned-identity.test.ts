import { describe, expect, it } from 'vitest';
import {
  assertAgentOwnedIdentity,
  buildAgentOwnedIdentityPrompt,
  getAgentOwnedIdentity,
} from '../src/agent-owned-identity.js';

describe('agent-owned identity boundary', () => {
  it('separates delegated read observation from fail-closed outbound writes', () => {
    const identity = getAgentOwnedIdentity('gmail', {
      KURO_GOOGLE_EMAIL: 'kuro.ai.agent@gmail.com',
    } as NodeJS.ProcessEnv);

    expect(identity).toEqual(expect.objectContaining({
      expected: 'kuro.ai.agent@gmail.com',
      inboundReads: 'delegated-observation-ok',
      outboundWrites: 'fail-closed',
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
    expect(prompt).toContain('outbound writes=fail-closed');
  });
});
