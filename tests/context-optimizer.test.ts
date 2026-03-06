import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock feedback-loops before importing context-optimizer
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
    __store: store,
  };
});

// Mock utils
vi.mock('../src/utils.js', () => ({
  slog: () => {},
}));

import {
  ContextOptimizer,
  resetContextOptimizer,
  getContextOptimizer,
  DEMOTION_THRESHOLD,
  OBSERVATION_CYCLES,
  SECTION_KEYWORDS,
  type SectionDemotionState,
} from '../src/context-optimizer.js';

// Access the mock store for test setup
const mockStore = (await vi.importMock('../src/feedback-loops.js') as { __store: Map<string, unknown> }).__store;

describe('ContextOptimizer', () => {
  beforeEach(() => {
    mockStore.clear();
    resetContextOptimizer();
  });

  describe('demotion', () => {
    it('does not demote before 200 cycles', () => {
      const opt = new ContextOptimizer();

      // Run 199 cycles with no citations for 'temporal'
      for (let i = 0; i < DEMOTION_THRESHOLD - 1; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.isDemoted('temporal')).toBe(false);
      expect(opt.getDemotedSections()).not.toContain('temporal');
    });

    it('demotes after 200 consecutive zero-citation cycles', () => {
      const opt = new ContextOptimizer();

      for (let i = 0; i < DEMOTION_THRESHOLD; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.isDemoted('temporal')).toBe(true);
      expect(opt.getDemotedSections()).toContain('temporal');
      expect(opt.getState().demoted['temporal']).toBeDefined();
      expect(opt.getState().demoted['temporal'].demotedAt).toBeTruthy();
    });

    it('resets counter when section is cited', () => {
      const opt = new ContextOptimizer();

      // Run 150 cycles with no citations
      for (let i = 0; i < 150; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.getState().zeroCounts['temporal']).toBe(150);

      // Cite 'temporal' — should reset counter
      opt.recordCycle({ citedSections: ['temporal'] });

      expect(opt.getState().zeroCounts['temporal']).toBe(0);
      expect(opt.isDemoted('temporal')).toBe(false);

      // Run another 150 cycles — should NOT demote (counter was reset)
      for (let i = 0; i < 150; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.isDemoted('temporal')).toBe(false);
      expect(opt.getState().zeroCounts['temporal']).toBe(150);
    });
  });

  describe('promotion', () => {
    it('auto-promotes demoted section when cited', () => {
      const opt = new ContextOptimizer();

      // Demote 'temporal'
      for (let i = 0; i < DEMOTION_THRESHOLD; i++) {
        opt.recordCycle({ citedSections: [] });
      }
      expect(opt.isDemoted('temporal')).toBe(true);

      // Cite it — should promote with observation
      opt.recordCycle({ citedSections: ['temporal'] });

      expect(opt.isDemoted('temporal')).toBe(false);
      expect(opt.isInObservation('temporal')).toBe(true);
      expect(opt.getState().observation['temporal'].remainingCycles).toBe(OBSERVATION_CYCLES);
    });

    it('completes observation period and clears observation state', () => {
      const opt = new ContextOptimizer();

      // Demote then promote
      for (let i = 0; i < DEMOTION_THRESHOLD; i++) {
        opt.recordCycle({ citedSections: [] });
      }
      opt.recordCycle({ citedSections: ['temporal'] }); // promote

      expect(opt.isInObservation('temporal')).toBe(true);

      // Run through observation period
      for (let i = 0; i < OBSERVATION_CYCLES; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.isInObservation('temporal')).toBe(false);
      // Not demoted either — observation just ended, counter starts fresh
      expect(opt.isDemoted('temporal')).toBe(false);
    });
  });

  describe('protected sections', () => {
    it('never demotes protected sections', () => {
      const opt = new ContextOptimizer();
      const protectedList = [
        'environment', 'soul', 'inbox', 'workspace', 'telegram',
        'memory', 'heartbeat', 'recent_conversations', 'next',
        'priority-focus', 'self', 'chat-room-recent',
      ];

      // Run well past demotion threshold
      for (let i = 0; i < DEMOTION_THRESHOLD + 50; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      for (const section of protectedList) {
        expect(opt.isDemoted(section)).toBe(false);
      }

      // Protected sections should not even have zero counts tracked
      for (const section of protectedList) {
        expect(opt.getState().zeroCounts[section]).toBeUndefined();
      }
    });
  });

  describe('keywords', () => {
    it('returns keywords for demoted sections', () => {
      const opt = new ContextOptimizer();

      for (let i = 0; i < DEMOTION_THRESHOLD; i++) {
        opt.recordCycle({ citedSections: [] });
      }

      expect(opt.isDemoted('temporal')).toBe(true);
      const keywords = opt.getLoadableKeywords('temporal');
      expect(keywords).toEqual(SECTION_KEYWORDS['temporal']);
    });

    it('returns undefined for non-demoted sections', () => {
      const opt = new ContextOptimizer();
      expect(opt.getLoadableKeywords('temporal')).toBeUndefined();
    });
  });

  describe('singleton', () => {
    it('getContextOptimizer returns the same instance', () => {
      const a = getContextOptimizer();
      const b = getContextOptimizer();
      expect(a).toBe(b);
    });

    it('resetContextOptimizer creates a new instance', () => {
      const a = getContextOptimizer();
      resetContextOptimizer();
      const b = getContextOptimizer();
      expect(a).not.toBe(b);
    });
  });

  describe('persistence', () => {
    it('save writes state via writeState', () => {
      const opt = new ContextOptimizer();

      for (let i = 0; i < 10; i++) {
        opt.recordCycle({ citedSections: [] });
      }
      opt.save();

      const saved = mockStore.get('context-optimizer.json') as SectionDemotionState;
      expect(saved).toBeDefined();
      expect(saved.totalCycles).toBe(10);
    });
  });

  describe('totalCycles tracking', () => {
    it('increments totalCycles each recordCycle call', () => {
      const opt = new ContextOptimizer();

      opt.recordCycle({ citedSections: ['temporal'] });
      opt.recordCycle({ citedSections: [] });
      opt.recordCycle({ citedSections: ['logs'] });

      expect(opt.getState().totalCycles).toBe(3);
    });
  });
});
