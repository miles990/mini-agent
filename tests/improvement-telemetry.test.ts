import { describe, expect, it } from 'vitest';
import {
  buildImprovementTelemetry,
  formatImprovementLearning,
} from '../src/improvement-telemetry.js';

describe('improvement telemetry', () => {
  it('records no-action cycles as trend evidence instead of dropping them', () => {
    const entry = buildImprovementTelemetry({
      cycle: 7,
      trigger: 'heartbeat',
      action: null,
      tags: [],
      sideEffects: [],
      noopStreak: 2,
      trueNoopStreak: 1,
      autonomousTaskRatio: '3:0',
      repeatRate: '0%',
      hasMainVisibleOutput: false,
      hadForegroundAction: false,
    });

    expect(entry.outcome).toBe('no-action');
    expect(entry.efficiencySignals).toContain('no-action cycle recorded for trend tracking');
  });

  it('marks visible output and verification evidence as correctness signals', () => {
    const entry = buildImprovementTelemetry({
      cycle: 8,
      trigger: 'continuation',
      action: 'PR shipped and verified with falsifier resolved',
      tags: ['ACTION', 'VERIFY'],
      sideEffects: ['pr'],
      noopStreak: 0,
      trueNoopStreak: 0,
      autonomousTaskRatio: '4:0',
      repeatRate: '0%',
      hasMainVisibleOutput: true,
      hadForegroundAction: false,
    });

    expect(entry.outcome).toBe('visible-output');
    expect(entry.correctnessSignals).toContain('action reports verification or terminal evidence');
    expect(entry.correctnessSignals).toContain('cycle emitted completion/verification/action tag');
  });

  it('formats reallocated holds for dashboard learning', () => {
    const entry = buildImprovementTelemetry({
      cycle: 9,
      trigger: 'heartbeat',
      action: 'Observation efficiency hold: waiting for review',
      tags: ['OBSERVATION-HOLD', 'REALLOCATE'],
      sideEffects: [],
      noopStreak: 0,
      trueNoopStreak: 0,
      autonomousTaskRatio: 'pending',
      repeatRate: 'pending',
      hasMainVisibleOutput: false,
      hadForegroundAction: false,
      outcomeOverride: 'reallocated-hold',
      note: 'previous cycle explicitly waited on user/review input',
    });

    const learning = formatImprovementLearning(entry);

    expect(learning.what).toContain('reallocated-hold');
    expect(learning.changed).toContain('LLM budget reallocated');
    expect(learning.verified).toContain('avoids re-reasoning');
  });
});
