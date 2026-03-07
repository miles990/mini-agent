/**
 * Evolution — 進化追蹤系統
 *
 * Gap Scanner: 系統 capability gap 主動掃描。
 * Called periodically (weekly) by feedback-loops.ts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { slog } from './utils.js';

// =============================================================================
// Gap Scanner — 系統 capability gap 主動掃描
// =============================================================================

const TRACKS_DIR = path.join(process.cwd(), 'memory', 'evolution-tracks');

/**
 * Scan for capability gaps and write results.
 * Called periodically (weekly) by Kuro's OODA cycle.
 */
export async function scanCapabilityGaps(): Promise<string> {
  await fs.mkdir(TRACKS_DIR, { recursive: true });
  const gapPath = path.join(TRACKS_DIR, 'gap-scan.md');

  // Gather signals from multiple sources
  const gaps: string[] = [];

  // 1. Check for error patterns (failure-driven gaps)
  try {
    const { getMemoryStateDir } = await import('./memory.js');
    const errorPatternsPath = path.join(getMemoryStateDir(), 'error-patterns.json');
    const raw = await fs.readFile(errorPatternsPath, 'utf-8');
    const patterns = JSON.parse(raw);
    if (Array.isArray(patterns)) {
      const frequent = patterns.filter((p: { count?: number }) => (p.count ?? 0) >= 3);
      for (const p of frequent) {
        gaps.push(`- [failure] ${(p as { pattern?: string }).pattern ?? 'unknown'} (${(p as { count?: number }).count ?? 0}x)`);
      }
    }
  } catch { /* no error patterns yet */ }

  // 2. Check metabolism log for unresolved flags
  try {
    const { getMemoryStateDir: getStateDir } = await import('./memory.js');
    const metaLogPath = path.join(getStateDir(), 'metabolism-log.jsonl');
    const raw = await fs.readFile(metaLogPath, 'utf-8');
    const flagged = raw.split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e): e is { action: string } => e?.action === 'flag-similar');
    if (flagged.length > 0) {
      gaps.push(`- [metabolism] ${flagged.length} similar-but-not-duplicate entries need review`);
    }
  } catch { /* no metabolism log yet */ }

  const scanDate = new Date().toISOString();
  let content = `# Capability Gap Scan\n\nLast scan: ${scanDate}\n\n`;

  if (gaps.length > 0) {
    content += `## Identified Gaps\n\n${gaps.join('\n')}\n\n`;
  } else {
    content += `## Status\n\nNo capability gaps detected.\n\n`;
  }

  content += `## Scan Dimensions\n\n`;
  content += `1. **Failure-driven** — recurring error patterns\n`;
  content += `2. **Friction-driven** — high-latency paths, retry-heavy operations\n`;
  content += `3. **Aspiration-driven** — SOUL interests vs actual tool usage\n`;

  await fs.writeFile(gapPath, content, 'utf-8');
  slog('EVOLUTION', `Gap scan complete: ${gaps.length} gaps found`);
  return content;
}
