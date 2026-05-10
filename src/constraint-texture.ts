/**
 * Constraint Texture — explicit execution constraints for brain orchestration.
 *
 * Scheduler chooses which DAG receives attention. DAG planner decomposes work.
 * Arbiter chooses actors per node. Runtime executes. This module keeps the
 * hard constraints shared across those layers instead of burying them in
 * arbiter branch logic.
 */

import type {
  DecisionBudget,
  EvaluatorTexture,
  ModelExecutionTier,
  PromptTexture,
  QualityCriterionType,
  WorkIntent,
  WorkItem,
  WorkRisk,
} from './brain-types.js';

const CHEAP_LOCAL_INTENTS = new Set<WorkIntent>(['json', 'summarize']);
const CODING_INTENTS = new Set<WorkIntent>(['code', 'diagnose']);
const PEER_REVIEW_INTENTS = new Set<WorkIntent>(['architecture', 'memory', 'policy']);
const REVIEW_INTENTS = new Set<WorkIntent>(['review', 'plan', 'research']);

export type ConstraintKind =
  | 'deterministic_execution'
  | 'human_gate'
  | 'provider_claims'
  | 'peer_critique'
  | 'write_lease';

export interface WorkConstraint {
  kind: ConstraintKind;
  required: boolean;
  reason: string;
}

export interface ConstraintTexture {
  taskId: string;
  intent: WorkIntent;
  risk: WorkRisk;
  profile: ConstraintTextureProfile;
  decisionBudget: DecisionBudget;
  humanApprovalRequired: boolean;
  writeLeaseRequired: boolean;
  kgClaimsRequired: boolean;
  peerCritiqueRequired: boolean;
  deterministicExecution: boolean;
  constraints: WorkConstraint[];
}

export interface ConstraintTextureProfile {
  criterionType: QualityCriterionType;
  promptTexture: PromptTexture;
  evaluatorTexture: EvaluatorTexture;
  modelTier: ModelExecutionTier;
  useReflect: boolean;
  rationale: string[];
}

export interface ConstraintTextureOptions {
  forceAkariForP0?: boolean;
}

export function deriveConstraintTexture(
  item: WorkItem,
  opts: ConstraintTextureOptions = {},
): ConstraintTexture {
  const profile = deriveTextureProfile(item);
  const deterministicExecution = item.intent === 'verify'
    || (profile.criterionType === 'mechanical' && item.risk === 'read_only' && !isCodingIntent(item.intent));
  const humanApprovalRequired = item.risk === 'deploy' || item.risk === 'external_write';
  const peerCritiqueRequired = needsPeerCritic(item, opts);
  const writeLeaseRequired = humanApprovalRequired
    ? Boolean(item.writeScope?.length)
    : item.risk === 'workspace_write' || Boolean(item.writeScope?.length);
  const kgClaimsRequired = requiresProviderClaims(item, {
    deterministicExecution,
    humanApprovalRequired,
    peerCritiqueRequired,
  });
  const decisionBudget = deriveDecisionBudget(item, {
    deterministicExecution,
    humanApprovalRequired,
    peerCritiqueRequired,
    kgClaimsRequired,
    profile,
  });

  return {
      taskId: item.id,
      intent: item.intent,
      risk: item.risk,
      profile,
      decisionBudget,
    humanApprovalRequired,
    writeLeaseRequired,
    kgClaimsRequired,
    peerCritiqueRequired,
    deterministicExecution,
    constraints: [
      {
        kind: 'human_gate',
        required: humanApprovalRequired,
        reason: humanApprovalRequired
          ? `${item.risk} requires human approval before execution`
          : 'local execution is allowed without human gate',
      },
      {
        kind: 'write_lease',
        required: writeLeaseRequired,
        reason: writeLeaseRequired
          ? 'workspace-affecting work needs an exclusive write lease'
          : 'read-only or deterministic work does not need a write lease',
      },
      {
        kind: 'provider_claims',
        required: kgClaimsRequired,
        reason: kgClaimsRequired
          ? 'provider output must remain traceable until verified'
          : 'deterministic local verification does not create semantic claims',
      },
      {
        kind: 'peer_critique',
        required: peerCritiqueRequired,
        reason: peerCritiqueReason(item, opts),
      },
      {
        kind: 'deterministic_execution',
        required: deterministicExecution,
        reason: deterministicExecution
          ? 'verification should run through shell/local execution'
          : 'semantic work may use provider judgment',
      },
    ],
  };
}

