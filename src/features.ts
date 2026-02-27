/**
 * Feature Toggle System
 *
 * 通用功能開關 — 每個子系統可 runtime 開/關，附帶執行計時與錯誤計數。
 * 狀態持久化到 features.json（File=Truth），重啟後保留。
 *
 * Usage:
 *   if (!isEnabled('digest-bot')) return;
 *   const done = trackStart('auto-commit');
 *   try { ... } finally { done(); }
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

interface FeatureState {
  enabled: boolean;
}

interface FeatureStats {
  totalRuns: number;
  totalMs: number;
  errors: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastDurationMs: number;
}

interface FeatureInfo {
  name: string;
  group: string;
  description: string;
}

interface FeaturesFile {
  [name: string]: FeatureState;
}

export interface FeatureReport {
  name: string;
  group: string;
  description: string;
  enabled: boolean;
  stats: FeatureStats;
}

// =============================================================================
// Feature Registry — all toggleable subsystems
// =============================================================================

const FEATURES: FeatureInfo[] = [
  // ── Polling (continuous loops) ──
  { name: 'telegram-poller',   group: 'polling',      description: 'Telegram message long-polling' },
  { name: 'digest-bot',        group: 'polling',      description: 'AI Research Digest bot polling + daily broadcast' },

  // ── Digest ──
  { name: 'instant-digest',    group: 'digest',        description: 'Instant content digestion — forwarded messages, URLs, /d command bypass OODA' },

  // ── Core ──
  { name: 'cooperative-yield',  group: 'core',         description: 'Signal-based cooperative yield (vs kill-based preemption)' },
  { name: 'reflex-ack',         group: 'core',         description: 'Instant 💭 reaction when busy (Layer 0 reflex)' },
  { name: 'ooda-loop',         group: 'core',         description: 'OODA cycle (main agent loop)' },
  { name: 'cron',              group: 'core',         description: 'Scheduled cron tasks' },
  { name: 'perception',        group: 'core',         description: 'Perception stream plugins' },
  { name: 'observability',     group: 'core',         description: 'Event bus subscribers (logging/routing)' },
  { name: 'hesitation-signal', group: 'core',        description: 'Deterministic hesitation — hold overconfident tags for review (Ritual constraint)' },

  // ── Post-cycle housekeeping ──
  { name: 'auto-commit',       group: 'housekeeping', description: 'Auto git commit memory/skills/plugins changes' },
  { name: 'auto-push',         group: 'housekeeping', description: 'Auto push unpushed commits to origin/main' },
  { name: 'github-automation', group: 'housekeeping', description: 'Auto create issues, merge PRs, track issues' },
  { name: 'feedback-loops',    group: 'housekeeping', description: 'Error patterns, perception citations, decision quality' },
  { name: 'stale-threads',     group: 'housekeeping', description: 'Resolve expired conversation threads (24h TTL)' },
  { name: 'auto-escalate',     group: 'housekeeping', description: 'Promote overdue HEARTBEAT tasks to P0' },
  { name: 'cron-drain',        group: 'housekeeping', description: 'Drain one queued cron task per cycle' },
  { name: 'housekeeping',      group: 'housekeeping', description: 'Push, search index, inbox expiration, handoff sync' },
  { name: 'approved-proposals',group: 'housekeeping', description: 'Auto-create handoffs from approved proposals' },
  { name: 'coach',             group: 'housekeeping', description: 'Action Coach — Haiku behavioral accountability (every 3 cycles)' },

  // ── Notification ──
  { name: 'telegram-notify',   group: 'notification', description: 'Outbound Telegram notifications' },
];

const featureMap = new Map<string, FeatureInfo>(FEATURES.map(f => [f.name, f]));

// =============================================================================
// State (in-memory + file-backed)
// =============================================================================

const states = new Map<string, boolean>();
const stats = new Map<string, FeatureStats>();

function defaultStats(): FeatureStats {
  return { totalRuns: 0, totalMs: 0, errors: 0, lastRunAt: null, lastError: null, lastDurationMs: 0 };
}

// Initialize all features as enabled
for (const f of FEATURES) {
  states.set(f.name, true);
  stats.set(f.name, defaultStats());
}

// =============================================================================
// Persistence
// =============================================================================

function getFeaturesFilePath(): string {
  try {
    return path.join(getInstanceDir(getCurrentInstanceId()), 'features.json');
  } catch {
    return '';
  }
}

function loadFromFile(): void {
  const filePath = getFeaturesFilePath();
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const data: FeaturesFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const [name, state] of Object.entries(data)) {
      if (featureMap.has(name)) {
        states.set(name, state.enabled);
      }
    }
    const disabled = [...states.entries()].filter(([, v]) => !v).map(([k]) => k);
    if (disabled.length > 0) {
      slog('FEATURES', `Loaded: ${disabled.length} disabled — ${disabled.join(', ')}`);
    }
  } catch {
    // File corrupt or missing — keep defaults (all enabled)
  }
}

function saveToFile(): void {
  const filePath = getFeaturesFilePath();
  if (!filePath) return;
  try {
    const data: FeaturesFile = {};
    for (const [name, enabled] of states) {
      data[name] = { enabled };
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // Best effort — don't crash on write failure
  }
}

// =============================================================================
// Public API
// =============================================================================

/** Initialize feature toggles — call once at startup */
export function initFeatures(): void {
  loadFromFile();
}

/** Check if a feature is enabled */
export function isEnabled(name: string): boolean {
  return states.get(name) ?? true; // Unknown features default to enabled
}

/** Toggle a feature on/off. Returns new state. */
export function setEnabled(name: string, enabled: boolean): boolean {
  if (!featureMap.has(name)) return true;
  const prev = states.get(name) ?? true;
  states.set(name, enabled);
  saveToFile();
  if (prev !== enabled) {
    slog('FEATURES', `${name}: ${prev ? 'ON' : 'OFF'} → ${enabled ? 'ON' : 'OFF'}`);
  }
  return enabled;
}

/** Toggle a feature. Returns new state. */
export function toggle(name: string): boolean {
  const current = states.get(name) ?? true;
  return setEnabled(name, !current);
}

/**
 * Start tracking execution time for a feature.
 * Returns a `done(error?)` function to call when finished.
 */
export function trackStart(name: string): (error?: string) => void {
  const start = Date.now();
  return (error?: string) => {
    const elapsed = Date.now() - start;
    const s = stats.get(name) ?? defaultStats();
    s.totalRuns++;
    s.totalMs += elapsed;
    s.lastRunAt = new Date().toISOString();
    s.lastDurationMs = elapsed;
    if (error) {
      s.errors++;
      s.lastError = error;
    }
    stats.set(name, s);
  };
}

/** Get full report of all features */
export function getFeatureReport(): FeatureReport[] {
  return FEATURES.map(f => ({
    name: f.name,
    group: f.group,
    description: f.description,
    enabled: states.get(f.name) ?? true,
    stats: stats.get(f.name) ?? defaultStats(),
  }));
}

/** Get report for a single feature */
export function getFeature(name: string): FeatureReport | null {
  const info = featureMap.get(name);
  if (!info) return null;
  return {
    ...info,
    enabled: states.get(name) ?? true,
    stats: stats.get(name) ?? defaultStats(),
  };
}

/** Reset stats for a feature (or all if no name given) */
export function resetStats(name?: string): void {
  if (name) {
    stats.set(name, defaultStats());
  } else {
    for (const f of FEATURES) {
      stats.set(f.name, defaultStats());
    }
  }
}

/** List all known feature names */
export function getFeatureNames(): string[] {
  return FEATURES.map(f => f.name);
}
