import fs from 'node:fs';
import path from 'node:path';
import {
  type AgentCapabilitySpec,
  type AgentOwnedIdentity,
  listAgentCapabilities,
} from './agent-owned-identity.js';

export interface SkillSelectionInput {
  hint?: string;
  mode?: string;
  signals?: string[];
  contextSignals?: string[];
  taskType?: string;
  priority?: number;
  limit?: number;
}

export interface SkillSelectionItem {
  service: string;
  kind: AgentOwnedIdentity['kind'];
  score: number;
  reasons: string[];
  requires: string[];
  combinesWith: string[];
  verifier?: string;
  contextFabric?: AgentOwnedIdentity['contextFabric'];
}

export interface SkillSelectionResult {
  selected: SkillSelectionItem[];
  blocked: Array<{ service: string; missing: string[] }>;
  available: string[];
}

export interface SkillUsageEvent {
  skill: string;
  outcome: 'success' | 'failure' | 'blocked' | 'superseded';
  pattern?: string;
  taskId?: string;
  mode?: string;
  savedTokensEstimate?: number;
  savedMinutesEstimate?: number;
  combinedWith?: string[];
  verifier?: string;
  note?: string;
  ts?: string;
}

export interface SkillHealthSummary {
  skill: string;
  uses: number;
  success: number;
  failure: number;
  blocked: number;
  lastUsedAt?: string;
  failureRate: number;
  status: 'healthy' | 'watch' | 'iterate' | 'unused';
  suggestion?: string;
}

export interface PatternPromotionCandidate {
  pattern: string;
  uses: number;
  successRate: number;
  savedTokensEstimate: number;
  savedMinutesEstimate: number;
  skills: string[];
  recommendedKind: 'skill' | 'workflow' | 'tool' | 'script' | 'cli' | 'code';
  rationale: string[];
  suggestedCapability: {
    service: string;
    kind: AgentOwnedIdentity['kind'] | 'script' | 'cli' | 'code';
    capabilities: string[];
    requires: string[];
    combinesWith: string[];
    verifier: string;
  };
}

const LEDGER_FILE = 'skill-usage.jsonl';

export function listManagedSkills(env: NodeJS.ProcessEnv = process.env): AgentOwnedIdentity[] {
  return listAgentCapabilities(env).filter(cap => {
    return (cap.kind === 'skill' || cap.kind === 'workflow') && cap.status === 'active';
  });
}

