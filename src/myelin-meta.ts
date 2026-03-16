/**
 * myelin-meta — L5 Meta-Cognitive Compiler.
 *
 * Aggregates patterns from L2 (Playbook), L3 (Skills), and L4 (ExpeL)
 * to compile higher-order decision principles and self-model insights.
 * Thin at first — intelligence grows as L2-L4 accumulate data.
 */

import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats, Methodology } from 'myelinate';
import fs from 'node:fs';
import { slog } from './utils.js';

// -- Types --------------------------------------------------------------------

export type MetaAction = 'exploit' | 'explore' | 'reflect' | 'delegate' | 'pause';

export interface MetaPrinciple {
  id: string;
  principle: string;
  evidence: string;
  confidence: number;
  appliesWhen: string[];
  createdAt: string;
}

export interface CognitiveProfile {
  strengths: string[];
  weaknesses: string[];
  biases: string[];
  updatedAt: string;
}

interface MetaProfile {
  principles: MetaPrinciple[];
  profile: CognitiveProfile;
  updatedAt: string;
}

// -- Paths --------------------------------------------------------------------

const RULES_PATH = './memory/myelin-meta-rules.json';
const LOG_PATH = './memory/myelin-meta-decisions.jsonl';
const PROFILE_PATH = './memory/myelin-meta-profile.json';

// -- Singleton ----------------------------------------------------------------

let _instance: Myelin<MetaAction> | null = null;

export function getMetaMyelin(): Myelin<MetaAction> {
  if (!_instance) {
    _instance = createMyelin<MetaAction>({
      llm: async (event) => {
        const ctx = event.context ?? {};
        const familiarity = Number(ctx.playbookHitRate ?? 0);
        const successRate = Number(ctx.recentSuccessRate ?? 0);
        const ruleCount = Number(ctx.experienceRuleCount ?? 0);
        const cycleTime = Number(ctx.cycleTime ?? 0);
        const complexity = Number(ctx.complexity ?? 0);
        const consecutiveFailures = Number(ctx.consecutiveFailures ?? 0);

        // High familiarity + high success → exploit known strategy
        if (familiarity > 0.7 && successRate > 0.8) {
          return { action: 'exploit', reason: 'high familiarity + success — use known strategy' };
        }

        // Consecutive failures → step back and reflect
        if (consecutiveFailures >= 3) {
          return { action: 'reflect', reason: `${consecutiveFailures} consecutive failures — reassess` };
        }

        // High complexity → delegate to background
        if (complexity > 0.8) {
          return { action: 'delegate', reason: 'high complexity — offload to background' };
        }

        // Long cycle time → decision fatigue
        if (cycleTime > 30000) {
          return { action: 'pause', reason: 'long cycle time — reduce complexity' };
        }

        // Low familiarity → explore
        if (familiarity < 0.3 || ruleCount < 5) {
          return { action: 'explore', reason: 'low familiarity — try new approach' };
        }

        // Default: moderate territory, exploit with caution
        return { action: 'exploit', reason: 'moderate familiarity — apply known patterns' };
      },
      rulesPath: RULES_PATH,
      logPath: LOG_PATH,
      failOpenAction: 'explore' as MetaAction,
      crystallize: { minOccurrences: 10, minConsistency: 0.85 },
    });
    slog('MYELIN-L5', 'Initialized meta-cognitive compiler');
  }
  return _instance;
}

// -- compileMeta — aggregate L2-L4 stats into principles + self-model --------

