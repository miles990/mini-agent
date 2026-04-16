/**
 * Delegation summary helpers — output extraction, persistence, lane output.
 *
 * Extracted from delegation.ts. These are generic output-processing utilities
 * used by finalizeTask and convertAndDispatchAsPlan for activity journaling,
 * foreground lane display, and sibling awareness.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import type { TaskResult } from './delegation.js';

const JOURNAL_MAX_ENTRIES = 100;

export function extractDelegationSummary(output: string, maxLen: number): string {
  if (!output) return '';
  let text = output;
  text = text.replace(/<ktml:thinking>[\s\S]*?<\/ktml:thinking>/g, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  text = text.replace(/\[forge\] merge skipped \([^)]*\)\s*$/, '').trim();

  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;

  const conclusionMatch = text.match(
    /#{2,3}\s*(?:\d+\.\s*)?(?:FINAL ANSWER|Conclusion|結論|Summary|摘要|Key Findings?|Results?|結果)/i
  ) ?? text.match(
    /(?:^|\n)\s*(?:結論|Conclusion|FINAL ANSWER)[：:]/i
  );
  if (conclusionMatch && conclusionMatch.index !== undefined) {
    const fromConclusion = text.slice(conclusionMatch.index).replace(/\n/g, ' ').trim();
    if (fromConclusion.length > 30) return fromConclusion.slice(0, maxLen);
  }

  const startsWithThink = /^(?:#{1,3}\s*(?:\d+\.\s*)?THINK|I am verifying|Let me (?:think|analyze|verify))/i.test(text.trim());
  if (startsWithThink) return '…' + cleaned.slice(-(maxLen - 1));

  return cleaned.slice(0, maxLen);
}

export function persistDelegationResult(result: TaskResult): void {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const journalPath = path.join(instanceDir, 'delegation-journal.jsonl');

    const entry = {
      ts: result.completedAt ?? new Date().toISOString(),
      id: result.id,
      type: result.type ?? 'code',
      status: result.status,
      durationMs: result.duration,
      forgeMerged: result.forge?.merged ?? false,
      output: result.output.slice(0, 2000),
    };
    fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n');

    try {
      const lines = fs.readFileSync(journalPath, 'utf-8').split('\n').filter(Boolean);
      if (lines.length > JOURNAL_MAX_ENTRIES + 20) {
        fs.writeFileSync(journalPath, lines.slice(-JOURNAL_MAX_ENTRIES).join('\n') + '\n');
      }
    } catch { /* trim is best-effort */ }
  } catch { /* fire-and-forget */ }
}

export function buildRecentDelegationSummary(maxAgeMs: number = 3_600_000, maxChars: number = 1500): string | null {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const journalPath = path.join(instanceDir, 'delegation-journal.jsonl');
    if (!fs.existsSync(journalPath)) return null;

    const raw = fs.readFileSync(journalPath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    const cutoff = Date.now() - maxAgeMs;
    const recent: Array<{ ts: string; id: string; type: string; status: string; durationMs: number; output: string }> = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.ts).getTime() >= cutoff) recent.push(entry);
      } catch { /* skip malformed */ }
    }
    if (recent.length === 0) return null;

    recent.reverse();
    let result = '';
    for (const e of recent) {
      const durSec = Math.round((e.durationMs ?? 0) / 1000);
      const preview = extractDelegationSummary(e.output ?? '', 100);
      const line = `- [${e.type}] ${e.id}: ${e.status} (${durSec}s) — ${preview}\n`;
      if (result.length + line.length > maxChars) break;
      result += line;
    }
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function writeLaneOutput(result: TaskResult): void {
  try {
    const instanceId = getCurrentInstanceId();
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    fs.mkdirSync(laneDir, { recursive: true });
    fs.writeFileSync(path.join(laneDir, `${result.id}.json`), JSON.stringify(result, null, 2));
  } catch { /* best effort */ }
}
