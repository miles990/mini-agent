import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tests for build-kuro-content.mjs (#394)
 *
 * Validates:
 * 1. Script exists and uses Anthropic API
 * 2. Validation gate logic (offline -- no API call)
 * 3. Wrapper script exists with correct setup
 * 4. Plist exists with 16:25 schedule
 * 5. Missing-feeder graceful-warn path (Acceptance #1)
 */

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'build-kuro-content.mjs');
const WRAPPER_PATH = path.join(process.cwd(), 'scripts', 'launchd-wrappers', 'build-kuro-content.sh');
const PLIST_PATH = path.join(process.cwd(), 'scripts', 'launchd-wrappers', 'com.kuro.build-kuro-content.plist');

// -- Inline reimplementation of validate() for unit tests --------------------
// Mirrors the validate() function in build-kuro-content.mjs so tests can verify
// the gate logic without executing the script (no API key needed).
function validate(content: string): string[] {
  const issues: string[] = [];

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 600) issues.push(`word count too low: ${wordCount} (min 600)`);
  if (wordCount > 2000) issues.push(`word count too high: ${wordCount} (max 2000)`);

  const takeMatch = content.match(/## kuro-take([\s\S]*?)(?=\n## |\s*$)/);
  if (!takeMatch) {
    issues.push('missing ## kuro-take section');
  } else {
    const links = (takeMatch[1] || '').match(/\[[^\]]+\]\([^)\s]+\)/g) || [];
    if (links.length === 0) issues.push('kuro-take section has no [text](url) links');
  }

  const repoMatch = content.match(/^repo:\s*(.+)$/m);
  if (!repoMatch) {
    issues.push('missing repo: field in github-spotlight section');
  } else {
    const repo = repoMatch[1].trim();
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      issues.push(`repo field does not match owner/repo format: "${repo}"`);
    }
  }

  const swotMatch = content.match(/## swot([\s\S]*?)(?=\n## |\s*$)/);
  if (!swotMatch) {
    issues.push('missing ## swot section');
  } else {
    const swotBody = swotMatch[1] || '';
    const dims = ['strengths', 'weaknesses', 'opportunities', 'threats'];
    for (const dim of dims) {
      const dimMatch = swotBody.match(new RegExp(`^${dim}:\\s*$`, 'm'));
      if (!dimMatch) {
        issues.push(`SWOT missing ${dim} dimension`);
      } else {
        const afterDim = swotBody.slice(swotBody.indexOf(dimMatch[0]) + dimMatch[0].length);
        const nextDimIdx = afterDim.search(/^[a-zA-Z]+:\s*$/m);
        const segment = nextDimIdx >= 0 ? afterDim.slice(0, nextDimIdx) : afterDim;
        const bullet = segment.match(/^\s*-\s+.+/m);
        if (!bullet) issues.push(`SWOT ${dim} dimension has no bullet items`);
      }
    }
  }

  return issues;
}

// -- Script existence --------------------------------------------------------
describe('build-kuro-content.mjs script', () => {
  let script: string;

  it('script file exists', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script.length).toBeGreaterThan(0);
  });

  it('uses Anthropic API via fetch (not claude CLI)', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('api.anthropic.com/v1/messages');
    expect(script).toContain('ANTHROPIC_API_KEY');
  });

  it('uses MINI_AGENT_MEMORY_DIR as durable state root with repo fallback', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('MINI_AGENT_MEMORY_DIR');
    expect(script).toContain('READ_STATE_DIRS');
    expect(script).toContain('tryReadState');
  });

  it('exits with error when zero feeders are available', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    // Must have the zero-feeder guard (Acceptance #1)
    expect(script).toContain('zero feeders available');
    expect(script).toContain('process.exit(1)');
  });

  it('writes .draft file on validation failure, not live .md (Acceptance #2)', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('.md.draft');
    expect(script).toContain('VALIDATION FAILED');
  });

  it('strips code fences from LLM output', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('```');
  });

  it('corrects date in frontmatter to prevent exemplar date leaking', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toMatch(/replace.*date:.*DATE/);
  });

  it('read-back verifies the written artifact before reporting success', () => {
    script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('verifyWrittenArtifact');
    expect(script).toContain('written artifact failed readback validation');
    expect(script).toContain('verified artifact bytes=');
  });
});

