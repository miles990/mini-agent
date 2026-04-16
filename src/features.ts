/**
 * Feature Toggle System
 *
 * 通用功能開關 — 每個子系統可 runtime 開/關，附帶執行計時與錯誤計數。
 * 狀態持久化到 features.json（File=Truth），重啟後保留。
 *
 * Usage:
 *   if (!isEnabled('ooda-loop')) return;
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
  defaultEnabled?: boolean; // default: true
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

  // ── Core ──
  { name: 'reflex-ack',         group: 'core',         description: 'Instant 💭 reaction when busy (Layer 0 reflex)' },
  { name: 'ooda-loop',         group: 'core',         description: 'OODA cycle (main agent loop)' },
  { name: 'hesitation-signal', group: 'core',        description: 'Deterministic hesitation — hold overconfident tags for review (Ritual constraint)' },

  // ── Post-cycle housekeeping ──
  { name: 'auto-commit',       group: 'housekeeping', description: 'Auto git commit memory/skills/plugins changes' },
  { name: 'auto-push',         group: 'housekeeping', description: 'Auto push unpushed commits to origin/main' },
  { name: 'github-automation', group: 'housekeeping', description: 'Auto create issues, merge PRs, track issues' },
  { name: 'feedback-loops',    group: 'housekeeping', description: 'Error patterns, perception citations, decision quality' },
  { name: 'stale-threads',     group: 'housekeeping', description: 'Resolve stale conversation threads (replied 1h, pending 24h TTL)' },
  { name: 'auto-escalate',     group: 'housekeeping', description: 'Promote overdue HEARTBEAT tasks to P0' },
  { name: 'cron-drain',        group: 'housekeeping', description: 'Drain one queued cron task per cycle' },
  { name: 'housekeeping',      group: 'housekeeping', description: 'Push, search index, inbox expiration, handoff sync' },
  { name: 'approved-proposals',group: 'housekeeping', description: 'Auto-create handoffs from approved proposals' },
  { name: 'pulse',             group: 'housekeeping', description: 'Unified Pulse System — behavioral signals via heuristics + local 9B (every cycle)' },
  { name: 'commitment-binding',group: 'housekeeping', description: 'Commitment Binding — track and display promise fulfillment' },
  { name: 'mushi-triage',     group: 'housekeeping', description: 'mushi trigger triage — HC1 classifies triggers before OODA cycle, skips low-signal triggers' },
  { name: 'concurrent-action',group: 'housekeeping', description: 'Run perception refresh + housekeeping concurrently during callClaude await' },
  { name: 'mushi-dedup',      group: 'housekeeping', description: 'mushi dedup — HC1 checks near-duplicate REMEMBER before writing' },
  { name: 'sonnet-routing', group: 'housekeeping', description: 'Intelligent model routing — use Sonnet for routine learn cycles, Opus for everything else' },
  { name: 'cognitive-mesh', group: 'housekeeping', description: 'Cognitive Mesh — multi-instance task routing + dynamic scaling' },
  { name: 'kg-live-ingest', group: 'housekeeping', description: 'KG live ingest — observe memory writes + log to live-ingest-log.jsonl (Path B)', defaultEnabled: true },

  // ── Notification ──
  { name: 'telegram-notify',   group: 'notification', description: 'Outbound Telegram notifications' },
  { name: 'streaming-notify',  group: 'notification', description: 'Use sendMessageDraft for progressive message streaming (Bot API 9.3+)' },
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

// Initialize features with their defaults (true unless explicitly set)
for (const f of FEATURES) {
  states.set(f.name, f.defaultEnabled ?? true);
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
