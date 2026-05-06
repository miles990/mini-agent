import { describe, expect, it } from 'vitest';
import { applyShipTruthLanguageGate } from '../src/ship-truth-language-gate.js';
import type { ShipTruthState } from '../src/correction-gate.js';

function shipTruth(state: ShipTruthState['state'], patch: Partial<ShipTruthState> = {}): ShipTruthState {
  return {
    repoPresent: true,
    branch: 'main',
    ahead: 0,
    behind: 0,
    dirty: false,
    state,
    ...patch,
  };
}

describe('ship truth language gate', () => {
  it('does not change text without ship claims', () => {
    const result = applyShipTruthLanguageGate('測試通過，下一步是 deploy。', {
      shipTruth: shipTruth('dirty', { dirty: true }),
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe('測試通過，下一步是 deploy。');
  });

  it('rewrites shipped claims while the worktree is dirty', () => {
    const result = applyShipTruthLanguageGate('已上線，這版 shipped。', {
      shipTruth: shipTruth('dirty', { dirty: true }),
    });

    expect(result.changed).toBe(true);
    expect(result.text).toContain('pushed-with-dirty-worktree');
    expect(result.text).toContain('[ship-truth] state=dirty');
    expect(result.text).not.toContain('已上線');
    expect(result.text).not.toMatch(/\bshipped\b/i);
  });

  it('labels ahead commits as committed-local pending push', () => {
    const result = applyShipTruthLanguageGate('部署完成。', {
      shipTruth: shipTruth('pending-push', { ahead: 2 }),
    });

    expect(result.changed).toBe(true);
    expect(result.text).toContain('committed-local/pending-push');
    expect(result.text).toContain('ahead=2');
  });

  it('rewrites bare ship claims without corrupting ship truth labels', () => {
    const result = applyShipTruthLanguageGate('真 ship a fix proposal; ship truth is dirty.', {
      shipTruth: shipTruth('dirty', { dirty: true }),
    });

    expect(result.changed).toBe(true);
    expect(result.text).toContain('真 pushed-with-dirty-worktree a fix proposal');
    expect(result.text).toContain('ship truth is dirty');
    expect(result.text).toContain('[ship-truth] state=dirty');
  });

  it('allows ship claims when ship truth is clean', () => {
    const result = applyShipTruthLanguageGate('deployed and verified-live', {
      shipTruth: shipTruth('clean'),
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe('deployed and verified-live');
  });
});
