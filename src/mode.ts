/**
 * Agent Control Mode — 冷靜/內斂/自主模式切換
 *
 * 三種預設模式，透過 bundled feature toggles 實現。
 * 每種模式是一組 feature 開關的快照，切換模式 = 批次套用。
 *
 * GitHub Issue #62
 */

import { setEnabled, isEnabled } from './features.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export type ModeName = 'calm' | 'reserved' | 'autonomous';

interface ModeDefinition {
  description: string;
  features: Record<string, boolean>;
  loopPaused: boolean;
}

export interface ModeReport {
  mode: ModeName | 'custom';
  description: string;
  features: Record<string, boolean>;
  loopPaused: boolean;
}

// =============================================================================
// Mode Definitions
// =============================================================================

const MODES: Record<ModeName, ModeDefinition> = {
  calm: {
    description: 'Minimal activity — only responds to direct messages',
    features: {
      'ooda-loop': false,
      'cron': false,
      'cron-drain': false,
      'feedback-loops': false,
      'github-automation': false,
      'auto-escalate': false,
      'auto-push': false,
      'approved-proposals': false,
    },
    loopPaused: true,
  },
  reserved: {
    description: 'Normal operation but no proactive outreach',
    features: {
      'ooda-loop': true,
      'cron': true,
      'cron-drain': true,
      'feedback-loops': true,
      'github-automation': false,
      'auto-escalate': false,
      'auto-push': true,
      'approved-proposals': false,
      'telegram-notify': false,
    },
    loopPaused: false,
  },
  autonomous: {
    description: 'Fully autonomous — default mode',
    features: {
      'ooda-loop': true,
      'cron': true,
      'cron-drain': true,
      'feedback-loops': true,
      'github-automation': true,
      'auto-escalate': true,
      'auto-push': true,
      'approved-proposals': true,
      'telegram-notify': true,
    },
    loopPaused: false,
  },
};

// =============================================================================
// State
// =============================================================================

let currentMode: ModeName | 'custom' = 'autonomous';

// Callback set by api.ts to control loop pause/resume
let loopController: { pause: () => void; resume: () => void } | null = null;

export function setLoopController(controller: { pause: () => void; resume: () => void }): void {
  loopController = controller;
}

// =============================================================================
// Public API
// =============================================================================

export function getModeNames(): ModeName[] {
  return Object.keys(MODES) as ModeName[];
}

export function getModeDescription(name: ModeName): string {
  return MODES[name]?.description ?? 'Unknown mode';
}

/** Detect current mode by matching feature states */
export function detectMode(): ModeName | 'custom' {
  for (const [name, def] of Object.entries(MODES) as Array<[ModeName, ModeDefinition]>) {
    const matches = Object.entries(def.features).every(
      ([feat, expected]) => isEnabled(feat) === expected,
    );
    if (matches) return name;
  }
  return 'custom';
}

/** Get current mode report */
export function getMode(): ModeReport {
  const detected = detectMode();
  currentMode = detected;
  const def = detected !== 'custom' ? MODES[detected] : null;

  // Collect current feature states for the tracked features
  const allTrackedFeatures = new Set<string>();
  for (const mode of Object.values(MODES)) {
    for (const feat of Object.keys(mode.features)) {
      allTrackedFeatures.add(feat);
    }
  }

  const features: Record<string, boolean> = {};
  for (const feat of allTrackedFeatures) {
    features[feat] = isEnabled(feat);
  }

  return {
    mode: detected,
    description: def?.description ?? 'Custom feature configuration',
    features,
    loopPaused: def?.loopPaused ?? false,
  };
}

/** Set mode — batch-toggle features + pause/resume loop */
export function setMode(name: ModeName): ModeReport {
  const def = MODES[name];
  if (!def) throw new Error(`Unknown mode: ${name}`);

  // Apply feature toggles
  for (const [feat, enabled] of Object.entries(def.features)) {
    setEnabled(feat, enabled);
  }

  // Control loop
  if (loopController) {
    if (def.loopPaused) {
      loopController.pause();
    } else {
      loopController.resume();
    }
  }

  currentMode = name;
  slog('MODE', `Switched to: ${name} — ${def.description}`);

  return getMode();
}

/** Check if a mode name is valid */
export function isValidMode(name: string): name is ModeName {
  return name in MODES;
}
