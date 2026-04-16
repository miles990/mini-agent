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

export function forgeStatus(workdir: string): ForgeSlotStatus | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const output = forgeExec('status', workdir);
    const lastLine = output.split('\n').pop() ?? '';
    const total = parseInt(lastLine.match(/total=(\d+)/)?.[1] ?? '0');
    const busy = parseInt(lastLine.match(/busy=(\d+)/)?.[1] ?? '0');
    const free = parseInt(lastLine.match(/free=(\d+)/)?.[1] ?? '0');
    return {
      total, busy, free,
      source: FORGE_LITE === FORGE_LITE_PLUGIN ? 'plugin' : 'bundled',
    };
  } catch {
    return null;
  }
}
