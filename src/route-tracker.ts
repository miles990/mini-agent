/**
 * Route Tracker — Slime Mold Nutrient Path Recording
 *
 * Records the complete route of each OODA cycle:
 *   trigger → perceptions included → perceptions cited → action → visible output?
 *
 * Computes per-perception "nutrient yield":
 *   yield = (times cited AND led to visible output) / (times included)
 *
 * Exposes efficiency metrics for Kuro's context so the slime mold can
 * strengthen productive paths and prune dead-weight.
 *
 * Fire-and-forget — never blocks the main cycle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface CycleRoute {
  ts: string;
  trigger: string;
  model: 'opus' | 'sonnet';
  contextChars: number;
  sectionsIncluded: string[];
  sectionsCited: string[];
  visibleOutput: boolean;
  durationMs: number;
}

interface PerceptionYield {
  included: number;
  cited: number;
  citedWithOutput: number;
  yieldRate: number;  // citedWithOutput / included (0-1)
}

export interface RouteEfficiency {
  totalCycles: number;
  productiveCycles: number;         // had visible output
  wasteRatio: number;               // 1 - productive/total
  avgTokensProductive: number;      // avg context tokens when productive
  avgTokensWaste: number;           // avg context tokens when no output
  perceptionYield: Record<string, PerceptionYield>;
  triggerEfficiency: Record<string, { total: number; productive: number; rate: number }>;
  pruneTargets: string[];           // perceptions to consider removing
  reinforceTargets: string[];       // perceptions producing highest yield
}

// =============================================================================
// Constants
// =============================================================================

const ROUTE_LOG = 'route-log.jsonl';
const MAX_LOG_LINES = 500;          // Keep last 500 cycles (~2 days)
const STATS_CACHE = 'route-stats.json';
const STATS_TTL = 5 * 60_000;      // Recompute every 5 min max

// Perceptions that should never be pruned (core infrastructure)
const CORE_PERCEPTIONS = new Set([
  'tasks', 'state-changes', 'chat-room-inbox',
  'claude-code-inbox', 'self-awareness', 'focus-context',
  'environment-sense', 'github-issues',
]);

// =============================================================================
// State
// =============================================================================

let cachedStats: RouteEfficiency | null = null;
let lastStatsAt = 0;

// =============================================================================
// Recording — called after each cycle
// =============================================================================

/**
 * Extract section names from context XML tags.
 */
function extractSections(context: string): string[] {
  const sections: string[] = [];
  // Match top-level XML sections: <name> or <name attr="...">
  for (const m of context.matchAll(/<([a-z][\w-]*?)[\s>]/g)) {
    const name = m[1];
    // Skip HTML-like tags and kuro: namespace
    if (name.startsWith('kuro:') || ['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol', 'h1', 'h2', 'h3'].includes(name)) continue;
    if (!sections.includes(name)) sections.push(name);
  }
  return sections;
}

/**
 * Extract which sections the action text references.
 */
function extractCitedSections(action: string, availableSections: string[]): string[] {
  const cited: string[] = [];
  const actionLower = action.toLowerCase();
  const sectionSet = new Set(availableSections);

  // Method 1: Direct <section-name> tag references
  for (const m of action.matchAll(/<(\w[\w-]+)>/g)) {
    if (sectionSet.has(m[1]) && !cited.includes(m[1])) {
      cited.push(m[1]);
    }
  }

  // Method 2: Section name keyword matching (hyphenated → space)
  for (const s of availableSections) {
    if (cited.includes(s)) continue;
    const keyword = s.replace(/-/g, ' ');
    if (keyword.length > 4 && actionLower.includes(keyword)) {
      cited.push(s);
    }
  }

  return cited;
}

/**
 * Record a cycle's route — fire-and-forget, called from loop.ts.
 */
