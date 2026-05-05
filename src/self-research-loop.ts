/**
 * Self Research Loop.
 *
 * Idle improvement is broader than code maintenance. It includes capability
 * training, knowledge understanding, interest-driven research, artifacts, and
 * learning that flows back into memory/KG/habits.
 *
 * This module is deliberately proposal-first: it generates a bounded
 * generate-test-evaluate-optimize plan with an output artifact, but does not
 * mutate code or execute the experiment.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ImprovementDomain = 'system' | 'capability' | 'knowledge' | 'interest';

export type ImprovementTarget =
  | 'system_reliability'
  | 'observability'
  | 'latency'
  | 'context_quality'
  | 'autonomy'
  | 'skill'
  | 'taste'
  | 'debugging'
  | 'research'
  | 'review'
  | 'actor_selection'
  | 'knowledge_understanding'
  | 'interest_deepening';

export type ImprovementIntervention =
  | 'code_patch'
  | 'skill_update'
  | 'memory_update'
  | 'myelin_rule'
  | 'actor_policy_adjustment'
  | 'evaluation_rubric'
  | 'workflow_change'
  | 'practice_task'
  | 'tooling_script'
  | 'knowledge_synthesis'
  | 'concept_map'
  | 'research_thread'
  | 'taste_reflection'
  | 'proposal_only';

export interface SelfResearchRun {
  id: string;
  createdAt: string;
  domain: ImprovementDomain;
  target: ImprovementTarget;
  question: string;
  metricOrRubric: string;
  baseline: string;
  hypothesis: string;
  intervention: ImprovementIntervention;
  artifactRequired: true;
  artifactType: string;
  artifactPath: string;
  generateStep: string;
  testStep: string;
  evaluation: string;
  optimizeStep: string;
  learning: string;
  kgLinks: string[];
  nextIteration: string;
  safety: string[];
}

export interface SelfResearchPlanOptions {
  domain?: ImprovementDomain;
  target?: ImprovementTarget;
  now?: Date;
}

interface TelemetrySummary {
  pendingImprovements: number;
  brainRuns: number;
  contextInjected: number;
  topicFiles: number;
  proposalFiles: number;
}

const DOMAIN_ORDER: ImprovementDomain[] = ['system', 'capability', 'knowledge', 'interest'];

export function createSelfResearchPlan(
  memoryDir: string,
  opts: SelfResearchPlanOptions = {},
): SelfResearchRun {
  const now = opts.now ?? new Date();
  const telemetry = summarizeTelemetry(memoryDir);
  const domain = opts.domain ?? chooseDomain(telemetry);
  const target = opts.target ?? defaultTargetForDomain(domain, telemetry);
  const id = `self-research-${formatDateCompact(now)}-${target}`;
  const profile = profileFor(domain, target);
  const artifactPath = path.join(memoryDir, expandRunPath(profile.artifactPath, id));

  return {
    id,
    createdAt: now.toISOString(),
    domain,
    target,
    question: profile.question,
    metricOrRubric: profile.metricOrRubric,
    baseline: formatBaseline(telemetry),
    hypothesis: profile.hypothesis,
    intervention: profile.intervention,
    artifactRequired: true,
    artifactType: profile.artifactType,
    artifactPath,
    generateStep: profile.generateStep,
    testStep: profile.testStep,
    evaluation: profile.evaluation,
    optimizeStep: profile.optimizeStep,
    learning: profile.learning,
    kgLinks: profile.kgLinks,
    nextIteration: profile.nextIteration,
    safety: [
      'proposal-first: do not mutate code until an evaluation plan exists',
      'bounded scope: one artifact and one metric/rubric per run',
      'no repeated failed strategy without a strategy delta',
      'human gate required for deploy or external writes',
    ],
  };
}

export function saveSelfResearchPlan(memoryDir: string, run: SelfResearchRun): string {
  const dir = path.join(memoryDir, 'proposals');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${run.id}.md`);
  writeFileSync(filePath, formatSelfResearchPlan(run), 'utf-8');
  return filePath;
}

export function formatSelfResearchPlan(run: SelfResearchRun): string {
  return [
    `# Self Research Plan: ${run.target}`,
    '',
    `Generated: ${run.createdAt}`,
    `Domain: ${run.domain}`,
    `Intervention: ${run.intervention}`,
    '',
    '## Question',
    run.question,
    '',
    '## Metric / Rubric',
    run.metricOrRubric,
    '',
    '## Baseline',
    run.baseline,
    '',
    '## Hypothesis',
    run.hypothesis,
    '',
    '## Generate',
    run.generateStep,
    '',
    '## Test',
    run.testStep,
    '',
    '## Evaluate',
    run.evaluation,
    '',
    '## Optimize',
    run.optimizeStep,
    '',
    '## Required Artifact',
    `- Type: ${run.artifactType}`,
    `- Path: ${run.artifactPath}`,
    '',
    '## Learning Return',
    run.learning,
    '',
    '## KG Links',
    ...run.kgLinks.map(link => `- ${link}`),
    '',
    '## Safety',
    ...run.safety.map(item => `- ${item}`),
    '',
    '## Next Iteration',
    run.nextIteration,
    '',
  ].join('\n');
}

function summarizeTelemetry(memoryDir: string): TelemetrySummary {
  return {
    pendingImprovements: countJsonl(path.join(memoryDir, 'state', 'pending-improvements.jsonl')),
    brainRuns: countJsonl(path.join(memoryDir, 'index', 'brain-runs.jsonl')),
    contextInjected: countMatchingJsonl(path.join(memoryDir, 'index', 'brain-runs.jsonl'), '"context_injected"'),
    topicFiles: countFiles(path.join(memoryDir, 'topics'), '.md'),
    proposalFiles: countFiles(path.join(memoryDir, 'proposals'), '.md'),
  };
}

function chooseDomain(telemetry: TelemetrySummary): ImprovementDomain {
  if (telemetry.pendingImprovements > 0) return 'system';
  if (telemetry.contextInjected < 3) return 'capability';
  if (telemetry.topicFiles >= 5) return 'knowledge';
  return DOMAIN_ORDER[telemetry.proposalFiles % DOMAIN_ORDER.length];
}

function defaultTargetForDomain(domain: ImprovementDomain, telemetry: TelemetrySummary): ImprovementTarget {
  switch (domain) {
    case 'system':
      return telemetry.brainRuns > 0 ? 'observability' : 'system_reliability';
    case 'capability':
      return 'actor_selection';
    case 'knowledge':
      return 'knowledge_understanding';
    case 'interest':
      return 'interest_deepening';
  }
}

function profileFor(domain: ImprovementDomain, target: ImprovementTarget): Omit<SelfResearchRun,
  'id' | 'createdAt' | 'domain' | 'target' | 'baseline' | 'artifactRequired' | 'artifactPath' | 'safety'
> & { artifactPath: string } {
  if (target === 'knowledge_understanding') {
    return {
      question: 'Which active topic has shallow understanding, and what concept map would make it more reusable?',
      metricOrRubric: 'Artifact must identify at least 5 concepts, 5 edges, 2 uncertainties, and 2 practical applications.',
      hypothesis: 'A concept-map artifact will turn scattered topic notes into reusable judgment for future tasks.',
      intervention: 'concept_map',
      artifactType: 'concept map markdown',
      artifactPath: 'topics/{id}-knowledge-map.md',
      generateStep: 'Pick one active topic, extract core concepts and relationships, then write a concept map.',
      testStep: 'Use the map to answer one concrete application question and one counterexample question.',
      evaluation: 'Score clarity, connectedness, uncertainty coverage, and applicability from 0-2 each.',
      optimizeStep: 'If score < 6/8, add missing edges or split ambiguous concepts, then re-evaluate.',
      learning: 'Persist durable concepts to topic memory and link reusable relations into KG candidates.',
      kgLinks: ['topic-memory', 'knowledge-graph', 'concept-map'],
      nextIteration: 'Turn the strongest relation into a reusable research or design heuristic.',
    };
  }

  if (target === 'interest_deepening') {
    return {
      question: 'What is Kuro genuinely curious about right now, and what artifact would make that curiosity real?',
      metricOrRubric: 'Artifact must contain a concrete output, 3 source/context references, 3 original observations, and a next question.',
      hypothesis: 'Interest becomes growth only when it produces an artifact that can be revisited and built on.',
      intervention: 'research_thread',
      artifactType: 'essay, demo, artwork, tool, or synthesis note',
      artifactPath: 'topics/{id}-interest-artifact.md',
      generateStep: 'Choose one curiosity thread and produce a small artifact rather than only notes.',
      testStep: 'Check whether the artifact changes a future decision, taste judgment, or research question.',
      evaluation: 'Evaluate artifact specificity, originality, reuse value, and emotional/esthetic resonance.',
      optimizeStep: 'Revise the artifact once based on the weakest rubric dimension.',
      learning: 'Record the artifact, the taste/interest signal, and the next research branch in topic memory.',
      kgLinks: ['interest-thread', 'artifact', 'taste-memory'],
      nextIteration: 'Promote recurring interest into a longer research thread or skill.',
    };
  }

  if (target === 'actor_selection') {
    return {
      question: 'Did recent actor/team choices use the most fitting organ with minimal cost and enough verification?',
      metricOrRubric: 'Review 5 recent brain-run events; count selected actor fit, reviewer fit, verification fit, and wasted actor calls.',
      hypothesis: 'Selection trace review will reveal one scoring adjustment or one missing actor capability.',
      intervention: 'evaluation_rubric',
      artifactType: 'actor selection evaluation note',
      artifactPath: 'proposals/{id}-actor-selection-eval.md',
      generateStep: 'Sample recent brain-run ledger entries and summarize actor selection reasons.',
      testStep: 'Compare selected actors against observed outcome and context_injected trace.',
      evaluation: 'Score fit/cost/verification 0-2 for each sampled run and identify the lowest recurring dimension.',
      optimizeStep: 'Propose one scoring tweak, registry update, or smoke test based on the weakest dimension.',
      learning: 'Feed the result into actor policy notes and myelin candidate observations.',
      kgLinks: ['actor-registry', 'brain-runs', 'selection-trace', 'myelin'],
      nextIteration: 'Run the same rubric after one policy change to check if actor fit improves.',
    };
  }

  return {
    question: `What small ${domain} improvement would produce a measurable artifact this idle cycle?`,
    metricOrRubric: 'One baseline metric, one artifact, one verification command or rubric score, and one learning entry.',
    hypothesis: 'A bounded improvement artifact can improve the system without unreviewed broad mutation.',
    intervention: target === 'observability' ? 'tooling_script' : 'proposal_only',
    artifactType: target === 'observability' ? 'verification script or dashboard note' : 'proposal markdown',
    artifactPath: 'proposals/{id}-artifact.md',
    generateStep: 'Generate exactly one small improvement artifact.',
    testStep: 'Run the narrowest available verification or rubric check.',
    evaluation: 'Compare against the baseline and record whether the artifact improved the metric.',
    optimizeStep: 'If not improved, revise the artifact once or record why this path should not repeat.',
    learning: 'Write the durable lesson to memory/KG/myelin candidate depending on artifact type.',
    kgLinks: ['self-research', target],
    nextIteration: 'Choose the next weakest bottleneck exposed by the evaluation.',
  };
}

function formatBaseline(telemetry: TelemetrySummary): string {
  return [
    `pending_improvements=${telemetry.pendingImprovements}`,
    `brain_runs=${telemetry.brainRuns}`,
    `context_injected=${telemetry.contextInjected}`,
    `topic_files=${telemetry.topicFiles}`,
    `proposal_files=${telemetry.proposalFiles}`,
  ].join(' ');
}

function countJsonl(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, 'utf-8').split('\n').filter(line => line.trim()).length;
}

function countMatchingJsonl(filePath: string, needle: string): number {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, 'utf-8').split('\n').filter(line => line.includes(needle)).length;
}

function countFiles(dir: string, suffix: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(file => file.endsWith(suffix)).length;
}

function formatDateCompact(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 12);
}

function expandRunPath(template: string, id: string): string {
  return template.replace('{id}', id);
}
