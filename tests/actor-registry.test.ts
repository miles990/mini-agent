import { describe, expect, it } from 'vitest';
import {
  getActorProfile,
  getDefaultDispatchableActors,
  getPeerCritiqueActors,
  isDispatchableActor,
} from '../src/actor-registry.js';

describe('actor registry', () => {
  it('models Kuro as the host coordinator, not a competing worker brain', () => {
    expect(getActorProfile('kuro')).toEqual(expect.objectContaining({
      id: 'kuro',
      kind: 'host-agent',
      cognition: 'agentic',
      dispatchable: false,
      autonomy: 'host',
      roleTendency: ['arbiter'],
      finalAuthority: expect.arrayContaining(['persona', 'taste', 'memory']),
    }));
    expect(isDispatchableActor('kuro')).toBe(false);
    expect(getDefaultDispatchableActors()).not.toContain('kuro');
  });

  it('models Akari as an independent Tanren-based peer agent', () => {
    expect(getActorProfile('akari')).toEqual(expect.objectContaining({
      id: 'akari',
      kind: 'peer-agent',
      cognition: 'agentic',
      dispatchable: true,
      framework: 'tanren',
      autonomy: 'independent',
    }));
  });

  it('models Tanren as a non-dispatchable framework, not another peer brain', () => {
    expect(getActorProfile('tanren')).toEqual(expect.objectContaining({
      id: 'tanren',
      kind: 'framework',
      cognition: 'none',
      dispatchable: false,
    }));
    expect(isDispatchableActor('tanren')).toBe(false);
    expect(getDefaultDispatchableActors()).not.toContain('tanren');
    expect(getPeerCritiqueActors()).not.toContain('tanren');
  });

  it('keeps executors, memory, and sensors distinct from brains', () => {
    expect(getActorProfile('shell')).toEqual(expect.objectContaining({
      kind: 'executor',
      cognition: 'none',
      dispatchable: true,
    }));
    expect(getActorProfile('myelin')).toEqual(expect.objectContaining({
      kind: 'memory',
      dispatchable: false,
    }));
    expect(getActorProfile('perception')).toEqual(expect.objectContaining({
      kind: 'sensor',
      dispatchable: false,
    }));
  });
});
