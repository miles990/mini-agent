import fs from 'node:fs';
import path from 'node:path';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned';

export interface VerifyResult {
  name: string;
  status: 'pass' | 'fail' | 'unknown';
  detail?: string;
  updatedAt: string;
}

interface BaseTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  verify: VerifyResult[];
  staleWarning?: string;
}

export interface TaskItem extends BaseTaskItem {
  type: 'task';
}

export interface GoalItem extends BaseTaskItem {
  type: 'goal';
  origin?: string;
  priority?: number;
}

export type QueueItem = TaskItem | GoalItem;
type TaskQueueState = QueueItem[];
export interface TaskPatch {
  type?: 'task' | 'goal';
  title?: string;
  status?: TaskStatus;
  verify?: VerifyResult[];
  staleWarning?: string;
  origin?: string;
  priority?: number;
}

const STALE_MS = 24 * 60 * 60 * 1000;

function getStatePath(): string {
  const dir = path.join(process.cwd(), 'memory', 'state');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'task-queue.json');
}

function normalizeTask(item: QueueItem): QueueItem {
  return {
    ...item,
    verify: Array.isArray(item.verify) ? item.verify : [],
  };
}

export function loadTaskQueue(): TaskQueueState {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as TaskQueueState;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTask);
  } catch {
    return [];
  }
}

export function saveTaskQueue(items: TaskQueueState): void {
  fs.writeFileSync(getStatePath(), JSON.stringify(items, null, 2), 'utf-8');
}

export function createTask(
  input: {
    type?: 'task' | 'goal';
    title: string;
    status?: TaskStatus;
    verify?: VerifyResult[];
    origin?: string;
    priority?: number;
  },
): QueueItem {
  const now = new Date().toISOString();
  const items = loadTaskQueue();
  const base: BaseTaskItem = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim(),
    status: input.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
    verify: input.verify ?? [],
  };

  const item: QueueItem = (input.type ?? 'task') === 'goal'
    ? { ...base, type: 'goal', origin: input.origin, priority: input.priority }
    : { ...base, type: 'task' };

  items.push(item);
  saveTaskQueue(items);
  return item;
}

export function readTask(id: string): QueueItem | null {
  return loadTaskQueue().find(item => item.id === id) ?? null;
}

export function updateTask(
  id: string,
  patch: TaskPatch,
): QueueItem | null {
  const items = loadTaskQueue();
  const idx = items.findIndex(item => item.id === id);
  if (idx < 0) return null;

  const current = items[idx];
  const nextType = patch.type ?? current.type;
  const updatedBase = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    verify: patch.verify ?? current.verify,
  };
  const updated: QueueItem = nextType === 'goal'
    ? {
      ...updatedBase,
      type: 'goal',
      origin: patch.origin ?? (current.type === 'goal' ? current.origin : undefined),
      priority: patch.priority ?? (current.type === 'goal' ? current.priority : undefined),
    }
    : {
      ...updatedBase,
      type: 'task',
    };
  items[idx] = updated;
  saveTaskQueue(items);
  return updated;
}

export function deleteTask(id: string): boolean {
  const items = loadTaskQueue();
  const next = items.filter(item => item.id !== id);
  if (next.length === items.length) return false;
  saveTaskQueue(next);
  return true;
}

export function markStaleInProgressTasks(nowMs = Date.now()): QueueItem[] {
  const items = loadTaskQueue();
  let changed = false;

  const next = items.map(item => {
    if (item.status !== 'in_progress') {
      if (item.staleWarning) {
        changed = true;
        return { ...item, staleWarning: undefined };
      }
      return item;
    }

    const age = nowMs - new Date(item.updatedAt).getTime();
    if (age > STALE_MS) {
      const warning = `stale: in_progress but no update for ${Math.floor(age / 3600000)}h`;
      if (item.staleWarning !== warning) {
        changed = true;
        return { ...item, staleWarning: warning };
      }
      return item;
    }

    if (item.staleWarning) {
      changed = true;
      return { ...item, staleWarning: undefined };
    }

    return item;
  });

  if (changed) saveTaskQueue(next);
  return next.filter(item => item.status === 'in_progress' && !!item.staleWarning);
}

function formatVerifyResult(item: QueueItem): string {
  if (item.verify.length === 0) return 'verify: (none)';
  const latest = item.verify.slice(-3).map(v => `${v.name}:${v.status}`).join(', ');
  return `verify: ${latest}`;
}

export function buildTaskQueueSection(): string {
  markStaleInProgressTasks();
  const items = loadTaskQueue()
    .filter(item => item.status === 'pending' || item.status === 'in_progress')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });

  if (items.length === 0) return '';

  const lines = items.map(item => {
    const stale = item.staleWarning ? ` | ⚠ ${item.staleWarning}` : '';
    return `- [${item.status}] (${item.type}) ${item.title} | ${formatVerifyResult(item)}${stale}`;
  });

  return [
    '<task-queue>',
    'Unified queue (pending + in_progress):',
    ...lines,
    '</task-queue>',
  ].join('\n');
}
