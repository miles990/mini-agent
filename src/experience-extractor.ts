/**
 * experience-extractor.ts — L4 Experience Rule Extraction Engine
 *
 * Implements ExpeL-style (Experience from Large Language Model Agents, AAAI 2024)
 * cross-task learning. Three stages:
 *
 *   1. Collect  — Append raw ExperienceRecord episodes to a JSONL pool.
 *   2. Abstract — Group by (taskType, outcome), extract common context/action
 *                 patterns, build "when X → do Y" rules with confidence scores.
 *   3. Apply    — Score and retrieve the top-N rules applicable to the current
 *                 task situation for injection into the LLM prompt.
 *
 * No parameter updates; pure in-context learning via prompt injection.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { slog } from './utils.js';
import type { ExperienceRecord, ExperienceRule, RuleGuidanceItem } from './crystallization-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECORDS_PATH = './memory/experience-records.jsonl';
const RULES_PATH = './memory/experience-rules.json';
const MAX_RECORDS = 500;
const MIN_GROUP_SIZE = 3;
const CONFIDENCE_THRESHOLD = 0.5;
const PRUNE_CONFIDENCE = 0.3;
const PRUNE_COUNTER_MIN = 5;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECENCY_BONUS = 0.1;
const MAX_RULES_RETURNED = 5;
const MAX_GUIDANCE_CHARS = 600;
const WHEN_SIMILARITY_THRESHOLD = 0.6;
const THEN_SIMILARITY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Helpers — file I/O
// ---------------------------------------------------------------------------

function ensureDir(filePath: string): void {
  try {
    const dir = filePath.split('/').slice(0, -1).join('/');
    if (dir) fs.mkdirSync(dir, { recursive: true });
  } catch { /* fire-and-forget */ }
}

function appendJSONL(filePath: string, data: unknown): void {
  try {
    ensureDir(filePath);
    fs.appendFileSync(filePath, JSON.stringify(data) + '\n');
  } catch { /* fire-and-forget */ }
}

function loadJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(filePath: string, data: unknown): void {
  try {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* fire-and-forget */ }
}

function loadRecords(): ExperienceRecord[] {
  try {
    if (!fs.existsSync(RECORDS_PATH)) return [];
    const content = fs.readFileSync(RECORDS_PATH, 'utf-8').trim();
    if (!content) return [];
    return content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as ExperienceRecord);
  } catch {
    return [];
  }
}

function rotateRecords(records: ExperienceRecord[]): ExperienceRecord[] {
  if (records.length <= MAX_RECORDS) return records;
  return records.slice(records.length - MAX_RECORDS);
}

// ---------------------------------------------------------------------------
// Helpers — text similarity (Jaccard index on word sets)
// ---------------------------------------------------------------------------

/** Tokenize a string into a set of lowercase words (length > 2). */
function tokenize(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[\s,;:.\/\-_]+/)
      .filter(t => t.length > 2),
  );
}

/** Jaccard similarity between two strings using their word sets. */
export function similarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Returns true if two rules are similar enough to be considered the same. */
function rulesAreSimilar(a: ExperienceRule, b: { when: string; then: string }): boolean {
  return (
    similarity(a.when, b.when) > WHEN_SIMILARITY_THRESHOLD &&
    similarity(a.then, b.then) > THEN_SIMILARITY_THRESHOLD
  );
}

// ---------------------------------------------------------------------------
// Helpers — rule construction
// ---------------------------------------------------------------------------

