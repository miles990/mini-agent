/**
 * Memory Classifier — N5 / H arbitrator (2026-04-24)
 *
 * Pure functions producing `memory_kind` + arbitration per N0 finalized schema
 * (memory/proposals/2026-04-24-memory-provenance-schema.md).
 *
 * Responsibilities:
 *   1. Split a memory entry into subclaims (Chinese period / newline / structural markers).
 *   2. Classify each subclaim into one of: descriptive / imperative / inference / commitment / observation.
 *   3. Arbitrate same-entity conflicting claims per precedence:
 *        observation ≥ imperative > descriptive > inference > self-cite
 *      Same tier → newer source_cycle wins.
 *      Tie-break: imperative ≥2 cycle newer than observation can override.
 *
 * Non-goals (Phase 1): integration into appendMemory (Kuro writer) or buildContext
 * (waits for B3 Part 3 + MVP acceptance gate). This module is pure logic only.
 */

export type MemoryKind = 'descriptive' | 'imperative' | 'inference' | 'commitment' | 'observation';

export type EvidenceKind =
  | 'shell-probe'
  | 'background-task'
  | 'chat'
  | 'kg-node'
  | 'inference'
  | 'self-cite';

export interface SubClaim {
  text: string;
  memory_kind: MemoryKind;
  evidence_kind?: EvidenceKind;
  confidence: number;
  subclaim_index: number;
}

export interface ClassifiedEntry {
  entry_id: string;
  source_cycle: number;
  subclaims: SubClaim[];
}

export interface ArbitrationResult {
  winners: Array<SubClaim & { from_entry: string; from_cycle: number }>;
  overridden: Array<SubClaim & { from_entry: string; from_cycle: number; overridden_by: string }>;
}

const KIND_TIER: Record<MemoryKind, number> = {
  observation: 4,
  imperative: 4,
  descriptive: 3,
  inference: 2,
  commitment: 2,
};

const SELF_CITE_TIER = 1;

export function splitSubClaims(content: string): string[] {
  const stripped = content.replace(/^\s*-\s*/, '').trim();
  const preSplit = stripped.replace(/\r\n?/g, '\n');
  const parts = preSplit
    .split(/。|\n+/u)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !/^\s*[-*]\s*$/.test(p));
  return parts;
}

const IMPERATIVE_CUES = [
  /^Pattern\s*[:：]/i,
  /^Rule\s*[:：]/i,
  /^Note to self/i,
  /^(先|記得|請|別|不要|一律|禁止|必須|應該|要|應|需)(?!.*(是|了|被|過))/,
  /,\s*(先|記得|請|別|不要|一律|禁止|必須)/,
  /(.+?)，(先|記得|請|別|不要|一律|禁止|必須).+/,
];

const OBSERVATION_CUES = [
  /^\[?實測\]?[:：]?/,
  /\b(curl|grep|http=|exit\s+\d+|shell|stdout|stderr|log)\b/i,
  /\b\d+\s*\/\s*\d+\b/,
  /\bhttp=\d{3}\b/i,
  /`[^`]+`/,
  /\b\d+\s*(ms|s|sec|min|hour|MB|GB|KB)\b/i,
  /\b(enriched_at|commit|sha|exit\s?code)\b/i,
];

const INFERENCE_CUES = [
  /(應該是|可能是|可能有|或許|大概|推測|估計|懷疑|appears to|seems to|might be|my guess|I think)/i,
  /(幻覺|假設|前提)/,
];

const COMMITMENT_CUES = [
  /(下\s?cycle|下次|下個|待辦|TODO|TTL|falsifier)/i,
  /(我會|將會|承諾|will\s+(do|add|fix|ship|ensure))/i,
  /\bcl-\d+/,
];

export function classifySubClaim(
  text: string,
  ctx: { index: number; evidence_kind?: EvidenceKind } = { index: 0 },
): SubClaim {
  const normalized = text.trim();

  const hasImperative = IMPERATIVE_CUES.some(re => re.test(normalized));
  const hasObservation = OBSERVATION_CUES.some(re => re.test(normalized));
  const hasInference = INFERENCE_CUES.some(re => re.test(normalized));
  const hasCommitment = COMMITMENT_CUES.some(re => re.test(normalized));

  let kind: MemoryKind;
  let confidence: number;

  if (hasImperative) {
    kind = 'imperative';
    confidence = 0.85;
  } else if (hasCommitment) {
    kind = 'commitment';
    confidence = 0.8;
  } else if (hasObservation && !hasInference) {
    kind = 'observation';
    confidence = 0.8;
  } else if (hasInference) {
    kind = 'inference';
    confidence = 0.6;
  } else {
    kind = 'descriptive';
    confidence = 0.5;
  }

  return {
    text: normalized,
    memory_kind: kind,
    evidence_kind: ctx.evidence_kind,
    confidence,
    subclaim_index: ctx.index,
  };
}

export function classifyEntry(
  entry_id: string,
  content: string,
  source_cycle: number,
  evidence_kind?: EvidenceKind,
): ClassifiedEntry {
  const parts = splitSubClaims(content);
  const subclaims = parts.map((text, index) => classifySubClaim(text, { index, evidence_kind }));
  return { entry_id, source_cycle, subclaims };
}

function effectiveTier(c: SubClaim): number {
  if (c.evidence_kind === 'self-cite') return SELF_CITE_TIER;
  return KIND_TIER[c.memory_kind] ?? 3;
}

function claimScore(c: SubClaim, entry_cycle: number): number {
  return effectiveTier(c) * 1e6 + entry_cycle;
}

export function arbitrate(entries: ClassifiedEntry[]): ArbitrationResult {
  const flattened = entries.flatMap(e =>
    e.subclaims.map(s => ({ ...s, from_entry: e.entry_id, from_cycle: e.source_cycle })),
  );

  const sorted = flattened.slice().sort((a, b) => claimScore(b, b.from_cycle) - claimScore(a, a.from_cycle));

  const winners: typeof flattened = [];
  const overridden: Array<typeof flattened[number] & { overridden_by: string }> = [];
  if (sorted.length === 0) return { winners: [], overridden: [] };

  const topScore = claimScore(sorted[0], sorted[0].from_cycle);
  for (const c of sorted) {
    const myScore = claimScore(c, c.from_cycle);
    if (myScore === topScore) {
      winners.push(c);
      continue;
    }
    const w = winners[0];
    const winnerTier = effectiveTier(w);
    const loserTier = effectiveTier(c);
    if (
      loserTier === winnerTier &&
      c.memory_kind === 'imperative' &&
      w.memory_kind === 'observation' &&
      c.from_cycle >= w.from_cycle + 2
    ) {
      overridden.push({ ...w, overridden_by: c.from_entry });
      winners.length = 0;
      winners.push(c);
      continue;
    }
    overridden.push({ ...c, overridden_by: w.from_entry });
  }

  return { winners, overridden };
}
