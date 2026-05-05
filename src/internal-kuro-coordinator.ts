/**
 * Internal Kuro Coordinator.
 *
 * Kuro is not a provider backend. This module gives Kuro an explicit runtime
 * role: integrate multi-brain outputs, surface conflicts, and state the current
 * coordination decision using Kuro's own memory/constraint layer as authority.
 */

import type { ActorId, ArbitrationDecision, WorkItem } from './brain-types.js';

export interface KuroCoordinationInput {
  workItem: WorkItem;
  decision: ArbitrationDecision;
  runs: Array<{
    actor: ActorId;
    role: string;
    status: string;
    text?: string;
    error?: string;
  }>;
}

export interface KuroCoordinationResult {
  coordinator: 'kuro';
  response: string;
  selectedPrimary: ActorId | null;
  conflicts: string[];
  recommendations: string[];
}

export function coordinateAsKuro(input: KuroCoordinationInput): KuroCoordinationResult {
  const successful = input.runs.filter(run => run.status === 'success');
  const failed = input.runs.filter(run => run.status === 'failed');
  const skipped = input.runs.filter(run => run.status === 'skipped');
  const selectedPrimary = successful[0]?.actor ?? null;
  const conflicts = detectConflicts(input.runs);
  const recommendations = [
    ...(conflicts.length > 0 ? ['require another review pass before accepting claims'] : []),
    ...(failed.length > 0 ? ['inspect failed actor output before relying on consensus'] : []),
    ...(successful.length === 0 ? ['fall back to human or narrower deterministic task'] : []),
  ];

  const response = [
    `Kuro coordinated ${input.decision.mode} for ${input.workItem.id}.`,
    `Successful actors: ${successful.map(run => run.actor).join(', ') || 'none'}.`,
    failed.length > 0 ? `Failed actors: ${failed.map(run => run.actor).join(', ')}.` : '',
    skipped.length > 0 ? `Skipped actors: ${skipped.map(run => run.actor).join(', ')}.` : '',
    selectedPrimary ? `Selected primary synthesis source: ${selectedPrimary}.` : 'No synthesis source selected.',
    conflicts.length > 0 ? `Conflicts: ${conflicts.join(' | ')}` : 'No explicit conflict detected.',
  ].filter(Boolean).join(' ');

  return {
    coordinator: 'kuro',
    response,
    selectedPrimary,
    conflicts,
    recommendations,
  };
}

function detectConflicts(runs: KuroCoordinationInput['runs']): string[] {
  const texts = runs
    .filter(run => run.status === 'success' && run.text)
    .map(run => ({ actor: run.actor, text: (run.text ?? '').toLowerCase() }));
  const conflicts: string[] = [];

  for (const left of texts) {
    for (const right of texts) {
      if (left.actor >= right.actor) continue;
      if (mentionsDisagreement(left.text) || mentionsDisagreement(right.text)) {
        conflicts.push(`${left.actor}/${right.actor} mention disagreement`);
      }
    }
  }

  return [...new Set(conflicts)];
}

function mentionsDisagreement(text: string): boolean {
  return /\b(disagree|conflict|contradict|unsafe|blocked|reject|反對|衝突|矛盾|不安全)\b/i.test(text);
}
