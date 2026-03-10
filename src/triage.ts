/**
 * Triage — NEXT.md 解析工具
 */

import fs from 'node:fs';
import path from 'node:path';

export const NEXT_MD_PATH = path.join(process.cwd(), 'memory', 'NEXT.md');

/**
 * Find the "## Next" section boundaries in NEXT.md content.
 * Resilient to header text variations (全形/半形括號, 不同描述文字).
 * Returns { headerIdx, afterHeader, sectionEnd } or null.
 */
export function findNextSection(content: string): { headerIdx: number; afterHeader: number; sectionEnd: number } | null {
  const match = content.match(/^## Next[（(]/m);
  if (!match || match.index === undefined) return null;

  const headerIdx = match.index;
  const afterHeader = content.indexOf('\n', headerIdx);
  if (afterHeader === -1) return null;

  const sectionEnd = content.indexOf('\n---', afterHeader);
  if (sectionEnd === -1) return null;

  return { headerIdx, afterHeader, sectionEnd };
}

/**
 * 從 NEXT.md 的 Next section 提取 pending items（未勾選的 checkbox）
 */
export function extractNextItems(content: string): string[] {
  const section = findNextSection(content);
  if (!section) return [];

  const sectionText = content.slice(section.afterHeader, section.sectionEnd);
  return sectionText
    .split('\n')
    .filter(line => line.match(/^- \[ \] /))
    .map(line => line.trim());
}

// =============================================================================
// Structured NEXT.md Parser — supports @created/@blocks metadata
// =============================================================================

export interface NextTask {
  line: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  created?: string;    // @created: 2026-02-20
  blocks?: string[];   // @blocks: X/Twitter, 其他任務
  doneWhen?: string;
  verify?: string;
  section: 'now' | 'next' | 'later';
}

/**
 * Parse all tasks from NEXT.md with full metadata.
 * Supports both old format (no @created/@blocks) and new format.
 *
 * Task format:
 *   - [ ] P1: Title @created: 2026-02-20 @blocks: X/Twitter
 *     Done when: ...
 *     Verify: ...
 */
export function parseAllNextTasks(content: string): NextTask[] {
  const tasks: NextTask[] = [];
  const lines = content.split('\n');

  let currentSection: 'now' | 'next' | 'later' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers
    if (/^## Now/.test(line)) { currentSection = 'now'; continue; }
    if (/^## Next[（(]/.test(line)) { currentSection = 'next'; continue; }
    if (/^## Later/.test(line)) { currentSection = 'later'; continue; }
    if (/^## Done/.test(line) || /^## 規則/.test(line)) { currentSection = null; continue; }
    if (/^---$/.test(line.trim())) { continue; }

    if (!currentSection) continue;

    // Match unchecked task lines: - [ ] P1: Title ...
    const taskMatch = line.match(/^- \[ \] (P[0-3]):\s*(.+)$/);
    if (!taskMatch) continue;

    const priority = taskMatch[1] as NextTask['priority'];
    let titleAndMeta = taskMatch[2];

    // Extract @created
    let created: string | undefined;
    const createdMatch = titleAndMeta.match(/@created:\s*(\d{4}-\d{2}-\d{2})/);
    if (createdMatch) {
      created = createdMatch[1];
      titleAndMeta = titleAndMeta.replace(createdMatch[0], '').trim();
    }

    // Extract @blocks
    let blocks: string[] | undefined;
    const blocksMatch = titleAndMeta.match(/@blocks:\s*(.+?)(?=@|$)/);
    if (blocksMatch) {
      blocks = blocksMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      titleAndMeta = titleAndMeta.replace(blocksMatch[0], '').trim();
    }

    // Clean trailing separators
    const title = titleAndMeta.replace(/\s*—\s*$/, '').trim();

    // Look ahead for Done when / Verify on indented lines
    let doneWhen: string | undefined;
    let verify: string | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next.startsWith('  ')) break;
      const dwMatch = next.match(/^\s+Done when:\s*(.+)/);
      if (dwMatch) doneWhen = dwMatch[1].trim();
      const vMatch = next.match(/^\s+Verify:\s*(.+)/);
      if (vMatch) verify = vMatch[1].trim();
    }

    tasks.push({ line, priority, title, created, blocks, doneWhen, verify, section: currentSection });
  }

  return tasks;
}

