export type ConflictClass = 'append-only-memory' | 'generated' | 'code' | 'config' | 'unknown';

export interface ConflictFile {
  path: string;
  class: ConflictClass;
  autoResolvable: boolean;
  resolution: 'append-union' | 'regenerate' | 'manual-review';
  reason: string;
}

export interface ConflictAssessment {
  conflicted: ConflictFile[];
  autoResolvable: ConflictFile[];
  manual: ConflictFile[];
  shouldBlock: boolean;
  guidance: string[];
}

const APPEND_ONLY_MEMORY_RE = /^memory\/(?:inner-notes\.md|handoffs\/active\.md|topics\/.+\.md|threads\/.+\.md|research\/.+\.md)$/;
const GENERATED_RE = /^(?:dist\/|memory\/topics\/\.summaries\/|memory\/index\/.+\.jsonl$)/;
const CODE_RE = /^(?:src\/|tests\/|scripts\/|plugins\/|\.githooks\/).+/;
const CONFIG_RE = /^(?:package\.json|pnpm-lock\.yaml|tsconfig\.json|agent-compose\.yaml|\.env(?:\..*)?)$/;

export function assessConflicts(paths: string[]): ConflictAssessment {
  const conflicted = unique(paths).map(classifyConflictPath);
  const autoResolvable = conflicted.filter(f => f.autoResolvable);
  const manual = conflicted.filter(f => !f.autoResolvable);
  const guidance: string[] = [];

  if (conflicted.length === 0) {
    guidance.push('No unresolved git conflicts detected.');
  } else {
    guidance.push(`Detected ${conflicted.length} unresolved conflict(s).`);
  }
  if (autoResolvable.length > 0) {
    guidance.push(`Auto-resolvable append-only memory files: ${autoResolvable.map(f => f.path).join(', ')}.`);
  }
  if (manual.length > 0) {
    guidance.push(`Manual review required: ${manual.map(f => `${f.path} (${f.class})`).join(', ')}.`);
  }

  return {
    conflicted,
    autoResolvable,
    manual,
    shouldBlock: conflicted.length > 0,
    guidance,
  };
}

export function classifyConflictPath(path: string): ConflictFile {
  if (APPEND_ONLY_MEMORY_RE.test(path)) {
    return {
      path,
      class: 'append-only-memory',
      autoResolvable: true,
      resolution: 'append-union',
      reason: 'memory markdown is append-oriented; preserve both sides and deduplicate exact lines',
    };
  }
  if (GENERATED_RE.test(path)) {
    return {
      path,
      class: 'generated',
      autoResolvable: false,
      resolution: 'regenerate',
      reason: 'generated files should be rebuilt from source instead of hand-merged',
    };
  }
  if (CODE_RE.test(path)) {
    return {
      path,
      class: 'code',
      autoResolvable: false,
      resolution: 'manual-review',
      reason: 'code conflicts need semantic review and tests',
    };
  }
  if (CONFIG_RE.test(path)) {
    return {
      path,
      class: 'config',
      autoResolvable: false,
      resolution: 'manual-review',
      reason: 'configuration conflicts can change runtime behavior and require explicit review',
    };
  }
  return {
    path,
    class: 'unknown',
    autoResolvable: false,
    resolution: 'manual-review',
    reason: 'unknown file type defaults to manual review',
  };
}

export function mergeAppendOnlyText(ours: string, theirs: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  const append = (text: string) => {
    const sourceLines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
    for (const line of sourceLines) {
      if (!line.trim()) {
        if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
        continue;
      }
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  };

  append(ours);
  append(theirs);

  while (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
