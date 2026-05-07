import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getAgentOwnedIdentity } from './agent-owned-identity.js';

let verifiedLogin: string | null = null;

export function expectedKuroGithubLogin(env: NodeJS.ProcessEnv = process.env): string {
  return env.KURO_GITHUB_LOGIN
    || env.KURO_GITHUB_USER
    || basenameFromGithubUrl(env.KURO_GITHUB)
    || basenameFromGithubUrl(readDotEnvValue('KURO_GITHUB'))
    || getAgentOwnedIdentity('github', env).expected;
}

export function getKuroGithubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.KURO_GITHUB_TOKEN || (env === process.env ? readDotEnvValue('KURO_GITHUB_TOKEN') : undefined);
}

export function kuroGithubCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const token = getKuroGithubToken(env);
  if (!token) throw new Error('KURO_GITHUB_TOKEN is required for Kuro-owned GitHub automation');
  return {
    ...env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}

export function kuroGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const token = getKuroGithubToken(env);
  if (!token) throw new Error('KURO_GITHUB_TOKEN is required for Kuro-owned git push automation');
  const config: Record<string, string> = {
    'http.https://github.com/.extraheader': `AUTHORIZATION: bearer ${token}`,
    'url.https://github.com/.insteadOf': 'git@github.com:',
    'url.https://github.com/.pushInsteadOf': 'git@github.com:',
    'user.name': env.KURO_GIT_AUTHOR_NAME || 'Kuro',
    'user.email': env.KURO_GIT_AUTHOR_EMAIL || 'kuro@mini-agent',
  };
  const next: NodeJS.ProcessEnv = { ...env, GH_TOKEN: token, GITHUB_TOKEN: token };
  const existingCount = Number(env.GIT_CONFIG_COUNT ?? 0);
  let index = Number.isFinite(existingCount) && existingCount > 0 ? existingCount : 0;
  for (const [key, value] of Object.entries(config)) {
    next[`GIT_CONFIG_KEY_${index}`] = key;
    next[`GIT_CONFIG_VALUE_${index}`] = value;
    index++;
  }
  next.GIT_CONFIG_COUNT = String(index);
  return next;
}

export function assertKuroGithubIdentity(env: NodeJS.ProcessEnv = process.env): void {
  const expected = expectedKuroGithubLogin(env);
  if (verifiedLogin === expected) return;
  const ghEnv = kuroGithubCliEnv(env);
  const actual = execFileSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    env: ghEnv,
  }).trim();
  if (actual !== expected) {
    throw new Error(`Kuro GitHub identity mismatch: expected ${expected}, got ${actual}`);
  }
  verifiedLogin = actual;
}

function basenameFromGithubUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\/+$/, '');
  const name = trimmed.split('/').pop()?.replace(/\.git$/, '');
  return name || undefined;
}

function readDotEnvValue(key: string): string | undefined {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return undefined;
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] !== key) continue;
      return unquoteEnvValue(match[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
