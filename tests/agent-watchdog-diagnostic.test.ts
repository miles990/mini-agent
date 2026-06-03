import { describe, expect, it } from 'vitest';
import { formatProviderWatchdogDiagnostic } from '../src/agent.js';

describe('formatProviderWatchdogDiagnostic', () => {
  it('surfaces SDK watchdog timeout discriminator fields', () => {
    const error = Object.assign(new Error('SDK query timeout after 240000ms'), {
      silentMs: 239_876.4,
      watchdog: 'wall-clock',
    });

    expect(formatProviderWatchdogDiagnostic(error)).toBe(', silentMs=239876, watchdog=wall-clock');
  });

  it('omits absent diagnostic fields for legacy provider errors', () => {
    expect(formatProviderWatchdogDiagnostic(new Error('timeout'))).toBe('');
  });
});