export function selectAgentSkills(
  input: SkillSelectionInput,
  env: NodeJS.ProcessEnv = process.env,
): SkillSelectionResult {
  const all = listAgentCapabilities(env);
  const activeNames = new Set(all.filter(cap => cap.status === 'active').map(cap => cap.service));
  const candidates = all.filter(cap => (cap.kind === 'skill' || cap.kind === 'workflow') && cap.status === 'active');
  const lowerHint = (input.hint ?? '').toLowerCase();
  const inputSignals = new Set((input.signals ?? []).map(s => s.toLowerCase()));
  const contextSignals = new Set((input.contextSignals ?? []).map(s => s.toLowerCase()));
  const blocked: SkillSelectionResult['blocked'] = [];

  const scored = candidates.map(skill => {
    const missing = skill.requires.filter(req => !activeNames.has(req));
    if (missing.length > 0) blocked.push({ service: skill.service, missing });
    const reasons: string[] = [];
    let score = 0;
    const trigger = skill.trigger;

    if (trigger?.modes?.length && input.mode && trigger.modes.includes(input.mode)) {
      score += 25;
      reasons.push(`mode:${input.mode}`);
    }
    for (const keyword of trigger?.keywords ?? []) {
      if (lowerHint.includes(keyword.toLowerCase())) {
        score += 10;
        reasons.push(`keyword:${keyword}`);
      }
    }
    for (const signal of trigger?.signals ?? []) {
      if (inputSignals.has(signal.toLowerCase())) {
        score += 18;
        reasons.push(`signal:${signal}`);
      }
    }
    for (const signal of skill.contextFabric?.emergenceSignals ?? []) {
      if (contextSignals.has(signal.toLowerCase()) || inputSignals.has(signal.toLowerCase())) {
        score += 14;
        reasons.push(`context:${signal}`);
      }
    }
    for (const source of skill.contextFabric?.sources ?? []) {
      if (lowerHint.includes(source.toLowerCase())) {
        score += 6;
        reasons.push(`context-source:${source}`);
      }
    }
    if (trigger?.taskTypes?.length && input.taskType && trigger.taskTypes.includes(input.taskType)) {
      score += 16;
      reasons.push(`taskType:${input.taskType}`);
    }
    if (typeof trigger?.minPriority === 'number' && typeof input.priority === 'number' && input.priority <= trigger.minPriority) {
      score += 12;
      reasons.push(`priority<=${trigger.minPriority}`);
    }
    if (skill.kind === 'workflow' && score > 0) score += 5;
    if (!trigger && lowerHint.includes(skill.service.toLowerCase())) {
      score += 8;
      reasons.push('name-match');
    }
    if (missing.length > 0) score = 0;

    return toSelectionItem(skill, score, reasons);
  }).filter(item => item.score > 0);

  const byName = new Map(scored.map(item => [item.service, item]));
  for (const item of [...scored]) {
    for (const partner of item.combinesWith) {
      if (byName.has(partner) || !activeNames.has(partner)) continue;
      const partnerCap = candidates.find(skill => skill.service === partner);
      if (!partnerCap) continue;
      const partnerItem = toSelectionItem(partnerCap, Math.max(1, Math.floor(item.score / 2)), [`combined-with:${item.service}`]);
      byName.set(partner, partnerItem);
    }
  }

  const selected = [...byName.values()]
    .sort((a, b) => b.score - a.score || a.service.localeCompare(b.service))
    .slice(0, input.limit ?? 5);

  return {
    selected,
    blocked,
    available: candidates.map(skill => skill.service).sort(),
  };
}

export function buildAgentSkillOrchestrationPrompt(env: NodeJS.ProcessEnv = process.env): string {
  const skills = listManagedSkills(env);
  if (skills.length === 0) return '';
  const rows = skills.map(skill => {
    const trigger = [
      ...(skill.trigger?.modes ?? []).map(x => `mode:${x}`),
      ...(skill.trigger?.signals ?? []).map(x => `signal:${x}`),
      ...(skill.trigger?.keywords ?? []).slice(0, 4).map(x => `kw:${x}`),
    ].join(',') || 'manual/contextual';
    const combo = skill.combinesWith.length > 0 ? `; combines=${skill.combinesWith.join(',')}` : '';
    const verifier = skill.verifier ? `; verifier=${skill.verifier}` : '';
    const fabric = skill.contextFabric?.sources?.length
      ? `; context=${skill.contextFabric.sources.join(',')}`
      : '';
    return `- ${skill.service}: trigger=${trigger}${combo}${fabric}${verifier}`;
  });
  return [
    '## AI-Native Skill Orchestration',
    'Skills/workflows are managed capabilities, not static instructions. Select the smallest useful set, combine declared partners when their triggers align, and avoid running isolated skills when a workflow can close the loop.',
    'KG and file context are the context fabric for skills: use KG/file signals to select skills, write outcomes back to memory/KG ledgers, and let repeated cross-skill patterns become new or revised capabilities.',
    'After using a managed skill, leave observable evidence and record/enable iteration when the verifier fails, repeated use does not improve outcomes, or multiple skills reveal a reusable emergent pattern.',
    'Promotion rule: repeated high-success patterns should become the most efficient capability form: skill for judgment, workflow for multi-step coordination, script/CLI for deterministic operations, code for always-on runtime behavior, or a hybrid when both judgment and execution are needed.',
    ...rows,
  ].join('\n');
}

