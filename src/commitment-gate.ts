import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { ParsedTags } from './types.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';

export interface CommitmentGapEntry {
  id: string;
  text: string;
  createdAt: string;
  expiresAt: string;
}

interface CommitmentGapsState {
  gaps: CommitmentGapEntry[];
}

const COMMITMENT_GAPS_FILE = 'commitment-gaps.json';
const COMMITMENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_GAPS = 50;

const COMMITMENT_PATTERN = /(?:收到|我來修|我來處理|我馬上|馬上(?:修|做|處理|去)|我現在就|我去做|i['’]ll fix|i will fix|i['’]ll handle|i['’]ll do it)/i;

function getCommitmentGapsPath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), COMMITMENT_GAPS_FILE);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function hasTrackingTags(tags: ParsedTags): boolean {
  return Boolean(
    tags.tasks.length > 0
    || tags.delegates.length > 0
    || tags.progresses.length > 0
    || tags.goal
    || tags.goalQueue
    || tags.goalAdvance
    || tags.goalProgress
    || tags.goalDone
    || tags.goalAbandon,
  );
}

function extractCommitments(response: string): string[] {
  const plain = response
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/<\/?kuro:[^>]+>/g, ' ');

  const candidates = plain
    .split(/[\n。！？!?]/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => COMMITMENT_PATTERN.test(s))
    .map(s => s.slice(0, 200));

  return [...new Set(candidates)];
}

function isExpired(item: CommitmentGapEntry, now = Date.now()): boolean {
  return new Date(item.expiresAt).getTime() <= now;
}

function parseState(raw: string): CommitmentGapsState {
  try {
    const parsed = JSON.parse(raw) as CommitmentGapsState;
    return Array.isArray(parsed.gaps) ? parsed : { gaps: [] };
  } catch {
    return { gaps: [] };
  }
}

function toStateJson(state: CommitmentGapsState): string {
  return JSON.stringify(state, null, 2);
}

function matchGoal(commitmentText: string, goalDescription: string): boolean {
  const commitment = normalize(commitmentText);
  const goal = normalize(goalDescription);
  if (!commitment || !goal) return false;
  return commitment.includes(goal) || goal.includes(commitment);
}

export async function detectAndRecordCommitmentGaps(response: string, tags: ParsedTags): Promise<number> {
  const commitments = extractCommitments(response);
  if (commitments.length === 0 || hasTrackingTags(tags)) return 0;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + COMMITMENT_TTL_MS).toISOString();
  const filePath = getCommitmentGapsPath();

  let state: CommitmentGapsState = { gaps: [] };
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    state = parseState(raw);
  } catch {
    state = { gaps: [] };
  }

  const active = state.gaps.filter(g => !isExpired(g, now));
  const seen = new Set(active.map(g => normalize(g.text)));
  let added = 0;

  for (const text of commitments) {
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    active.push({
      id: `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      createdAt: nowIso,
      expiresAt,
    });
    seen.add(key);
    added++;
  }

  if (added === 0 && active.length === state.gaps.length) return 0;

  const nextState: CommitmentGapsState = {
    gaps: active.slice(-MAX_GAPS),
  };

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, toStateJson(nextState), 'utf-8');
  return added;
}

export function loadActiveCommitmentGaps(): CommitmentGapEntry[] {
  const filePath = getCommitmentGapsPath();
  let state: CommitmentGapsState;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    state = parseState(raw);
  } catch {
    return [];
  }

  const now = Date.now();
  const active = state.gaps.filter(g => !isExpired(g, now));

  if (active.length !== state.gaps.length) {
    try {
      fs.writeFileSync(filePath, toStateJson({ gaps: active }), 'utf-8');
    } catch {
      // Ignore cleanup failure — prompt rendering should continue.
    }
  }

  return active;
}

export function buildCommitmentGateSection(): string {
  const gaps = loadActiveCommitmentGaps();
  if (gaps.length === 0) return '';

  const lines = gaps.map(g => `- [${g.createdAt}] ${g.text}`);
  return `## Commitment Gate
Untracked commitments detected. Convert them into tracked execution this cycle.
Use one of: <kuro:task>, <kuro:delegate>, <kuro:progress>, <kuro:goal>.
${lines.join('\n')}`;
}

export function clearCommitmentGapsForGoal(goalDescription: string): number {
  const filePath = getCommitmentGapsPath();
  let state: CommitmentGapsState;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    state = parseState(raw);
  } catch {
    return 0;
  }

  const before = state.gaps.length;
  const remaining = state.gaps.filter(g => !matchGoal(g.text, goalDescription));
  const removed = before - remaining.length;
  if (removed <= 0) return 0;

  try {
    fs.writeFileSync(filePath, toStateJson({ gaps: remaining }), 'utf-8');
  } catch {
    return 0;
  }
  return removed;
}
