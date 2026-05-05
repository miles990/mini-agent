/**
 * Myelin Status — file-backed observability for decision crystallization.
 *
 * myelin's in-process stats reset on service restart. The durable truth is the
 * rules JSON plus decision JSONL files in memory/, so status must be derived
 * from those files.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type MyelinDomainHealth = 'effective' | 'recording' | 'idle' | 'missing';

export interface MyelinRuleSummary {
  id: string;
  action: string;
  hitCount: number;
  reason: string;
}

export interface MyelinDomainStatus {
  name: string;
  health: MyelinDomainHealth;
  rulesPath: string;
  decisionsPath: string;
  ruleCount: number;
  hitCountSum: number;
  decisionLines: number;
  recentWindow: number;
  recent: {
    total: number;
    rule: number;
    llm: number;
    heuristic: number;
    observe: number;
    error: number;
    crystallization: number;
    other: number;
    ruleRatio: number;
    llmRatio: number;
  };
  lastDecisionAt: string | null;
  lastCrystallizedAt: string | null;
  topRules: MyelinRuleSummary[];
}

export interface MyelinStatusSnapshot {
  generatedAt: string;
  memoryDir: string;
  window: number;
  summary: {
    domains: number;
    effective: number;
    recording: number;
    idle: number;
    missing: number;
    totalRules: number;
    totalRuleHits: number;
    totalDecisionLines: number;
  };
  domains: MyelinDomainStatus[];
}

interface DomainConfig {
  name: string;
  rulesFile: string;
  decisionsFile: string;
}

const DOMAINS: DomainConfig[] = [
  { name: 'triage', rulesFile: 'myelin-triage-rules.json', decisionsFile: 'myelin-decisions.jsonl' },
  { name: 'learning', rulesFile: 'myelin-learning-rules.json', decisionsFile: 'myelin-learning-decisions.jsonl' },
  { name: 'routing', rulesFile: 'myelin-routing-rules.json', decisionsFile: 'myelin-routing-decisions.jsonl' },
  { name: 'workflow', rulesFile: 'myelin-workflow-rules.json', decisionsFile: 'myelin-workflow-decisions.jsonl' },
  { name: 'research', rulesFile: 'research-rules.json', decisionsFile: 'research-decisions.jsonl' },
];

export function getMyelinStatus(memoryDir: string, window = 500): MyelinStatusSnapshot {
  const safeWindow = Math.max(1, Math.min(5000, Math.floor(window)));
  const domains = DOMAINS.map(domain => getDomainStatus(memoryDir, domain, safeWindow));
  const counts = countByHealth(domains);
  return {
    generatedAt: new Date().toISOString(),
    memoryDir,
    window: safeWindow,
    summary: {
      domains: domains.length,
      effective: counts.effective,
      recording: counts.recording,
      idle: counts.idle,
      missing: counts.missing,
      totalRules: domains.reduce((sum, domain) => sum + domain.ruleCount, 0),
      totalRuleHits: domains.reduce((sum, domain) => sum + domain.hitCountSum, 0),
      totalDecisionLines: domains.reduce((sum, domain) => sum + domain.decisionLines, 0),
    },
    domains,
  };
}

function getDomainStatus(memoryDir: string, domain: DomainConfig, window: number): MyelinDomainStatus {
  const rulesPath = path.join(memoryDir, domain.rulesFile);
  const decisionsPath = path.join(memoryDir, domain.decisionsFile);
  const rules = readRules(rulesPath);
  const decisionLines = readJsonl(decisionsPath);
  const recentRecords = decisionLines.records.slice(-window);
  const recent = summarizeRecent(recentRecords);
  const topRules = rules
    .slice()
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 5);

  return {
    name: domain.name,
    health: classifyHealth(rules.length, recent),
    rulesPath,
    decisionsPath,
    ruleCount: rules.length,
    hitCountSum: rules.reduce((sum, rule) => sum + rule.hitCount, 0),
    decisionLines: decisionLines.total,
    recentWindow: window,
    recent,
    lastDecisionAt: lastTimestamp(decisionLines.records, '_type', 'decision'),
    lastCrystallizedAt: lastTimestamp(decisionLines.records, '_type', 'crystallization'),
    topRules,
  };
}

function readRules(filePath: string): MyelinRuleSummary[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(rule => {
      const raw = typeof rule === 'object' && rule ? rule as Record<string, unknown> : {};
      return {
        id: stringField(raw.id),
        action: stringField(raw.action),
        hitCount: typeof raw.hitCount === 'number' ? raw.hitCount : 0,
        reason: stringField(raw.reason).slice(0, 240),
      };
    });
  } catch {
    return [];
  }
}

function readJsonl(filePath: string): { records: Array<Record<string, unknown>>; total: number } {
  if (!existsSync(filePath)) return { records: [], total: 0 };
  const records: Array<Record<string, unknown>> = [];
  let total = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    total++;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === 'object' && parsed) records.push(parsed as Record<string, unknown>);
    } catch {
      // Corrupt lines count toward total but cannot inform method ratios.
    }
  }
  return { records, total };
}

function summarizeRecent(records: Array<Record<string, unknown>>): MyelinDomainStatus['recent'] {
  const recent = {
    total: records.length,
    rule: 0,
    llm: 0,
    heuristic: 0,
    observe: 0,
    error: 0,
    crystallization: 0,
    other: 0,
    ruleRatio: 0,
    llmRatio: 0,
  };
  for (const record of records) {
    const kind = typeof record._type === 'string' && record._type === 'crystallization'
      ? 'crystallization'
      : stringField(record.method);
    if (kind === 'rule') recent.rule++;
    else if (kind === 'llm') recent.llm++;
    else if (kind === 'heuristic') recent.heuristic++;
    else if (kind === 'observe') recent.observe++;
    else if (kind === 'error') recent.error++;
    else if (kind === 'crystallization') recent.crystallization++;
    else recent.other++;
  }
  recent.ruleRatio = recent.total > 0 ? recent.rule / recent.total : 0;
  recent.llmRatio = recent.total > 0 ? recent.llm / recent.total : 0;
  return recent;
}

function classifyHealth(ruleCount: number, recent: MyelinDomainStatus['recent']): MyelinDomainHealth {
  if (ruleCount === 0 && recent.total === 0) return 'missing';
  if (recent.rule > 0) return 'effective';
  if (recent.llm > 0 || recent.heuristic > 0 || recent.observe > 0) return 'recording';
  if (recent.crystallization > 0 || ruleCount > 0) return 'idle';
  return 'missing';
}

function countByHealth(domains: MyelinDomainStatus[]): Record<MyelinDomainHealth, number> {
  return domains.reduce<Record<MyelinDomainHealth, number>>((acc, domain) => {
    acc[domain.health]++;
    return acc;
  }, { effective: 0, recording: 0, idle: 0, missing: 0 });
}

function lastTimestamp(records: Array<Record<string, unknown>>, field: string, value: string): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i][field] !== value) continue;
    const ts = records[i].ts;
    return typeof ts === 'string' ? ts : null;
  }
  return null;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
