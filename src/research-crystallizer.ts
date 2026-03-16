/**
 * Research Crystallizer — 學習/研究決策的結晶化引擎
 *
 * 獨立的 myelin 實例，專門結晶化學習和研究過程中的決策模式：
 * - topic-select: 選什麼主題研究
 * - source-strategy: 用什麼來源策略（arXiv、HN、web、code）
 * - depth-assess: 研究多深（skim、read、deep-dive）
 * - retention-decide: 保留什麼（key insight vs noise）
 * - synthesis: 如何交叉引用/連結
 *
 * 結晶化後的方法論可注入小模型 prompt，讓便宜的本地模型
 * 用大模型歸納出的研究策略做研究。
 */

import { buildGuidance } from 'myelinate';
import type { Myelin, Methodology } from 'myelinate';
import fs from 'node:fs';
import { slog } from './utils.js';
import { getResearchInstance } from './myelin-fleet.js';

// =============================================================================
// Types
// =============================================================================

/** Research decision event types */
export type ResearchEventType =
  | 'topic-select'      // Chose a topic to research
  | 'source-strategy'   // Chose sources to use
  | 'depth-assess'      // Decided research depth
  | 'retention-decide'  // Decided what to keep
  | 'synthesis';        // Connected insights across domains

/** Research decision actions */
export type ResearchAction =
  | 'deep-dive' | 'skim' | 'skip'         // depth
  | 'arxiv' | 'hn' | 'web' | 'code' | 'multi-source'  // source
  | 'retain' | 'discard' | 'connect'      // retention
  | 'high-priority' | 'normal' | 'low-priority';       // topic priority

/** Structured research observation from a completed delegation */
export interface ResearchObservation {
  topic: string;
  sources: string[];         // URLs or source types used
  depth: 'skim' | 'read' | 'deep-dive';
  insightsFound: number;
  crossReferences: number;   // connections to existing knowledge
  qualityScore: number;      // 0-10, from delegation confidence
  duration: number;          // ms
  retained: string[];        // what was remembered
  discarded: string[];       // what was skipped
  tags: string[];            // topic tags
}

/** Distilled research methodology for small model injection */
export interface ResearchMethodology {
  methodology: Methodology;
  guidanceText: string;       // Human-readable methodology for prompt injection
  smallModelPrompt: string;   // Ready-to-use prompt for small models
  stats: {
    totalObservations: number;
    ruleCount: number;
    templateCount: number;
    principleCount: number;
  };
}

// =============================================================================
// Instance (from Fleet) + state
// =============================================================================

const METHODOLOGY_PATH = './memory/research-methodology.json';
let _lastMethodology: Methodology | undefined;

/** Get the research crystallizer instance from the Fleet. */
export function getResearchCrystallizer(): Myelin<string> {
  return getResearchInstance();
}

// =============================================================================
// Observation — Record research decisions
// =============================================================================

/**
 * Record a research observation from a completed learn/research delegation.
 * Extracts multiple decision events from a single observation.
 */
export function recordResearchObservation(obs: ResearchObservation): void {
  const crystallizer = getResearchCrystallizer();

  // Decision 1: Topic selection (what was researched)
  crystallizer.triage({
    type: 'topic-select',
    source: obs.tags[0] ?? 'unknown',
    context: {
      topic: obs.topic,
      quality: obs.qualityScore,
      insights: obs.insightsFound,
      tags: obs.tags.join(','),
    },
  });

  // Decision 2: Source strategy (where did they look)
  const sourceType = categorizeSourceStrategy(obs.sources);
  crystallizer.triage({
    type: 'source-strategy',
    source: sourceType,
    context: {
      topic: obs.topic,
      sourceCount: obs.sources.length,
      strategy: sourceType,
      quality: obs.qualityScore,
    },
  });

  // Decision 3: Depth assessment
  crystallizer.triage({
    type: 'depth-assess',
    source: obs.depth,
    context: {
      topic: obs.topic,
      depth: obs.depth,
      duration: obs.duration,
      insightsPerMinute: obs.duration > 0 ? (obs.insightsFound / (obs.duration / 60000)) : 0,
    },
  });

  // Decision 4: Retention (what was kept vs discarded)
  if (obs.retained.length > 0 || obs.discarded.length > 0) {
    const retentionRate = obs.retained.length / Math.max(1, obs.retained.length + obs.discarded.length);
    crystallizer.triage({
      type: 'retention-decide',
      source: obs.tags[0] ?? 'unknown',
      context: {
        topic: obs.topic,
        retained: obs.retained.length,
        discarded: obs.discarded.length,
        retentionRate,
        quality: obs.qualityScore,
      },
    });
  }

  // Decision 5: Synthesis (cross-references found)
  if (obs.crossReferences > 0) {
    crystallizer.triage({
      type: 'synthesis',
      source: obs.tags[0] ?? 'unknown',
      context: {
        topic: obs.topic,
        crossReferences: obs.crossReferences,
        tags: obs.tags.join(','),
      },
    });
  }

  slog('RESEARCH-CRYSTALLIZER', `Recorded observation: ${obs.topic} (${obs.insightsFound} insights, ${obs.sources.length} sources)`);
}

