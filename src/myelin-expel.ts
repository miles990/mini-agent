/**
 * myelin-expel — L4 ExpeL-style cross-context distillation.
 *
 * Records complete OODA episodes and periodically distills cross-episode
 * insights into "when -> how" experience rules.
 *
 * Reference: ExpeL (Zhao et al., 2023) — extracts task-level insights
 * from accumulated successful/failed episodes into a reusable experience pool.
 */

import fs from 'node:fs';
import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats } from 'myelinate';
import { slog } from './utils.js';

// --- Data Model ---

/** A complete OODA cycle record. */
export interface Episode {
  id: string;               // episode_<timestamp>
  ts: string;               // ISO timestamp
  trigger: string;          // What triggered this cycle
  intent: string;           // Detected intent category
  contextSnapshot: string;  // Compressed context key
  decision: string;         // Action type: reply, delegate, learn, etc.
  actions: string[];        // Tags emitted, delegations spawned
  result: 'success' | 'partial' | 'failure';
  durationMs: number;
  tags: string[];
}

/** A distilled when->how insight. */
export interface ExperienceRule {
  id: string;
  when: string;             // Condition pattern (natural language)
  then: string;             // Recommended approach
  because: string;          // Evidence summary
  confidence: number;       // 0-1
  episodeCount: number;     // How many episodes support this
  createdAt: string;
}

// --- Paths ---

const EPISODES_PATH   = './memory/myelin-episodes.jsonl';
const RULES_PATH      = './memory/myelin-expel-rules.json';
const LOG_PATH        = './memory/myelin-expel-decisions.jsonl';
const EXPERIENCE_POOL = './memory/myelin-experience-pool.json';

// --- Episode Logging ---

/** Append an episode to the JSONL log. Fire-and-forget, never throws. */
export function recordEpisode(episode: Omit<Episode, 'id'>): void {
  try {
    const full: Episode = { ...episode, id: `episode_${Date.now()}` };
    fs.mkdirSync('./memory', { recursive: true });
    fs.appendFileSync(EPISODES_PATH, JSON.stringify(full) + '\n');
    // Feed myelinate for pattern tracking
    getExpelMyelin().triage({
      type: episode.trigger,
      source: episode.intent,
      context: {
        decision: episode.decision,
        result: episode.result,
        durationMs: episode.durationMs,
        tagCount: episode.tags.length,
        actionCount: episode.actions.length,
        contextSnapshot: episode.contextSnapshot,
      },
    }).catch(() => {});
    slog('MYELIN-L4', `episode recorded: ${episode.trigger}/${episode.intent} -> ${episode.result}`);
  } catch { /* fire-and-forget */ }
}

// --- Myelin Instance ---

export type ExpeL = 'apply-experience' | 'explore-new' | 'reflect';

let _expelInstance: Myelin<ExpeL> | null = null;

/** Get or create the singleton ExpeL myelin instance. */
export function getExpelMyelin(): Myelin<ExpeL> {
  if (!_expelInstance) {
    _expelInstance = createMyelin<ExpeL>({
      llm: async (event) => {
        const trigger = event.type;
        const intent = event.source ?? '';
        const episodes = loadEpisodes();
        const matching = episodes.filter(
          (e) => e.trigger === trigger && e.intent === intent,
        );
        if (matching.length >= 3) {
          const successes = matching.filter((e) => e.result === 'success').length;
          const rate = successes / matching.length;
          if (rate >= 0.7) {
            const top = mostCommon(matching.map((e) => e.decision));
            return { action: 'apply-experience', reason: `${matching.length} episodes, ${Math.round(rate * 100)}% success, decision: ${top}` };
          }
          if (rate < 0.5) {
            return { action: 'reflect', reason: `${matching.length} episodes, only ${Math.round(rate * 100)}% success` };
          }
        }
        return {
          action: 'explore-new',
          reason: matching.length > 0
            ? `${matching.length} prior episodes, not yet stable`
            : 'no prior episodes for this pattern',
        };
      },
      rulesPath: RULES_PATH,
      logPath: LOG_PATH,
      failOpenAction: 'explore-new' as ExpeL,
      crystallize: { minOccurrences: 8, minConsistency: 0.80 },
    });
    slog('MYELIN-L4', 'Initialized ExpeL layer — experience crystallization active');
  }
  return _expelInstance;
}

// --- Experience Distillation ---

interface DistillExperienceResult {
  rules: ExperienceRule[];
  episodesProcessed: number;
  newRules: number;
}

/**
 * Read episode log, group by intent+trigger, extract stable patterns
 * as ExperienceRules. Stores rules in experience pool file.
 */
