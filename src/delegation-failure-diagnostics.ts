/**
 * Delegation Failure Diagnostics — close the repeated-failure loop.
 *
 * The guard prevents blind retries. This module turns that stop signal into
 * durable diagnosis: classify the failure, write a report, update the linked
 * diagnostic task, and move the failure lifecycle forward.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  getDelegationFailureCode,
  readDelegationFailureRecordsSync,
  transitionDelegationFailureStatus,
  type DelegationFailureRecord,
  type DelegationFailureStatus,
} from './delegation-failure-guard.js';
import { updateTask } from './memory-index.js';
import { eventBus } from './event-bus.js';
import { slog } from './utils.js';

export interface DelegationFailureDiagnosis {
  signature: string;
  code: string;
  status: DelegationFailureStatus;
  category: 'missing_environment' | 'provider_quota' | 'max_turns' | 'shell_prompt_injection' | 'command_failed' | 'middleware_failed' | 'unknown';
  summary: string;
  recommendedAction: string;
  reportPath: string;
  taskId?: string;
}

export async function diagnoseDelegationFailure(
  memoryDir: string,
  signature: string,
): Promise<DelegationFailureDiagnosis | null> {
  const record = readDelegationFailureRecordsSync(memoryDir).find(failure => failure.signature === signature);
  if (!record) return null;

  const diagnosis = buildDiagnosis(memoryDir, record);
  writeDiagnosisReport(diagnosis, record);

  const transitioned = transitionDelegationFailureStatus(
    memoryDir,
    signature,
    diagnosis.status,
    `${diagnosis.summary}; ${diagnosis.recommendedAction}; report=${relativeToCwd(diagnosis.reportPath)}`,
  );

  if (record.diagnosticTaskId) {
    await updateTask(memoryDir, record.diagnosticTaskId, {
      status: diagnosis.status === 'resolved' ? 'completed' : 'hold',
      verify: [{
        name: 'delegation-failure-diagnostic',
        status: diagnosis.status === 'resolved' ? 'pass' : 'unknown',
        detail: `${diagnosis.category}: ${diagnosis.summary}`,
        updatedAt: new Date().toISOString(),
      }],
      staleWarning: diagnosis.status === 'needs_human'
        ? diagnosis.recommendedAction
        : undefined,
    });
  }

  const finalDiagnosis = {
    ...diagnosis,
    taskId: record.diagnosticTaskId,
  };
  eventBus.emit('action:delegation-failure', {
    signature,
    status: transitioned?.status ?? diagnosis.status,
    diagnosticTaskId: record.diagnosticTaskId,
    category: diagnosis.category,
  });
  return finalDiagnosis;
}

export async function diagnosePendingDelegationFailures(
  memoryDir: string,
  limit = 5,
): Promise<DelegationFailureDiagnosis[]> {
  const failures = readDelegationFailureRecordsSync(memoryDir)
    .filter(failure =>
      (failure.status === 'diagnosing' && Boolean(failure.diagnosticTaskId))
      || (failure.status === 'open' && failure.frequency >= 2)
    )
    .slice(0, limit);
  const results: DelegationFailureDiagnosis[] = [];
  for (const failure of failures) {
    const result = await diagnoseDelegationFailure(memoryDir, failure.signature);
    if (result) results.push(result);
  }
  return results;
}

function buildDiagnosis(memoryDir: string, record: DelegationFailureRecord): DelegationFailureDiagnosis {
  const code = getDelegationFailureCode(record.signature);
  const lower = `${record.prompt}\n${record.error}`.toLowerCase();
  const reportPath = path.join(memoryDir, 'reports', 'delegation-failures', `${code}.md`);

  if (/forge worktree allocation failed|workspace isolation policy/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'needs_human',
      category: 'missing_environment',
      summary: 'The repeated failure is caused by forge worktree allocation being blocked by workspace isolation policy.',
      recommendedAction: 'Ensure the forge worktree setup is functional (run scripts/forge-lite.sh create <name>), or mark this failure resolved if it was a test envelope task.',
      reportPath,
    };
  }

  if (/api[_-]?key|not set|missing (env|environment)|enoent.*\/users\/user\/myelin|linked_pkg_dir_not_found/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'needs_human',
      category: 'missing_environment',
      summary: 'The repeated failure is caused by missing local environment, credential, or linked dependency.',
      recommendedAction: 'Fix the missing environment input, then mark this failure resolved or rerun the origin task.',
      reportPath,
    };
  }

  if (/out of extra usage|usage limit|rate[_ -]?limit|quota/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'resolved',
      category: 'provider_quota',
      summary: 'The repeated failure is provider quota/resource exhaustion, not a task defect.',
      recommendedAction: 'Hold the origin task with a date-after provider resource condition and retry after reset.',
      reportPath,
    };
  }

  if (/maximum number of turns|reached max(?:imum)? turns|max turns/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'resolved',
      category: 'max_turns',
      summary: 'The repeated failure is a provider turn-budget exhaustion pattern, usually caused by an oversized delegated task.',
      recommendedAction: 'Do not retry the same prompt unchanged; split the origin task into smaller probes or implementation slices.',
      reportPath,
    };
  }

  if (/syntax error near unexpected token.*newline|<arbitration>|<\/arbitration>|\/bin\/bash: -c: line/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'resolved',
      category: 'shell_prompt_injection',
      summary: 'The failure matches the old shell prompt-injection path where arbitration XML leaked into shell execution.',
      recommendedAction: 'The shell request path now preserves raw shell prompts; rerun only if the original task still matters.',
      reportPath,
    };
  }

  if (/command exited \d+|shell error/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'needs_human',
      category: 'command_failed',
      summary: 'The delegated command exits non-zero repeatedly with the same signature.',
      recommendedAction: 'Inspect the command and expected exit behavior before retrying; blind retries are held.',
      reportPath,
    };
  }

  if (/task .* failed|middleware|worker|timeout|rate_limit/.test(lower)) {
    return {
      signature: record.signature,
      code,
      status: 'needs_human',
      category: 'middleware_failed',
      summary: 'The middleware/provider lane repeatedly returned a task failure.',
      recommendedAction: 'Check provider health, worker logs, and task prompt before releasing the origin task.',
      reportPath,
    };
  }

  return {
    signature: record.signature,
    code,
    status: 'needs_human',
    category: 'unknown',
    summary: 'The repeated failure does not match a known deterministic class.',
    recommendedAction: 'Review the report and add a classifier once the root cause is known.',
    reportPath,
  };
}

function writeDiagnosisReport(diagnosis: DelegationFailureDiagnosis, record: DelegationFailureRecord): void {
  const dir = path.dirname(diagnosis.reportPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = [
    `# Delegation Failure Diagnosis ${diagnosis.code}`,
    '',
    `- status: ${diagnosis.status}`,
    `- category: ${diagnosis.category}`,
    `- frequency: ${record.frequency}`,
    `- task: ${record.taskId}`,
    record.diagnosticTaskId ? `- diagnostic_task: ${record.diagnosticTaskId}` : '- diagnostic_task: none',
    `- first_seen: ${record.firstSeen}`,
    `- last_seen: ${record.lastSeen}`,
    '',
    '## Summary',
    diagnosis.summary,
    '',
    '## Recommended Action',
    diagnosis.recommendedAction,
    '',
    '## Prompt',
    fenced(record.prompt),
    '',
    '## Error',
    fenced(record.error),
    '',
    '## Signature',
    fenced(record.signature),
    '',
  ].join('\n');
  writeFileSync(diagnosis.reportPath, body, 'utf-8');
  slog('DELEGATION-DIAG', `${diagnosis.code} ${diagnosis.category} → ${diagnosis.status}`);
}

function fenced(value: string): string {
  return ['```', value, '```'].join('\n');
}

function relativeToCwd(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