export function deriveTextureProfile(item: WorkItem): ConstraintTextureProfile {
  const criterionType = item.qualityCriterion ?? inferQualityCriterion(item);
  const rationale: string[] = [];

  let promptTexture: PromptTexture = 'hybrid';
  let evaluatorTexture: EvaluatorTexture = 'ct-aware';
  let modelTier: ModelExecutionTier = 'strong-llm';
  let useReflect = false;

  if (criterionType === 'mechanical') {
    promptTexture = 'prescription';
    evaluatorTexture = 'mechanical-check';
    modelTier = item.intent === 'verify' ? 'shell' : 'local';
    rationale.push('Paper 1/2 boundary: prescriptions fit deterministic, enumerative, schema, and mechanically-verifiable quality criteria.');
  } else if (criterionType === 'restraint') {
    promptTexture = 'ct';
    evaluatorTexture = 'source-faithfulness';
    modelTier = 'cheap-llm';
    useReflect = false;
    rationale.push('Paper 2 Experiment 4: boundary/restraint tasks reward aligned CT and cheap models, but reflect can over-modify very short outputs.');
  } else if (criterionType === 'boundary_sensitive') {
    promptTexture = 'ct-reflect';
    evaluatorTexture = 'source-faithfulness';
    modelTier = 'cheap-llm';
    useReflect = true;
    rationale.push('Paper 2 Experiment 4: source-faithfulness and over-inference avoidance depend on boundary-preserving convergence conditions.');
  } else if (criterionType === 'stakeholder_tension') {
    promptTexture = 'ct';
    evaluatorTexture = 'pairwise';
    modelTier = 'panel';
    rationale.push('Paper 1 stakeholder experiment: convergence conditions win when requirements are in tension and need perspective integration.');
  } else if (criterionType === 'judgment') {
    promptTexture = 'ct-reflect';
    evaluatorTexture = 'ct-aware';
    modelTier = 'strong-llm';
    useReflect = true;
    rationale.push('Paper 2 Experiments 2-3: CT improves judgment tasks; a second pass helps synthesis/revision more than extra raw thinking.');
  } else {
    promptTexture = 'hybrid';
    evaluatorTexture = 'ct-aware';
    modelTier = 'strong-llm';
    rationale.push('Paper 2 Experiment 2: hybrid is the safer default for mixed workloads because it avoids PS failure modes while preserving structure.');
  }

  return { criterionType, promptTexture, evaluatorTexture, modelTier, useReflect, rationale };
}

export function buildConstraintTexturePromptSection(item: WorkItem): string {
  const profile = deriveTextureProfile(item);
  const lines = [
    '<constraint-texture-profile>',
    `criterion: ${profile.criterionType}`,
    `prompt_texture: ${profile.promptTexture}`,
    `evaluator_texture: ${profile.evaluatorTexture}`,
    `model_lane: ${profile.modelTier}`,
    `reflect_pass: ${profile.useReflect ? 'yes' : 'no'}`,
    'paper_backed_rule:',
  ];

  switch (profile.promptTexture) {
    case 'prescription':
      lines.push(
        '- This is mechanically verifiable work. Prefer exact commands, schemas, fields, or pass/fail checks over open-ended reasoning.',
        '- Completion means the requested observable check passes, not that the explanation sounds plausible.',
      );
      break;
    case 'ct':
      lines.push(
        '- This needs convergence conditions. State the endpoint quality in context, then satisfy that endpoint directly.',
        '- Do not pad with generic checklist compliance; preserve the audience/source boundary that makes the answer correct.',
      );
      break;
    case 'ct-reflect':
      lines.push(
        '- First produce the answer, then do one short audience/source-boundary reflection pass before finalizing.',
        '- The second pass must remove over-inference and improve decision usefulness, not add length for its own sake.',
      );
      break;
    case 'hybrid':
      lines.push(
        '- Use prescriptions for mechanical subparts and convergence conditions for judgment subparts.',
        '- Split output/checks so deterministic facts are verifiable and semantic choices are justified by context.',
      );
      break;
  }

  if (profile.evaluatorTexture === 'source-faithfulness') {
    lines.push('- Evaluation focus: source faithfulness, uncertainty preservation, and no unsupported claims.');
  } else if (profile.evaluatorTexture === 'pairwise') {
    lines.push('- Evaluation focus: compare alternatives by which one better resolves stakeholder tension without hiding tradeoffs.');
  } else if (profile.evaluatorTexture === 'mechanical-check') {
    lines.push('- Evaluation focus: run or cite the concrete check; avoid semantic claims when a command/schema can decide.');
  } else {
    lines.push('- Evaluation focus: judge whether the result would improve the real downstream decision, not whether it mentions the right words.');
  }

  if (profile.criterionType === 'restraint') {
    lines.push('- Restraint caveat: do not use a reflective rewrite that expands a short answer unless explicitly asked.');
  }

  lines.push(`rationale: ${profile.rationale[0] ?? 'paper-backed prompt texture selection'}`);
  lines.push('</constraint-texture-profile>');
  return lines.join('\n');
}

