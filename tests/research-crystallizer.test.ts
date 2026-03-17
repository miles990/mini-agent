import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// =============================================================================
// Research Crystallizer Tests
// =============================================================================

// Test helpers — import the pure functions directly
import {
  parseDelegationOutput,
  recordResearchObservation,
  distillResearchMethodology,
  getCurrentMethodology,
  _resetMethodologyForTest,
} from '../src/research-crystallizer.js';

import {
  buildResearchPrompt,
  processResearchResult,
  runResearchDistillation,
  getMethodologySummary,
} from '../src/small-model-research.js';

// Temp paths for test isolation
const TEST_RULES_PATH = '/tmp/test-research-rules.json';
const TEST_LOG_PATH = '/tmp/test-research-decisions.jsonl';
const TEST_METHODOLOGY_PATH = '/tmp/test-research-methodology.json';

function cleanup() {
  for (const p of [TEST_RULES_PATH, TEST_LOG_PATH, TEST_METHODOLOGY_PATH]) {
    try { fs.unlinkSync(p); } catch {}
  }
}

describe('parseDelegationOutput', () => {
  it('extracts topic from header', () => {
    const output = `## Crystallization Research

    Found that arXiv:2603.10808 describes a four-stage crystallization cycle.
    Key insight: the investment theory maps LLM fluid intelligence to rule crystallized intelligence.

    Source: https://arxiv.org/abs/2603.10808`;

    const obs = parseDelegationOutput(output, 'research', 120000, 7);
    expect(obs).not.toBeNull();
    expect(obs!.topic).toContain('Crystallization Research');
    expect(obs!.sources).toContain('https://arxiv.org/abs/2603.10808');
    expect(obs!.depth).toBe('skim'); // output ~250 chars, below 1000 threshold
    expect(obs!.qualityScore).toBe(7);
    expect(obs!.tags).toContain('academic');
  });

  it('returns null for empty output', () => {
    expect(parseDelegationOutput('', 'learn', 0)).toBeNull();
    expect(parseDelegationOutput('too short', 'learn', 0)).toBeNull();
  });

  it('extracts URLs as sources', () => {
    const output = `I investigated the topic by checking these sources:
    https://news.ycombinator.com/item?id=12345
    https://arxiv.org/abs/2603.10808
    https://github.com/miles990/myelin

    The key finding is that crystallization patterns emerge naturally.
    This connects to our existing work on agent architecture.`;

    const obs = parseDelegationOutput(output, 'research', 60000);
    expect(obs).not.toBeNull();
    expect(obs!.sources.length).toBe(3);
    expect(obs!.tags).toContain('academic');
    expect(obs!.tags).toContain('ai');
  });

  it('detects cross-references', () => {
    const output = `This research connects to what we already know about agent design.
    The bridge between cognitive science and AI is clear.
    Cross-referencing with Cattell's investment theory shows analogous patterns.
    This insight links fluid and crystallized intelligence.
    A long enough output to not be filtered as too short for analysis purposes.`;

    const obs = parseDelegationOutput(output, 'learn', 45000);
    expect(obs).not.toBeNull();
    expect(obs!.crossReferences).toBeGreaterThan(0);
  });

  it('extracts remember tags as retained', () => {
    const output = `After reading the paper, the core finding is important.
    <kuro:remember>Crystallization reduces LLM calls by 80% after 100 decisions</kuro:remember>
    The pattern is clear: repeated decisions converge to rules.
    Additional padding text to make this long enough to not be filtered out by minimum length.`;

    const obs = parseDelegationOutput(output, 'research', 90000);
    expect(obs).not.toBeNull();
    expect(obs!.retained.length).toBe(1);
    expect(obs!.retained[0]).toContain('Crystallization reduces');
  });

  it('assesses depth based on output length', () => {
    const short = 'x'.repeat(500) + '\nA short research output with some insight.';
    const medium = 'x'.repeat(1500) + '\nA medium depth research with more detail and insight.';
    const long = 'x'.repeat(4000) + '\nA deep-dive with extensive analysis and insight.';

    const shortObs = parseDelegationOutput(short, 'learn', 30000);
    const mediumObs = parseDelegationOutput(medium, 'learn', 60000);
    const longObs = parseDelegationOutput(long, 'research', 120000);

    expect(shortObs!.depth).toBe('skim');
    expect(mediumObs!.depth).toBe('read');
    expect(longObs!.depth).toBe('deep-dive');
  });
});

