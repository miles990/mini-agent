/**
 * crystallization-types.ts — Shared type definitions for the crystallization engine.
 *
 * Used by experience-extractor.ts (L4) and other crystallization modules.
 */

/** A single task execution episode recorded for ExpeL-style learning. */
export interface ExperienceRecord {
  taskType: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial';
  context: Record<string, unknown>;
  timestamp?: string;
}

/** A distilled experience rule with confidence tracking. */
export interface ExperienceRule {
  id: string;
  when: string;
  then: string;
  confidence: number;
  supportCount: number;
  counterCount: number;
  createdAt: string;
  lastApplied: string;
  tags: string[];
}

/** A lightweight rule item for prompt injection guidance. */
export interface RuleGuidanceItem {
  when: string;
  then: string;
  confidence: number;
}