export function isCheapLocalIntent(intent: WorkIntent): boolean {
  return CHEAP_LOCAL_INTENTS.has(intent);
}

export function isCodingIntent(intent: WorkIntent): boolean {
  return CODING_INTENTS.has(intent);
}

export function isReviewIntent(intent: WorkIntent): boolean {
  return REVIEW_INTENTS.has(intent);
}

export function peerCritiqueReason(item: WorkItem, opts: ConstraintTextureOptions = {}): string {
  if (item.hasProviderConflict) return 'provider conflict needs peer critique before convergence';
  if (PEER_REVIEW_INTENTS.has(item.intent)) return `${item.intent} work has high long-term coupling and needs peer critique`;
  if (opts.forceAkariForP0 && item.priority === 'P0') return 'P0 work is configured to request peer critique';
  if (item.tags?.some(t => ['architecture', 'soul', 'memory', 'policy', 'kg'].includes(t.toLowerCase())) === true) {
    return 'task tags indicate peer critique is worth the added cost';
  }
  return 'peer critique is optional for this task';
}

function deriveDecisionBudget(
  item: WorkItem,
  state: {
    deterministicExecution: boolean;
    humanApprovalRequired: boolean;
    peerCritiqueRequired: boolean;
    kgClaimsRequired: boolean;
    profile: ConstraintTextureProfile;
  },
): DecisionBudget {
  if (state.humanApprovalRequired) {
    return {
      maxActors: 1,
      requireReviewer: false,
      allowPanel: false,
      maxCost: 'high',
      stopWhen: 'human_approved',
      reason: 'external/deploy risk stops at human approval before execution',
    };
  }

  if (state.deterministicExecution) {
    return {
      maxActors: 1,
      requireReviewer: false,
      allowPanel: false,
      maxCost: 'low',
      stopWhen: 'verified',
      reason: 'deterministic verification should use the cheapest executable path',
    };
  }

  if (state.profile.modelTier === 'cheap-llm' && item.risk === 'read_only') {
    return {
      maxActors: 1,
      requireReviewer: false,
      allowPanel: false,
      maxCost: 'low',
      stopWhen: 'primary_confident',
      reason: `paper-backed ${state.profile.criterionType} task should use aligned CT on the cheapest sufficient reasoning lane`,
    };
  }

  if (state.peerCritiqueRequired) {
    return {
      maxActors: 4,
      requireReviewer: true,
      allowPanel: true,
      maxCost: item.priority === 'P2' ? 'medium' : 'high',
      stopWhen: item.hasProviderConflict ? 'no_dissent' : 'primary_confident',
      reason: 'peer critique is required, so a bounded panel is worth the cost',
    };
  }

  if (isCodingIntent(item.intent) || item.risk === 'workspace_write') {
    return {
      maxActors: 2,
      requireReviewer: true,
      allowPanel: false,
      maxCost: item.priority === 'P2' ? 'medium' : 'high',
      stopWhen: 'verified',
      reason: 'workspace-affecting work should pair implementation with one reviewer',
    };
  }

  if (isReviewIntent(item.intent)) {
    return {
      maxActors: 2,
      requireReviewer: item.priority !== 'P2',
      allowPanel: false,
      maxCost: item.priority === 'P2' ? 'medium' : 'high',
      stopWhen: 'no_dissent',
      reason: 'semantic review may use one independent second pass, not a full panel',
    };
  }

  if (isCheapLocalIntent(item.intent) && item.risk === 'read_only') {
    return {
      maxActors: 1,
      requireReviewer: false,
      allowPanel: false,
      maxCost: 'low',
      stopWhen: 'primary_confident',
      reason: 'cheap read-only work should stay single-actor',
    };
  }

  return {
    maxActors: item.priority === 'P0' ? 2 : 1,
    requireReviewer: item.priority === 'P0' || state.kgClaimsRequired,
    allowPanel: false,
    maxCost: item.priority === 'P2' ? 'medium' : 'high',
    stopWhen: item.priority === 'P0' ? 'no_dissent' : 'primary_confident',
    reason: 'default budget scales with priority and claim requirements',
  };
}

