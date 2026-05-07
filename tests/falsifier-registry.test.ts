// Tests for issue #197 falsifier registry. Coverage:
//  - register returns stable ID for same condition (dedup)
//  - resolve marks entry resolved, last-write-wins on reread
//  - getActiveFalsifiers excludes resolved + TTL-expired
//  - expireOverdueFalsifiers marks overdue with result='expired'
//  - buildFalsifierContext renders short reference block
//  - falsifierStats counts active/resolved/expired correctly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpStateDir: string;

vi.mock('../src/memory.js', () => ({
  getMemoryStateDir: () => tmpStateDir,
}));

vi.mock('../src/utils.js', () => ({
  slog: vi.fn(),
}));

import {
  registerFalsifier,
  resolveFalsifier,
  getActiveFalsifiers,
  expireOverdueFalsifiers,
  buildFalsifierContext,
  falsifierStats,
} from '../src/falsifier-registry.js';

describe('falsifier-registry', () => {
  beforeEach(() => {
    tmpStateDir = mkdtempSync(path.join(tmpdir(), 'fr-test-'));
  });

  afterEach(() => {
    rmSync(tmpStateDir, { recursive: true, force: true });
  });

  describe('registerFalsifier', () => {
    it('returns stable id for same condition (dedup)', () => {
      const id1 = registerFalsifier({ condition: 'tail X >= 1', cycleCreated: 1 });
      const id2 = registerFalsifier({ condition: 'tail X >= 1', cycleCreated: 2 });
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^fl-[a-f0-9]{8}$/);
    });

    it('different conditions get different ids', () => {
      const id1 = registerFalsifier({ condition: 'foo', cycleCreated: 1 });
      const id2 = registerFalsifier({ condition: 'bar', cycleCreated: 1 });
      expect(id1).not.toBe(id2);
    });

    it('persists to disk', () => {
      registerFalsifier({ condition: 'foo', cycleCreated: 1 });
      expect(existsSync(path.join(tmpStateDir, 'falsifier-registry.jsonl'))).toBe(true);
    });

    it('re-registers if existing entry is resolved', () => {
      const id1 = registerFalsifier({ condition: 'foo', cycleCreated: 1 });
      resolveFalsifier({ id: id1, result: 'confirmed' });
      // Re-register same condition after resolve — should still return same ID
      // (stable hash) but append a fresh active entry.
      const id2 = registerFalsifier({ condition: 'foo', cycleCreated: 5 });
      expect(id1).toBe(id2);
      const active = getActiveFalsifiers(5);
      expect(active).toHaveLength(1);
      expect(active[0].cycleCreated).toBe(5);
    });
  });

  describe('resolveFalsifier', () => {
    it('marks entry resolved with timestamp + result', () => {
      const id = registerFalsifier({ condition: 'foo', cycleCreated: 1 });
      const ok = resolveFalsifier({ id, result: 'falsified', evidence: 'count was 0' });
      expect(ok).toBe(true);
      const active = getActiveFalsifiers(2);
      expect(active).toHaveLength(0);
    });

    it('returns false for unknown id', () => {
      expect(resolveFalsifier({ id: 'fl-deadbeef', result: 'confirmed' })).toBe(false);
    });
  });

  describe('getActiveFalsifiers', () => {
    it('excludes ttl-expired entries', () => {
      registerFalsifier({ condition: 'foo', cycleCreated: 1, ttlCycles: 3 });
      // cycle 1 + ttl 3 → expires at cycle 4
      expect(getActiveFalsifiers(3)).toHaveLength(1);
      expect(getActiveFalsifiers(4)).toHaveLength(0);
    });

    it('default ttl is 5', () => {
      registerFalsifier({ condition: 'foo', cycleCreated: 0 });
      expect(getActiveFalsifiers(4)).toHaveLength(1);
      expect(getActiveFalsifiers(5)).toHaveLength(0);
    });

    it('sorts by createdAt ascending', async () => {
      registerFalsifier({ condition: 'first', cycleCreated: 1 });
      // Ensure timestamp differs
      await new Promise((r) => setTimeout(r, 5));
      registerFalsifier({ condition: 'second', cycleCreated: 1 });
      const active = getActiveFalsifiers(2);
      expect(active.map((e) => e.condition)).toEqual(['first', 'second']);
    });
  });

  describe('expireOverdueFalsifiers', () => {
    it('marks overdue entries with result=expired', () => {
      registerFalsifier({ condition: 'foo', cycleCreated: 0, ttlCycles: 2 });
      registerFalsifier({ condition: 'bar', cycleCreated: 5, ttlCycles: 2 });
      const count = expireOverdueFalsifiers(4);
      expect(count).toBe(1);
      const stats = falsifierStats(4);
      expect(stats.expired).toBe(1);
      expect(stats.active).toBe(1);
    });

    it('idempotent — re-expiring already-resolved entries returns 0', () => {
      registerFalsifier({ condition: 'foo', cycleCreated: 0, ttlCycles: 2 });
      expect(expireOverdueFalsifiers(4)).toBe(1);
      expect(expireOverdueFalsifiers(4)).toBe(0);
    });
  });

  describe('buildFalsifierContext', () => {
    it('returns empty string when no active', () => {
      expect(buildFalsifierContext(1)).toBe('');
    });

    it('renders compact reference block', () => {
      registerFalsifier({ condition: 'tail commitments.jsonl >= 1', cycleCreated: 0, ttlCycles: 5 });
      const ctx = buildFalsifierContext(1);
      expect(ctx).toContain('Active falsifiers (1)');
      expect(ctx).toMatch(/\[fl-[a-f0-9]{8}\] tail commitments\.jsonl >= 1 \(expires in 4\)/);
    });
  });

  describe('falsifierStats', () => {
    it('counts active/resolved/expired correctly', () => {
      const a = registerFalsifier({ condition: 'a', cycleCreated: 0, ttlCycles: 5 });
      registerFalsifier({ condition: 'b', cycleCreated: 0, ttlCycles: 1 });
      const c = registerFalsifier({ condition: 'c', cycleCreated: 0, ttlCycles: 5 });
      resolveFalsifier({ id: c, result: 'confirmed' });
      expireOverdueFalsifiers(3); // 'b' expires
      const stats = falsifierStats(3);
      expect(stats.active).toBe(1); // only 'a'
      expect(stats.resolved).toBe(1); // 'c'
      expect(stats.expired).toBe(1); // 'b'
      expect(stats.total).toBe(3);
      expect(a).toBeTruthy();
    });
  });
});
