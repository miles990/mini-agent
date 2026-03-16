/**
 * Small Model Research Pipeline
 *
 * 用結晶化的方法論引導本地小模型做研究。
 * 核心理念：大模型的研究經驗 → myelin 結晶化 → 方法論 → 小模型 prompt
 *
 * Flow:
 * 1. 從 research-crystallizer 取得當前方法論
 * 2. 把方法論 + 感知信號組裝成小模型 prompt
 * 3. 委派研究任務到本地小模型（oMLX/ollama）
 * 4. 解析結果，回饋到結晶化引擎
 * 5. 方法論持續演化 → 小模型研究品質持續提升
 */

import { getCurrentMethodology, distillResearchMethodology, recordResearchObservation, parseDelegationOutput } from './research-crystallizer.js';
import type { ResearchMethodology, ResearchObservation } from './research-crystallizer.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface ResearchTask {
  topic: string;
  context: string;           // Perception signals that triggered this research
  depth: 'skim' | 'read' | 'deep-dive';
  sources?: string[];        // Preferred sources (from methodology)
  maxDurationMs?: number;
}

export interface ResearchResult {
  task: ResearchTask;
  output: string;
  observation: ResearchObservation | null;
  methodologyUsed: boolean;  // Whether methodology was injected
  model: string;             // Which model was used
  duration: number;
}

export interface SmallModelConfig {
  provider: 'omlx' | 'ollama' | 'vllm';
  model: string;             // e.g., 'qwen2.5:0.5b', 'qwen2.5:3b'
  endpoint?: string;
  maxTokens?: number;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: SmallModelConfig = {
  provider: 'omlx',
  model: 'mlx-community/Qwen2.5-3B-Instruct-4bit',
  maxTokens: 2048,
};

// =============================================================================
// Core Pipeline
// =============================================================================

/**
 * Build a methodology-guided research prompt for small models.
 *
 * This is where crystallization pays off:
 * - Without methodology: generic "research X" → small model flounders
 * - With methodology: "research X using these strategies, prioritize these sources,
 *   go this deep, keep these types of insights" → small model follows a playbook
 */
export function buildResearchPrompt(
  task: ResearchTask,
  methodology?: ResearchMethodology | null,
): string {
  const sections: string[] = [];

  // Methodology injection (the crystallized intelligence)
  if (methodology?.smallModelPrompt) {
    sections.push(methodology.smallModelPrompt);
    sections.push('---\n');
  }

  // Task specification
  sections.push(`## Current Research Task

**Topic**: ${task.topic}
**Depth**: ${task.depth}
**Context**: ${task.context}
`);

  // Source guidance (from methodology or default)
  if (task.sources && task.sources.length > 0) {
    sections.push(`**Preferred Sources**: ${task.sources.join(', ')}\n`);
  }

  sections.push(`Begin your research. Follow the methodology above if available.
Focus on actionable insights. Be concise.`);

  return sections.join('\n');
}

/**
 * Generate a delegation prompt for small model research.
 *
 * Returns a prompt string ready to be passed to spawnDelegation().
 * The delegation system handles the actual subprocess execution.
 */
export function generateDelegationPrompt(task: ResearchTask): {
  prompt: string;
  methodologyUsed: boolean;
} {
  const methodology = getCurrentMethodology();
  const prompt = buildResearchPrompt(task, methodology);

  return {
    prompt,
    methodologyUsed: methodology !== null,
  };
}

/**
 * Process a completed research delegation result.
 *
 * Extracts structured observations and feeds them back into
 * the crystallization engine. This closes the loop:
 *
 * methodology → small model research → observation → crystallization → better methodology
 */
export function processResearchResult(
  output: string,
  type: 'learn' | 'research',
  duration: number,
  confidence?: number,
): ResearchResult | null {
  const observation = parseDelegationOutput(output, type, duration, confidence);

  if (observation) {
    // Feed back into crystallization engine
    recordResearchObservation(observation);
    slog('SMALL-MODEL-RESEARCH', `Processed result: ${observation.topic} → ${observation.insightsFound} insights`);
  }

  return observation ? {
    task: {
      topic: observation.topic,
      context: '',
      depth: observation.depth,
    },
    output,
    observation,
    methodologyUsed: false, // Will be set by caller
    model: 'local',
    duration,
  } : null;
}

/**
 * Run periodic distillation and return updated methodology stats.
 * Should be called from housekeeping / OODA cycle periodically.
 */
export function runResearchDistillation(): {
  stats: ResearchMethodology['stats'];
  guidanceText: string;
  hasMethodology: boolean;
} {
  const result = distillResearchMethodology();

  slog('SMALL-MODEL-RESEARCH', `Distillation complete: ${result.stats.ruleCount} rules, ${result.stats.principleCount} principles`);

  return {
    stats: result.stats,
    guidanceText: result.guidanceText,
    hasMethodology: result.stats.principleCount > 0,
  };
}

/**
 * Get the current research methodology summary for display.
 */
export function getMethodologySummary(): string {
  const methodology = getCurrentMethodology();
  if (!methodology) return 'No research methodology crystallized yet. Need more observations.';

  const { stats, guidanceText } = methodology;
  return [
    `Research Methodology Status:`,
    `- Observations: ${stats.totalObservations}`,
    `- Rules: ${stats.ruleCount}`,
    `- Templates: ${stats.templateCount}`,
    `- Principles: ${stats.principleCount}`,
    ``,
    guidanceText || '(No guidance text generated yet)',
  ].join('\n');
}