/**
 * Parse delegation output to extract research observation.
 * Extracts structured data from free-text delegation results.
 */
export function parseDelegationOutput(
  output: string,
  type: 'learn' | 'research',
  duration: number,
  confidence?: number,
): ResearchObservation | null {
  if (!output || output.length < 50) return null;

  // Extract topic from first meaningful line
  const topicMatch = output.match(/(?:topic|主題|研究|investigating|exploring|learning about)[:\s]+([^\n]+)/i)
    ?? output.match(/^##?\s+(.+)/m);
  const topic = topicMatch?.[1]?.trim() ?? extractTopicFromContent(output);

  // Extract URLs as sources
  const urls = [...output.matchAll(/https?:\/\/[^\s\)]+/g)].map(m => m[0]);

  // Extract source types
  const sources = urls.length > 0 ? urls : ['local-knowledge'];

  // Assess depth from output length and structure
  const depth: 'skim' | 'read' | 'deep-dive' =
    output.length > 3000 ? 'deep-dive' :
    output.length > 1000 ? 'read' : 'skim';

  // Count insights (lines with insight markers)
  const insightPatterns = /(?:insight|發現|洞見|key\s+finding|重點|核心|principle|原則|觀點)/gi;
  const insightsFound = (output.match(insightPatterns) ?? []).length || 1;

  // Count cross-references
  const crossRefPatterns = /(?:connect|關聯|連結|cross-ref|呼應|類比|bridge|analogous|similar to)/gi;
  const crossReferences = (output.match(crossRefPatterns) ?? []).length;

  // Extract retained items (things that were remembered)
  const rememberMatches = [...output.matchAll(/<kuro:remember[^>]*>([\s\S]*?)<\/kuro:remember>/g)];
  const retained = rememberMatches.map(m => m[1].trim().slice(0, 100));

  // Extract tags from content
  const tags = extractTags(output, topic);

  return {
    topic,
    sources,
    depth,
    insightsFound,
    crossReferences,
    qualityScore: confidence ?? estimateQuality(output),
    duration,
    retained,
    discarded: [], // Can't determine from output alone
    tags,
  };
}

// =============================================================================
// Distillation — Extract methodology
// =============================================================================

/**
 * Run distillation cycle and return the current research methodology.
 * Called periodically (e.g., every N cycles or on demand).
 */
export function distillResearchMethodology(): ResearchMethodology {
  const crystallizer = getResearchCrystallizer();
  const result = crystallizer.evolve(_lastMethodology);
  _lastMethodology = result.distill.methodology;

  // Persist methodology for cross-session continuity
  try {
    fs.writeFileSync(
      METHODOLOGY_PATH,
      JSON.stringify({
        methodology: result.distill.methodology,
        methodologyText: result.distill.methodologyText,
        guidance: result.guidance,
        updatedAt: new Date().toISOString(),
      }, null, 2),
    );
  } catch { /* non-critical */ }

  const smallModelPrompt = buildSmallModelResearchPrompt(
    result.distill.methodology,
    result.guidance,
  );

  return {
    methodology: result.distill.methodology,
    guidanceText: result.guidance,
    smallModelPrompt,
    stats: {
      totalObservations: crystallizer.stats().totalDecisions,
      ruleCount: crystallizer.stats().ruleCount,
      templateCount: result.distill.templates.length,
      principleCount: result.distill.methodology.principles.length,
    },
  };
}

/**
 * Get current methodology without running distillation.
 * Loads from persisted file if available.
 */
export function getCurrentMethodology(): ResearchMethodology | null {
  // Try in-memory first
  if (_lastMethodology && _lastMethodology.principles.length > 0) {
    const crystallizer = getResearchCrystallizer();
    const guidance = buildGuidance(_lastMethodology);
    return {
      methodology: _lastMethodology,
      guidanceText: guidance,
      smallModelPrompt: buildSmallModelResearchPrompt(_lastMethodology, guidance),
      stats: {
        totalObservations: crystallizer.stats().totalDecisions,
        ruleCount: crystallizer.stats().ruleCount,
        templateCount: 0, // Would need distillation
        principleCount: _lastMethodology.principles.length,
      },
    };
  }

  // Try persisted file
  try {
    const data = JSON.parse(fs.readFileSync(METHODOLOGY_PATH, 'utf-8'));
    if (data.methodology?.principles?.length > 0) {
      _lastMethodology = data.methodology;
      return {
        methodology: data.methodology,
        guidanceText: data.guidance ?? '',
        smallModelPrompt: buildSmallModelResearchPrompt(data.methodology, data.guidance ?? ''),
        stats: {
          totalObservations: 0,
          ruleCount: 0,
          templateCount: 0,
          principleCount: data.methodology.principles.length,
        },
      };
    }
  } catch { /* no persisted methodology */ }

  return null;
}

