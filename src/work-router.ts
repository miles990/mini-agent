/**
 * Work Router — unified work classifier + runtime escalation
 *
 * Determines if a room message is quick-reply, task-worthy, or urgent.
 * Provides RuntimeEscalation for mid-flight promotion of foreground work.
 */

import { appendMemoryIndexEntry } from './memory-index.js';
import { registerProcess } from './process-table.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export type WorkClass = 'quick-reply' | 'task-worthy' | 'urgent';

export interface ClassifyResult {
  workClass: WorkClass;
  hasStateMutation: boolean;
  estimatedLatency: 'fast' | 'medium' | 'slow';
}

// =============================================================================
// Classify
// =============================================================================

const URGENT_PATTERN = /P0|urgent|ASAP|緊急|馬上/i;
const TASK_WORTHY_PATTERN = /(implement|fix|build|refactor|deploy|create|重構|實作|修復|建立)/i;
const MULTI_STEP_PATTERN = /(step|步驟|then|然後|接著)/i;
const STATE_MUTATION_PATTERN = /(deploy|push|commit|delete|刪除|發布)/i;

export function classifyWork(message: string, source: string): ClassifyResult {
  const isUrgent = source === 'alex' && URGENT_PATTERN.test(message);
  const isTaskWorthy =
    TASK_WORTHY_PATTERN.test(message) ||
    (message.length > 200 && MULTI_STEP_PATTERN.test(message));

  const workClass: WorkClass = isUrgent
    ? 'urgent'
    : isTaskWorthy
      ? 'task-worthy'
      : 'quick-reply';

  return {
    workClass,
    hasStateMutation: STATE_MUTATION_PATTERN.test(message),
    estimatedLatency: workClass === 'task-worthy' ? 'slow' : 'fast',
  };
}

// =============================================================================
// RuntimeEscalation
// =============================================================================

export class RuntimeEscalation {
  private startTime = Date.now();
  private mutationDetected = false;
  private stepCount = 0;
  private promoted = false;
  private taskId: string | null = null;

  readonly ELAPSED_THRESHOLD = 30_000; // 30s
  readonly STEP_SAFETY_NET = 10;

  private static MUTATION_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
  private static MUTATION_BASH_PATTERNS = [
    /\bgit\s+(commit|push|reset|checkout)/,
    /\brm\s/,
    /\bmv\s/,
    /\bcp\s/,
  ];

  onToolCall(toolName: string, command?: string): void {
    this.stepCount++;
    if (RuntimeEscalation.MUTATION_TOOLS.has(toolName)) {
      this.mutationDetected = true;
    }
    if (toolName === 'Bash' && command) {
      const matched = RuntimeEscalation.MUTATION_BASH_PATTERNS.some((p) => p.test(command));
      if (matched) this.mutationDetected = true;
    }
  }

  shouldPromote(): boolean {
    if (this.promoted) return false;
    const elapsed = Date.now() - this.startTime;
    return (
      elapsed > this.ELAPSED_THRESHOLD ||
      this.mutationDetected ||
      this.stepCount > this.STEP_SAFETY_NET
    );
  }

  async promote(source: string, text: string, memoryDir: string): Promise<string> {
    const entry = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'in_progress',
      source: 'room-promoted',
      summary: text.slice(0, 200),
      tags: [source],
    });

    registerProcess({
      id: entry.id,
      summary: entry.summary ?? text.slice(0, 200),
      status: entry.status,
      priority: 50,
      source: source as 'alex' | 'kuro' | 'system' | 'discovery',
      createdAt: entry.ts,
      ticksSpent: 0,
      deadline: null,
      dependsOn: [],
    });

    this.promoted = true;
    this.taskId = entry.id;

    const metrics = this.getMetrics();
    slog(
      'WORK-ROUTER',
      `promoted → task ${entry.id} | reason=${metrics.reason} elapsed=${metrics.elapsed}ms steps=${metrics.stepCount} mutation=${metrics.hadMutation}`,
    );

    return entry.id;
  }

  getMetrics(): { reason: string; elapsed: number; stepCount: number; hadMutation: boolean } {
    const elapsed = Date.now() - this.startTime;
    let reason = 'unknown';
    if (elapsed > this.ELAPSED_THRESHOLD) reason = 'elapsed';
    else if (this.mutationDetected) reason = 'mutation';
    else if (this.stepCount > this.STEP_SAFETY_NET) reason = 'step-safety-net';
    return { reason, elapsed, stepCount: this.stepCount, hadMutation: this.mutationDetected };
  }

  reset(): void {
    this.startTime = Date.now();
    this.mutationDetected = false;
    this.stepCount = 0;
    this.promoted = false;
    this.taskId = null;
  }
}