function needsPeerCritic(item: WorkItem, opts: ConstraintTextureOptions): boolean {
  const profile = deriveTextureProfile(item);
  return item.hasProviderConflict === true
    || profile.criterionType === 'stakeholder_tension'
    || PEER_REVIEW_INTENTS.has(item.intent)
    || (opts.forceAkariForP0 === true && item.priority === 'P0')
    || item.tags?.some(t => ['architecture', 'soul', 'memory', 'policy', 'kg'].includes(t.toLowerCase())) === true;
}

function inferQualityCriterion(item: WorkItem): QualityCriterionType {
  const text = `${item.title}\n${item.prompt ?? ''}\n${(item.tags ?? []).join(' ')}`.toLowerCase();
  const mechanical = isMechanicalCriterion(item, text);
  const tension = /(stakeholder|tradeoff|tension|conflict|competing requirement|取捨|張力|衝突|利害關係|多方)/i.test(text);
  const boundary = /(source[- ]?faith|faithful|source[- ]?ground|grounded|evidence boundary|unsupported claim|over[- ]?inference|claim audit|risk memo|confirmed vs|not confirmed|引用來源|證據邊界|不得推論|不要腦補|忠於來源)/i.test(text);
  const restraint = /(restraint|concise|brief|short|\b\d+[- ]?word|\b\d+[- ]?sentence|under \d+ words|no more than|不超過|簡短|短文|兩句|2 sentences?|50 words?|100 words?)/i.test(text);
  const judgment = isJudgmentCriterion(item, text);

  const semanticCount = [tension, boundary, restraint, judgment].filter(Boolean).length;
  if (mechanical && semanticCount > 0) return 'mixed';
  if (tension) return 'stakeholder_tension';
  if (restraint) return 'restraint';
  if (boundary) return 'boundary_sensitive';
  if (mechanical) return 'mechanical';
  if (judgment) return 'judgment';
  return 'mixed';
}

function isMechanicalCriterion(item: WorkItem, text: string): boolean {
  if (item.intent === 'verify' || item.intent === 'json') return true;
  return /(json schema|schema|format only|return json|fields?\b|typecheck|vitest|test command|build command|lint|api contract|type signature|enumerat|checklist|exact match|regex|fixed format|deterministic|機械|固定格式|列舉|檢查清單|可驗證格式)/i.test(text);
}

function isJudgmentCriterion(item: WorkItem, text: string): boolean {
  if (['chat', 'plan', 'research', 'review', 'architecture', 'memory', 'policy'].includes(item.intent)) return true;
  return /(design|architecture|strategy|recommend|decision|synthesis|diagnose|root cause|\bpm\b|product|需求|設計|架構|策略|建議|決策|分析|整理脈絡|根因)/i.test(text);
}

function requiresProviderClaims(
  item: WorkItem,
  state: {
    deterministicExecution: boolean;
    humanApprovalRequired: boolean;
    peerCritiqueRequired: boolean;
  },
): boolean {
  if (state.humanApprovalRequired) return true;
  if (state.deterministicExecution) return false;
  if (state.peerCritiqueRequired) return true;
  if (isCodingIntent(item.intent) || item.risk === 'workspace_write') return true;
  if (isReviewIntent(item.intent)) return true;
  if (isCheapLocalIntent(item.intent) && item.risk === 'read_only') return item.priority === 'P0';
  return item.priority === 'P0';
}
