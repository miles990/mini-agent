export interface IssueEvidenceGuardInput {
  title: string;
  body: string;
}

export interface IssueEvidenceGuardResult {
  allowed: boolean;
  requiresRecurrenceEvidence: boolean;
  reasons: string[];
  evidence?: RecurrenceEvidence;
}

export interface RecurrenceEvidence {
  count: number | null;
  uniqueEvents: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  source: string | null;
  spanMinutes: number | null;
}

const RECURRENCE_RE = /\b(recurr(?:ing|ence|ent)|repeat(?:ed|ing)?|again|continues?\s+to|keeps?\s+(?:failing|emitting|returning)|loop|spiral)\b|(?:反覆|重複|持續|一直|循環|迴圈)|(?:>=|≥)\s*\d+|\b\d+\s*(?:x|times)\b|\b\d+\s*次\b|failureBuckets=/i;

export function evaluateIssueEvidenceGuard(input: IssueEvidenceGuardInput): IssueEvidenceGuardResult {
  const text = `${input.title}\n${input.body}`;
  if (!RECURRENCE_RE.test(text)) {
    return { allowed: true, requiresRecurrenceEvidence: false, reasons: [] };
  }

  const evidence = extractRecurrenceEvidence(text);
  const reasons = validateRecurrenceEvidence(evidence);
  return {
    allowed: reasons.length === 0,
    requiresRecurrenceEvidence: true,
    reasons,
    evidence,
  };
}

export function extractRecurrenceEvidence(text: string): RecurrenceEvidence {
  const count = extractNumber(text, [
    /\bcount\s*[:=]\s*(\d+)/i,
    /\bevents?\s*[:=]\s*(\d+)/i,
    /\boccurrences?\s*[:=]\s*(\d+)/i,
    /(?:>=|≥)\s*(\d+)/,
  ]);
  const uniqueEvents = extractNumber(text, [
    /\bunique[_ -]?events?\s*[:=]\s*(\d+)/i,
    /\bunique[_ -]?keys?\s*[:=]\s*(\d+)/i,
    /\bdistinct[_ -]?events?\s*[:=]\s*(\d+)/i,
  ]);
  const firstSeen = extractDate(text, /\bfirst[_ -]?seen\s*[:=]\s*([^\n]+)/i);
  const lastSeen = extractDate(text, /\blast[_ -]?seen\s*[:=]\s*([^\n]+)/i);
  const source = extractSource(text);
  const spanMinutes = computeSpanMinutes(firstSeen, lastSeen);
  return { count, uniqueEvents, firstSeen, lastSeen, source, spanMinutes };
}

function validateRecurrenceEvidence(evidence: RecurrenceEvidence): string[] {
  const reasons: string[] = [];
  if ((evidence.count ?? 0) < 3) reasons.push('recurrence issue requires count>=3');
  if ((evidence.uniqueEvents ?? 0) < 3) reasons.push('recurrence issue requires unique_events>=3');
  if (!evidence.firstSeen || !evidence.lastSeen) reasons.push('recurrence issue requires first_seen and last_seen');
  if (evidence.spanMinutes !== null && evidence.spanMinutes < 10) {
    reasons.push('recurrence issue requires events spread across >=10 minutes, not a single burst');
  }
  if (!evidence.source) reasons.push('recurrence issue requires source path/query evidence');
  return reasons;
}

function extractNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function extractDate(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match) return null;
  const raw = match[1].trim().replace(/[`'"，,].*$/, '');
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function extractSource(text: string): string | null {
  const explicit = text.match(/\bsource\s*[:=]\s*([^\n]+)/i)?.[1]?.trim();
  if (explicit && /(?:\/|curl|gh |rg |grep|jq|jsonl|ledger|http)/i.test(explicit)) return explicit;
  const pathLike = text.match(/(?:\/[\w./-]+|[\w./-]+\.jsonl|curl\s+-?\w*\s+\S+|gh\s+\w+\s+\w+)/i)?.[0];
  return pathLike ?? null;
}

function computeSpanMinutes(firstSeen: string | null, lastSeen: string | null): number | null {
  if (!firstSeen || !lastSeen) return null;
  const first = Date.parse(firstSeen);
  const last = Date.parse(lastSeen);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Math.abs(last - first) / 60_000;
}