export function compileMeta(input: {
  playbookHitRate: number;
  topPlaybooks: string[];
  skillReuseRate: number;
  topSkills: string[];
  experienceRuleCount: number;
  recentSuccessRate: number;
}): { principles: MetaPrinciple[]; profile: CognitiveProfile } {
  const myelin = getMetaMyelin();

  // Record the aggregated stats as a meta-observation
  myelin.triage({
    type: 'meta-compile',
    source: 'L5-compiler',
    context: {
      playbookHitRate: input.playbookHitRate,
      skillReuseRate: input.skillReuseRate,
      experienceRuleCount: input.experienceRuleCount,
      recentSuccessRate: input.recentSuccessRate,
      topPlaybookCount: input.topPlaybooks.length,
      topSkillCount: input.topSkills.length,
    },
  });

  // Evolve to get updated methodology
  let methodology: Methodology | undefined;
  try {
    const result = myelin.evolve();
    methodology = result.distill.methodology;
  } catch {
    slog('MYELIN-L5', 'evolve() not ready — insufficient data');
  }

  // Extract MetaPrinciples from methodology
  const principles: MetaPrinciple[] = (methodology?.principles ?? []).map((p, i) => ({
    id: `meta-${i}`,
    principle: p.description,
    evidence: p.supportingTemplates.join(', ') || 'inferred from patterns',
    confidence: p.confidence,
    appliesWhen: [p.when],
    createdAt: methodology?.generatedAt ?? new Date().toISOString(),
  }));

  // Build cognitive profile from input signals
  const profile = buildProfile(input);

  // Persist
  const payload: MetaProfile = {
    principles,
    profile,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(payload, null, 2));
  } catch { /* non-critical */ }

  slog('MYELIN-L5', `Compiled: ${principles.length} principles, profile updated`);
  return { principles, profile };
}

// -- Profile builder ----------------------------------------------------------

function buildProfile(input: Parameters<typeof compileMeta>[0]): CognitiveProfile {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const biases: string[] = [];

  if (input.playbookHitRate > 0.7) strengths.push('Strong pattern recognition — playbooks hit often');
  if (input.skillReuseRate > 0.6) strengths.push('Good skill reuse — composable action sequences');
  if (input.recentSuccessRate > 0.8) strengths.push('High recent success rate');
  if (input.experienceRuleCount > 20) strengths.push('Rich experience base — many distilled rules');

  if (input.playbookHitRate < 0.3) weaknesses.push('Low playbook coverage — many novel situations');
  if (input.skillReuseRate < 0.2) weaknesses.push('Low skill reuse — not leveraging learned sequences');
  if (input.recentSuccessRate < 0.5) weaknesses.push('Below-average recent success rate');

  if (input.playbookHitRate > 0.9 && input.skillReuseRate < 0.3) {
    biases.push('Over-reliance on playbooks without skill composition');
  }
  if (input.recentSuccessRate > 0.9 && input.experienceRuleCount < 5) {
    biases.push('Success without reflection — may lack generalizable lessons');
  }
  if (input.topPlaybooks.length <= 2 && input.playbookHitRate > 0.5) {
    biases.push('Narrow playbook usage — may be stuck in familiar patterns');
  }

  return { strengths, weaknesses, biases, updatedAt: new Date().toISOString() };
}

// -- Accessors ----------------------------------------------------------------

export function getMetaPrinciples(): MetaPrinciple[] {
  try {
    const data: MetaProfile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
    return data.principles ?? [];
  } catch {
    return [];
  }
}

export function formatMetaForPrompt(): string {
  const principles = getMetaPrinciples();
  if (principles.length === 0) return '';

  let profile: CognitiveProfile | undefined;
  try {
    const data: MetaProfile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
    profile = data.profile;
  } catch { /* no profile yet */ }

  const lines: string[] = ['<metacognition>'];
  lines.push('Decision principles (from L2-L4 patterns):');
  for (const p of principles) {
    lines.push(`- ${p.principle} (confidence: ${Math.round(p.confidence * 100)}%)`);
  }

  if (profile) {
    if (profile.strengths.length > 0) {
      lines.push(`Self-model:`);
      lines.push(`- Strengths: ${profile.strengths.join('; ')}`);
    }
    if (profile.biases.length > 0) {
      lines.push(`- Watch out: ${profile.biases.join('; ')}`);
    }
  }

  lines.push('</metacognition>');
  return lines.join('\n');
}

export function getMetaStats(): MyelinStats {
  return getMetaMyelin().stats();
}

export function distillMeta(): { rules: number; principles: number } {
  const myelin = getMetaMyelin();
  const result = myelin.distill();
  const principleCount = getMetaPrinciples().length;
  slog('MYELIN-L5', `Distill: ${result.rules.length} rules, ${principleCount} principles`);
  return { rules: result.rules.length, principles: principleCount };
}
