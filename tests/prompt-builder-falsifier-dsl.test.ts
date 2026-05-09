import { describe, expect, it } from 'vitest';

import { buildFallbackAutonomousPrompt, buildPromptFromConfig } from '../src/prompt-builder.js';

describe('prompt-builder falsifier DSL discipline', () => {
  it('teaches concrete auto-graded falsifier markers in configured autonomous prompts', () => {
    const prompt = buildPromptFromConfig({
      modes: [{ name: 'normal', weight: 100, description: 'autonomous body' }],
      cooldowns: { afterAction: 1, afterNoAction: 1 },
    }, [], 0, false);

    expect(prompt).toContain('grep:/abs/path "regex" >=N');
    expect(prompt).toContain('file_exists:/abs/path');
    expect(prompt).not.toContain('falsifier: abs_path + op + threshold');
  });

  it('teaches the same markers in fallback autonomous prompts', () => {
    const prompt = buildFallbackAutonomousPrompt([], false);

    expect(prompt).toContain('grep:/abs/path "regex" >=N');
    expect(prompt).toContain('file_not_exists:/abs/path');
    expect(prompt).not.toContain('falsifier: abs_path + op + threshold');
  });
});
