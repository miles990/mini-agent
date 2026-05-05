/**
 * Myelin to Shared Knowledge/KG sync.
 *
 * Myelin learns decision patterns. KG/shared knowledge makes those patterns
 * available across brains and future context retrieval. This sync is deliberately
 * small: only top effective rules are exported, and only when hitCount advances.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeMemoryTriple } from './kg-memory.js';
import { getMyelinStatus, type MyelinDomainStatus, type MyelinRuleSummary } from './myelin-status.js';
import { observe as kbObserve } from './shared-knowledge.js';
import { slog } from './utils.js';

export interface MyelinKgSyncOptions {
  limitPerDomain?: number;
  minHitCount?: number;
  force?: boolean;
}

export interface MyelinKgSyncedRule {
  key: string;
  domain: string;
  ruleId: string;
  action: string;
  hitCount: number;
}

export interface MyelinKgSyncResult {
  observed: number;
  skipped: number;
  domains: number;
  synced: MyelinKgSyncedRule[];
}

export interface MyelinKnowledgeContextOptions {
  limit?: number;
  minHitCount?: number;
}

interface SyncState {
  rules: Record<string, { hitCount: number; syncedAt: string }>;
}

const DEFAULT_LIMIT_PER_DOMAIN = 3;
const DEFAULT_MIN_HIT_COUNT = 1;

export function syncMyelinToKnowledge(
  memoryDir: string,
  opts: MyelinKgSyncOptions = {},
): MyelinKgSyncResult {
  const limitPerDomain = Math.max(1, Math.min(10, Math.floor(opts.limitPerDomain ?? DEFAULT_LIMIT_PER_DOMAIN)));
  const minHitCount = Math.max(0, Math.floor(opts.minHitCount ?? DEFAULT_MIN_HIT_COUNT));
  const status = getMyelinStatus(memoryDir, 500);
  const state = readSyncState(memoryDir);
  const synced: MyelinKgSyncedRule[] = [];
  let skipped = 0;

  for (const domain of status.domains) {
    if (domain.health !== 'effective') continue;
    const rules = domain.topRules
      .filter(rule => rule.hitCount >= minHitCount)
      .slice(0, limitPerDomain);
    for (const rule of rules) {
      const key = `${domain.name}:${rule.id || rule.action}:${rule.action}`;
      const previous = state.rules[key];
      if (!opts.force && previous && previous.hitCount >= rule.hitCount) {
        skipped++;
        continue;
      }

      const content = formatRuleMemory(domain, rule);
      kbObserve({
        source: 'myelin',
        type: 'crystallize',
        data: {
          domain: domain.name,
          ruleId: rule.id,
          action: rule.action,
          hitCount: rule.hitCount,
          ruleRatio: domain.recent.ruleRatio,
          health: domain.health,
          reason: rule.reason,
        },
        tags: ['myelin', 'decision-pattern', domain.name, rule.action].filter(Boolean),
        outcome: 'success',
      });
      writeMemoryTriple({
        agent: 'kuro',
        predicate: 'learned',
        content,
        topic: 'myelin',
        importance: importanceForHits(rule.hitCount),
        source: 'myelin-kg-sync',
        visibility: 'shared',
      });

      state.rules[key] = { hitCount: rule.hitCount, syncedAt: new Date().toISOString() };
      synced.push({ key, domain: domain.name, ruleId: rule.id, action: rule.action, hitCount: rule.hitCount });
    }
  }

  writeSyncState(memoryDir, state);
  if (synced.length > 0) {
    slog('MYELIN-KG', `synced ${synced.length} rule patterns to shared knowledge/KG`);
  }
  return { observed: synced.length, skipped, domains: status.domains.length, synced };
}

export function getMyelinKnowledgeContext(
  memoryDir: string,
  opts: MyelinKnowledgeContextOptions = {},
): string | null {
  const state = readSyncState(memoryDir);
  const keys = new Set(Object.keys(state.rules));
  if (keys.size === 0) return null;

  const status = getMyelinStatus(memoryDir, 500);
  const limit = Math.max(1, Math.min(12, Math.floor(opts.limit ?? 6)));
  const minHitCount = Math.max(0, Math.floor(opts.minHitCount ?? DEFAULT_MIN_HIT_COUNT));
  const patterns: Array<{ domain: string; action: string; hitCount: number; reason: string; syncedAt: string }> = [];

  for (const domain of status.domains) {
    if (domain.health !== 'effective') continue;
    for (const rule of domain.topRules) {
      const key = `${domain.name}:${rule.id || rule.action}:${rule.action}`;
      const synced = state.rules[key];
      if (!synced || rule.hitCount < minHitCount) continue;
      patterns.push({
        domain: domain.name,
        action: rule.action,
        hitCount: rule.hitCount,
        reason: rule.reason,
        syncedAt: synced.syncedAt,
      });
    }
  }

  if (patterns.length === 0) return null;
  patterns.sort((a, b) => b.hitCount - a.hitCount || b.syncedAt.localeCompare(a.syncedAt));

  const lines = patterns.slice(0, limit).map(pattern =>
    `- ${pattern.domain}: prefer "${pattern.action}" (${pattern.hitCount} hits). ${pattern.reason || 'No reason recorded.'}`,
  );
  return [
    '<myelin-decision-patterns>',
    'Use these learned local decision patterns as soft guidance; do not override the explicit task or safety constraints.',
    ...lines,
    '</myelin-decision-patterns>',
  ].join('\n');
}

function formatRuleMemory(domain: MyelinDomainStatus, rule: MyelinRuleSummary): string {
  const ratio = Math.round(domain.recent.ruleRatio * 100);
  return [
    `Myelin decision pattern: ${domain.name} uses action "${rule.action}"`,
    `Rule ${rule.id || '(no id)'} has ${rule.hitCount} hits; recent rule ratio ${ratio}%.`,
    `Reason: ${rule.reason || '(no reason)'}`,
  ].join(' ');
}

function importanceForHits(hitCount: number): 'high' | 'medium' | 'low' {
  if (hitCount >= 300) return 'high';
  if (hitCount >= 50) return 'medium';
  return 'low';
}

function getSyncPath(memoryDir: string): string {
  return path.join(memoryDir, 'state', 'myelin-kg-sync.json');
}

function readSyncState(memoryDir: string): SyncState {
  const filePath = getSyncPath(memoryDir);
  if (!existsSync(filePath)) return { rules: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<SyncState>;
    return { rules: parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : {} };
  } catch {
    return { rules: {} };
  }
}

function writeSyncState(memoryDir: string, state: SyncState): void {
  const filePath = getSyncPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}
