/**
 * Output Gate — deterministic output production mechanism.
 *
 * Ensures at least one qualifying external-facing output before
 * internal-only work continues. Persists state across restarts.
 *
 * Priority: gate > scheduler > nudge (attention-balance).
 * Design: KG discussion 33ecd549 consensus (CC + Akari).
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { queryMemoryIndexSync, createTask } from './memory-index.js';
import { logMechanism, rotateMechanismLog } from './mechanism-log.js';

// =============================================================================
// Config
// =============================================================================

const IDLE_THRESHOLD_MS = 48 * 3600_000;
const P1_THRESHOLD_MS = 60 * 3600_000;
const P0_THRESHOLD_MS = 72 * 3600_000;
const GRACE_PERIOD_CYCLES = 10;
const EMERGENCY_TASK_MAX = 1;
const DEGRADED_MODE_FAILURES = 2;

const INTERNAL_PATTERN = /heartbeat|scheduler|dispatcher|memory-index|perception-cache|retry-lane|falsifier|cycle-tasks|omlx-gate|attention-balance|architecture-validation|cron|behavior|loop|heartbeat-md|agent-middleware|commitment-ledger|process-table/i;

const SCAN_DIRS = ['topics', 'drafts', 'reports'];
const SCAN_DIRS_WITH_SCRIPTS = [...SCAN_DIRS, '../scripts'];
const MIN_SIZE: Record<string, number> = { topics: 500, drafts: 1000, reports: 500, '../scripts': 200 };

// =============================================================================
// State (persisted)
// =============================================================================

interface OutputGateState {
  lastQualifyingOutputTs: string;
  lastQualifyingOutputFile: string | null;
  gateActiveTs: string | null;
  emergencyTaskCount: number;
  emergencyTaskFailures: number;
  degradedMode: boolean;
  cyclesSinceStart: number;
}

const STATE_FILE = 'output-gate.json';
const EMERGENCY_TASK_MARKER = '[output-gate] produce external-facing output';

let state: OutputGateState = {
  lastQualifyingOutputTs: new Date().toISOString(),
  lastQualifyingOutputFile: null,
  gateActiveTs: null,
  emergencyTaskCount: 0,
  emergencyTaskFailures: 0,
  degradedMode: false,
  cyclesSinceStart: 0,
};

function getStatePath(memoryDir: string): string {
  const stateDir = path.join(memoryDir, 'state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, STATE_FILE);
}

export function loadOutputGateState(memoryDir: string): void {
  try {
    const p = getStatePath(memoryDir);
    if (fs.existsSync(p)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
    }
  } catch { /* use defaults */ }
}

function persistState(memoryDir: string): void {
  try {
    fs.writeFileSync(getStatePath(memoryDir), JSON.stringify(state, null, 2));
  } catch { /* non-critical */ }
}

// =============================================================================
// Qualifying Output Detection
// =============================================================================

function scanForQualifyingOutput(memoryDir: string): string | null {
  const lastTs = new Date(state.lastQualifyingOutputTs).getTime();
  const baseDir = path.dirname(memoryDir);

  for (const rel of SCAN_DIRS_WITH_SCRIPTS) {
    const dir = rel.startsWith('..') ? path.join(baseDir, rel.slice(3)) : path.join(memoryDir, rel);
    if (!fs.existsSync(dir)) continue;
    const minSize = MIN_SIZE[rel] ?? 500;
    try {
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith('.')) continue;
        if (INTERNAL_PATTERN.test(file)) continue;
        const fp = path.join(dir, file);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs <= lastTs) continue;
        if (stat.size < minSize) continue;
        if (!stat.isFile()) continue;
        return `${rel}/${file}`;
      }
    } catch { /* skip */ }
  }
  return null;
}

// =============================================================================
// Gate Logic
// =============================================================================

export type GateSeverity = 'inactive' | 'nudge' | 'p1_task' | 'p0_task' | 'degraded';

export interface GateCheck {
  severity: GateSeverity;
  idleHours: number;
  prompt: string | null;
  taskCreated: boolean;
}

function hasExistingEmergencyTask(memoryDir: string): boolean {
  const tasks = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  return tasks.some(t => (t.summary ?? '').includes(EMERGENCY_TASK_MARKER));
}

