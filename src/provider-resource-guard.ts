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
  if (!/out of extra usage|usage limit|rate[_ -]?limit|quota/.test(lower)) return null;

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
