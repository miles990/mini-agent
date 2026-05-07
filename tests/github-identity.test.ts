import { describe, expect, it } from 'vitest';
import { expectedKuroGithubLogin, getKuroGithubToken, kuroGithubCliEnv, kuroGitEnv } from '../src/github-identity.js';

describe('github identity', () => {
  it('derives the expected Kuro login from KURO_GITHUB', () => {
    expect(expectedKuroGithubLogin({ KURO_GITHUB: 'https://github.com/kuro-agent' } as NodeJS.ProcessEnv)).toBe('kuro-agent');
  });

  it('does not treat generic GitHub tokens as Kuro-owned credentials', () => {
    const env = { GITHUB_TOKEN: 'user-token', GH_TOKEN: 'user-token' } as NodeJS.ProcessEnv;
    expect(getKuroGithubToken(env)).toBeUndefined();
    expect(() => kuroGithubCliEnv(env)).toThrow(/KURO_GITHUB_TOKEN/);
  });

  it('maps Kuro token into gh and git-only environment without changing generic identity source', () => {
    const env = {
      KURO_GITHUB_TOKEN: 'kuro-token',
      GITHUB_TOKEN: 'user-token',
      GH_TOKEN: 'user-token',
    } as NodeJS.ProcessEnv;
    expect(kuroGithubCliEnv(env)).toEqual(expect.objectContaining({
      GH_TOKEN: 'kuro-token',
      GITHUB_TOKEN: 'kuro-token',
    }));

    const gitEnv = kuroGitEnv(env);
    expect(gitEnv.GH_TOKEN).toBe('kuro-token');
    expect(gitEnv.GITHUB_TOKEN).toBe('kuro-token');
    expect(gitEnv.GIT_CONFIG_COUNT).toBe('5');
    expect(gitEnv.GIT_CONFIG_VALUE_0).toBe('AUTHORIZATION: bearer kuro-token');
    expect(gitEnv.GIT_CONFIG_VALUE_3).toBe('Kuro');
  });
});
