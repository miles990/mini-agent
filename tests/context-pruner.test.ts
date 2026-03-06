import { describe, it, expect, vi } from 'vitest';

// Mock feedback-loops before importing context-pruner
vi.mock('../src/feedback-loops.js', () => {
  const store = new Map<string, unknown>();
  return {
    readState: <T>(_filename: string, fallback: T): T => {
      const data = store.get(_filename);
      return (data as T) ?? fallback;
    },
    writeState: (filename: string, data: unknown): void => {
      store.set(filename, structuredClone(data));
    },
  };
});

vi.mock('../src/utils.js', () => ({
  slog: () => {},
}));

import { generatePruningPrompt, parsePruningProposal, savePruningProposal } from '../src/context-pruner.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('context-pruner', () => {
  describe('generatePruningPrompt', () => {
    it('generates a prompt with topic content and instructions', () => {
      const prompt = generatePruningPrompt('music', `# Music
- [2026-01-15] Discovered Nujabes - jazz hop pioneer
- [2026-01-15] Discovered Nujabes - jazz hip-hop pioneer (duplicate)
- [2025-12-01] BPM of test.mp3 is 120
- [2026-02-20] Cross-domain: music structure maps to code architecture`);

      expect(prompt).toContain('music');
      expect(prompt).toContain('DELETE');
      expect(prompt).toContain('KEEP');
    });

    it('includes ACE anti-collapse rule for cross-domain insights', () => {
      const prompt = generatePruningPrompt('test', '# Test\n- some entry');
      expect(prompt).toMatch(/cross.domain/i);
      expect(prompt).toMatch(/never.*delete|must.*keep|always.*keep/i);
    });
  });

  describe('parsePruningProposal', () => {
    it('parses DELETE and KEEP lines from Haiku response', () => {
      const response = `Analysis of topic "music":

DELETE: - [2026-01-15] Discovered Nujabes - jazz hip-hop pioneer (duplicate)
REASON: Duplicate of previous entry

DELETE: - [2025-12-01] BPM of test.mp3 is 120
REASON: Ephemeral fact, not reusable knowledge

KEEP: - [2026-01-15] Discovered Nujabes - jazz hop pioneer
KEEP: - [2026-02-20] Cross-domain: music structure maps to code architecture`;

      const result = parsePruningProposal(response);
      expect(result.deletions).toHaveLength(2);
      expect(result.keeps).toHaveLength(2);
      expect(result.deletions[0].line).toContain('duplicate');
      expect(result.deletions[0].reason).toContain('Duplicate');
    });

    it('returns empty result for unparseable response', () => {
      const result = parsePruningProposal('I cannot analyze this.');
      expect(result.deletions).toHaveLength(0);
      expect(result.keeps).toHaveLength(0);
    });

    it('handles DELETE without REASON line', () => {
      const response = `DELETE: - [2026-01-01] Some old entry
KEEP: - [2026-02-01] Some new entry`;

      const result = parsePruningProposal(response);
      expect(result.deletions).toHaveLength(1);
      expect(result.deletions[0].reason).toBe('No reason given');
    });

    it('rejects deletions of cross-domain insights (ACE guardrail)', () => {
      const response = `DELETE: - [2026-02-20] Cross-domain: music structure maps to code architecture
REASON: Not relevant to this topic

DELETE: - [2025-12-01] BPM of test.mp3 is 120
REASON: Ephemeral metric`;

      const result = parsePruningProposal(response);
      expect(result.deletions).toHaveLength(1);
      expect(result.deletions[0].line).toContain('BPM');
    });

    it('protects isomorphic/analogous patterns from deletion', () => {
      const response = `DELETE: - [2026-03-01] Realized Git branching is isomorphic to biological evolution
REASON: Tangential

DELETE: - [2026-03-02] Old config value was 42
REASON: Outdated`;

      const result = parsePruningProposal(response);
      expect(result.deletions).toHaveLength(1);
      expect(result.deletions[0].line).toContain('config');
    });
  });

  describe('savePruningProposal', () => {
    it('creates proposal file with correct structure', () => {
      const tmpDir = path.join(os.tmpdir(), `pruner-test-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const proposal = {
        deletions: [{ line: '- [2026-01-01] Old entry', reason: 'Outdated' }],
        keeps: [{ line: '- [2026-02-01] Good entry' }],
      };

      const filepath = savePruningProposal(tmpDir, 'test-topic', proposal);
      expect(fs.existsSync(filepath)).toBe(true);

      const content = fs.readFileSync(filepath, 'utf-8');
      expect(content).toContain('Pruning Proposal: test-topic');
      expect(content).toContain('Old entry');
      expect(content).toContain('Good entry');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