export function recordCycleRoute(route: CycleRoute): void {
  setImmediate(() => {
    try {
      const logPath = path.join(getMemoryStateDir(), ROUTE_LOG);
      fs.appendFileSync(logPath, JSON.stringify(route) + '\n', 'utf-8');

      // Rotate log if too long (check every 50 writes via line count estimate)
      try {
        const stat = fs.statSync(logPath);
        // Rough estimate: ~300 bytes per line
        if (stat.size > MAX_LOG_LINES * 400) {
          const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
          if (lines.length > MAX_LOG_LINES) {
            fs.writeFileSync(logPath, lines.slice(-MAX_LOG_LINES).join('\n') + '\n', 'utf-8');
          }
        }
      } catch { /* best effort rotation */ }

      // Invalidate cache
      cachedStats = null;
    } catch { /* fire-and-forget */ }
  });
}

/**
 * Build a CycleRoute from cycle data.
 * Call this at the end of each cycle in loop.ts.
 */
export function buildCycleRoute(
  trigger: string,
  model: 'opus' | 'sonnet',
  context: string,
  action: string | null,
  visibleOutput: boolean,
  durationMs: number,
): CycleRoute {
  const sectionsIncluded = extractSections(context);
  const sectionsCited = action ? extractCitedSections(action, sectionsIncluded) : [];

  return {
    ts: new Date().toISOString(),
    trigger: trigger || 'unknown',
    model,
    contextChars: context.length,
    sectionsIncluded,
    sectionsCited,
    visibleOutput,
    durationMs,
  };
}

// =============================================================================
// Stats Computation
// =============================================================================

function loadRoutes(): CycleRoute[] {
  try {
    const logPath = path.join(getMemoryStateDir(), ROUTE_LOG);
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter((r): r is CycleRoute => r !== null);
  } catch {
    return [];
  }
}

/**
 * Compute route efficiency stats from log data.
 * Cached for STATS_TTL to avoid recomputing every call.
 */
export function getRouteEfficiency(): RouteEfficiency {
  const now = Date.now();
  if (cachedStats && (now - lastStatsAt) < STATS_TTL) return cachedStats;

  const routes = loadRoutes();
  if (routes.length === 0) {
    return {
      totalCycles: 0, productiveCycles: 0, wasteRatio: 0,
      avgTokensProductive: 0, avgTokensWaste: 0,
      perceptionYield: {}, triggerEfficiency: {},
      pruneTargets: [], reinforceTargets: [],
    };
  }

  // Per-perception tracking
  const pYield = new Map<string, { included: number; cited: number; citedWithOutput: number }>();
  // Per-trigger tracking
  const tEff = new Map<string, { total: number; productive: number }>();

  let productiveCycles = 0;
  let tokensProductive = 0;
  let tokensWaste = 0;

  for (const route of routes) {
    const isProductive = route.visibleOutput;
    if (isProductive) {
      productiveCycles++;
      tokensProductive += route.contextChars;
    } else {
      tokensWaste += route.contextChars;
    }

    // Normalize trigger to category (e.g. "telegram-user (yielded, waited 5s)" → "telegram-user")
    const triggerKey = route.trigger.split(/\s/)[0];
    const t = tEff.get(triggerKey) ?? { total: 0, productive: 0 };
    t.total++;
    if (isProductive) t.productive++;
    tEff.set(triggerKey, t);

    // Track perception yield
    for (const section of route.sectionsIncluded) {
      const p = pYield.get(section) ?? { included: 0, cited: 0, citedWithOutput: 0 };
      p.included++;
      if (route.sectionsCited.includes(section)) {
        p.cited++;
        if (isProductive) p.citedWithOutput++;
      }
      pYield.set(section, p);
    }
  }

  const wasteCycles = routes.length - productiveCycles;

  // Build perception yield map
  const perceptionYield: Record<string, PerceptionYield> = {};
  for (const [name, p] of pYield) {
    perceptionYield[name] = {
      ...p,
      yieldRate: p.included > 0 ? Number((p.citedWithOutput / p.included).toFixed(3)) : 0,
    };
  }

  // Build trigger efficiency map
  const triggerEfficiency: Record<string, { total: number; productive: number; rate: number }> = {};
  for (const [trigger, t] of tEff) {
    triggerEfficiency[trigger] = {
      ...t,
      rate: t.total > 0 ? Number((t.productive / t.total).toFixed(3)) : 0,
    };
  }

  // Identify prune targets: included ≥5 times, cited < 5%, not core
  const pruneTargets: string[] = [];
  const reinforceTargets: string[] = [];
  for (const [name, p] of Object.entries(perceptionYield)) {
    if (CORE_PERCEPTIONS.has(name)) continue;
    if (p.included < 5) continue; // not enough data
    const citationRate = p.cited / p.included;
    if (citationRate < 0.05) {
      pruneTargets.push(name);
    } else if (p.yieldRate >= 0.15) {
      reinforceTargets.push(name);
    }
  }

  cachedStats = {
    totalCycles: routes.length,
    productiveCycles,
    wasteRatio: routes.length > 0 ? Number((wasteCycles / routes.length).toFixed(3)) : 0,
    avgTokensProductive: productiveCycles > 0 ? Math.round(tokensProductive / productiveCycles / 4) : 0,
    avgTokensWaste: wasteCycles > 0 ? Math.round(tokensWaste / wasteCycles / 4) : 0,
    perceptionYield,
    triggerEfficiency,
    pruneTargets,
    reinforceTargets,
  };
  lastStatsAt = now;

  // Persist cache for dashboard/API
  try {
    const cachePath = path.join(getMemoryStateDir(), STATS_CACHE);
    fs.writeFileSync(cachePath, JSON.stringify(cachedStats, null, 2), 'utf-8');
  } catch { /* best effort */ }

  return cachedStats;
}