export function distillExperience(): DistillExperienceResult {
  const episodes = loadEpisodes();
  if (episodes.length === 0) return { rules: [], episodesProcessed: 0, newRules: 0 };

  const existing = getExperienceRules();
  const existingKeys = new Set(existing.map((r) => r.when));

  // Group by trigger+intent
  const groups = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const key = `${ep.trigger}::${ep.intent}`;
    const list = groups.get(key) ?? [];
    list.push(ep);
    groups.set(key, list);
  }

  const newRules: ExperienceRule[] = [];
  for (const [key, eps] of groups) {
    if (eps.length < 3) continue;
    const [trigger, intent] = key.split('::');
    const successes = eps.filter((e) => e.result === 'success');
    if (successes.length < 2) continue;
    const successRate = successes.length / eps.length;

    const topDecision = mostCommon(successes.map((e) => e.decision));
    const topTags = topN(eps.flatMap((e) => e.tags), 3);
    const when = `trigger=${trigger}, intent=${intent}` +
      (topTags.length > 0 ? `, topics include [${topTags.join(', ')}]` : '');
    if (existingKeys.has(when)) continue;

    const then = `Use "${topDecision}" approach (${Math.round(successRate * 100)}% success across ${eps.length} episodes)`;
    const avgMs = Math.round(eps.reduce((s, e) => s + e.durationMs, 0) / eps.length);
    const because = `${successes.length}/${eps.length} successes, avg ${avgMs}ms, actions: [${topN(eps.flatMap((e) => e.actions), 3).join(', ')}]`;

    newRules.push({
      id: `expr_${Date.now()}_${newRules.length}`,
      when, then, because,
      confidence: successRate,
      episodeCount: eps.length,
      createdAt: new Date().toISOString(),
    });
  }

  const allRules = [...existing, ...newRules];
  try {
    fs.mkdirSync('./memory', { recursive: true });
    fs.writeFileSync(EXPERIENCE_POOL, JSON.stringify(allRules, null, 2));
  } catch (err) {
    slog('MYELIN-L4', `Failed to write experience pool: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  slog('MYELIN-L4', `distill: ${episodes.length} episodes -> ${allRules.length} rules (${newRules.length} new)`);
  return { rules: allRules, episodesProcessed: episodes.length, newRules: newRules.length };
}

// --- Experience Rule Access ---

/** Load experience rules from the pool file. Returns [] if none exist. */
export function getExperienceRules(): ExperienceRule[] {
  try {
    if (!fs.existsSync(EXPERIENCE_POOL)) return [];
    const raw = fs.readFileSync(EXPERIENCE_POOL, 'utf-8');
    return JSON.parse(raw) as ExperienceRule[];
  } catch { return []; }
}

/**
 * Format top experience rules for prompt injection.
 * Returns empty string if no rules exist.
 */
export function formatExperienceForPrompt(maxRules = 5): string {
  const rules = getExperienceRules();
  if (rules.length === 0) return '';

  const sorted = [...rules].sort(
    (a, b) => b.confidence * b.episodeCount - a.confidence * a.episodeCount,
  );
  const top = sorted.slice(0, maxRules);
  const lines = top.map((r) => {
    const pct = Math.round(r.confidence * 100);
    return `- When ${r.when}: ${r.then} (confidence: ${pct}%, from ${r.episodeCount} episodes)`;
  });
  return `<experience rules="${top.length}">\nBased on past episodes:\n${lines.join('\n')}\n</experience>`;
}

// --- Stats & Combined Distillation ---

/** Get ExpeL myelin stats. */
export function getExpelStats(): MyelinStats {
  return getExpelMyelin().stats();
}

/** Run both myelinate distillation and experience extraction. */
export function distillExpel(): { myelin: ReturnType<Myelin<ExpeL>['distill']>; experience: DistillExperienceResult } {
  const myelin = getExpelMyelin();
  const myelinResult = myelin.distill();
  const experienceResult = distillExperience();
  slog('MYELIN-L4', `full distill: ${myelinResult.rules.length} myelin rules, ${experienceResult.rules.length} experience rules`);
  return { myelin: myelinResult, experience: experienceResult };
}

// --- Helpers ---

function loadEpisodes(): Episode[] {
  try {
    if (!fs.existsSync(EPISODES_PATH)) return [];
    const raw = fs.readFileSync(EPISODES_PATH, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').map((line) => JSON.parse(line) as Episode);
  } catch { return []; }
}

function mostCommon(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '', bestCount = 0;
  for (const [k, c] of counts) if (c > bestCount) { best = k; bestCount = c; }
  return best;
}

function topN(arr: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