function makeId(): string {
  return `rule-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Find the most frequent value in an array. */
function mostFrequent(items: string[]): string {
  const freq = new Map<string, number>();
  for (const item of items) freq.set(item, (freq.get(item) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [k, c] of freq) {
    if (c > bestCount) { best = k; bestCount = c; }
  }
  return best;
}

/**
 * Extract the context keys whose values are identical across all records.
 * Returns a short human-readable summary string.
 */
function commonContextSummary(records: ExperienceRecord[]): string {
  if (records.length === 0) return '';
  const first = records[0].context;
  const commonKeys = Object.keys(first).filter(k =>
    records.every(r => String(r.context[k]) === String(first[k])),
  );
  return commonKeys
    .slice(0, 3)
    .map(k => `${k}=${String(first[k]).slice(0, 30)}`)
    .join(', ');
}

/**
 * Build an ExperienceRule candidate from a group of records sharing the same
 * (taskType, outcome) combination.
 */
function buildCandidateRule(
  taskType: string,
  records: ExperienceRecord[],
  kind: 'success' | 'failure',
): { when: string; then: string; tags: string[] } {
  const ctx = commonContextSummary(records);
  const when = ctx
    ? `taskType=${taskType} and context has ${ctx}`
    : `taskType=${taskType}`;
  const action = mostFrequent(records.map(r => r.action));
  const then = kind === 'success'
    ? `use action: ${action}`
    : `avoid action: ${action}`;
  return { when, then, tags: [taskType] };
}

// ---------------------------------------------------------------------------
// Stage 1 — Collect
// ---------------------------------------------------------------------------

/**
 * Append a task execution experience to the JSONL pool.
 * Rotates the file when the record count exceeds MAX_RECORDS.
 * Fire-and-forget: never throws.
 */
export function recordExperience(record: ExperienceRecord): void {
  try {
    // Load current records to check rotation
    const existing = loadRecords();
    if (existing.length >= MAX_RECORDS) {
      // Rotate: keep the most recent (MAX_RECORDS - 1) + new one
      const trimmed = rotateRecords([...existing, record]);
      saveJSON(RECORDS_PATH.replace('.jsonl', '-tmp.jsonl'), null); // unused, just for type compat
      try {
        ensureDir(RECORDS_PATH);
        fs.writeFileSync(
          RECORDS_PATH,
          trimmed.map(r => JSON.stringify(r)).join('\n') + '\n',
        );
      } catch { /* fire-and-forget */ }
    } else {
      appendJSONL(RECORDS_PATH, record);
    }
  } catch { /* fire-and-forget */ }
}

// ---------------------------------------------------------------------------
// Stage 3 — Apply
// ---------------------------------------------------------------------------

/**
 * Load rules from JSON, filter by taskType and confidence, score each rule,
 * and return the top 5 as RuleGuidanceItem[].
 *
 * Scoring:
 *   base        = rule.confidence
 *   recency     = +0.1 if lastApplied within 7 days
 *   supportRatio = supportCount / (supportCount + counterCount)
 *   final       = base * 0.5 + supportRatio * 0.5
 */
export function matchExperienceRules(
  taskType: string,
  _context: Record<string, unknown>,
): RuleGuidanceItem[] {
  try {
    const rules = loadJSON<ExperienceRule[]>(RULES_PATH, []);
    if (!Array.isArray(rules) || rules.length === 0) return [];

    const now = Date.now();

    const candidates = rules.filter(rule => {
      const tagMatch =
        Array.isArray(rule.tags) &&
        (rule.tags.includes(taskType) || rule.tags.includes('*'));
      const aboveThreshold = rule.confidence > CONFIDENCE_THRESHOLD;
      const supportDominates = rule.supportCount > rule.counterCount;
      return tagMatch && aboveThreshold && supportDominates;
    });

    const scored = candidates.map(rule => {
      const base = rule.confidence;
      const lastAppliedMs = new Date(rule.lastApplied).getTime();
      const recencyBonus =
        !isNaN(lastAppliedMs) && now - lastAppliedMs < RECENCY_WINDOW_MS
          ? RECENCY_BONUS
          : 0;
      const total = rule.supportCount + rule.counterCount;
      const supportRatio = total > 0 ? rule.supportCount / total : 0;
      const finalScore = (base + recencyBonus) * 0.5 + supportRatio * 0.5;
      return { rule, score: finalScore };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RULES_RETURNED)
      .map(({ rule }) => ({
        when: rule.when,
        then: rule.then,
        confidence: rule.confidence,
      }));
  } catch {
    return [];
  }
}

/**
 * Format a list of RuleGuidanceItem[] into a prompt-injectable XML block.
 *
 * Format:
 *   <experience-rules>
 *   • When [condition] → [action] (confidence%)
 *   </experience-rules>
 *
 * Capped at 5 rules and 600 total characters.
 */
export function buildExperienceGuidance(rules: RuleGuidanceItem[]): string {
  if (rules.length === 0) return '';

  const top = rules.slice(0, MAX_RULES_RETURNED);
  const lines: string[] = [];

  for (const rule of top) {
    const pct = Math.round(rule.confidence * 100);
    const line = `• When ${rule.when} → ${rule.then} (${pct}%)`;
    lines.push(line);
  }

  const body = `<experience-rules>\n${lines.join('\n')}\n</experience-rules>`;
  if (body.length <= MAX_GUIDANCE_CHARS) return body;

  // Truncate: rebuild with fewer lines until under budget
  for (let count = lines.length - 1; count >= 1; count--) {
    const truncated = `<experience-rules>\n${lines.slice(0, count).join('\n')}\n</experience-rules>`;
    if (truncated.length <= MAX_GUIDANCE_CHARS) return truncated;
  }

  // Last resort: hard-truncate the single-line version
  const single = `<experience-rules>\n${lines[0]}\n</experience-rules>`;
  return single.slice(0, MAX_GUIDANCE_CHARS);
}

// ---------------------------------------------------------------------------
// Stage 2 — Abstract (distillation)
// ---------------------------------------------------------------------------

/**
 * ExpeL-style three-stage distillation.
 *
 * Stage 1 — Collect:  Read all records from JSONL.
 * Stage 2 — Abstract: Group by (taskType, outcome); for groups >= 3 records,
 *                     extract common patterns and build candidate rules.
 *                     Also look for cross-task patterns (same action + outcome
 *                     across taskTypes → elevated confidence).
 * Stage 3 — Merge:    Merge candidates with existing rules via similarity.
 *                     Similar → increment supportCount.
 *                     Contradictory → increment counterCount.
 *                     Prune rules where confidence < 0.3 AND counterCount > 5.
 *
 * Returns counts of { newRules, updated }.
 */
export function distillExperienceRules(): { newRules: number; updated: number } {
  try {
    // --- Stage 1: Collect ---
    const records = loadRecords();
    if (records.length === 0) {
      // Still run merge/prune on existing rules
      return mergeAndPrune([], []);
    }

    // --- Stage 2: Abstract ---
    const candidates = abstractRules(records);

    // --- Stage 3: Merge ---
    return mergeAndPrune(candidates, loadJSON<ExperienceRule[]>(RULES_PATH, []));
  } catch (e) {
    slog('EXPEL', `distillExperienceRules error: ${String(e)}`);
    return { newRules: 0, updated: 0 };
  }
}

/** Group records and build candidate when/then tuples. */
function abstractRules(
  records: ExperienceRecord[],
): Array<{ when: string; then: string; tags: string[]; outcome: 'success' | 'failure'; count: number }> {
  // Group by taskType + outcome
  const groups = new Map<string, ExperienceRecord[]>();
  for (const record of records) {
    const key = `${record.taskType}::${record.outcome}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const candidates: Array<{
    when: string;
    then: string;
    tags: string[];
    outcome: 'success' | 'failure';
    count: number;
  }> = [];

  for (const [key, group] of groups) {
    if (group.length < MIN_GROUP_SIZE) continue;
    const [taskType, outcome] = key.split('::') as [string, 'success' | 'failure' | 'partial'];
    if (outcome !== 'success' && outcome !== 'failure') continue;
    const candidate = buildCandidateRule(taskType, group, outcome);
    candidates.push({ ...candidate, outcome, count: group.length });
  }

  // Cross-task rules: same action leading to same outcome across >=2 taskTypes
  const actionOutcomeMap = new Map<
    string,
    { taskTypes: Set<string>; count: number }
  >();
  for (const record of records) {
    const k = `${record.action}::${record.outcome}`;
    const entry = actionOutcomeMap.get(k) ?? { taskTypes: new Set(), count: 0 };
    entry.taskTypes.add(record.taskType);
    entry.count++;
    actionOutcomeMap.set(k, entry);
  }
  for (const [k, entry] of actionOutcomeMap) {
    if (entry.taskTypes.size >= 2 && entry.count >= MIN_GROUP_SIZE) {
      const [action, outcome] = k.split('::') as [string, 'success' | 'failure' | 'partial'];
      if (outcome !== 'success' && outcome !== 'failure') continue;
      const when = `action="${action}" across multiple task types`;
      const then = outcome === 'success'
        ? `use action: ${action} (works across task types)`
        : `avoid action: ${action} (fails across task types)`;
      candidates.push({ when, then, tags: ['*'], outcome, count: entry.count });
    }
  }

  return candidates;
}