// =============================================================================
// Auto-Pruning — adjust perception intervals based on yield data
// =============================================================================

/**
 * Apply slime mold pruning: slow down low-yield perceptions, restore high-yield ones.
 * Called from runFeedbackLoops every 50 cycles.
 */
export function applyRoutePruning(): void {
  try {
    const stats = getRouteEfficiency();
    if (stats.totalCycles < 20) return; // need sufficient data

    // Lazy import to avoid circular dependency
    const { perceptionStreams } = require('./perception-stream.js');

    for (const name of stats.pruneTargets) {
      perceptionStreams.adjustInterval(name, 15 * 60_000); // slow to 15min
      slog('ROUTE', `[prune] ${name}: low yield → interval 15min`);
    }

    for (const name of stats.reinforceTargets) {
      perceptionStreams.restoreDefaultInterval(name);
      slog('ROUTE', `[reinforce] ${name}: high yield → interval restored`);
    }
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Context Section — inject into buildContext for Kuro's awareness
// =============================================================================

/**
 * Build a compact route efficiency section for context injection.
 * Only included when there's enough data (≥10 cycles).
 */
export function buildRouteSection(): string | null {
  const stats = getRouteEfficiency();
  if (stats.totalCycles < 10) return null;

  const lines: string[] = [];
  lines.push(`Cycles: ${stats.totalCycles} | Productive: ${stats.productiveCycles} (${Math.round((1 - stats.wasteRatio) * 100)}%) | Waste: ${Math.round(stats.wasteRatio * 100)}%`);
  lines.push(`Avg tokens — productive: ${stats.avgTokensProductive} | waste: ${stats.avgTokensWaste}`);

  // Trigger efficiency (compact)
  const triggerLines = Object.entries(stats.triggerEfficiency)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([t, e]) => `${t}: ${e.productive}/${e.total} (${Math.round(e.rate * 100)}%)`);
  if (triggerLines.length > 0) {
    lines.push(`Trigger efficiency: ${triggerLines.join(', ')}`);
  }

  // Reinforce targets
  if (stats.reinforceTargets.length > 0) {
    lines.push(`Reinforce: ${stats.reinforceTargets.join(', ')}`);
  }

  // Prune targets
  if (stats.pruneTargets.length > 0) {
    lines.push(`Prune candidates: ${stats.pruneTargets.join(', ')}`);
  }

  return lines.join('\n');
}
