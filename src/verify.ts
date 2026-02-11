/**
 * Verify Primitives — Minimal Core Enhanced
 *
 * Parse and execute "Verify:" lines from NEXT.md.
 * Built-in primitives + shell command fallback.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// ── Types ──
interface VerifyDetail { spec: string; passed: boolean; message?: string }
export interface VerifyResult { passed: boolean; details: VerifyDetail[] }
type PrimitiveFn = (args: string[], cwd: string) => Promise<VerifyDetail>;

// ── Registry ──
const primitives = new Map<string, PrimitiveFn>();
export function registerPrimitive(name: string, fn: PrimitiveFn): void {
  primitives.set(name, fn);
}

// ── Built-in Primitives ──

primitives.set('file-exists', async (args, cwd) => {
  const p = path.resolve(cwd, args[0]);
  const ok = fs.existsSync(p);
  return { spec: `file-exists ${args[0]}`, passed: ok, message: ok ? 'exists' : 'not found' };
});

primitives.set('file-contains', async (args, cwd) => {
  const [fp, pattern, ...rest] = args;
  const p = path.resolve(cwd, fp);
  if (!fs.existsSync(p)) return { spec: `file-contains ${fp}`, passed: false, message: 'file not found' };
  const matches = fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.includes(pattern)).length;
  const minIdx = rest.indexOf('--min-lines');
  const min = minIdx >= 0 ? parseInt(rest[minIdx + 1]) : 1;
  return { spec: `file-contains ${args.join(' ')}`, passed: matches >= min, message: `${matches} lines (need ${min})` };
});

primitives.set('git-pushed', async (_args, cwd) => {
  try {
    const out = execSync('git log origin/main..HEAD --oneline', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    const n = out ? out.split('\n').length : 0;
    return { spec: 'git-pushed', passed: n === 0, message: n === 0 ? 'all pushed' : `${n} unpushed` };
  } catch { return { spec: 'git-pushed', passed: false, message: 'git check failed' }; }
});

primitives.set('git-committed', async (args, cwd) => {
  try {
    const out = execSync(`git log --oneline --grep="${args[0]}" -5`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    return { spec: `git-committed ${args[0]}`, passed: out.length > 0, message: out ? 'found' : 'not found' };
  } catch { return { spec: `git-committed ${args[0]}`, passed: false, message: 'git check failed' }; }
});

primitives.set('service-healthy', async (args) => {
  const url = args[0].startsWith('http') ? args[0] : `http://${args[0]}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { spec: `service-healthy ${args[0]}`, passed: r.ok, message: r.ok ? 'ok' : `${r.status}` };
  } catch { return { spec: `service-healthy ${args[0]}`, passed: false, message: 'unreachable' }; }
});

primitives.set('port-open', async (args) => {
  const port = parseInt(args[0]);
  return new Promise<VerifyDetail>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve({ spec: `port-open ${port}`, passed: true, message: 'open' }); });
    socket.on('timeout', () => { socket.destroy(); resolve({ spec: `port-open ${port}`, passed: false, message: 'timeout' }); });
    socket.on('error', () => { resolve({ spec: `port-open ${port}`, passed: false, message: 'closed' }); });
    socket.connect(port, '127.0.0.1');
  });
});

// ── Parser ──

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '', q = '';
  for (const ch of input) {
    if (q) { if (ch === q) q = ''; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ' ') { if (cur) { tokens.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function parseVerifyLine(line: string): Array<{ type: 'shell' | 'primitive'; name: string; args: string[] }> {
  const t = line.trim();
  if (t.startsWith('`') && t.endsWith('`')) return [{ type: 'shell', name: t.slice(1, -1), args: [] }];
  return t.split(/\s+AND\s+/).map(part => {
    const tokens = tokenize(part.trim());
    return primitives.has(tokens[0])
      ? { type: 'primitive' as const, name: tokens[0], args: tokens.slice(1) }
      : { type: 'shell' as const, name: part.trim(), args: [] };
  });
}

// ── Runner ──

export async function runVerify(line: string, cwd: string): Promise<VerifyResult> {
  const specs = parseVerifyLine(line);
  const details: VerifyDetail[] = [];
  for (const spec of specs) {
    if (spec.type === 'shell') {
      try {
        execSync(spec.name, { cwd, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
        details.push({ spec: spec.name, passed: true });
      } catch { details.push({ spec: spec.name, passed: false }); }
    } else {
      details.push(await primitives.get(spec.name)!(spec.args, cwd));
    }
  }
  return { passed: details.every(d => d.passed), details };
}

// ── NEXT.md Processor ──

/**
 * Process NEXT.md content: find "Verify:" lines and annotate with results
 */
export async function verifyNextTasks(content: string, cwd: string): Promise<string> {
  if (!content) return '';
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    result.push(line);
    const verifyMatch = line.match(/^\s*- Verify:\s*(.+)/);
    if (verifyMatch) {
      const { passed, details } = await runVerify(verifyMatch[1].trim(), cwd);
      const status = passed ? '✅ PASSED' : '❌ NOT YET';
      const msg = details.map(d => d.message).filter(Boolean).join('; ');
      result.push(`  - **Status: ${status}**${msg ? ` (${msg})` : ''}`);
    }
  }

  return result.join('\n');
}
