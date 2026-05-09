import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { MemoryIndexEntry } from './memory-index.js';

export type DesignGovernanceStatus = 'ok' | 'warn' | 'blocked';
export type DesignGovernanceDepth = 'trivial' | 'standard' | 'deep';

export interface DesignGovernanceTaskFinding {
  taskId: string;
  summary: string;
  status: string;
  depth: DesignGovernanceDepth;
  reason: string;
  artifactPath?: string;
  missingSections: string[];
}

export interface DesignGovernanceReport {
  status: DesignGovernanceStatus;
  summary: string;
  evidence: string[];
  missingArtifacts: DesignGovernanceTaskFinding[];
  incompleteArtifacts: DesignGovernanceTaskFinding[];
}

const DESIGN_ARTIFACT_ROOT = path.join('proposals', 'design-artifacts');
const ACTIVE_IMPLEMENTATION_STATUSES = new Set(['in_progress', 'needs-decomposition', 'blocked']);
const HIGH_RISK_TAGS = new Set([
  'architecture',
  'autonomy-closure',
  'data-flow',
  'design-governance',
  'kg',
  'middleware',
  'multi-agent',
  'skill',
  'state-machine',
  'workflow',
]);

const HIGH_RISK_SUMMARY_RE = /\b(?:autonomy closure|autonomy-closure|scheduler|middleware|delegation|multi-?brain|kg|knowledge graph|memory|state machine|state-machine|data flow|data-flow|workflow|skill|identity|auth|webhook|deploy|dashboard|api|provider|runtime workspace|runtime-workspace)\b/i;

const REQUIRED_SECTIONS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'constraint-texture', label: 'Constraint Texture', pattern: /constraint\s+texture/i },
  { key: 'data-flow', label: 'Data Flow', pattern: /data\s+flow|資料流/i },
  { key: 'state-machine', label: 'State Machine', pattern: /state\s+machine|狀態機/i },
  { key: 'operator-flow', label: 'User/Operator Flow', pattern: /(?:user|operator)\s+flow|用戶流程|操作流程/i },
  { key: 'failure-path', label: 'Failure Path', pattern: /failure\s+path|fallback|rollback|失敗路徑|回退/i },
  { key: 'acceptance', label: 'Acceptance/Falsifier', pattern: /acceptance|falsifier|驗收|反證/i },
  { key: 'test-plan', label: 'Test Plan', pattern: /test\s+plan|verification|測試|驗證/i },
  { key: 'backtest', label: 'Effect Backtest', pattern: /backtest|effect\s+backtest|效果回測|回測/i },
  { key: 'mermaid', label: 'Mermaid Diagram', pattern: /```mermaid/i },
];

export function evaluateDesignGovernance(
  memoryDir: string,
  openTasks: MemoryIndexEntry[],
): DesignGovernanceReport {
  const risky = openTasks
    .map(task => classifyDesignNeed(task))
    .filter((finding): finding is DesignGovernanceTaskFinding => finding !== null);

  const missingArtifacts: DesignGovernanceTaskFinding[] = [];
  const incompleteArtifacts: DesignGovernanceTaskFinding[] = [];

  for (const finding of risky) {
    const artifact = findDesignArtifact(memoryDir, finding);
    if (!artifact) {
      missingArtifacts.push(finding);
      continue;
    }

    const missingSections = missingDesignSections(artifact.content);
    const enriched = {
      ...finding,
      artifactPath: artifact.relPath,
      missingSections,
    };
    if (missingSections.length > 0) incompleteArtifacts.push(enriched);
  }

  const hasBlocking = [...missingArtifacts, ...incompleteArtifacts].some(finding =>
    ACTIVE_IMPLEMENTATION_STATUSES.has(finding.status),
  );
  const status: DesignGovernanceStatus = hasBlocking
    ? 'blocked'
    : missingArtifacts.length > 0 || incompleteArtifacts.length > 0 ? 'warn' : 'ok';

  const evidence = [
    ...missingArtifacts.slice(0, 5).map(finding =>
      `${finding.taskId} missing design artifact: ${finding.reason}`,
    ),
    ...incompleteArtifacts.slice(0, 5).map(finding =>
      `${finding.taskId} incomplete ${finding.artifactPath}: missing ${finding.missingSections.join(', ')}`,
    ),
  ];

  return {
    status,
    summary: status === 'ok'
      ? `${risky.length} high-risk task(s) have design governance`
      : `${missingArtifacts.length} missing and ${incompleteArtifacts.length} incomplete design artifact(s)`,
    evidence,
    missingArtifacts,
    incompleteArtifacts,
  };
}

export function buildDesignArtifactTemplate(task: Pick<MemoryIndexEntry, 'id' | 'summary' | 'refs' | 'tags'>): string {
  const title = task.summary ?? task.id;
  return [
    `# Design Artifact: ${title}`,
    '',
    `Task: ${task.id}`,
    `Refs: ${(task.refs ?? []).join(', ') || 'none'}`,
    `Tags: ${(task.tags ?? []).join(', ') || 'none'}`,
    '',
    '## Constraint Texture',
    '- Tension:',
    '- Bottleneck:',
    '- Waste mode:',
    '- Convergence rule:',
    '',
    '## Data Flow',
    '```mermaid',
    'flowchart TD',
    '  A[Input / signal] --> B[Classifier / planner]',
    '  B --> C[Implementation]',
    '  C --> D[Verifier]',
    '  D --> E[KG / memory feedback]',
    '```',
    '',
    '## State Machine',
    '```mermaid',
    'stateDiagram-v2',
    '  [*] --> Planned',
    '  Planned --> Implementing',
    '  Implementing --> Reviewing',
    '  Reviewing --> Testing',
    '  Testing --> Deployed',
    '  Testing --> Revising',
    '  Revising --> Implementing',
    '  Deployed --> Backtested',
    '```',
    '',
    '## User/Operator Flow',
    '```mermaid',
    'sequenceDiagram',
    '  participant User',
    '  participant Agent',
    '  participant Runtime',
    '  participant KG',
    '  User->>Agent: goal / issue / observation',
    '  Agent->>Runtime: plan and execute',
    '  Runtime->>KG: record context and result',
    '  Agent-->>User: progress and completion summary',
    '```',
    '',
    '## Failure Path',
    '- Retry limit:',
    '- Fallback strategy:',
    '- Escalation / hold condition:',
    '- Rollback:',
    '',
    '## Acceptance/Falsifier',
    '- Acceptance:',
    '- Falsifier:',
    '',
    '## Test Plan',
    '- Unit:',
    '- Integration:',
    '- Verifier:',
    '',
    '## Review Plan',
    '- Code review focus:',
    '- Diagram/code consistency check:',
    '',
    '## Effect Backtest',
    '- Metric:',
    '- Observation window:',
    '- KG/memory update:',
    '',
  ].join('\n');
}

