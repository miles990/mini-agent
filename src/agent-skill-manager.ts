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
  taskId?: string;
  mode?: string;
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
