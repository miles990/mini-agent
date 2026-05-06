import path from 'node:path';

export type MemoryRepoClass =
  | 'curated-knowledge'
  | 'runtime-state'
  | 'raw-log'
  | 'cache'
  | 'backup'
  | 'local-artifact';

export interface MemoryRepoPathClassification {
  relPath: string;
  klass: MemoryRepoClass;
  track: boolean;
  reason: string;
}

export interface MemoryRepoFileStat extends MemoryRepoPathClassification {
  bytes: number;
}

export interface MemoryRepoHealthReport {
  generatedAt: string;
  memoryDir: string;
  totals: {
    files: number;
    bytes: number;
    trackableFiles: number;
    ignoredFiles: number;
  };
  classes: Record<MemoryRepoClass, { files: number; bytes: number }>;
  largest: MemoryRepoFileStat[];
  kgCandidates: MemoryRepoFileStat[];
}

export const MEMORY_REPO_GITIGNORE = `# mini-agent external memory repository policy
# Track curated knowledge, not high-frequency runtime scratch.

.DS_Store
.gitignore.local

# Runtime state and append-only telemetry
state/
logs/
compiled-chunks.json
pending-memories.jsonl
*.jsonl

# Local inbox/buffers/cursors
.conversation-threads.json
.inner-voice-buffer.json
.memory-access.json
.state-snapshot.json
.telegram-inbox.md
.telegram-offset
.topic-hits.json
inbox.jsonl

# Generated caches and bulky media
media/
context-checkpoints/
*.cache
*-cache.json
*-cache.jsonl

# Backups remain local unless explicitly promoted into docs/reports.
*.bak
*.backup-*
*.corrupt-backup-*
*.tmp

# Package/tool artifacts should never live in memory repo history.
node_modules/
dist/
`;

export const MEMORY_REPO_README = `# mini-agent Memory

Private, versioned memory for mini-agent.

This repository is for curated knowledge, durable decisions, handoffs, topic notes, reports, and maintenance artifacts. High-frequency runtime state stays local and is ignored by git.

## Policy

- Track: Markdown knowledge, topic summaries, handoffs, decisions, proposals, reports, rules, and small curated JSON.
- Ignore: runtime state, append-only telemetry, raw logs, caches, buffers, local cursors, backups, and media.
- Promote raw observations only after refinement into a concise Markdown note or report.

## Observability

Run from the mini-agent code repo:

\`\`\`sh
pnpm memory:repo:setup
pnpm memory:repo:check
\`\`\`

The check writes \`reports/memory-repo-health.md\` and prints a JSON summary.

## KG Usage

The memory repo is the auditable text layer. The knowledge graph is the relationship and retrieval layer. Promote concise Markdown into KG; do not push raw logs, state, caches, or backups.
`;

export const MEMORY_REPO_MAINTENANCE = `# Memory Maintenance

## Goal

Memory should become clearer over time: fewer stale raw traces, stronger links, better summaries, and more reusable knowledge.

## Cadence

- Runtime writes high-frequency state into ignored paths.
- Maintenance cycles refine useful observations into tracked Markdown.
- Large raw files are summarized before they are promoted.
- Conflicts are resolved by preserving both facts first, then writing a concise synthesis.

## Promotion Criteria

A memory item is worth tracking when it is:

- reusable for future behavior or decisions
- connected to a topic, project, person, or system
- falsifiable or backed by a concrete artifact
- shorter and clearer than the raw trace it came from

## Quarantine Criteria

Do not track:

- raw append-only logs
- temporary buffers
- generated caches
- local offsets/cursors
- stale backups
- unreviewed large dumps
`;

export const CONTEXT_FABRIC_DESIGN = `# Context Fabric

mini-agent uses three memory layers together:

1. Runtime context: short-lived checkpoints, buffers, current task state, telemetry.
2. Curated memory repo: auditable Markdown knowledge, handoffs, reports, and durable decisions.
3. Knowledge Graph: shared semantic memory for cross-agent relationships, verification, conflicts, and retrieval.

## Composition Rule

Context should be assembled by need, not dumped wholesale.

- Immediate task execution reads current runtime state and recent checkpoints.
- Planning and review read curated summaries, handoffs, decisions, and relevant reports.
- Cross-agent work reads KG neighborhoods, conflicts, verification edges, and shared claims.
- Long-term learning promotes repeated useful patterns from runtime state into curated memory, then into KG when relationship queries would help.

## Promotion Rule

Context can become memory only after it gains enough epistemic support:

- provenance: where it came from is recorded
- confidence: the system knows whether it is fact, inference, preference, or hypothesis
- review: an agent or deterministic check accepted it, or repeated evidence supports it
- scope: the memory says whether it is private, shared, project-specific, or temporary

Memory can become context only with its source and confidence preserved. Low-confidence or conflicting memories must be injected as candidates, not as facts.

## Storage Rule

- Raw context checkpoints stay local and ignored.
- Digest context can be tracked when it is useful across sessions.
- Shared context anchors belong in KG when another agent may need to discover, verify, challenge, or connect them.

## KG Rule

KG is the shared external semantic memory. It should store relationship-bearing knowledge, not raw append-only logs. Good KG candidates include decisions, claims, issues, PRs, agents, projects, concepts, conflicts, verifications, and context anchors.
`;

const BACKUP_PATTERNS = [
  /\.bak(?:$|-)/,
  /\.backup-/,
  /\.corrupt-backup-/,
  /backup-\d{8}/,
];