function classifyDesignNeed(task: MemoryIndexEntry): DesignGovernanceTaskFinding | null {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const explicitDepth = String(payload.design_depth ?? payload.designDepth ?? '').toLowerCase();
  if (explicitDepth === 'trivial' || task.tags?.includes('design-exempt')) return null;
  const explicitRequired = payload.design_governance_required === true || payload.designGovernanceRequired === true;
  if (String(task.status) === 'hold' && !explicitRequired) return null;
  if (payload.origin === 'autonomy-closure' && !explicitRequired) return null;

  const summary = task.summary ?? '';
  if (/autonomy closure:\s*repair design-governance/i.test(summary)) return null;
  const tags = task.tags ?? [];
  const tagRequired = tags.some(tag => HIGH_RISK_TAGS.has(tag));
  const summaryRequired = HIGH_RISK_SUMMARY_RE.test(summary);
  const highPriority = Number(payload.priority ?? 99) <= 1;
  const implementationActive = ACTIVE_IMPLEMENTATION_STATUSES.has(String(task.status));

  if (!explicitRequired && !tagRequired && !(summaryRequired && (highPriority || implementationActive))) return null;

  const depth: DesignGovernanceDepth = explicitRequired || tagRequired || summaryRequired ? 'deep' : 'standard';
  const reason = explicitRequired
    ? 'explicit design_governance_required'
    : tagRequired
      ? `high-risk tag=${tags.find(tag => HIGH_RISK_TAGS.has(tag))}`
      : 'high-risk summary touches autonomous workflow/data/state infrastructure';

  return {
    taskId: task.id,
    summary,
    status: String(task.status),
    depth,
    reason,
    missingSections: [],
  };
}

function findDesignArtifact(
  memoryDir: string,
  finding: Pick<DesignGovernanceTaskFinding, 'taskId' | 'summary'>,
): { relPath: string; content: string } | null {
  const candidates = candidateArtifactPaths(finding);
  for (const relPath of candidates) {
    const abs = path.join(memoryDir, relPath);
    if (existsSync(abs)) return { relPath, content: readFileSync(abs, 'utf-8') };
  }

  const root = path.join(memoryDir, DESIGN_ARTIFACT_ROOT);
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.md')) continue;
    const relPath = path.join(DESIGN_ARTIFACT_ROOT, name);
    const content = readFileSync(path.join(memoryDir, relPath), 'utf-8');
    if (content.includes(finding.taskId) || (finding.summary.length >= 32 && content.includes(finding.summary.slice(0, 64)))) {
      return { relPath, content };
    }
  }
  return null;
}

function candidateArtifactPaths(finding: Pick<DesignGovernanceTaskFinding, 'taskId'>): string[] {
  return [
    path.join(DESIGN_ARTIFACT_ROOT, `${safeFileName(finding.taskId)}.md`),
    path.join(DESIGN_ARTIFACT_ROOT, `${finding.taskId}.md`),
  ];
}

function missingDesignSections(content: string): string[] {
  return REQUIRED_SECTIONS
    .filter(section => !section.pattern.test(content))
    .map(section => section.label);
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}
