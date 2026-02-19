import { describe, it, expect } from 'vitest';
import { parseBehaviorConfig, parseInterval } from '../src/loop.js';
import type { BehaviorConfig } from '../src/loop.js';

describe('parseBehaviorConfig', () => {
  const VALID_BEHAVIOR_MD = `# Autonomous Behavior

## Modes

### learn-personal
Weight: 50
Follow curiosity beyond work — music, design, philosophy, culture...

### learn-project
Weight: 30
Strengthen mini-agent — competitive research, architecture, differentiation.

### reflect
Weight: 20
Connect knowledge across tracks, update SOUL.md.

## Cooldowns
after-action: 3
after-no-action: 5

## Focus
topic: self-evolution
why: "觀察自己的行為模式"
until: 2026-02-20
`;

  it('should parse valid behavior.md with modes', () => {
    const config = parseBehaviorConfig(VALID_BEHAVIOR_MD);
    expect(config).not.toBeNull();
    expect(config!.modes).toHaveLength(3);
    expect(config!.modes[0].name).toBe('learn-personal');
    expect(config!.modes[1].name).toBe('learn-project');
    expect(config!.modes[2].name).toBe('reflect');
  });

  it('should normalize weights to sum to 100', () => {
    const config = parseBehaviorConfig(VALID_BEHAVIOR_MD);
    expect(config).not.toBeNull();
    const totalWeight = config!.modes.reduce((sum, m) => sum + m.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('should parse cooldowns', () => {
    const config = parseBehaviorConfig(VALID_BEHAVIOR_MD);
    expect(config).not.toBeNull();
    expect(config!.cooldowns.afterAction).toBe(3);
    expect(config!.cooldowns.afterNoAction).toBe(5);
  });

  it('should parse focus section', () => {
    const config = parseBehaviorConfig(VALID_BEHAVIOR_MD);
    expect(config).not.toBeNull();
    expect(config!.focus).toBeDefined();
    expect(config!.focus!.topic).toBe('self-evolution');
    expect(config!.focus!.why).toContain('觀察');
    expect(config!.focus!.until).toBe('2026-02-20');
  });

  it('should use default cooldowns when not specified', () => {
    const minimal = `# Behavior

## Modes

### explore
Weight: 100
Explore new topics.
`;
    const config = parseBehaviorConfig(minimal);
    expect(config).not.toBeNull();
    expect(config!.cooldowns.afterAction).toBe(0);
    expect(config!.cooldowns.afterNoAction).toBe(0);
  });

  it('should return null when no Modes section', () => {
    const noModes = `# Behavior

## Settings
Some settings here.
`;
    const config = parseBehaviorConfig(noModes);
    expect(config).toBeNull();
  });

  it('should return null for empty Modes section', () => {
    const emptyModes = `# Behavior

## Modes

## Cooldowns
after-action: 2
`;
    const config = parseBehaviorConfig(emptyModes);
    expect(config).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseBehaviorConfig('')).toBeNull();
  });

  it('should handle modes with weight 0', () => {
    const withZero = `# Behavior

## Modes

### active
Weight: 80
Do things.

### disabled
Weight: 0
This mode is disabled.

### secondary
Weight: 20
Secondary mode.
`;
    const config = parseBehaviorConfig(withZero);
    expect(config).not.toBeNull();
    // Weight 0 mode may be excluded because it has no description after filtering
    // or included with weight 0 — check actual behavior
    const active = config!.modes.find(m => m.name === 'active');
    const secondary = config!.modes.find(m => m.name === 'secondary');
    expect(active).toBeDefined();
    expect(secondary).toBeDefined();
  });

  it('should clamp cooldown values to valid range (1-10)', () => {
    const extremeCooldowns = `# Behavior

## Modes

### test
Weight: 100
Test mode.

## Cooldowns
after-action: 0
after-no-action: 99
`;
    const config = parseBehaviorConfig(extremeCooldowns);
    expect(config).not.toBeNull();
    expect(config!.cooldowns.afterAction).toBe(1);   // clamped from 0
    expect(config!.cooldowns.afterNoAction).toBe(10); // clamped from 99
  });

  it('should handle focus without optional fields', () => {
    const focusMinimal = `# Behavior

## Modes

### test
Weight: 100
Test mode.

## Focus
topic: something
`;
    const config = parseBehaviorConfig(focusMinimal);
    expect(config).not.toBeNull();
    expect(config!.focus).toBeDefined();
    expect(config!.focus!.topic).toBe('something');
    expect(config!.focus!.why).toBeUndefined();
    expect(config!.focus!.until).toBeUndefined();
  });

  it('should return null for malformed mode entries (missing Weight)', () => {
    const noWeight = `# Behavior

## Modes

### broken
No weight line here, just description.
`;
    const config = parseBehaviorConfig(noWeight);
    expect(config).toBeNull();
  });

  it('should handle real-world behavior.md with many modes', () => {
    const realWorld = `# Autonomous Behavior

## Modes

### learn-personal
Weight: 50
Follow curiosity beyond work — music, design, philosophy, culture...

### learn-project
Weight: 50
Strengthen mini-agent — competitive research, architecture, differentiation.

### organize
Weight: 0
Review conversations, extract to memory, clean up stale items.

### reflect
Weight: 5
Connect knowledge across tracks, update SOUL.md.

### act-on-learning
Weight: 0
Turn insights into improvements (L1 self-improve, L2 proposals).

### chat
Weight: 0
Proactively share interesting discoveries with Alex via Telegram.

## Cooldowns
after-action: 2
after-no-action: 3

## Focus
topic: self-evolution-foundations
why: "behavior.md 剛上線"
until: 2026-02-20
`;
    const config = parseBehaviorConfig(realWorld);
    expect(config).not.toBeNull();
    // Modes with weight 0 but valid description are still parsed
    // Math.round normalization may produce ±1 rounding error
    const totalWeight = config!.modes.reduce((sum, m) => sum + m.weight, 0);
    expect(totalWeight).toBeGreaterThanOrEqual(99);
    expect(totalWeight).toBeLessThanOrEqual(101);
    expect(config!.cooldowns.afterAction).toBe(2);
    expect(config!.cooldowns.afterNoAction).toBe(3);
    expect(config!.focus!.topic).toBe('self-evolution-foundations');
  });
});

describe('parseInterval', () => {
  it('should parse seconds', () => {
    expect(parseInterval('30s')).toBe(30_000);
  });

  it('should parse minutes', () => {
    expect(parseInterval('5m')).toBe(300_000);
  });

  it('should parse hours', () => {
    expect(parseInterval('1h')).toBe(3_600_000);
  });

  it('should return default for invalid format', () => {
    const defaultMs = 300_000; // DEFAULT_CONFIG.intervalMs
    expect(parseInterval('abc')).toBe(defaultMs);
    expect(parseInterval('')).toBe(defaultMs);
    expect(parseInterval('10')).toBe(defaultMs);
    expect(parseInterval('10x')).toBe(defaultMs);
  });
});