/** Merge candidates into existing rules, prune weak ones, persist. */
function mergeAndPrune(
  candidates: Array<{ when: string; then: string; tags: string[]; outcome: 'success' | 'failure'; count: number }>,
  existingRules: ExperienceRule[],
): { newRules: number; updated: number } {
  if (!Array.isArray(existingRules)) existingRules = [];

  const rules = existingRules.map(r => ({ ...r })); // shallow clone each rule
  let newRules = 0;
  let updated = 0;
  const now = nowIso();

  for (const candidate of candidates) {
    // Check if any existing rule is similar
    const matchIndex = rules.findIndex(r => rulesAreSimilar(r, candidate));

    if (matchIndex !== -1) {
      // Merge: increment support (success candidate) or counter (failure candidate)
      const existing = rules[matchIndex]!;
      if (candidate.outcome === 'success') {
        existing.supportCount += 1;
      } else {
        existing.counterCount += 1;
      }
      const total = existing.supportCount + existing.counterCount;
      existing.confidence = total > 0 ? existing.supportCount / total : 0;
      existing.lastApplied = now;
      updated++;
    } else {
      // New rule
      const supportCount = candidate.outcome === 'success' ? candidate.count : 0;
      const counterCount = candidate.outcome === 'failure' ? candidate.count : 0;
      const total = supportCount + counterCount;
      const confidence = total > 0 ? supportCount / total : 0;
      const newRule: ExperienceRule = {
        id: makeId(),
        when: candidate.when,
        then: candidate.then,
        confidence,
        supportCount,
        counterCount,
        createdAt: now,
        lastApplied: now,
        tags: candidate.tags,
      };
      rules.push(newRule);
      newRules++;
    }
  }

  // Prune rules that are both low-confidence and heavily contradicted
  const pruned = rules.filter(
    r => !(r.confidence < PRUNE_CONFIDENCE && r.counterCount > PRUNE_COUNTER_MIN),
  );

  saveJSON(RULES_PATH, pruned);
  slog('EXPEL', `distill: +${newRules} new, ${updated} updated, ${pruned.length} total rules`);
  return { newRules, updated };
}