export function recordSkillUsage(memoryDir: string, event: SkillUsageEvent): SkillUsageEvent {
  const normalized: SkillUsageEvent = {
    ...event,
    skill: event.skill.trim(),
    ts: event.ts ?? new Date().toISOString(),
    combinedWith: event.combinedWith ?? [],
  };
  if (!normalized.skill) throw new Error('skill is required');
  const filePath = skillUsageLedgerPath(memoryDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(normalized) + '\n', 'utf-8');
  return normalized;
}

export function readSkillUsage(memoryDir: string): SkillUsageEvent[] {
  const filePath = skillUsageLedgerPath(memoryDir);
  if (!fs.existsSync(filePath)) return [];
  const events: SkillUsageEvent[] = [];
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SkillUsageEvent;
      if (parsed.skill && parsed.outcome) events.push(parsed);
    } catch {
      // Ignore malformed telemetry; health remains best-effort.
    }
  }
  return events;
}

export function summarizeSkillHealth(
  memoryDir: string,
  env: NodeJS.ProcessEnv = process.env,
): SkillHealthSummary[] {
  const events = readSkillUsage(memoryDir);
  const bySkill = new Map<string, SkillUsageEvent[]>();
  for (const event of events) {
    const list = bySkill.get(event.skill) ?? [];
    list.push(event);
    bySkill.set(event.skill, list);
  }

  return listManagedSkills(env).map(skill => {
    const list = bySkill.get(skill.service) ?? [];
    const uses = list.length;
    const success = list.filter(event => event.outcome === 'success').length;
    const failure = list.filter(event => event.outcome === 'failure').length;
    const blocked = list.filter(event => event.outcome === 'blocked').length;
    const failureRate = uses > 0 ? (failure + blocked) / uses : 0;
    const threshold = skill.iteration?.failureThreshold ?? 0.34;
    const minUses = skill.iteration?.minUses ?? 3;
    const lastUsedAt = list.map(event => event.ts).filter(Boolean).sort().at(-1);
    let status: SkillHealthSummary['status'] = 'healthy';
    let suggestion: string | undefined;
    if (uses === 0) {
      status = 'unused';
      suggestion = 'No ledger evidence yet; use only when trigger matches and record outcome.';
    } else if (uses >= minUses && failureRate >= threshold) {
      status = 'iterate';
      suggestion = iterationSuggestion(skill, failureRate);
    } else if (failureRate > 0) {
      status = 'watch';
      suggestion = 'Some failed/blocked outcomes; keep recording verifier evidence.';
    }
    return { skill: skill.service, uses, success, failure, blocked, lastUsedAt, failureRate, status, suggestion };
  });
}

export function suggestPatternPromotions(
  memoryDir: string,
  env: NodeJS.ProcessEnv = process.env,
): PatternPromotionCandidate[] {
  const events = readSkillUsage(memoryDir).filter(event => event.pattern?.trim());
  const byPattern = new Map<string, SkillUsageEvent[]>();
  for (const event of events) {
    const key = normalizePattern(event.pattern ?? '');
    if (!key) continue;
    const list = byPattern.get(key) ?? [];
    list.push(event);
    byPattern.set(key, list);
  }

  const active = new Set(listAgentCapabilities(env).map(cap => cap.service));
  const candidates: PatternPromotionCandidate[] = [];
  for (const [pattern, list] of byPattern) {
    const uses = list.length;
    const success = list.filter(event => event.outcome === 'success').length;
    const successRate = uses > 0 ? success / uses : 0;
    const savedTokensEstimate = sum(list.map(event => event.savedTokensEstimate));
    const savedMinutesEstimate = sum(list.map(event => event.savedMinutesEstimate));
    if (uses < 3 || successRate < 0.67) continue;

    const skills = unique(list.flatMap(event => [event.skill, ...(event.combinedWith ?? [])]));
    const recommendedKind = choosePromotionKind(pattern, list, savedTokensEstimate, savedMinutesEstimate);
    const service = `pattern-${slugify(pattern)}`;
    if (active.has(service)) continue;
    const rationale = promotionRationale(recommendedKind, uses, successRate, savedTokensEstimate, savedMinutesEstimate);
    candidates.push({
      pattern,
      uses,
      successRate,
      savedTokensEstimate,
      savedMinutesEstimate,
      skills,
      recommendedKind,
      rationale,
      suggestedCapability: {
        service,
        kind: recommendedKind === 'script' || recommendedKind === 'cli' || recommendedKind === 'code' ? 'tool' : recommendedKind,
        capabilities: ['promoted-pattern', recommendedKind, ...skills.slice(0, 4)],
        requires: skills.filter(skill => active.has(skill)),
        combinesWith: skills.filter(skill => active.has(skill)).slice(0, 4),
        verifier: `pattern "${pattern}" keeps successRate >= 0.67 over next 3 uses and reduces repeated reasoning/tool overhead`,
      },
    });
  }

  return candidates.sort((a, b) => {
    const aValue = a.uses * a.successRate + a.savedTokensEstimate / 10_000 + a.savedMinutesEstimate / 60;
    const bValue = b.uses * b.successRate + b.savedTokensEstimate / 10_000 + b.savedMinutesEstimate / 60;
    return bValue - aValue;
  });
}

