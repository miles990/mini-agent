import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

interface SuccessPattern {
  task: string;
  action: string;
  tags: string[];
  mode: string;
  at: string;
}

const PATTERNS_FILE = 'success-patterns.jsonl';
const MAX_PATTERNS = 500;

export function recordSuccessPattern(
  task: string,
  action: string,
  tags: string[],
  mode: string,
): void {
  try {
    const stateDir = getMemoryStateDir();
    const filePath = path.join(stateDir, PATTERNS_FILE);
    const pattern: SuccessPattern = {
      task: task.slice(0, 200),
      action: (action || '').slice(0, 300),
      tags,
      mode,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(filePath, JSON.stringify(pattern) + '\n', 'utf-8');
    slog('SUCCESS', `recorded: ${task.slice(0, 60)}`);

    const stat = fs.statSync(filePath);
    if (stat.size > 200_000) trimPatterns(filePath);
  } catch { /* fire-and-forget */ }
}

function trimPatterns(filePath: string): void {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > MAX_PATTERNS) {
      fs.writeFileSync(filePath, lines.slice(-MAX_PATTERNS).join('\n') + '\n', 'utf-8');
      slog('SUCCESS', `trimmed ${lines.length}→${MAX_PATTERNS} patterns`);
    }
  } catch { /* silent */ }
}

export function buildSuccessContext(contextHint: string): string | null {
  try {
    const stateDir = getMemoryStateDir();
    const filePath = path.join(stateDir, PATTERNS_FILE);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    const kws = contextHint.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    if (kws.length === 0) return null;

    const scored: Array<{ p: SuccessPattern; score: number }> = [];
    for (const line of lines) {
      try {
        const p = JSON.parse(line) as SuccessPattern;
        const text = `${p.task} ${p.action}`.toLowerCase();
        const score = kws.filter(kw => text.includes(kw)).length;
        if (score >= Math.max(1, Math.ceil(kws.length * 0.2))) {
          scored.push({ p, score });
        }
      } catch { continue; }
    }

    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    const out = top.map(({ p }) =>
      `- [${p.at.slice(0, 10)}] ${p.task} → ${p.action} (${p.tags.join(',')})`
    );
    return out.join('\n');
  } catch {
    return null;
  }
}