describe('buildResearchPrompt', () => {
  it('builds prompt without methodology', () => {
    const prompt = buildResearchPrompt({
      topic: 'crystallization patterns',
      context: 'Alex asked about crystallization',
      depth: 'read',
    });

    expect(prompt).toContain('crystallization patterns');
    expect(prompt).toContain('read');
    expect(prompt).toContain('Begin your research');
  });

  it('injects methodology when available', () => {
    const mockMethodology = {
      methodology: {
        dimensions: [{ name: 'source-type', description: 'Source type', indicators: ['source'], levels: ['arxiv', 'web'], weight: 0.8 }],
        principles: [{ description: 'Always check arXiv first', when: 'researching AI', then: 'arxiv', confidence: 0.9, supportingTemplates: [] }],
        matrix: [],
        templateCount: 2,
        ruleCount: 5,
        totalHits: 50,
        generatedAt: new Date().toISOString(),
      },
      guidanceText: 'Established principles:\n- Always check arXiv first (90% confidence)',
      smallModelPrompt: 'You are a research assistant. Follow these crystallized research patterns:\n\n## Research Methodology\nEstablished principles:\n- Always check arXiv first',
      stats: { totalObservations: 50, ruleCount: 5, templateCount: 2, principleCount: 1 },
    };

    const prompt = buildResearchPrompt(
      { topic: 'AI agents', context: 'Exploring new papers', depth: 'deep-dive' },
      mockMethodology,
    );

    expect(prompt).toContain('Always check arXiv first');
    expect(prompt).toContain('AI agents');
    expect(prompt).toContain('deep-dive');
  });

  it('includes preferred sources when specified', () => {
    const prompt = buildResearchPrompt({
      topic: 'small models',
      context: 'Local inference optimization',
      depth: 'read',
      sources: ['arxiv.org', 'huggingface.co'],
    });

    expect(prompt).toContain('arxiv.org');
    expect(prompt).toContain('huggingface.co');
  });
});

describe('processResearchResult', () => {
  it('extracts observation and returns result', () => {
    const output = `## Small Model Research

    Found that Qwen 2.5 0.5B achieves 85% of GPT-4 quality on classification tasks.
    Key insight: distilled models retain decision patterns well.
    Cross-referencing with our crystallization approach shows complementary strengths.

    Source: https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct
    Additional analysis shows the model excels at structured output generation.`;

    const result = processResearchResult(output, 'research', 90000, 6);
    expect(result).not.toBeNull();
    expect(result!.observation).not.toBeNull();
    expect(result!.observation!.sources.length).toBeGreaterThan(0);
    expect(result!.duration).toBe(90000);
  });

  it('returns null for empty output', () => {
    expect(processResearchResult('', 'learn', 0)).toBeNull();
  });
});

describe('getMethodologySummary', () => {
  const realPath = './memory/research-methodology.json';
  const backupPath = './memory/research-methodology.json.test-bak';

  beforeEach(() => {
    _resetMethodologyForTest();
    try { fs.renameSync(realPath, backupPath); } catch {}
  });

  afterEach(() => {
    try { fs.renameSync(backupPath, realPath); } catch {}
  });

  it('returns message when no methodology exists', () => {
    const summary = getMethodologySummary();
    expect(summary).toContain('No research methodology');
  });
});

describe('end-to-end: observation → crystallization pipeline', () => {
  it('records observations and produces methodology summary', () => {
    // Simulate multiple research observations
    for (let i = 0; i < 3; i++) {
      recordResearchObservation({
        topic: `AI agent architecture ${i}`,
        sources: ['https://arxiv.org/abs/test'],
        depth: 'deep-dive',
        insightsFound: 3,
        crossReferences: 1,
        qualityScore: 7,
        duration: 120000,
        retained: ['Key finding about crystallization'],
        discarded: [],
        tags: ['ai', 'academic'],
      });
    }

    // Run distillation
    const result = runResearchDistillation();
    expect(result.stats.totalObservations).toBeGreaterThan(0);
    // May not have enough observations for rules yet (need minOccurrences=5)
    // but the pipeline should work without errors
  });
});