function toSelectionItem(skill: AgentOwnedIdentity, score: number, reasons: string[]): SkillSelectionItem {
  return {
    service: skill.service,
    kind: skill.kind,
    score,
    reasons,
    requires: skill.requires,
    combinesWith: skill.combinesWith,
    verifier: skill.verifier,
    contextFabric: skill.contextFabric,
  };
}

function skillUsageLedgerPath(memoryDir: string): string {
  return path.join(memoryDir, 'state', LEDGER_FILE);
}

function iterationSuggestion(skill: AgentOwnedIdentity, failureRate: number): string {
  const policy = skill.iteration?.updatePolicy ?? 'propose-change';
  if (policy === 'disable-on-failure') return `Failure rate ${failureRate.toFixed(2)} exceeds threshold; disable or replace this capability overlay before further autonomous use.`;
  if (policy === 'self-edit-skill') return `Failure rate ${failureRate.toFixed(2)} exceeds threshold; revise the skill/workflow instructions and verifier, then record a new trial.`;
  if (policy === 'human-review') return `Failure rate ${failureRate.toFixed(2)} exceeds threshold; escalate for Alex review before changing behavior.`;
  return `Failure rate ${failureRate.toFixed(2)} exceeds threshold; propose a registry/skill update with verifier evidence.`;
}

function choosePromotionKind(
  pattern: string,
  events: SkillUsageEvent[],
  savedTokensEstimate: number,
  savedMinutesEstimate: number,
): PatternPromotionCandidate['recommendedKind'] {
  const text = `${pattern} ${events.map(event => event.note ?? '').join(' ')}`.toLowerCase();
  const skills = unique(events.flatMap(event => [event.skill, ...(event.combinedWith ?? [])]));
  if (/(deterministic|repeatable|shell|curl|git|json|parse|format|deploy|snapshot|固定|重複|可腳本)/i.test(text)) {
    return savedMinutesEstimate >= 30 || savedTokensEstimate >= 10_000 ? 'cli' : 'script';
  }
  if (/(always-on|runtime|gate|health|scheduler|autonomy|自動|常駐|閉環)/i.test(text)) return 'code';
  if (skills.length >= 3 || /(multi-step|pipeline|workflow|handoff|協作|多步)/i.test(text)) return 'workflow';
  return 'skill';
}

function promotionRationale(
  kind: PatternPromotionCandidate['recommendedKind'],
  uses: number,
  successRate: number,
  savedTokensEstimate: number,
  savedMinutesEstimate: number,
): string[] {
  return [
    `${uses} repeated use(s) with successRate=${successRate.toFixed(2)}`,
    ...(savedTokensEstimate > 0 ? [`estimated token savings=${Math.round(savedTokensEstimate)}`] : []),
    ...(savedMinutesEstimate > 0 ? [`estimated time savings=${Math.round(savedMinutesEstimate)}m`] : []),
    `recommended as ${kind} because that is the lowest-overhead durable form for this pattern`,
  ];
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'unnamed';
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
