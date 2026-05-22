import fs from 'node:fs';
import path from 'node:path';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { slog } from './utils.js';

export type WorkModeName = 'maintenance' | 'creative';

export interface WorkModeReport {
  mode: WorkModeName;
  baseMode: WorkModeName;
  description: string;
  temporary: boolean;
  temporaryReason: string | null;
  switchedAt: string | null;
  updatedAt: string;
}

interface WorkModeState {
  baseMode: WorkModeName;
  activeMode: WorkModeName;
  temporaryReason?: string | null;
  switchedAt?: string | null;
  updatedAt: string;
}

export interface WorkModeContext {
  hasP0Event?: boolean;
  hasP0Tasks?: boolean;
}

const DEFAULT_WORK_MODE: WorkModeName = 'maintenance';

const DESCRIPTIONS: Record<WorkModeName, string> = {
  maintenance: 'Repair and operations mode: fix bugs, close urgent work, deploy, and keep runtime healthy. Free creation is disabled.',
  creative: 'Free creation mode: explore, make, and publish creative work. Maintenance backlog is disabled except live P0/direct safety work.',
};

export function getWorkModeNames(): WorkModeName[] {
  return ['maintenance', 'creative'];
}

export function isValidWorkMode(value: unknown): value is WorkModeName {
  return value === 'maintenance' || value === 'creative';
}

function getWorkModeStatePath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'work-mode.json');
}

function readState(): WorkModeState {
  try {
    const raw = JSON.parse(fs.readFileSync(getWorkModeStatePath(), 'utf-8')) as Partial<WorkModeState>;
    const baseMode = isValidWorkMode(raw.baseMode) ? raw.baseMode : DEFAULT_WORK_MODE;
    const activeMode = isValidWorkMode(raw.activeMode) ? raw.activeMode : baseMode;
    return {
      baseMode,
      activeMode,
      temporaryReason: typeof raw.temporaryReason === 'string' ? raw.temporaryReason : null,
      switchedAt: typeof raw.switchedAt === 'string' ? raw.switchedAt : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    const now = new Date().toISOString();
    const state: WorkModeState = {
      baseMode: DEFAULT_WORK_MODE,
      activeMode: DEFAULT_WORK_MODE,
      temporaryReason: null,
      switchedAt: now,
      updatedAt: now,
    };
    try { writeState(state); } catch { /* status endpoints must stay readable */ }
    return state;
  }
}

function writeState(state: WorkModeState): void {
  const file = getWorkModeStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function toReport(state: WorkModeState): WorkModeReport {
  return {
    mode: state.activeMode,
    baseMode: state.baseMode,
    description: DESCRIPTIONS[state.activeMode],
    temporary: state.activeMode !== state.baseMode,
    temporaryReason: state.temporaryReason ?? null,
    switchedAt: state.switchedAt ?? null,
    updatedAt: state.updatedAt,
  };
}

export function getWorkMode(): WorkModeReport {
  return toReport(readState());
}

export function setWorkMode(mode: WorkModeName): WorkModeReport {
  const now = new Date().toISOString();
  const state: WorkModeState = {
    baseMode: mode,
    activeMode: mode,
    temporaryReason: null,
    switchedAt: now,
    updatedAt: now,
  };
  writeState(state);
  slog('WORK-MODE', `Switched to ${mode}`);
  return toReport(state);
}

export function resolveWorkMode(context: WorkModeContext = {}): WorkModeReport {
  const state = readState();
  const needsMaintenance = Boolean(context.hasP0Event || context.hasP0Tasks);
  const reason = context.hasP0Event
    ? 'live P0/direct event'
    : context.hasP0Tasks
      ? 'pending P0 maintenance task'
      : null;

  if (state.baseMode === 'creative' && needsMaintenance && state.activeMode !== 'maintenance') {
    const now = new Date().toISOString();
    const next: WorkModeState = {
      ...state,
      activeMode: 'maintenance',
      temporaryReason: reason,
      switchedAt: now,
      updatedAt: now,
    };
    writeState(next);
    slog('WORK-MODE', `Auto-switched creative -> maintenance (${reason})`);
    return toReport(next);
  }

  if (state.baseMode === 'creative' && !needsMaintenance && state.activeMode !== 'creative') {
    const now = new Date().toISOString();
    const next: WorkModeState = {
      ...state,
      activeMode: 'creative',
      temporaryReason: null,
      switchedAt: now,
      updatedAt: now,
    };
    writeState(next);
    slog('WORK-MODE', 'Auto-switched maintenance -> creative (urgent work cleared)');
    return toReport(next);
  }

  return toReport(state);
}

export function getWorkModePrompt(report: WorkModeReport = getWorkMode()): string {
  if (report.mode === 'creative') {
    return [
      '<work-mode mode="creative" exclusive="true">',
      'Current mode: creative. Work only on free creation: explore, make, publish, and refine creative output.',
      'Do not drain maintenance backlog, debug runtime, or review operations tasks unless a live P0/direct safety signal appears.',
      '</work-mode>',
    ].join('\n');
  }

  const temporary = report.temporary && report.baseMode === 'creative'
    ? ` Temporary override from creative mode: ${report.temporaryReason ?? 'urgent maintenance'}. Return to creative when urgent work is cleared.`
    : '';
  return [
    '<work-mode mode="maintenance" exclusive="true">',
    `Current mode: maintenance. Work only on repair, health, deploy, closure, and user-directed operational work.${temporary}`,
    'Do not start free creative exploration or generative-art making in this mode.',
    '</work-mode>',
  ].join('\n');
}
