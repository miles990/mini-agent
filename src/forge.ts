/**
 * Forge — worktree slot management (§Q2: stays mini-agent-side)
 *
 * Extracted from delegation.ts to keep delegation focused on dispatch logic.
 * Forge allocates isolated git worktrees for code workers so they can write
 * without conflicting with the main working tree or each other.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import type { DelegationTaskType } from './types.js';

export interface ForgeSlotStatus {
  total: number;
  busy: number;
  free: number;
  source: 'plugin' | 'bundled';
}

// Task types that don't need dependency installation (pure docs/review work)
const NO_INSTALL_TYPES: Set<DelegationTaskType> = new Set(['create', 'review', 'learn', 'research', 'plan', 'debug']);

const FORGE_LITE_BUNDLED = new URL('../scripts/forge-lite.sh', import.meta.url).pathname;
const FORGE_LITE_PLUGIN = path.join(
  process.env.HOME ?? '', '.claude/plugins/marketplaces/forge/scripts/forge-lite.sh'
);
const FORGE_LITE = fs.existsSync(FORGE_LITE_PLUGIN) ? FORGE_LITE_PLUGIN : FORGE_LITE_BUNDLED;

function forgeExec(cmd: string, workdir: string, timeoutMs = 15_000): string {
  return execSync(`bash "${FORGE_LITE}" ${cmd}`, {
    cwd: workdir, encoding: 'utf-8', timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function forgeCreate(taskId: string, workdir: string, taskType?: DelegationTaskType): string | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const noInstall = taskType && NO_INSTALL_TYPES.has(taskType) ? ' --no-install' : '';
    const output = forgeExec(`create "${taskId}" --caller-pid ${process.pid}${noInstall}`, workdir);
    return output.split('\n').pop()!.trim();
  } catch (e) {
    slog('FORGE', `forgeCreate failed for ${taskId}: ${(e as Error).message?.split('\n')[0] ?? e}`);
    return null;
  }
}

export function forgeYolo(worktreePath: string, mainDir: string, message: string): boolean {
  try {
    forgeExec(`yolo "${worktreePath}" "${message}"`, mainDir, 120_000);
    return true;
  } catch {
    return false;
  }
}

/** @DANGEROUS _reason: deletes the worktree — only call after yolo failed or task aborted */
export function forgeCleanup(worktreePath: string, mainDir: string): void {
  try { forgeExec(`cleanup "${worktreePath}"`, mainDir); } catch { /* best effort */ }
}

export function forgeRecover(workdir: string): void {
  try {
    if (!fs.existsSync(FORGE_LITE)) return;
    const output = forgeExec('recover', workdir, 30_000);
    if (output) slog('FORGE', output);
  } catch { /* best effort */ }
}

// 3-second cache. /status is polled once per second by kuro-live.sh and the
// dashboard — without this cache every poll sync-spawned bash forge-lite.sh
// (cold shell launch ~200-500ms). That spawn rate kept the main thread
// blocked enough to make HTTP /health and /status timeout under load.
// 2026-04-17 D21: one spawn every 3s is fine; users get near-real-time
// slot info without the main thread getting hammered.
let cachedForgeStatus: { ts: number; workdir: string; status: ForgeSlotStatus | null } | null = null;
const FORGE_STATUS_TTL_MS = 3_000;

export function forgeStatus(workdir: string): ForgeSlotStatus | null {
  const now = Date.now();
  if (cachedForgeStatus && cachedForgeStatus.workdir === workdir && now - cachedForgeStatus.ts < FORGE_STATUS_TTL_MS) {
    return cachedForgeStatus.status;
  }
  try {
    if (!fs.existsSync(FORGE_LITE)) {
      cachedForgeStatus = { ts: now, workdir, status: null };
      return null;
    }
    const output = forgeExec('status', workdir);
    const lastLine = output.split('\n').pop() ?? '';
    const total = parseInt(lastLine.match(/total=(\d+)/)?.[1] ?? '0');
    const busy = parseInt(lastLine.match(/busy=(\d+)/)?.[1] ?? '0');
    const free = parseInt(lastLine.match(/free=(\d+)/)?.[1] ?? '0');
    const status = {
      total, busy, free,
      source: FORGE_LITE === FORGE_LITE_PLUGIN ? 'plugin' as const : 'bundled' as const,
    };
    cachedForgeStatus = { ts: now, workdir, status };
    return status;
  } catch {
    cachedForgeStatus = { ts: now, workdir, status: null };
    return null;
  }
}
