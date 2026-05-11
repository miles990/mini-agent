import type { ActorId } from './brain-types.js';
import { queryMemoryIndexSync } from './memory-index.js';

export interface ProviderResourceHold {
  type: 'provider-quota';
  provider: 'claude' | 'codex' | 'unknown';
  resumeAt: string;
  reason: string;
}

export function classifyProviderResourceHold(
  output: string,
  now = new Date(),
): ProviderResourceHold | null {
  const lower = output.toLowerCase();
  if (!/maximum budget|out of extra usage|usage limit|hit your limit|rate[_ -]?limit|quota/.test(lower)) return null;

  const provider = lower.includes('claude') ? 'claude'
    : lower.includes('codex') ? 'codex'
      : 'unknown';
  const resumeAt = parseResetTime(output, now)
    ?? new Date(now.getTime() + 60 * 60_000);

  return {
    type: 'provider-quota',
    provider,
    resumeAt: resumeAt.toISOString(),
    reason: `${provider} provider quota/resource exhausted; retry after ${resumeAt.toISOString()}`,
  };
}

export function readActiveProviderResourceHolds(
  memoryDir: string,
  now = new Date(),
): ProviderResourceHold[] {
  const holds: ProviderResourceHold[] = [];
  for (const entry of queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] })) {
    const hold = parseProviderResourceHold(entry.payload?.provider_resource_hold);
    if (!hold) continue;
    const resumeAt = Date.parse(hold.resumeAt);
    if (!Number.isFinite(resumeAt) || resumeAt <= now.getTime()) continue;
    holds.push(hold);
  }
  return holds;
}

export function filterActorsForProviderResourceHolds(
  actors: ActorId[],
  memoryDir: string,
  now = new Date(),
): ActorId[] {
  const heldProviders = new Set(readActiveProviderResourceHolds(memoryDir, now).map(hold => hold.provider));
  if (heldProviders.size === 0) return actors;
  return actors.filter(actor => {
    if (heldProviders.has('unknown') && (actor === 'claude' || actor === 'codex')) return false;
    return !heldProviders.has(actor as ProviderResourceHold['provider']);
  });
}

function parseResetTime(output: string, now: Date): Date | null {
  const match = output.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const reset = new Date(now);
  reset.setHours(hour, minute, 0, 0);
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  return reset;
}

function parseProviderResourceHold(value: unknown): ProviderResourceHold | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'provider-quota') return null;
  if (raw.provider !== 'claude' && raw.provider !== 'codex' && raw.provider !== 'unknown') return null;
  if (typeof raw.resumeAt !== 'string' || typeof raw.reason !== 'string') return null;
  return {
    type: 'provider-quota',
    provider: raw.provider,
    resumeAt: raw.resumeAt,
    reason: raw.reason,
  };
}