export function checkOutputGate(memoryDir: string): GateCheck {
  state.cyclesSinceStart++;
  rotateMechanismLog(memoryDir);

  if (state.cyclesSinceStart <= GRACE_PERIOD_CYCLES) {
    return { severity: 'inactive', idleHours: 0, prompt: null, taskCreated: false };
  }

  const newOutput = scanForQualifyingOutput(memoryDir);
  if (newOutput) {
    recordQualifyingOutput(memoryDir, newOutput);
    return { severity: 'inactive', idleHours: 0, prompt: null, taskCreated: false };
  }

  const idleMs = Date.now() - new Date(state.lastQualifyingOutputTs).getTime();
  const idleHours = Math.round(idleMs / 3600_000);

  if (state.degradedMode) {
    logMechanism(memoryDir, { mechanism: 'output-gate', action: 'degraded-active', reason: `idle ${idleHours}h` });
    return {
      severity: 'degraded', idleHours,
      prompt: `\n<output-gate severity="degraded">\n⚠️ Output gate degraded mode (${idleHours}h idle). 任何有實質內容的檔案寫入都算 qualifying output。\n</output-gate>\n`,
      taskCreated: false,
    };
  }

  if (idleMs < IDLE_THRESHOLD_MS) {
    return { severity: 'inactive', idleHours, prompt: null, taskCreated: false };
  }

  let severity: GateSeverity = 'nudge';
  if (idleMs >= P0_THRESHOLD_MS) severity = 'p0_task';
  else if (idleMs >= P1_THRESHOLD_MS) severity = 'p1_task';

  if (!state.gateActiveTs) state.gateActiveTs = new Date().toISOString();

  logMechanism(memoryDir, {
    mechanism: 'output-gate', action: `gate-${severity}`,
    reason: `${idleHours}h since last qualifying output`,
    data: { lastOutput: state.lastQualifyingOutputFile },
  });

  let taskCreated = false;
  if ((severity === 'p1_task' || severity === 'p0_task') && !hasExistingEmergencyTask(memoryDir)) {
    if (state.emergencyTaskCount < EMERGENCY_TASK_MAX) {
      const priority = severity === 'p0_task' ? 0 : 1;
      createTask(memoryDir, {
        title: EMERGENCY_TASK_MARKER,
        priority, origin: 'scheduler', status: 'pending',
      }).catch(() => {
        state.emergencyTaskFailures++;
        if (state.emergencyTaskFailures >= DEGRADED_MODE_FAILURES) {
          state.degradedMode = true;
          slog('GATE', 'entering degraded mode');
        }
      });
      state.emergencyTaskCount++;
      taskCreated = true;
      slog('GATE', `emergency P${priority} task created (idle ${idleHours}h)`);
    }
  }

  persistState(memoryDir);

  const prompt = severity === 'nudge'
    ? `\n<output-gate severity="nudge">\n📊 已 ${idleHours}h 沒有 external-facing 產出。下個 cycle 考慮做一件外部可見的事：學習 topic、迭代草稿、或完成 pipeline task。\n</output-gate>\n`
    : severity === 'p1_task'
    ? `\n<output-gate severity="p1">\n⚠️ 已 ${idleHours}h 沒有 external-facing 產出。P1 task 已建立。優先完成一個 external-facing artifact。\n</output-gate>\n`
    : `\n<output-gate severity="p0">\n🔴 已 ${idleHours}h 沒有 external-facing 產出。P0 task 已建立。立即做一個 external-facing 的事。Internal debugging 暫停。\n</output-gate>\n`;

  return { severity, idleHours, prompt, taskCreated };
}

// =============================================================================
// Record Output
// =============================================================================

export function recordQualifyingOutput(memoryDir: string, file: string): void {
  const wasActive = state.gateActiveTs !== null;
  state.lastQualifyingOutputTs = new Date().toISOString();
  state.lastQualifyingOutputFile = file;
  state.gateActiveTs = null;
  state.emergencyTaskCount = 0;
  state.emergencyTaskFailures = 0;
  state.degradedMode = false;
  persistState(memoryDir);

  logMechanism(memoryDir, {
    mechanism: 'output-gate', action: 'output-recorded',
    reason: `qualifying output: ${file}`, data: { wasGateActive: wasActive },
  });

  if (wasActive) {
    slog('GATE', `gate cleared by output: ${file}`);
    eventBus.emit('action:task', { event: 'output-gate-cleared', file });
  }
}

// =============================================================================
// Public API
// =============================================================================

export function getOutputGateStatus(): { severity: GateSeverity; idleHours: number; lastOutput: string | null; degraded: boolean } {
  const idleMs = Date.now() - new Date(state.lastQualifyingOutputTs).getTime();
  const idleHours = Math.round(idleMs / 3600_000);
  let severity: GateSeverity = 'inactive';
  if (state.degradedMode) severity = 'degraded';
  else if (idleMs >= P0_THRESHOLD_MS) severity = 'p0_task';
  else if (idleMs >= P1_THRESHOLD_MS) severity = 'p1_task';
  else if (idleMs >= IDLE_THRESHOLD_MS) severity = 'nudge';
  return { severity, idleHours, lastOutput: state.lastQualifyingOutputFile, degraded: state.degradedMode };
}
