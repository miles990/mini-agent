/**
 * Evolution — 進化追蹤系統
 *
 * 追蹤 Kuro 的自我升級，產出結構化報告，供 Alex review。
 * 整合到 perception section 讓 Kuro 感知進化狀態。
 *
 * 設計原則：
 * - 升級報告自動偵測（掃描 git diff）+ 手動產出
 * - 多條 track 並行追蹤
 * - 每次升級要比前一次更強
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export type EvolutionTrack = 'metabolism' | 'communication' | 'perception' | 'self-healing' | 'architecture';
export type Effort = 'S' | 'M' | 'L';

export interface UpgradeReport {
  title: string;
  date: string;
  track: EvolutionTrack;
  effort: Effort;
  files: string[];
  problem: string;
  solution: string;
  beforeAfter: Array<{ metric: string; before: string; after: string }>;
  verification: string;
  next: string;
}

// =============================================================================
// Constants
// =============================================================================

const REPORTS_DIR = path.join(process.cwd(), 'memory', 'evolution-tracks', 'reports');
const TRACKS_DIR = path.join(process.cwd(), 'memory', 'evolution-tracks');

// =============================================================================
// Report Generation
// =============================================================================

/**
 * Write an upgrade report to the evolution tracks directory.
 * S-effort: one-line changelog. M/L-effort: full structured report.
 */
export async function writeUpgradeReport(report: UpgradeReport): Promise<string> {
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const slug = report.title.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `${report.date.slice(0, 10)}-${slug}.md`;
  const filepath = path.join(REPORTS_DIR, filename);

  let content: string;

  if (report.effort === 'S') {
    // S-effort: one-line changelog
    content = `# ${report.title}\n\n`;
    content += `- Date: ${report.date} | Track: ${report.track} | Effort: S\n`;
    content += `- What: ${report.solution}\n`;
    content += `- Files: ${report.files.join(', ')}\n`;
    content += `- Verified: ${report.verification}\n`;
  } else {
    // M/L-effort: full structured report
    content = `# Upgrade Report: ${report.title}\n\n`;
    content += `- Date: ${report.date}\n`;
    content += `- Track: ${report.track}\n`;
    content += `- Effort: ${report.effort}\n`;
    content += `- Files: ${report.files.map(f => `\`${f}\``).join(', ')}\n\n`;
    content += `## Problem\n\n${report.problem}\n\n`;
    content += `## Solution\n\n${report.solution}\n\n`;

    if (report.beforeAfter.length > 0) {
      content += `## Before → After\n\n`;
      content += `| Metric | Before | After |\n`;
      content += `|--------|--------|-------|\n`;
      for (const row of report.beforeAfter) {
        content += `| ${row.metric} | ${row.before} | ${row.after} |\n`;
      }
      content += '\n';
    }

    content += `## Verification\n\n${report.verification}\n\n`;
    content += `## Next\n\n${report.next}\n`;
  }

  await fs.writeFile(filepath, content, 'utf-8');
  slog('EVOLUTION', `Report written: ${filename}`);
  return filepath;
}

// =============================================================================
// Evolution Status — perception section for Kuro
// =============================================================================

/**
 * Build a perception section summarizing evolution status.
 * Returns formatted text for injection into OODA context.
 */
export async function buildEvolutionStatus(): Promise<string> {
  try {
    const reports = await listRecentReports(7);
    if (reports.length === 0) return '';

    const lines = ['Recent upgrades (last 7 days):'];
    for (const r of reports) {
      lines.push(`  - [${r.date}] ${r.track}: ${r.title} (${r.effort})`);
    }

    // Count by track
    const trackCounts = new Map<string, number>();
    for (const r of reports) {
      trackCounts.set(r.track, (trackCounts.get(r.track) ?? 0) + 1);
    }
    const active = [...trackCounts.entries()].map(([t, c]) => `${t}(${c})`).join(', ');
    lines.push(`Active tracks: ${active}`);

    return lines.join('\n');
  } catch {
    return '';
  }
}

interface ReportMeta {
  title: string;
  date: string;
  track: string;
  effort: string;
}

async function listRecentReports(days: number): Promise<ReportMeta[]> {
  try {
    const files = await fs.readdir(REPORTS_DIR);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const results: ReportMeta[] = [];
    for (const file of files.filter(f => f.endsWith('.md') && f >= cutoffStr)) {
      const content = await fs.readFile(path.join(REPORTS_DIR, file), 'utf-8');
      const title = content.match(/^#\s+(?:Upgrade Report:\s*)?(.+)/m)?.[1] ?? file;
      const date = content.match(/Date:\s*(\S+)/)?.[1] ?? file.slice(0, 10);
      const track = content.match(/Track:\s*(\S+)/)?.[1] ?? 'unknown';
      const effort = content.match(/Effort:\s*(\S+)/)?.[1] ?? 'M';
      results.push({ title: title.trim(), date, track, effort });
    }

    return results.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

// =============================================================================
// Gap Scanner — 系統 capability gap 主動掃描
// =============================================================================

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
