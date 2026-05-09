// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  extractRepoField,
  extractLicenseField,
  checkRepoMetadata,
} from '../scripts/build-kuro-content.mjs';

const makeContent = (repo: string, license: string) =>
  `---\ndate: 2026-05-09\nauthor: kuro\n---\n## github-spotlight\nrepo: ${repo}\nlicense: ${license}\nversion: 1.0\n`;

describe('build-kuro-content GitHub repo cross-check (#436 acceptance #1)', () => {
  describe('extractRepoField', () => {
    it('extracts owner/repo from repo: line', () => {
      expect(extractRepoField(makeContent('owner/name', 'MIT'))).toBe('owner/name');
    });

    it('returns null when no repo: field', () => {
      expect(extractRepoField('## kuro-take\nsome content')).toBeNull();
    });

    it('rejects plain word without slash', () => {
      expect(extractRepoField('repo: notarepo')).toBeNull();
    });

    it('handles dots and hyphens in owner and repo names', () => {
      expect(extractRepoField('repo: my-org/my.repo\n')).toBe('my-org/my.repo');
    });

    it('handles underscores', () => {
      expect(extractRepoField('repo: open_ai/whisper\n')).toBe('open_ai/whisper');
    });
  });

  describe('extractLicenseField', () => {
    it('extracts MIT', () => {
      expect(extractLicenseField('license: MIT')).toBe('MIT');
    });

    it('extracts SPDX identifier style', () => {
      expect(extractLicenseField('license: BSD-2-Clause')).toBe('BSD-2-Clause');
    });

    it('returns null when field is absent', () => {
      expect(extractLicenseField('no license here')).toBeNull();
    });
  });

  describe('checkRepoMetadata', () => {
    it('warns on license mismatch', async () => {
      const execImpl = async () =>
        JSON.stringify({ license: { spdx_id: 'MIT' }, forks_count: 142, stargazers_count: 5000 });
      const r = await checkRepoMetadata(makeContent('owner/repo', 'BSD-2-Clause'), { execImpl });
      expect(r.warnings.some(w => w.includes('license-mismatch'))).toBe(true);
      expect(r.warnings.some(w => w.includes('BSD-2-Clause') && w.includes('MIT'))).toBe(true);
    });

    it('no license-mismatch warning when licenses match', async () => {
      const execImpl = async () =>
        JSON.stringify({ license: { spdx_id: 'MIT' }, forks_count: 100, stargazers_count: 2000 });
      const r = await checkRepoMetadata(makeContent('owner/repo', 'MIT'), { execImpl });
      expect(r.warnings.some(w => w.includes('license-mismatch'))).toBe(false);
    });

    it('returns gh-api-warn on exec failure, does not throw', async () => {
      const execImpl = async () => { throw new Error('network error'); };
      const r = await checkRepoMetadata(makeContent('owner/repo', 'MIT'), { execImpl });
      expect(r.warnings.some(w => w.includes('gh-api-warn'))).toBe(true);
    });

    it('returns empty warnings when no repo field', async () => {
      const r = await checkRepoMetadata('no repo field here', {});
      expect(r.warnings).toEqual([]);
    });

    it('handles null license in api response gracefully (no mismatch warning)', async () => {
      const execImpl = async () =>
        JSON.stringify({ license: null, forks_count: 0, stargazers_count: 0 });
      const r = await checkRepoMetadata(makeContent('owner/repo', 'MIT'), { execImpl });
      expect(r.warnings.some(w => w.includes('license-mismatch'))).toBe(false);
    });

    it('includes repo-info line with forks and stars', async () => {
      const execImpl = async () =>
        JSON.stringify({ license: { spdx_id: 'MIT' }, forks_count: 87, stargazers_count: 1234 });
      const r = await checkRepoMetadata(makeContent('owner/repo', 'MIT'), { execImpl });
      expect(r.warnings.some(w => w.includes('forks=87') && w.includes('stars=1234'))).toBe(true);
    });

    it('warns gh-api-warn on invalid JSON from api', async () => {
      const execImpl = async () => 'not json at all';
      const r = await checkRepoMetadata(makeContent('owner/repo', 'MIT'), { execImpl });
      expect(r.warnings.some(w => w.includes('gh-api-warn'))).toBe(true);
    });

    it('does not warn license-mismatch when content has no license field', async () => {
      const execImpl = async () =>
        JSON.stringify({ license: { spdx_id: 'MIT' }, forks_count: 10, stargazers_count: 200 });
      const content = '## github-spotlight\nrepo: owner/repo\nversion: 1.0\n';
      const r = await checkRepoMetadata(content, { execImpl });
      expect(r.warnings.some(w => w.includes('license-mismatch'))).toBe(false);
    });
  });
});
