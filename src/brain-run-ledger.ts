/**
 * Brain Run Ledger — append-only observable state for multi-brain work.
 *
 * This records public execution state and rationale, not private model chain of
 * thought. File = truth so API, CLI, scheduler, and Kuro loop can share it.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ActorId, ActorSelectionTrace, ArbitrationMode, DecisionBudget, WorkIntent } from './brain-types.js';
import type { BrainActorRun } from './brain-runtime.js';

const BRAIN_RUN_LEDGER_FILE = 'brain-runs.jsonl';

export type BrainRunEventKind =
  | 'runtime_started'
  | 'actor_queued'
  | 'actor_started'
  | 'context_injected'
  | 'actor_finished'
  | 'claim_written'
  | 'runtime_finished';

export type BrainRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped';

export interface BrainRunEvent {
  id: string;
  taskId: string;
  event: BrainRunEventKind;
  status: BrainRunStatus;
  createdAt: string;
  intent?: WorkIntent;
  actor?: ActorId;
  role?: BrainActorRun['role'];
  mode?: ArbitrationMode;
  primary?: ActorId | null;
  rationale?: string;
  decisionBudget?: DecisionBudget;
  detail?: string;
  durationMs?: number;
  claimIds?: string[];
  contextSources?: string[];
  contextPreview?: string[];
  selectionTrace?: ActorSelectionTrace;
}

export interface BrainRunQuery {
  taskId?: string;
  actor?: ActorId | ActorId[];
  event?: BrainRunEventKind | BrainRunEventKind[];
  status?: BrainRunStatus | BrainRunStatus[];
  limit?: number;
}

export interface BrainRunState {
  key: string;
  taskId: string;
  status: BrainRunStatus;
  lastEvent: BrainRunEventKind;
  updatedAt: string;
  intent?: WorkIntent;
  actor?: ActorId;
  role?: BrainRunEvent['role'];
  mode?: ArbitrationMode;
  primary?: ActorId | null;
  rationale?: string;
  decisionBudget?: DecisionBudget;
  detail?: string;
  durationMs?: number;
  claimIds?: string[];
  contextSources?: string[];
  contextPreview?: string[];
  selectionTrace?: ActorSelectionTrace;
}

export function getBrainRunLedgerPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', BRAIN_RUN_LEDGER_FILE);
}

export function appendBrainRunEvent(
  memoryDir: string,
  event: Omit<BrainRunEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): BrainRunEvent {
  const record: BrainRunEvent = {
    id: event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: event.createdAt ?? new Date().toISOString(),
    ...event,
  };
  appendFileSync(ensureBrainRunLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
  return record;
}

export function readBrainRunEventsSync(memoryDir: string, query: BrainRunQuery = {}): BrainRunEvent[] {
  const filePath = ensureBrainRunLedger(memoryDir);
  let events = readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseBrainRunEvent)
    .filter((event): event is BrainRunEvent => event !== null);

  const actors = asList(query.actor);
  const kinds = asList(query.event);
  const statuses = asList(query.status);

  if (query.taskId) events = events.filter(event => event.taskId === query.taskId);
  if (actors.length > 0) events = events.filter(event => event.actor !== undefined && actors.includes(event.actor));
  if (kinds.length > 0) events = events.filter(event => kinds.includes(event.event));
  if (statuses.length > 0) events = events.filter(event => statuses.includes(event.status));

  events.sort(compareBrainRunEventsDesc);
  if (query.limit !== undefined) events = events.slice(0, query.limit);
  return events;
}

export function readBrainRunStatesSync(memoryDir: string, query: BrainRunQuery = {}): BrainRunState[] {
  const events = readBrainRunEventsSync(memoryDir, {
    ...query,
    status: undefined,
    limit: undefined,
  });
  const latest = new Map<string, BrainRunState>();

  for (const event of events) {
    const key = `${event.taskId}:${event.actor ?? 'runtime'}`;
    if (latest.has(key)) continue;
    latest.set(key, {
      key,
      taskId: event.taskId,
      status: event.status,
      lastEvent: event.event,
      updatedAt: event.createdAt,
      ...(event.intent ? { intent: event.intent } : {}),
      ...(event.actor ? { actor: event.actor } : {}),
      ...(event.role ? { role: event.role } : {}),
      ...(event.mode ? { mode: event.mode } : {}),
      ...(event.primary !== undefined ? { primary: event.primary } : {}),
      ...(event.rationale ? { rationale: event.rationale } : {}),
      ...(event.decisionBudget ? { decisionBudget: event.decisionBudget } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(event.claimIds ? { claimIds: event.claimIds } : {}),
      ...(event.contextSources ? { contextSources: event.contextSources } : {}),
      ...(event.contextPreview ? { contextPreview: event.contextPreview } : {}),
      ...(event.selectionTrace ? { selectionTrace: event.selectionTrace } : {}),
    });
  }

  let states = [...latest.values()];
  const statuses = asList(query.status);
  if (statuses.length > 0) states = states.filter(state => statuses.includes(state.status));
  states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (query.limit !== undefined) states = states.slice(0, query.limit);
  return states;
}

function compareBrainRunEventsDesc(a: BrainRunEvent, b: BrainRunEvent): number {
  const time = b.createdAt.localeCompare(a.createdAt);
  if (time !== 0) return time;
  return brainRunEventRank(b.event, b.status) - brainRunEventRank(a.event, a.status);
}

function brainRunEventRank(event: BrainRunEventKind, status: BrainRunStatus): number {
  if (event === 'runtime_finished') return 70;
  if (event === 'claim_written') return 65;
  if (event === 'actor_finished') return 60;
  if (event === 'context_injected') return 45;
  if (event === 'actor_started') return 40;
  if (event === 'actor_queued') return 30;
  if (event === 'runtime_started') return status === 'skipped' ? 55 : 20;
  return 0;
}

function ensureBrainRunLedger(memoryDir: string): string {
  const filePath = getBrainRunLedgerPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function parseBrainRunEvent(line: string): BrainRunEvent | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const id = stringField(raw.id);
    const taskId = stringField(raw.taskId);
    const event = stringField(raw.event) as BrainRunEventKind | '';
    const status = stringField(raw.status) as BrainRunStatus | '';
    const createdAt = stringField(raw.createdAt);
    if (!id || !taskId || !isBrainRunEventKind(event) || !isBrainRunStatus(status) || !createdAt) return null;

    return {
      id,
      taskId,
      event,
      status,
      createdAt,
      ...(isWorkIntent(raw.intent) ? { intent: raw.intent } : {}),
      ...(isActorId(raw.actor) ? { actor: raw.actor } : {}),
      ...(isRunRole(raw.role) ? { role: raw.role } : {}),
      ...(isArbitrationMode(raw.mode) ? { mode: raw.mode } : {}),
      ...(isActorId(raw.primary) || raw.primary === null ? { primary: raw.primary } : {}),
      ...(typeof raw.rationale === 'string' ? { rationale: raw.rationale } : {}),
      ...(isDecisionBudget(raw.decisionBudget) ? { decisionBudget: raw.decisionBudget } : {}),
      ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
      ...(typeof raw.durationMs === 'number' ? { durationMs: raw.durationMs } : {}),
      ...(Array.isArray(raw.claimIds) ? { claimIds: raw.claimIds.filter((id): id is string => typeof id === 'string') } : {}),
      ...(Array.isArray(raw.contextSources) ? { contextSources: raw.contextSources.filter((source): source is string => typeof source === 'string') } : {}),
      ...(Array.isArray(raw.contextPreview) ? { contextPreview: raw.contextPreview.filter((line): line is string => typeof line === 'string') } : {}),
      ...(isSelectionTrace(raw.selectionTrace) ? { selectionTrace: raw.selectionTrace } : {}),
    };
  } catch {
    return null;
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isBrainRunEventKind(value: string): value is BrainRunEventKind {
  return ['runtime_started', 'actor_queued', 'actor_started', 'context_injected', 'actor_finished', 'claim_written', 'runtime_finished'].includes(value);
}

function isBrainRunStatus(value: string): value is BrainRunStatus {
  return ['queued', 'running', 'success', 'partial', 'failed', 'skipped'].includes(value);
}

function isActorId(value: unknown): value is ActorId {
  return typeof value === 'string'
    && ['claude', 'codex', 'local', 'shell', 'akari', 'tanren', 'kuro', 'human'].includes(value);
}

function isWorkIntent(value: unknown): value is WorkIntent {
  return typeof value === 'string'
    && ['chat', 'plan', 'code', 'research', 'summarize', 'json', 'diagnose', 'review', 'verify', 'architecture', 'memory', 'policy'].includes(value);
}

function isRunRole(value: unknown): value is BrainActorRun['role'] {
  return typeof value === 'string'
    && ['primary', 'candidate', 'reviewer', 'coordinator'].includes(value);
}

function isArbitrationMode(value: unknown): value is ArbitrationMode {
  return typeof value === 'string'
    && ['solo', 'race', 'panel', 'split', 'consensus', 'human'].includes(value);
}

function isSelectionTrace(value: unknown): value is ActorSelectionTrace {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return Array.isArray(raw.selected) && Array.isArray(raw.considered);
}

function isDecisionBudget(value: unknown): value is DecisionBudget {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (raw.maxActors === 1 || raw.maxActors === 2 || raw.maxActors === 4)
    && typeof raw.requireReviewer === 'boolean'
    && typeof raw.allowPanel === 'boolean'
    && typeof raw.maxCost === 'string'
    && ['low', 'medium', 'high'].includes(raw.maxCost)
    && typeof raw.stopWhen === 'string'
    && ['verified', 'primary_confident', 'no_dissent', 'human_approved'].includes(raw.stopWhen)
    && typeof raw.reason === 'string';
}
