import { Parser } from 'htmlparser2';

export interface KuroTag {
  name: string;
  attributes: Record<string, string>;
  content: string;
  raw: string;
  start: number;
  end: number;
  selfClosing: boolean;
  depth: number;
  parentName?: string;
}

interface ParseOptions {
  maxDepth?: number;
  stripCodeSpans?: boolean;
}

interface StackEntry {
  name: string;
  attributes: Record<string, string>;
  start: number;
  openEnd: number;
  parentName?: string;
  depth: number;
  tracked: boolean;
}

interface Range {
  start: number;
  end: number;
}

interface ParseState {
  tags: KuroTag[];
  stack: StackEntry[];
  ranges: Range[];
}

function isKuroTag(name: string): boolean {
  return name.startsWith('kuro:');
}

function sanitizeForTagParsing(input: string): string {
  // Mask markdown code fences/inline code while preserving indexes.
  return input
    .replace(/```[\s\S]*?```/g, block => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]+`/g, span => ' '.repeat(span.length));
}

function parseInternal(input: string, options?: ParseOptions): ParseState {
  const maxDepth = options?.maxDepth ?? 2;
  const source = options?.stripCodeSpans === false ? input : sanitizeForTagParsing(input);
  const state: ParseState = {
    tags: [],
    stack: [],
    ranges: [],
  };

  const parser = new Parser({
    onopentag(name, attributes) {
      if (!isKuroTag(name)) return;
      const depth = state.stack.length + 1;
      state.stack.push({
        name,
        attributes,
        start: parser.startIndex,
        openEnd: parser.endIndex,
        parentName: state.stack[state.stack.length - 1]?.name,
        depth,
        tracked: depth <= maxDepth,
      });
    },
    onclosetag(name) {
      if (!isKuroTag(name)) return;
      const idx = state.stack.map(s => s.name).lastIndexOf(name);
      if (idx < 0) return;
      const entry = state.stack[idx];
      state.stack.splice(idx, 1);
      if (!entry.tracked) return;

      const closeStart = parser.startIndex;
      const closeEnd = parser.endIndex;
      const selfClosing = closeStart <= entry.openEnd;
      const contentStart = Math.min(entry.openEnd + 1, input.length);
      const contentEnd = selfClosing ? contentStart : Math.max(contentStart, closeStart);
      const end = Math.min(input.length, closeEnd + 1);

      let content = input.slice(contentStart, contentEnd);

      // Strip orphaned kuro closing tags from content (e.g. </kuro:action> leaked into <kuro:task>)
      const PLAIN_TEXT_TAGS = new Set(['kuro:task', 'kuro:remember', 'kuro:chat', 'kuro:ask', 'kuro:done', 'kuro:inner', 'kuro:impulse', 'kuro:summary', 'kuro:goal', 'kuro:goal-progress', 'kuro:goal-done', 'kuro:goal-abandon']);
      if (PLAIN_TEXT_TAGS.has(name)) {
        content = content.replace(/<\/?kuro:[^>]*>/g, '');
        // User-visible tags (chat, ask, summary) must not be truncated — they are the message itself.
        // Inner (cross-cycle working memory) can also be long. Cap only structural/metadata tags.
        const NO_CAP_TAGS = new Set(['kuro:chat', 'kuro:ask', 'kuro:summary', 'kuro:inner']);
        if (!NO_CAP_TAGS.has(name)) {
          const CLOSED_CONTENT_CAP = 500;
          if (content.length > CLOSED_CONTENT_CAP) {
            content = content.slice(0, CLOSED_CONTENT_CAP);
          }
        }
      }

      state.tags.push({
        name,
        attributes: entry.attributes,
        content,
        raw: input.slice(entry.start, end),
        start: entry.start,
        end,
        selfClosing,
        depth: entry.depth,
        parentName: entry.parentName,
      });
      state.ranges.push({ start: entry.start, end });
    },
  }, {
    decodeEntities: false,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  });

  parser.write(source);
  parser.end();

  // Graceful fallback for malformed/unclosed tags.
  // Cap content to prevent pollution (e.g. unclosed <kuro:task> absorbing entire response).
  const UNCLOSED_CONTENT_CAP = 500;
  for (const entry of state.stack) {
    if (!entry.tracked) continue;
    const contentStart = Math.min(entry.openEnd + 1, input.length);
    let contentEnd = input.length;
    let raw = input.slice(entry.start);
    let content = input.slice(contentStart, contentEnd);

    const NO_CAP_TAGS = new Set(['kuro:chat', 'kuro:ask', 'kuro:summary', 'kuro:inner']);
    if (!NO_CAP_TAGS.has(entry.name) && content.length > UNCLOSED_CONTENT_CAP) {
      contentEnd = contentStart + UNCLOSED_CONTENT_CAP;
      content = input.slice(contentStart, contentEnd);
      raw = input.slice(entry.start, contentEnd);
    }

    // Strip nested kuro tags from unclosed tag content — prevents tag leakage
    content = content.replace(/<\/?kuro:[^>]*>/g, '');

    state.tags.push({
      name: entry.name,
      attributes: entry.attributes,
      content,
      raw,
      start: entry.start,
      end: contentEnd,
      selfClosing: false,
      depth: entry.depth,
      parentName: entry.parentName,
    });
    state.ranges.push({ start: entry.start, end: contentEnd });
  }

  state.tags.sort((a, b) => a.start - b.start);
  state.ranges.sort((a, b) => a.start - b.start);
  return state;
}

export function parseKuroTags(input: string, options?: ParseOptions): KuroTag[] {
  return parseInternal(input, options).tags;
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const merged: Range[] = [];
  let current = { ...ranges[0] };
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
      continue;
    }
    merged.push(current);
    current = { ...next };
  }
  merged.push(current);
  return merged;
}

export function stripKuroTags(
  input: string,
  options?: ParseOptions & { exclude?: Set<string> },
): string {
  const parsed = parseInternal(input, options);
  const exclude = options?.exclude;
  const ranges: Range[] = [];
  for (const tag of parsed.tags) {
    if (exclude && exclude.has(tag.name)) continue;
    ranges.push({ start: tag.start, end: tag.end });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return input.trim();

  let cursor = 0;
  let out = '';
  for (const r of merged) {
    if (r.start > cursor) out += input.slice(cursor, r.start);
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < input.length) out += input.slice(cursor);
  // Also strip thinking blocks (e.g. <ktml:thinking>, <thinking>) — these are
  // internal reasoning from local models and should never leak to Chat Room/Telegram.
  return out.replace(/<(?:ktml:)?thinking>[\s\S]*?<\/(?:ktml:)?thinking>/g, '').trim();
}

export function getKuroTagBalance(
  input: string,
  options?: { stripCodeSpans?: boolean },
): Map<string, { open: number; close: number }> {
  const source = options?.stripCodeSpans === false ? input : sanitizeForTagParsing(input);
  const counts = new Map<string, { open: number; close: number }>();
  const parser = new Parser({
    onopentag(name) {
      if (!isKuroTag(name)) return;
      const row = counts.get(name) ?? { open: 0, close: 0 };
      row.open += 1;
      counts.set(name, row);
    },
    onclosetag(name) {
      if (!isKuroTag(name)) return;
      const row = counts.get(name) ?? { open: 0, close: 0 };
      row.close += 1;
      counts.set(name, row);
    },
  }, {
    decodeEntities: false,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  });
  parser.write(source);
  parser.end();
  return counts;
}

export function createKuroChatStreamParser(
  onChat: (tag: KuroTag) => void,
  options?: ParseOptions,
): { write: (chunk: string) => void; end: () => void } {
  const maxDepth = options?.maxDepth ?? 2;
  const streamState = {
    source: '',
    stack: [] as StackEntry[],
  };

  const parser = new Parser({
    onopentag(name, attributes) {
      if (!isKuroTag(name)) return;
      const depth = streamState.stack.length + 1;
      streamState.stack.push({
        name,
        attributes,
        start: parser.startIndex,
        openEnd: parser.endIndex,
        parentName: streamState.stack[streamState.stack.length - 1]?.name,
        depth,
        tracked: depth <= maxDepth,
      });
    },
    onclosetag(name) {
      if (!isKuroTag(name)) return;
      const idx = streamState.stack.map(s => s.name).lastIndexOf(name);
      if (idx < 0) return;
      const entry = streamState.stack[idx];
      streamState.stack.splice(idx, 1);
      if (!entry.tracked || name !== 'kuro:chat') return;

      const closeStart = parser.startIndex;
      const closeEnd = parser.endIndex;
      const selfClosing = closeStart <= entry.openEnd;
      const contentStart = Math.min(entry.openEnd + 1, streamState.source.length);
      const contentEnd = selfClosing ? contentStart : Math.max(contentStart, closeStart);
      const end = Math.min(streamState.source.length, closeEnd + 1);
      onChat({
        name,
        attributes: entry.attributes,
        content: streamState.source.slice(contentStart, contentEnd),
        raw: streamState.source.slice(entry.start, end),
        start: entry.start,
        end,
        selfClosing,
        depth: entry.depth,
        parentName: entry.parentName,
      });
    },
  }, {
    decodeEntities: false,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  });

  return {
    write(chunk: string): void {
      if (!chunk) return;
      streamState.source += chunk;
      parser.write(options?.stripCodeSpans === false ? chunk : sanitizeForTagParsing(chunk));
    },
    end(): void {
      parser.end();
    },
  };
}

/**
 * Strip hallucinated turn separators from model output.
 * Models (especially via CLI subprocess) sometimes continue generating past their
 * response and produce fake "User:" / "Human:" turns. These should never reach
 * the chat room or Telegram.
 */
export function stripTurnSeparators(text: string): string {
  return text.replace(/\n{1,}(?:---|===)?\n{0,2}(?:User|Human|Assistant)[:：].*/gs, '').trim();
}

/**
 * Neutralize system-level XML tags in external message content before it enters
 * the LLM context. Prevents prompt injection via chat room / inbox messages
 * that contain tags like <system-reminder>, <functions>, <tool_result>, etc.
 *
 * Replaces angle brackets with fullwidth equivalents (＜ ＞) only for known
 * dangerous patterns — legitimate tags like <kuro:chat> are left intact.
 */
const SYSTEM_TAG_PATTERN = /(<\/?)(system-reminder|system|functions|function|tool_result|tool_use|antml:[a-z_]+)([\s>])/gi;

export function sanitizeExternalContent(text: string): string {
  return text.replace(SYSTEM_TAG_PATTERN, (_, open: string, tag: string, after: string) =>
    `${open.replace('<', '＜')}${tag}${after.replace('>', '＞')}`
  );
}
