/**
 * Knowledge Graph Chunker — v0
 *
 * Splits raw markdown (library/topics/threads/memory/*.md) into ChunkRecord[]
 * with stable hash-based ids. Pure function: (source_file, content) → chunks.
 *
 * Schema: ChunkRecord in src/kg-types.ts
 * Scope: markdown only. Room jsonl / dialogue turns handled by separate ingestor.
 */

import crypto from 'node:crypto';
import type { ChunkRecord } from './kg-types.js';

export interface ChunkOptions {
  /** Override author attribution (defaults to 'kuro' for topics/threads, 'external' for library). */
  defaultAuthor?: ChunkRecord['author'];
  /** ISO timestamp to stamp on created; useful for deterministic rebuilds. */
  now?: string;
}

/** sha1 of normalized (trimmed, collapsed whitespace) text. */
function textHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

function makeChunkId(hash: string): string {
  return `chk-${hash.slice(0, 12)}`;
}

function inferAuthor(source_file: string, override?: ChunkRecord['author']): ChunkRecord['author'] {
  if (override) return override;
  if (source_file.includes('/library/')) return 'external';
  return 'kuro';
}

/**
 * Chunk a markdown document.
 *
 * Rules:
 * - Frontmatter (leading `---...---`) → single chunk type='frontmatter'.
 * - Heading lines (`#`, `##`, ...) → chunk type='heading'; updates section_path.
 * - Fenced code blocks (```...```) → chunk type='code_block'.
 * - List items (`- `, `* `, `N. `) → chunk type='list_item' (one item = one chunk,
 *   including continuation lines indented under it).
 * - Everything else separated by blank lines → chunk type='paragraph'.
 */
export function chunkMarkdown(
  source_file: string,
  content: string,
  opts: ChunkOptions = {}
): ChunkRecord[] {
  const now = opts.now ?? new Date().toISOString();
  const author = inferAuthor(source_file, opts.defaultAuthor);
  const lines = content.split('\n');
  const chunks: ChunkRecord[] = [];
  const sectionPath: string[] = [];

  let i = 0;

  // Frontmatter (must start at line 1)
  if (lines[0]?.trim() === '---') {
    let end = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') { end = j; break; }
    }
    if (end > 0) {
      const text = lines.slice(0, end + 1).join('\n');
      const hash = textHash(text);
      chunks.push({
        id: makeChunkId(hash),
        source_file,
        line_range: [1, end + 1],
        section_path: [],
        type: 'frontmatter',
        text,
        text_hash: hash,
        author,
        extracted_entities: [],
        created: now,
      });
      i = end + 1;
    }
  }

  const pushChunk = (
    type: ChunkRecord['type'],
    startLine: number,
    endLine: number,
    text: string,
    path: string[],
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const hash = textHash(trimmed);
    chunks.push({
      id: makeChunkId(hash),
      source_file,
      line_range: [startLine, endLine],
      section_path: [...path],
      type,
      text: trimmed,
      text_hash: hash,
      author,
      extracted_entities: [],
      created: now,
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line → skip
    if (trimmed === '') { i++; continue; }

    // Fenced code block
    if (/^```/.test(trimmed)) {
      const start = i;
      const fence = trimmed.match(/^`{3,}/)![0];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
      if (i < lines.length) i++; // consume closing fence
      const text = lines.slice(start, i).join('\n');
      pushChunk('code_block', start + 1, i, text, sectionPath);
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      // Maintain section_path: truncate to level-1, then push title
      sectionPath.length = Math.max(0, level - 1);
      sectionPath.push(title);
      pushChunk('heading', i + 1, i + 1, trimmed, sectionPath);
      i++;
      continue;
    }

    // List item (- / * / + / digit.)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const start = i;
      i++;
      // Consume continuation lines: indented further than marker, OR indented at all
      // with non-empty content (lazy continuation). Stop on blank line or new top-level item.
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') break;
        const nextListMatch = next.match(/^(\s*)([-*+]|\d+\.)\s+/);
        if (nextListMatch) {
          // Nested item if more indented; otherwise sibling/new item → stop
          if (nextListMatch[1].length <= indent) break;
        }
        // Plain continuation line: must be indented more than marker
        if (!nextListMatch && next.search(/\S/) <= indent) break;
        i++;
      }
      const text = lines.slice(start, i).join('\n');
      pushChunk('list_item', start + 1, i, text, sectionPath);
      continue;
    }

    // Paragraph: consume until blank line, heading, list, or code fence
    const start = i;
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const t = next.trim();
      if (t === '') break;
      if (/^#{1,6}\s/.test(t)) break;
      if (/^```/.test(t)) break;
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(next)) break;
      i++;
    }
    const text = lines.slice(start, i).join('\n');
    pushChunk('paragraph', start + 1, i, text, sectionPath);
  }

  return chunks;
}