// -- Validation gate (unit tests, no API) ------------------------------------
describe('validate() -- content validation gate', () => {
  /** Build a minimal valid content block with enough words */
  function buildValid(overrides: Partial<{
    kuroTake: string;
    repo: string;
    swotBody: string;
  }> = {}): string {
    const padding = Array(620).fill('word').join(' ');
    const kuroTake = overrides.kuroTake ??
      "Today's AI signals point to a convergence. [GPT-Realtime-2](https://openai.com/blog) launched today.\n\nSecond paragraph here with more detail. [arXiv paper](https://arxiv.org/abs/2605.0001) confirms the trend.";
    const repo = overrides.repo ?? 'sansan0/TrendRadar';
    const swotBody = overrides.swotBody ?? `strengths:\n- Fast iteration\nweaknesses:\n- Limited data\nopportunities:\n- New lane\nthreats:\n- Commoditization`;
    return [
      '---',
      'date: 2026-05-09',
      'author: kuro',
      'schema_version: 1',
      '---',
      '',
      `## kuro-take\n${kuroTake}`,
      '',
      `## github-spotlight\nrepo: ${repo}\nlicense: MIT\nwhy-it-matters: Good project.`,
      '',
      `## swot\n${swotBody}`,
      '',
      padding,
    ].join('\n');
  }

  it('passes on valid content', () => {
    const errors = validate(buildValid());
    expect(errors).toHaveLength(0);
  });

  it('fails when word count is below 600', () => {
    const short = '## kuro-take\n[link](http://x.com) text.\n## github-spotlight\nrepo: a/b\n## swot\nstrengths:\n- x\nweaknesses:\n- x\nopportunities:\n- x\nthreats:\n- x';
    const errors = validate(short);
    expect(errors.some(e => e.includes('word count too low'))).toBe(true);
  });

  it('fails when kuro-take has no [text](url) links', () => {
    const content = buildValid({ kuroTake: 'No links in this paragraph. Just plain text here.' });
    const errors = validate(content);
    expect(errors.some(e => e.includes('no [text](url) links'))).toBe(true);
  });

  it('fails when repo field is missing', () => {
    const content = buildValid({ repo: '' });
    const errors = validate(content);
    expect(errors.some(e => e.includes('repo'))).toBe(true);
  });

  it('fails when repo does not match owner/repo format', () => {
    const content = buildValid({ repo: 'not-a-valid-repo' });
    const errors = validate(content);
    expect(errors.some(e => e.includes('owner/repo format'))).toBe(true);
  });

  it('fails when a SWOT dimension is missing', () => {
    const swotMissingThreats = 'strengths:\n- x\nweaknesses:\n- x\nopportunities:\n- x';
    const content = buildValid({ swotBody: swotMissingThreats });
    const errors = validate(content);
    expect(errors.some(e => e.includes('threats'))).toBe(true);
  });

  it('fails when a SWOT dimension has no bullets', () => {
    const swotEmptyBullets = 'strengths:\nweaknesses:\n- x\nopportunities:\n- x\nthreats:\n- x';
    const content = buildValid({ swotBody: swotEmptyBullets });
    const errors = validate(content);
    expect(errors.some(e => e.includes('strengths') && e.includes('bullet'))).toBe(true);
  });

  it('accepts repo names with dots and hyphens', () => {
    const content = buildValid({ repo: 'some-org/my.repo-name' });
    const errors = validate(content);
    expect(errors.filter(e => e.includes('owner/repo format'))).toHaveLength(0);
  });
});

// -- Launchd wiring ----------------------------------------------------------
describe('build-kuro-content launchd wrapper', () => {
  it('wrapper script exists', () => {
    const wrapper = readFileSync(WRAPPER_PATH, 'utf-8');
    expect(wrapper.length).toBeGreaterThan(0);
  });

  it('wrapper calls build-kuro-content.mjs', () => {
    const wrapper = readFileSync(WRAPPER_PATH, 'utf-8');
    expect(wrapper).toContain('build-kuro-content.mjs');
  });

  it('wrapper sources .env before running', () => {
    const wrapper = readFileSync(WRAPPER_PATH, 'utf-8');
    expect(wrapper).toContain('.env');
    expect(wrapper).toContain('set -a');
  });

  it('wrapper defaults durable state to external mini-agent-memory', () => {
    const wrapper = readFileSync(WRAPPER_PATH, 'utf-8');
    expect(wrapper).toContain('MINI_AGENT_MEMORY_DIR');
    expect(wrapper).toContain('/Users/user/Workspace/mini-agent-memory/memory');
  });
});

describe('com.kuro.build-kuro-content.plist', () => {
  let plist: string;

  it('plist file exists', () => {
    plist = readFileSync(PLIST_PATH, 'utf-8');
    expect(plist.length).toBeGreaterThan(0);
  });

  it('schedule is 16:25 (after enrich, before build-ai-trend-index)', () => {
    plist = readFileSync(PLIST_PATH, 'utf-8');
    expect(plist).toContain('<integer>16</integer>');
    expect(plist).toContain('<integer>25</integer>');
  });

  it('log path is kuro-content-cron.log', () => {
    plist = readFileSync(PLIST_PATH, 'utf-8');
    expect(plist).toContain('kuro-content-cron.log');
  });

  it('label is com.kuro.build-kuro-content', () => {
    plist = readFileSync(PLIST_PATH, 'utf-8');
    expect(plist).toContain('com.kuro.build-kuro-content');
  });
});