// =============================================================================
// Small Model Prompt Builder
// =============================================================================

/**
 * Build a complete research prompt for small local models.
 *
 * This is the key value: crystallized methodology from big model decisions
 * becomes a structured guide that small models can follow.
 *
 * Structure:
 * 1. Research methodology (crystallized principles)
 * 2. Source strategy (which sources to prioritize)
 * 3. Depth guidelines (when to go deep vs skim)
 * 4. Output format (structured for further crystallization)
 */
function buildSmallModelResearchPrompt(
  methodology: Methodology,
  guidance: string,
): string {
  const sections: string[] = [];

  sections.push(`You are a research assistant. Follow these crystallized research patterns:

## Research Methodology
${guidance || 'No established patterns yet. Use your best judgment.'}
`);

  // Source strategy from dimensions
  const sourceDim = methodology.dimensions.find(d =>
    d.name.includes('source') || d.name.includes('strategy'),
  );
  if (sourceDim) {
    sections.push(`## Source Strategy
Key factors: ${sourceDim.levels.join(', ')}
Weight: ${(sourceDim.weight * 100).toFixed(0)}%
`);
  }

  // Depth guidelines from principles
  const depthPrinciples = methodology.principles.filter(p =>
    p.description.includes('depth') || p.description.includes('deep') || p.description.includes('skim'),
  );
  if (depthPrinciples.length > 0) {
    sections.push(`## Depth Guidelines
${depthPrinciples.map(p => `- ${p.description} (${(p.confidence * 100).toFixed(0)}% confidence)`).join('\n')}
`);
  }

  // Retention guidelines
  const retentionPrinciples = methodology.principles.filter(p =>
    p.description.includes('retain') || p.description.includes('keep') || p.description.includes('discard'),
  );
  if (retentionPrinciples.length > 0) {
    sections.push(`## What to Keep
${retentionPrinciples.map(p => `- ${p.description}`).join('\n')}
`);
  }

  sections.push(`## Output Format
Structure your findings as:
1. **Topic**: What you researched
2. **Sources**: URLs and references used
3. **Key Insights**: Numbered list of findings (max 5)
4. **Cross-References**: Connections to known topics
5. **Recommendation**: deep-dive / sufficient / low-value

Keep responses concise. Focus on actionable insights over exhaustive summaries.`);

  return sections.join('\n');
}

// =============================================================================
// Helpers
// =============================================================================

function categorizeSourceStrategy(sources: string[]): ResearchAction {
  const types = new Set<string>();
  for (const s of sources) {
    if (s.includes('arxiv.org')) types.add('arxiv');
    else if (s.includes('news.ycombinator.com') || s.includes('lobste.rs')) types.add('hn');
    else if (s.includes('github.com')) types.add('code');
    else if (s.startsWith('http')) types.add('web');
  }
  if (types.size === 0) return 'code';
  if (types.size > 1) return 'multi-source';
  return types.values().next().value as ResearchAction;
}

function extractTopicFromContent(content: string): string {
  // Take first non-empty line, trimmed
  const lines = content.split('\n').filter(l => l.trim().length > 10);
  return (lines[0] ?? 'unknown-topic').trim().slice(0, 80);
}

function extractTags(content: string, topic: string): string[] {
  const tags: string[] = [];
  const lowerContent = content.toLowerCase();

  // Domain detection
  if (lowerContent.includes('arxiv') || lowerContent.includes('paper') || lowerContent.includes('論文')) tags.push('academic');
  if (lowerContent.includes('agent') || lowerContent.includes('llm') || lowerContent.includes('ai ')) tags.push('ai');
  if (lowerContent.includes('design') || lowerContent.includes('interface') || lowerContent.includes('ux')) tags.push('design');
  if (lowerContent.includes('crystalliz') || lowerContent.includes('結晶')) tags.push('crystallization');
  if (lowerContent.includes('security') || lowerContent.includes('vulnerability')) tags.push('security');

  // Topic-based
  const topicLower = topic.toLowerCase();
  if (topicLower.includes('model')) tags.push('models');
  if (topicLower.includes('research')) tags.push('research');

  return tags.length > 0 ? tags : ['general'];
}

function estimateQuality(output: string): number {
  let score = 3; // base
  if (output.length > 1000) score += 1;
  if (output.length > 3000) score += 1;
  if (output.includes('http')) score += 1;           // Has sources
  if (output.includes('insight') || output.includes('洞見')) score += 1;
  if (output.includes('connect') || output.includes('關聯')) score += 1;
  if (output.match(/<kuro:remember/)) score += 1;    // Retained something
  return Math.min(10, score);
}
