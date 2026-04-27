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

export function loadSuccessPatterns(limit: number = 50): SuccessPattern[] {
  try {
    const stateDir = getMemoryStateDir();
    const filePath = path.join(stateDir, PATTERNS_FILE);
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const patterns: SuccessPattern[] = [];
    for (const line of lines.slice(-limit)) {
      try { patterns.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return patterns;
  } catch { return []; }
}

export function findRelevantSuccesses(currentTask: string, limit: number = 3): SuccessPattern[] {
  const patterns = loadSuccessPatterns(100);
  if (patterns.length === 0) return [];

  const taskWords = currentTask.toLowerCase().split(/[\s\-_：:,，/]+/).filter(w => w.length > 2);
  if (taskWords.length === 0) return patterns.slice(-limit);

  const scored = patterns.map(p => {
    const patternText = `${p.task} ${p.action} ${(p.tags || []).join(' ')}`.toLowerCase();
    const matchCount = taskWords.filter(w => patternText.includes(w)).length;
    return { pattern: p, score: matchCount / taskWords.length };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0.2).slice(0, limit).map(s => s.pattern);
}

export function buildSuccessHint(currentTask: string): string {
  const relevant = findRelevantSuccesses(currentTask, 3);
  if (relevant.length === 0) return '';
  const hints = relevant.map(p =>
    `- 「${p.task.slice(0, 60)}」→ ${p.action.slice(0, 80)} [${(p.tags || []).join(', ')}]`
  ).join('\n');
  return `\n<past-successes>\n以下是類似任務的成功經驗：\n${hints}\n</past-successes>\n`;
}

export function seedFromHeartbeat(): void {
  try {
    const stateDir = getMemoryStateDir();
    const filePath = path.join(stateDir, PATTERNS_FILE);
    if (fs.existsSync(filePath)) return;

    const hbPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
    if (!fs.existsSync(hbPath)) return;

    const hb = fs.readFileSync(hbPath, 'utf-8');
    const completedRe = /^- \[x\] (.+?)(?:\s*<!--.*?-->)*$/gm;
    const seeds: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = completedRe.exec(hb)) !== null && seeds.length < 20) {
      const task = m[1].replace(/✅.*$/, '').trim();
      if (task.length > 10 && task.length < 300) seeds.push(task);
    }
    if (seeds.length === 0) return;

    const lines = seeds.map(t => JSON.stringify({
      task: t.slice(0, 200),
      action: 'backfill-from-heartbeat',
      tags: ['kuro:done'],
      mode: 'autonomous',
      at: new Date().toISOString(),
    } satisfies SuccessPattern));
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    slog('SUCCESS', `seeded ${seeds.length} patterns from HEARTBEAT completed tasks`);
  } catch { /* fire-and-forget */ }
}

export function buildSuccessContext(contextHint?: string): string | null {
  try {
    const stateDir = getMemoryStateDir();
    const filePath = path.join(stateDir, PATTERNS_FILE);
    if (!fs.existsSync(filePath)) {
      seedFromHeartbeat();
      if (!fs.existsSync(filePath)) return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    const kws = (contextHint ?? '').toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    let top: SuccessPattern[];
    if (kws.length === 0) {
      // No hint — return most recent patterns so Kuro always sees past successes
      const parsed: SuccessPattern[] = [];
      for (const line of lines) {
        try { parsed.push(JSON.parse(line) as SuccessPattern); } catch { continue; }
      }
      top = parsed.slice(-3);
    } else {
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
      top = scored.slice(0, 3).map(s => s.p);
    }

    if (top.length === 0) return null;
    const out = top.map(p =>
      `- [${p.at.slice(0, 10)}] ${p.task} → ${p.action} (${p.tags.join(',')})`
    );
    return out.join('\n');
  } catch {
    return null;
  }
}
