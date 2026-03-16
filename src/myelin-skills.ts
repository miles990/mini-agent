/**
 * myelin-skills — L3 Skill Library Crystallization
 *
 * Crystallizes successful multi-step delegation patterns into reusable skill
 * templates. When the agent sees a familiar task type, it can reuse a proven
 * action sequence instead of generating one from scratch.
 *
 * Part of the 5-level crystallization system:
 *   L1: Route Crystallization (myelin triage)
 *   L2: Playbook Crystallization (thinking strategies)
 * → L3: Skill Library (composable action sequences)  ← this file
 *   L4: Experience Rules (ExpeL-style cross-task learning)
 *   L5: Cognitive Compiler (SOAR-style chunking)
 */

import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats, TriageResult } from 'myelinate';
import fs from 'node:fs';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

/** Skill triage actions */
export type SkillAction = 'reuse-skill' | 'adapt-skill' | 'novel-task';

/** What gets recorded when a delegation completes */
export interface DelegationOutcome {
  taskType: string;          // 'research', 'code', 'learn', 'review', 'shell', 'create'
  promptFingerprint: string; // First 200 chars of prompt, normalized
  toolsUsed: string[];       // Extracted tool/source markers
  duration: number;          // ms
  success: boolean;          // Did it produce useful output?
  outputQuality: number;     // 0-10 estimate
  outputLength: number;
}

/** A reusable skill template */
export interface CrystallizedSkill {
  id: string;
  name: string;
  taskPattern: string;       // What kind of task this handles
  promptTemplate: string;    // Template with {{placeholders}}
  expectedTools: string[];
  avgDuration: number;
  successRate: number;
  hitCount: number;
  createdAt: string;
}

// =============================================================================
// Constants
// =============================================================================

const RULES_PATH = './memory/myelin-skill-rules.json';
const LOG_PATH = './memory/myelin-skill-decisions.jsonl';
const SKILLS_LIBRARY_PATH = './memory/myelin-skills-library.json';

/** Known task patterns that map to reuse-skill */
const KNOWN_PATTERNS = new Set([
  'research', 'code-review', 'learn-topic', 'learn',
  'review', 'code', 'create',
]);

/** Partial-match patterns that map to adapt-skill */
const PARTIAL_PATTERNS = new Set([
  'shell', 'debug', 'refactor', 'test', 'analyze',
]);

// =============================================================================
// Singleton
// =============================================================================

let _instance: Myelin<SkillAction> | null = null;

/** Get or create the singleton skill myelin instance. */
export function getSkillMyelin(): Myelin<SkillAction> {
  if (!_instance) {
    _instance = createMyelin<SkillAction>({
      llm: async (event) => {
        // Simple heuristic — if task type matches known patterns, suggest reuse;
        // if partially matching, adapt; else novel.
        // Over time, myelin will crystallize these into zero-cost rules.
        const taskType = String(event.context?.taskType ?? '').toLowerCase();
        const prompt = String(event.context?.prompt ?? '').toLowerCase();

        // Exact known pattern → reuse
        if (KNOWN_PATTERNS.has(taskType)) {
          return { action: 'reuse-skill', reason: `known pattern: ${taskType}` };
        }

        // Partial match → adapt
        if (PARTIAL_PATTERNS.has(taskType)) {
          return { action: 'adapt-skill', reason: `partial pattern: ${taskType}` };
        }

        // Check prompt content for pattern signals
        const hasResearchSignals = /research|survey|arXiv|investigate|study|explore/i.test(prompt);
        const hasCodeSignals = /implement|fix|refactor|write code|function|module/i.test(prompt);
        const hasLearnSignals = /learn|understand|explain|what is|how does/i.test(prompt);
        const hasReviewSignals = /review|check|audit|verify|look at/i.test(prompt);

        if (hasResearchSignals || hasCodeSignals || hasLearnSignals || hasReviewSignals) {
          return { action: 'adapt-skill', reason: 'prompt content matches known signal' };
        }

        return { action: 'novel-task', reason: 'no matching pattern' };
      },
      rulesPath: RULES_PATH,
      logPath: LOG_PATH,
      autoLog: true,
      failOpenAction: 'novel-task' as SkillAction,
      crystallize: {
        minOccurrences: 5,
        minConsistency: 0.80,
      },
    });
    slog('MYELIN-L3', 'Initialized skill library layer — delegation crystallization active');
  }
  return _instance;
}

// =============================================================================
// Skills Library I/O
// =============================================================================

/** Load skills from the library file. */
function loadSkillsLibrary(): CrystallizedSkill[] {
  try {
    if (!fs.existsSync(SKILLS_LIBRARY_PATH)) return [];
    const data = fs.readFileSync(SKILLS_LIBRARY_PATH, 'utf-8');
    return JSON.parse(data) as CrystallizedSkill[];
  } catch {
    return [];
  }
}