const CACHE_PATTERNS = [
  /(^|\/)compiled-chunks\.json$/,
  /(^|\/)context-checkpoints\//,
  /(^|\/)pending-memories\.jsonl$/,
  /-cache\.jsonl?$/,
  /\.cache$/,
];

const LOCAL_ARTIFACT_PATTERNS = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.conversation-threads\.json$/,
  /(^|\/)\.inner-voice-buffer\.json$/,
  /(^|\/)\.memory-access\.json$/,
  /(^|\/)\.state-snapshot\.json$/,
  /(^|\/)\.telegram-inbox\.md$/,
  /(^|\/)\.telegram-offset$/,
  /(^|\/)\.topic-hits\.json$/,
  /(^|\/)media\//,
];

export function classifyMemoryRepoPath(relPath: string): MemoryRepoPathClassification {
  const normalized = relPath.split(path.sep).join('/');

  if (normalized.startsWith('state/')) {
    return { relPath: normalized, klass: 'runtime-state', track: false, reason: 'high-frequency runtime state' };
  }

  if (BACKUP_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { relPath: normalized, klass: 'backup', track: false, reason: 'backup or stale recovery artifact' };
  }

  if (CACHE_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { relPath: normalized, klass: 'cache', track: false, reason: 'generated cache' };
  }

  if (normalized.startsWith('logs/') || normalized.endsWith('.jsonl')) {
    return { relPath: normalized, klass: 'raw-log', track: false, reason: 'append-only raw log or telemetry' };
  }

  if (LOCAL_ARTIFACT_PATTERNS.some(pattern => pattern.test(normalized))) {
    return { relPath: normalized, klass: 'local-artifact', track: false, reason: 'machine-local buffer, cursor, or media artifact' };
  }

  return { relPath: normalized, klass: 'curated-knowledge', track: true, reason: 'curated memory artifact' };
}

export function buildMemoryRepoHealthReport(
  memoryDir: string,
  files: Array<{ relPath: string; bytes: number }>,
  generatedAt = new Date().toISOString(),
): MemoryRepoHealthReport {
  const classes = emptyClassCounts();
  const stats = files.map(file => ({ ...classifyMemoryRepoPath(file.relPath), bytes: file.bytes }));
  for (const stat of stats) {
    classes[stat.klass].files += 1;
    classes[stat.klass].bytes += stat.bytes;
  }

  return {
    generatedAt,
    memoryDir,
    totals: {
      files: stats.length,
      bytes: stats.reduce((sum, stat) => sum + stat.bytes, 0),
      trackableFiles: stats.filter(stat => stat.track).length,
      ignoredFiles: stats.filter(stat => !stat.track).length,
    },
    classes,
    largest: [...stats].sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    kgCandidates: stats.filter(isKgCandidate).sort((a, b) => b.bytes - a.bytes).slice(0, 20),
  };
}

export function formatMemoryRepoHealthMarkdown(report: MemoryRepoHealthReport): string {
  const lines = [
    '# Memory Repo Health',
    '',
    `Generated: ${report.generatedAt}`,
    `Memory dir: \`${report.memoryDir}\``,
    '',
    '## Summary',
    '',
    `- Files: ${report.totals.files}`,
    `- Size: ${formatBytes(report.totals.bytes)}`,
    `- Trackable curated files: ${report.totals.trackableFiles}`,
    `- Ignored runtime/raw files: ${report.totals.ignoredFiles}`,
    '',
    '## Classes',
    '',
    '| Class | Files | Size |',
    '| --- | ---: | ---: |',
  ];

  for (const [klass, entry] of Object.entries(report.classes)) {
    lines.push(`| ${klass} | ${entry.files} | ${formatBytes(entry.bytes)} |`);
  }

  lines.push('', '## Largest Files', '', '| Path | Class | Size | Tracked |', '| --- | --- | ---: | --- |');
  for (const file of report.largest) {
    lines.push(`| \`${file.relPath}\` | ${file.klass} | ${formatBytes(file.bytes)} | ${file.track ? 'yes' : 'no'} |`);
  }

  lines.push(
    '',
    '## KG Candidates',
    '',
    'These curated Markdown files are good candidates for KG sync or relationship extraction.',
    '',
    '| Path | Size |',
    '| --- | ---: |',
  );
  for (const file of report.kgCandidates) {
    lines.push(`| \`${file.relPath}\` | ${formatBytes(file.bytes)} |`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function isKgCandidate(file: MemoryRepoFileStat): boolean {
  if (!file.track) return false;
  if (!file.relPath.endsWith('.md')) return false;
  if (file.relPath === 'README.md' || file.relPath === 'MAINTENANCE.md') return false;
  return /^(MEMORY|SOUL|HEARTBEAT|NEXT)\.md$/.test(file.relPath)
    || /^(topics|handoffs|proposals|reports|research|reviews|learning|discussions)\//.test(file.relPath);
}

function emptyClassCounts(): Record<MemoryRepoClass, { files: number; bytes: number }> {
  return {
    'curated-knowledge': { files: 0, bytes: 0 },
    'runtime-state': { files: 0, bytes: 0 },
    'raw-log': { files: 0, bytes: 0 },
  cache: { files: 0, bytes: 0 },
    backup: { files: 0, bytes: 0 },
    'local-artifact': { files: 0, bytes: 0 },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} TB`;
}
