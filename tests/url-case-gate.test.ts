import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractGitHubRefs,
  buildVerbatimUrlMap,
  enforceUrlCase,
  applyUrlCaseGate,
} from '../src/url-case-gate.js';

// =============================================================================
// Crystallization test: verification discipline #1 — GitHub owner/repo names
// are case-sensitive. When Alex pastes `https://github.com/JuliusBrussee/caveman`
// into the room, a delegate prompt containing `juliusbrussee/caveman` must be
// rewritten back to the verbatim form before spawn. Two cycles (#37 and #46
// on 2026-04-08) failed this rule in markdown form; the gate enforces it in
// code. See src/url-case-gate.ts header for incident history.
// =============================================================================

describe('url-case-gate', () => {
  let tmpDir: string;
  let memoryDir: string;
  let convDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-case-test-'));
    memoryDir = path.join(tmpDir, 'memory');
    convDir = path.join(memoryDir, 'conversations');
    fs.mkdirSync(convDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // extractGitHubRefs
  // ---------------------------------------------------------------------------

  describe('extractGitHubRefs', () => {
    it('extracts github.com owner/repo', () => {
      const refs = extractGitHubRefs('check https://github.com/JuliusBrussee/caveman out');
      expect(refs).toHaveLength(1);
      expect(refs[0].owner).toBe('JuliusBrussee');
      expect(refs[0].repo).toBe('caveman');
      expect(refs[0].key).toBe('juliusbrussee/caveman');
    });

    it('extracts api.github.com/repos/owner/repo', () => {
      const refs = extractGitHubRefs('curl https://api.github.com/repos/JuliusBrussee/caveman/contents/README.md');
      expect(refs).toHaveLength(1);
      expect(refs[0].owner).toBe('JuliusBrussee');
      expect(refs[0].repo).toBe('caveman');
    });

    it('extracts raw.githubusercontent.com', () => {
      const refs = extractGitHubRefs('fetch https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md');
      expect(refs).toHaveLength(1);
      expect(refs[0].owner).toBe('JuliusBrussee');
      expect(refs[0].repo).toBe('caveman');
    });

    it('extracts multiple refs in one text', () => {
      const refs = extractGitHubRefs(
        'compare https://github.com/JuliusBrussee/caveman with https://github.com/anthropics/claude-code',
      );
      expect(refs).toHaveLength(2);
      expect(refs.map(r => r.owner)).toEqual(['JuliusBrussee', 'anthropics']);
    });

    it('ignores non-github URLs', () => {
      const refs = extractGitHubRefs('see https://example.com/foo/bar for details');
      expect(refs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // buildVerbatimUrlMap
  // ---------------------------------------------------------------------------

  describe('buildVerbatimUrlMap', () => {
    function writeConv(day: string, messages: Array<{ id: string; from: string; text: string; ts: string }>) {
      const file = path.join(convDir, `${day}.jsonl`);
      fs.writeFileSync(file, messages.map(m => JSON.stringify(m)).join('\n') + '\n');
    }

    it('indexes URLs from Alex messages within the window', () => {
      const now = Date.parse('2026-04-08T16:30:00Z');
      writeConv('2026-04-08', [
        {
          id: '2026-04-08-015',
          from: 'alex',
          text: '剛剛看到這個 https://github.com/JuliusBrussee/caveman',
          ts: '2026-04-08T03:19:00Z',
        },
      ]);
      const map = buildVerbatimUrlMap(memoryDir, 24 * 60 * 60 * 1000, now);
      const record = map.get('juliusbrussee/caveman');
      expect(record).toBeDefined();
      expect(record!.canonical.owner).toBe('JuliusBrussee');
      expect(record!.canonical.repo).toBe('caveman');
      expect(record!.from).toBe('alex');
      expect(record!.msgId).toBe('2026-04-08-015');
    });

    it('excludes self-authored (kuro) messages — the failure mode this gate prevents', () => {
      // If Kuro's own mangled copy were trusted, the gate would lock in the
      // wrong case forever. Only non-self senders count as verbatim source.
      const now = Date.parse('2026-04-08T16:30:00Z');
      writeConv('2026-04-08', [
        {
          id: 'kuro-1',
          from: 'kuro',
          text: 'looking at https://github.com/juliusbrussee/caveman', // mangled
          ts: '2026-04-08T04:00:00Z',
        },
      ]);
      const map = buildVerbatimUrlMap(memoryDir, 24 * 60 * 60 * 1000, now);
      expect(map.size).toBe(0);
    });

    it('excludes messages older than the window', () => {
      const now = Date.parse('2026-04-08T16:30:00Z');
      writeConv('2026-04-06', [
        {
          id: 'old',
          from: 'alex',
          text: 'https://github.com/JuliusBrussee/caveman',
          ts: '2026-04-06T00:00:00Z', // >48h old
        },
      ]);
      const map = buildVerbatimUrlMap(memoryDir, 24 * 60 * 60 * 1000, now);
      expect(map.size).toBe(0);
    });

    it('first occurrence wins on duplicates', () => {
      const now = Date.parse('2026-04-08T16:30:00Z');
      writeConv('2026-04-08', [
        {
          id: 'first',
          from: 'alex',
          text: 'https://github.com/JuliusBrussee/caveman',
          ts: '2026-04-08T03:00:00Z',
        },
        {
          id: 'second',
          from: 'alex',
          text: 'https://github.com/JULIUSBRUSSEE/caveman', // different case
          ts: '2026-04-08T04:00:00Z',
        },
      ]);
      const map = buildVerbatimUrlMap(memoryDir, 24 * 60 * 60 * 1000, now);
      const record = map.get('juliusbrussee/caveman');
      expect(record!.canonical.owner).toBe('JuliusBrussee'); // first wins
      expect(record!.msgId).toBe('first');
    });

    it('returns empty map when conversations dir is missing', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
      const map = buildVerbatimUrlMap(emptyDir);
      expect(map.size).toBe(0);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  // ---------------------------------------------------------------------------
  // enforceUrlCase — the core crystallization behavior
  // ---------------------------------------------------------------------------

  describe('enforceUrlCase', () => {
    it('rewrites a lowercased owner to the verbatim form', () => {
      const verbatim = new Map([[
        'juliusbrussee/caveman',
        {
          canonical: {
            urlPrefix: 'https://github.com/JuliusBrussee/caveman',
            index: 0,
            owner: 'JuliusBrussee',
            repo: 'caveman',
            key: 'juliusbrussee/caveman',
          },
          msgId: '2026-04-08-015',
          from: 'alex',
        },
      ]]);
      const result = enforceUrlCase(
        'research https://github.com/juliusbrussee/caveman README',
        verbatim,
      );
      expect(result.prompt).toBe('research https://github.com/JuliusBrussee/caveman README');
      expect(result.rewrites).toHaveLength(1);
      expect(result.rewrites[0].from).toBe('https://github.com/juliusbrussee/caveman');
      expect(result.rewrites[0].to).toBe('https://github.com/JuliusBrussee/caveman');
      expect(result.rewrites[0].sourceMsgId).toBe('2026-04-08-015');
    });

    it('rewrites api.github.com form using the same inbox source', () => {
      const verbatim = new Map([[
        'juliusbrussee/caveman',
        {
          canonical: {
            urlPrefix: 'https://github.com/JuliusBrussee/caveman',
            index: 0,
            owner: 'JuliusBrussee',
            repo: 'caveman',
            key: 'juliusbrussee/caveman',
          },
          msgId: '2026-04-08-015',
          from: 'alex',
        },
      ]]);
      const result = enforceUrlCase(
        'curl https://api.github.com/repos/juliusbrussee/caveman/contents/README.md',
        verbatim,
      );
      expect(result.prompt).toContain('JuliusBrussee/caveman');
      expect(result.prompt).not.toContain('juliusbrussee/caveman');
      expect(result.rewrites).toHaveLength(1);
    });

    it('leaves discovery URLs (not in inbox) untouched', () => {
      // Kuro legitimately found a repo via research — Alex never typed it.
      // The gate must not reject or rewrite in this case.
      const verbatim = new Map([[
        'juliusbrussee/caveman',
        {
          canonical: {
            urlPrefix: 'https://github.com/JuliusBrussee/caveman',
            index: 0,
            owner: 'JuliusBrussee',
            repo: 'caveman',
            key: 'juliusbrussee/caveman',
          },
          msgId: '2026-04-08-015',
          from: 'alex',
        },
      ]]);
      const original = 'also check https://github.com/SomeOther/unrelated-repo for context';
      const result = enforceUrlCase(original, verbatim);
      expect(result.prompt).toBe(original);
      expect(result.rewrites).toHaveLength(0);
    });

    it('no-ops when owner/repo already match verbatim', () => {
      const verbatim = new Map([[
        'juliusbrussee/caveman',
        {
          canonical: {
            urlPrefix: 'https://github.com/JuliusBrussee/caveman',
            index: 0,
            owner: 'JuliusBrussee',
            repo: 'caveman',
            key: 'juliusbrussee/caveman',
          },
          msgId: '2026-04-08-015',
          from: 'alex',
        },
      ]]);
      const original = 'research https://github.com/JuliusBrussee/caveman';
      const result = enforceUrlCase(original, verbatim);
      expect(result.prompt).toBe(original);
      expect(result.rewrites).toHaveLength(0);
    });

    it('handles multiple mangled URLs in one prompt', () => {
      const verbatim = new Map([
        [
          'juliusbrussee/caveman',
          {
            canonical: {
              urlPrefix: 'https://github.com/JuliusBrussee/caveman',
              index: 0,
              owner: 'JuliusBrussee',
              repo: 'caveman',
              key: 'juliusbrussee/caveman',
            },
            msgId: 'm1',
            from: 'alex',
          },
        ],
        [
          'anthropics/claude-code',
          {
            canonical: {
              urlPrefix: 'https://github.com/anthropics/claude-code',
              index: 0,
              owner: 'anthropics',
              repo: 'claude-code',
              key: 'anthropics/claude-code',
            },
            msgId: 'm2',
            from: 'alex',
          },
        ],
      ]);
      const result = enforceUrlCase(
        'compare https://github.com/juliusbrussee/CAVEMAN vs https://github.com/Anthropics/claude-code',
        verbatim,
      );
      expect(result.prompt).toContain('JuliusBrussee/caveman');
      expect(result.prompt).toContain('anthropics/claude-code');
      expect(result.rewrites).toHaveLength(2);
    });

    it('no-ops on empty verbatim map (discovery-only cycle)', () => {
      const original = 'research https://github.com/juliusbrussee/caveman';
      const result = enforceUrlCase(original, new Map());
      expect(result.prompt).toBe(original);
      expect(result.rewrites).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // applyUrlCaseGate — end-to-end
  // ---------------------------------------------------------------------------

  describe('applyUrlCaseGate', () => {
    it('reproduces the #037 → #018 failure scenario and fixes it', () => {
      // Ground truth: on 2026-04-08 Alex posted the verbatim URL. Kuro later
      // wrote a delegate prompt with `julius-brussee` (wrong hyphen AND
      // lowercase), hit GitHub API, got 404, and concluded the repo did not
      // exist. This test replays the original inbox and verifies that a
      // case-only drift gets auto-corrected before the delegate spawns.
      const day = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(
        path.join(convDir, `${day}.jsonl`),
        JSON.stringify({
          id: '2026-04-08-015',
          from: 'alex',
          text: '剛剛看到這個 https://github.com/JuliusBrussee/caveman',
          ts: new Date().toISOString(),
        }) + '\n',
      );

      const delegatePrompt = 'Research https://github.com/juliusbrussee/caveman — tell me what it does';
      const result = applyUrlCaseGate(delegatePrompt, memoryDir);
      expect(result.prompt).toContain('JuliusBrussee/caveman');
      expect(result.rewrites).toHaveLength(1);
    });

    it('fails open when memoryDir does not exist', () => {
      const result = applyUrlCaseGate(
        'https://github.com/Foo/bar',
        '/nonexistent/path/that/should/not/exist',
      );
      // Should not throw. Should return the prompt unchanged.
      expect(result.prompt).toBe('https://github.com/Foo/bar');
      expect(result.rewrites).toHaveLength(0);
    });
  });
});