/** Persist skills library to disk. */
function saveSkillsLibrary(skills: CrystallizedSkill[]): void {
  try {
    fs.writeFileSync(SKILLS_LIBRARY_PATH, JSON.stringify(skills, null, 2));
  } catch (err) {
    slog('MYELIN-L3', `Failed to save skills library: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

// =============================================================================
// Record Delegation Outcome
// =============================================================================

/**
 * Record a completed delegation for future crystallization.
 * Fire-and-forget — never throws.
 * Calls myelin.triage() with the outcome data so the pattern is logged.
 */
export function recordDelegationOutcome(outcome: DelegationOutcome): void {
  try {
    const myelin = getSkillMyelin();
    myelin.triage({
      type: outcome.taskType,
      source: outcome.taskType,
      context: {
        taskType: outcome.taskType,
        prompt: outcome.promptFingerprint,
        toolsUsed: outcome.toolsUsed.join(','),
        toolCount: outcome.toolsUsed.length,
        duration: outcome.duration,
        success: outcome.success,
        outputQuality: outcome.outputQuality,
        outputLength: outcome.outputLength,
      },
    });
    slog('MYELIN-L3', `Recorded delegation: ${outcome.taskType} (${outcome.success ? 'ok' : 'fail'}, quality=${outcome.outputQuality}, ${outcome.duration}ms)`);
  } catch {
    // fire-and-forget — never throws
  }
}

// =============================================================================
// Match Skill
// =============================================================================

/**
 * Match a task to a crystallized skill.
 * Checks myelin rules first, then looks up skill from the skills library.
 */
export async function matchSkill(
  taskType: string,
  prompt: string,
): Promise<{
  action: SkillAction;
  skill: CrystallizedSkill | null;
  result: TriageResult<SkillAction>;
}> {
  const myelin = getSkillMyelin();

  const result = await myelin.triage({
    type: taskType,
    source: taskType,
    context: {
      taskType,
      prompt: prompt.slice(0, 200),
      promptLength: prompt.length,
    },
  });

  // Look up matching skill from library
  let skill: CrystallizedSkill | null = null;
  if (result.action === 'reuse-skill' || result.action === 'adapt-skill') {
    const skills = loadSkillsLibrary();
    skill = skills.find(s => s.taskPattern === taskType) ?? null;

    // If no exact match, try partial match on task pattern
    if (!skill) {
      skill = skills.find(s =>
        taskType.includes(s.taskPattern) || s.taskPattern.includes(taskType),
      ) ?? null;
    }

    // If we found a skill, bump its hit count
    if (skill) {
      skill.hitCount += 1;
      const allSkills = loadSkillsLibrary();
      const idx = allSkills.findIndex(s => s.id === skill!.id);
      if (idx >= 0) {
        allSkills[idx] = skill;
        saveSkillsLibrary(allSkills);
      }
    }
  }

  const emoji = result.method === 'rule' ? '⚡' : '🧠';
  slog('MYELIN-L3', `${emoji} match: ${taskType} → ${result.action} (${result.latencyMs}ms ${result.method})${skill ? ` [skill: ${skill.name}]` : ''}`);

  return { action: result.action, skill, result };
}

// =============================================================================
// Stats
// =============================================================================

/** Get skill myelin stats for observability. */
export function getSkillStats(): MyelinStats {
  return getSkillMyelin().stats();
}

// =============================================================================
// Distillation
// =============================================================================

/**
 * Run distillation on the skill myelin + update skills library.
 * Analyzes logged delegation patterns and extracts new skills.
 * Returns counts of rules, templates, and skills.
 */
export function distillSkills(): { rules: number; templates: number; skills: number } {
  const myelin = getSkillMyelin();
  const distillResult = myelin.distill();

  const ruleCount = distillResult.rules.length;
  const templateCount = distillResult.templates.length;

  // Extract new skills from templates
  // Templates represent stable patterns — each can become a skill
  const existingSkills = loadSkillsLibrary();
  const existingIds = new Set(existingSkills.map(s => s.id));
  let newSkillCount = 0;

  for (const template of distillResult.templates) {
    // Use template action + invariant source as the pattern key
    const patternKey = template.invariants?.source ?? template.action ?? 'unknown';
    const skillId = `skill-${patternKey}-${Date.now()}`;

    // Skip if we already have a skill for this pattern
    if (existingSkills.some(s => s.taskPattern === patternKey)) continue;
    if (existingIds.has(skillId)) continue;

    const newSkill: CrystallizedSkill = {
      id: skillId,
      name: template.name || patternKey,
      taskPattern: patternKey,
      promptTemplate: `Handle {{taskType}} task: {{prompt}}`,
      expectedTools: template.variables.filter(v => v.includes('tool')),
      avgDuration: 0,
      successRate: template.ruleCount > 0 ? 1.0 : 0,
      hitCount: template.totalHits,
      createdAt: new Date().toISOString(),
    };

    existingSkills.push(newSkill);
    newSkillCount++;
    slog('MYELIN-L3', `Crystallized new skill: ${newSkill.name} (pattern: ${newSkill.taskPattern}, hits: ${newSkill.hitCount})`);
  }

  if (newSkillCount > 0) {
    saveSkillsLibrary(existingSkills);
  }

  slog('MYELIN-L3', `Distill complete: ${ruleCount} rules, ${templateCount} templates, ${existingSkills.length} total skills (+${newSkillCount} new)`);

  return {
    rules: ruleCount,
    templates: templateCount,
    skills: existingSkills.length,
  };
}

// =============================================================================
// Format Skill for Prompt Injection
// =============================================================================

/**
 * Format a crystallized skill for prompt injection.
 * Returns XML-style block for LLM consumption, or empty string if null.
 */
export function formatSkillForPrompt(skill: CrystallizedSkill | null): string {
  if (!skill) return '';

  const steps = skill.promptTemplate
    .split(/\n|(?:{{)/)
    .filter(s => s.trim().length > 0)
    .slice(0, 5);

  const stepLines = steps.map((s, i) => `${i + 1}. ${s.replace(/}}/g, '').trim()}`).join('\n');
  const tools = skill.expectedTools.join(', ') || 'general';
  const avgSec = skill.avgDuration > 0 ? `~${Math.round(skill.avgDuration / 1000)}s` : 'unknown';

  return `<skill name="${skill.name}" success-rate="${skill.successRate.toFixed(2)}">
已知有效的作法：
${stepLines}
預期工具：${tools}
預期時間：${avgSec}
</skill>`;
}