// ---------------------------------------------------------------------------
// applyRuleOutcome — feedback loop
// ---------------------------------------------------------------------------

/**
 * Update a rule's support/counter count after it was applied in the field.
 * Recalculates confidence and updates lastApplied timestamp.
 */
export function applyRuleOutcome(
  ruleId: string,
  outcome: 'success' | 'failure',
): void {
  try {
    const rules = loadJSON<ExperienceRule[]>(RULES_PATH, []);
    if (!Array.isArray(rules)) return;

    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;

    if (outcome === 'success') {
      rule.supportCount += 1;
    } else {
      rule.counterCount += 1;
    }
    const total = rule.supportCount + rule.counterCount;
    rule.confidence = total > 0 ? rule.supportCount / total : 0;
    rule.lastApplied = nowIso();

    saveJSON(RULES_PATH, rules);
  } catch (e) {
    slog('EXPEL', `applyRuleOutcome error: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// getExperienceStats
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics for observability.
 */
export function getExperienceStats(): {
  totalRecords: number;
  totalRules: number;
  avgConfidence: number;
  topRules: string[];
} {
  try {
    const records = loadRecords();
    const rules = loadJSON<ExperienceRule[]>(RULES_PATH, []);
    const validRules = Array.isArray(rules) ? rules : [];

    const totalRecords = records.length;
    const totalRules = validRules.length;
    const avgConfidence =
      totalRules === 0
        ? 0
        : validRules.reduce((sum, r) => sum + r.confidence, 0) / totalRules;

    const topRules = [...validRules]
      .sort((a, b) => b.confidence * b.supportCount - a.confidence * a.supportCount)
      .slice(0, 5)
      .map(r => `When ${r.when} → ${r.then} (${Math.round(r.confidence * 100)}%)`);

    return { totalRecords, totalRules, avgConfidence, topRules };
  } catch {
    return { totalRecords: 0, totalRules: 0, avgConfidence: 0, topRules: [] };
  }
}
