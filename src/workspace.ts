/**
 * Workspace Observer
 *
 * 提供 Agent 對工作空間的感知能力：
 * - 檔案結構
 * - Git 狀態
 * - 最近修改的檔案
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { diagLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceSnapshot {
  /** 工作目錄路徑 */
  cwd: string;
  /** 重要檔案列表（排除 node_modules 等） */
  files: string[];
  /** Git 資訊 */
  git: {
    branch: string;
    dirty: string[];    // 有修改的檔案
    untracked: string[];
  } | null;
  /** 最近修改的檔案（最多 5 個） */
  recentlyModified: Array<{ file: string; mtime: string }>;
}

/** Agent 自身狀態（外部注入，避免循環依賴） */
export interface AgentSelfStatus {
  /** Agent 名稱 */
  name: string;
  /** 角色 */
  role: string;
  /** Port */
  port: number;
  /** Persona 描述 */
  persona?: string;
  /** Server 啟動時間 */
  startedAt: string;
  /** AgentLoop 狀態 */
  loop: {
    running: boolean;
    paused: boolean;
    cycleCount: number;
    lastAction: string | null;
    nextCycleAt: string | null;
  } | null;
  /** 活躍 Cron 任務 */
  cronTasks: Array<{ schedule: string; task: string }>;
  /** 今日統計 */
  stats?: {
    chatCount: number;
    errorCount: number;
  };
}

// =============================================================================
// Constants
// =============================================================================

/** 排除的目錄 */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.DS_Store', '.cache',
  'coverage', '.turbo', '.next', '.nuxt',
]);

/** 最大檔案列表深度 */
const MAX_DEPTH = 2;

/** 最大檔案數量 */
const MAX_FILES = 30;

// =============================================================================
// Implementation
// =============================================================================

/**
 * 列出目錄中的重要檔案（排除 node_modules 等）
 */
function listFiles(dir: string, depth = 0, prefix = ''): string[] {
  if (depth > MAX_DEPTH) return [];

  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && depth === 0 && entry.name !== '.env') continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(`${relativePath}/`);
      if (results.length < MAX_FILES) {
        results.push(...listFiles(path.join(dir, entry.name), depth + 1, relativePath));
      }
    } else {
      results.push(relativePath);
    }

    if (results.length >= MAX_FILES) break;
  }

  return results;
}

/**
 * 取得 Git 狀態
 */
function getGitStatus(cwd: string): WorkspaceSnapshot['git'] {
  try {
    // 檢查是否為 git repo
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    });

    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();

    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();

    const dirty: string[] = [];
    const untracked: string[] = [];

    if (status) {
      for (const line of status.split('\n')) {
        const code = line.slice(0, 2);
        const file = line.slice(3);
        if (code === '??') {
          untracked.push(file);
        } else {
          dirty.push(file);
        }
      }
    }

    return { branch, dirty, untracked };
  } catch (error) {
    diagLog('workspace.getGitStatus', error, { cwd });
    return null;
  }
}

/**
 * 取得最近修改的檔案
 */
function getRecentlyModified(dir: string, limit = 5): Array<{ file: string; mtime: string }> {
  const allFiles: Array<{ file: string; mtime: Date }> = [];

  function walk(d: string, prefix = ''): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(d, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        try {
          const stat = fs.statSync(fullPath);
          allFiles.push({ file: relativePath, mtime: stat.mtime });
        } catch {
          // skip
        }
      }
    }
  }

  walk(dir);

  return allFiles
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit)
    .map(f => ({
      file: f.file,
      mtime: f.mtime.toISOString().replace('T', ' ').slice(0, 19),
    }));
}

/**
 * 取得 workspace 快照
 */
export function getWorkspaceSnapshot(cwd?: string): WorkspaceSnapshot {
  const dir = cwd || process.cwd();

  return {
    cwd: dir,
    files: listFiles(dir),
    git: getGitStatus(dir),
    recentlyModified: getRecentlyModified(dir),
  };
}

/**
 * 將 workspace 快照格式化為簡潔的 context 文字
 */
export function formatWorkspaceContext(snapshot: WorkspaceSnapshot): string {
  const lines: string[] = [];

  lines.push(`Working directory: ${snapshot.cwd}`);

  // Git
  if (snapshot.git) {
    lines.push(`Git branch: ${snapshot.git.branch}`);
    if (snapshot.git.dirty.length > 0) {
      lines.push(`Modified files: ${snapshot.git.dirty.join(', ')}`);
    }
    if (snapshot.git.untracked.length > 0) {
      lines.push(`Untracked: ${snapshot.git.untracked.join(', ')}`);
    }
  }

  // Recently modified
  if (snapshot.recentlyModified.length > 0) {
    lines.push('Recently modified:');
    for (const f of snapshot.recentlyModified) {
      lines.push(`  ${f.mtime} ${f.file}`);
    }
  }

  // File tree (condensed)
  if (snapshot.files.length > 0) {
    lines.push(`Files (${snapshot.files.length}):`);
    for (const f of snapshot.files) {
      lines.push(`  ${f}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// #2 Process Awareness
// =============================================================================

export interface ProcessStatus {
  /** Server 運行時間（秒） */
  uptimeSeconds: number;
  /** 記憶體使用 */
  memory: { rss: number; heapUsed: number; heapTotal: number };
  /** Node.js 版本 */
  nodeVersion: string;
  /** PID */
  pid: number;
  /** 其他 Agent 實例 */
  otherInstances: Array<{ id: string; name?: string; port: number; running: boolean }>;
  /** 今日日誌統計 */
  logStats: { claude: number; api: number; cron: number; error: number } | null;
}

/**
 * 取得 Process 狀態
 */
export function getProcessStatus(otherInstancesFn?: () => Array<{ id: string; name?: string; port: number; running: boolean }>, logStatsFn?: () => { claude: number; api: number; cron: number; error: number } | null): ProcessStatus {
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    nodeVersion: process.version,
    pid: process.pid,
    otherInstances: otherInstancesFn?.() ?? [],
    logStats: logStatsFn?.() ?? null,
  };
}

/**
 * 格式化 Process 狀態
 */
export function formatProcessStatus(status: ProcessStatus): string {
  const lines: string[] = [];

  const upH = Math.floor(status.uptimeSeconds / 3600);
  const upM = Math.floor((status.uptimeSeconds % 3600) / 60);
  lines.push(`Uptime: ${upH}h ${upM}m | PID: ${status.pid} | Node: ${status.nodeVersion}`);
  lines.push(`Memory: ${status.memory.rss}MB RSS, ${status.memory.heapUsed}/${status.memory.heapTotal}MB heap`);

  if (status.otherInstances.length > 0) {
    lines.push(`Other instances (${status.otherInstances.length}):`);
    for (const inst of status.otherInstances) {
      const name = inst.name ?? inst.id;
      lines.push(`  ${name} :${inst.port} ${inst.running ? '●' : '○'}`);
    }
  }

  if (status.logStats) {
    const s = status.logStats;
    lines.push(`Today's logs: ${s.claude} claude, ${s.api} api, ${s.cron} cron, ${s.error} errors`);
  }

  return lines.join('\n');
}

// =============================================================================
// #3 Log Awareness
// =============================================================================

export interface LogSummary {
  /** 最近的錯誤（最多 5 個） */
  recentErrors: Array<{ time: string; message: string }>;
  /** 最近的事件（最多 10 個） */
  recentEvents: Array<{ time: string; type: string; summary: string }>;
}

/**
 * 取得日誌摘要（透過注入的函數）
 */
export function getLogSummary(
  errorsFn?: () => Array<{ time: string; message: string }>,
  eventsFn?: () => Array<{ time: string; type: string; summary: string }>,
): LogSummary {
  return {
    recentErrors: errorsFn?.() ?? [],
    recentEvents: eventsFn?.() ?? [],
  };
}

/**
 * 格式化日誌摘要
 */
export function formatLogSummary(summary: LogSummary): string {
  const lines: string[] = [];

  if (summary.recentErrors.length > 0) {
    lines.push(`Recent errors (${summary.recentErrors.length}):`);
    for (const e of summary.recentErrors) {
      lines.push(`  [${e.time}] ${e.message.slice(0, 100)}`);
    }
  } else {
    lines.push('No recent errors');
  }

  if (summary.recentEvents.length > 0) {
    lines.push(`Recent events (${summary.recentEvents.length}):`);
    for (const e of summary.recentEvents) {
      lines.push(`  [${e.time}] ${e.type}: ${e.summary.slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// #4 System Resources
// =============================================================================

export interface SystemResources {
  /** CPU 負載（1/5/15 分鐘平均） */
  loadAvg: [number, number, number];
  /** CPU 核心數 */
  cpuCount: number;
  /** 系統記憶體 */
  memoryMB: { total: number; free: number; usedPercent: number };
  /** 磁碟空間（工作目錄所在） */
  diskGB: { total: number; free: number; usedPercent: number } | null;
  /** 系統運行時間（秒） */
  systemUptime: number;
  /** 平台 */
  platform: string;
}

/**
 * 取得系統資源
 */
export function getSystemResources(): SystemResources {
  const loadAvg = os.loadavg() as [number, number, number];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // 磁碟空間
  let disk: SystemResources['diskGB'] = null;
  try {
    const dfOutput = execFileSync('df', ['-k', process.cwd()], {
      encoding: 'utf-8', timeout: 3000,
    }).trim();
    const dfLines = dfOutput.split('\n');
    if (dfLines.length >= 2) {
      const parts = dfLines[1].split(/\s+/);
      const totalKB = parseInt(parts[1]);
      const usedKB = parseInt(parts[2]);
      const freeKB = parseInt(parts[3]);
      if (!isNaN(totalKB) && !isNaN(freeKB)) {
        disk = {
          total: Math.round(totalKB / 1024 / 1024),
          free: Math.round(freeKB / 1024 / 1024),
          usedPercent: Math.round((usedKB / totalKB) * 100),
        };
      }
    }
  } catch {
    // df 不可用
  }

  return {
    loadAvg: [
      Math.round(loadAvg[0] * 100) / 100,
      Math.round(loadAvg[1] * 100) / 100,
      Math.round(loadAvg[2] * 100) / 100,
    ],
    cpuCount: os.cpus().length,
    memoryMB: {
      total: Math.round(totalMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      usedPercent: Math.round((usedMem / totalMem) * 100),
    },
    diskGB: disk,
    systemUptime: Math.floor(os.uptime()),
    platform: `${os.platform()} ${os.arch()} ${os.release()}`,
  };
}

/**
 * 格式化系統資源
 */
export function formatSystemResources(res: SystemResources): string {
  const lines: string[] = [];

  lines.push(`Platform: ${res.platform}`);
  lines.push(`CPU: ${res.cpuCount} cores, load: ${res.loadAvg.join(', ')}`);
  lines.push(`Memory: ${res.memoryMB.usedPercent}% used (${res.memoryMB.free}MB free / ${res.memoryMB.total}MB)`);

  if (res.diskGB) {
    lines.push(`Disk: ${res.diskGB.usedPercent}% used (${res.diskGB.free}GB free / ${res.diskGB.total}GB)`);
  }

  const sysUpH = Math.floor(res.systemUptime / 3600);
  const sysUpD = Math.floor(sysUpH / 24);
  lines.push(`System uptime: ${sysUpD}d ${sysUpH % 24}h`);

  return lines.join('\n');
}

// =============================================================================
// #5 Network Awareness
// =============================================================================

export interface NetworkStatus {
  /** 自身 port 是否開啟 */
  selfPortOpen: boolean;
  /** 其他可達的服務 */
  reachableServices: Array<{ name: string; url: string; ok: boolean; latencyMs?: number }>;
}

/**
 * 檢查 port 是否被佔用（同步）
 */
function checkPortSync(port: number): boolean {
  try {
    execFileSync('lsof', ['-i', `:${port}`, '-P', '-n'], {
      encoding: 'utf-8', timeout: 2000,
    });
    return true;
  } catch (error) {
    // lsof returns exit 1 when port not found — this is expected, don't log
    const exitCode = (error as { status?: number })?.status;
    if (exitCode !== 1) {
      diagLog('workspace.checkPortSync', error, { port: String(port) });
    }
    return false;
  }
}

/**
 * 取得網路狀態（同步版本，適合 context building）
 */
export function getNetworkStatus(selfPort: number, servicesToCheck?: Array<{ name: string; url: string }>): NetworkStatus {
  const selfPortOpen = checkPortSync(selfPort);

  const reachable: NetworkStatus['reachableServices'] = [];
  for (const svc of servicesToCheck ?? []) {
    try {
      const start = Date.now();
      execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--connect-timeout', '2', svc.url], {
        encoding: 'utf-8', timeout: 3000,
      });
      reachable.push({ name: svc.name, url: svc.url, ok: true, latencyMs: Date.now() - start });
    } catch {
      reachable.push({ name: svc.name, url: svc.url, ok: false });
    }
  }

  return { selfPortOpen, reachableServices: reachable };
}

/**
 * 格式化網路狀態
 */
export function formatNetworkStatus(status: NetworkStatus): string {
  const lines: string[] = [];

  lines.push(`Self port: ${status.selfPortOpen ? '● open' : '○ closed'}`);

  if (status.reachableServices.length > 0) {
    for (const svc of status.reachableServices) {
      const latency = svc.latencyMs ? ` (${svc.latencyMs}ms)` : '';
      lines.push(`  ${svc.ok ? '●' : '○'} ${svc.name}${latency}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// #6 Configuration Awareness
// =============================================================================

export interface ConfigSnapshot {
  /** Compose 檔案內容（簡化） */
  compose: {
    agents: Array<{ id: string; name: string; port: number; persona?: string; loop?: { enabled: boolean; interval?: string }; cronCount: number }>;
  } | null;
  /** 全域預設值 */
  globalDefaults: Record<string, unknown> | null;
  /** 當前實例配置 */
  instanceConfig: Record<string, unknown> | null;
}

/**
 * 取得配置快照（透過注入）
 */
export function getConfigSnapshot(
  composeFn?: () => ConfigSnapshot['compose'],
  globalDefaultsFn?: () => Record<string, unknown> | null,
  instanceConfigFn?: () => Record<string, unknown> | null,
): ConfigSnapshot {
  return {
    compose: composeFn?.() ?? null,
    globalDefaults: globalDefaultsFn?.() ?? null,
    instanceConfig: instanceConfigFn?.() ?? null,
  };
}

/**
 * 格式化配置快照
 */
export function formatConfigSnapshot(config: ConfigSnapshot): string {
  const lines: string[] = [];

  if (config.compose) {
    lines.push(`Compose agents (${config.compose.agents.length}):`);
    for (const a of config.compose.agents) {
      const loop = a.loop?.enabled ? ` loop:${a.loop.interval ?? 'default'}` : '';
      lines.push(`  ${a.name} :${a.port}${loop} (${a.cronCount} cron)`);
    }
  }

  if (config.instanceConfig) {
    const keys = Object.keys(config.instanceConfig).filter(k => !['id', 'createdAt', 'updatedAt'].includes(k));
    if (keys.length > 0) {
      lines.push(`Instance config: ${keys.map(k => `${k}=${JSON.stringify(config.instanceConfig![k])}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化 Agent 自我狀態
 */
export function formatSelfStatus(status: AgentSelfStatus): string {
  const lines: string[] = [];

  lines.push(`Name: ${status.name}`);
  lines.push(`Role: ${status.role} | Port: ${status.port}`);
  if (status.persona) {
    lines.push(`Persona: ${status.persona}`);
  }
  lines.push(`Server started: ${status.startedAt}`);

  // Loop
  if (status.loop) {
    const loopState = status.loop.paused ? 'paused' : status.loop.running ? 'running' : 'stopped';
    lines.push(`AgentLoop: ${loopState} (${status.loop.cycleCount} cycles)`);
    if (status.loop.lastAction) {
      lines.push(`  Last action: ${status.loop.lastAction.slice(0, 80)}`);
    }
    if (status.loop.nextCycleAt) {
      lines.push(`  Next cycle: ${status.loop.nextCycleAt}`);
    }
  }

  // Cron
  if (status.cronTasks.length > 0) {
    lines.push(`Cron tasks (${status.cronTasks.length}):`);
    for (const t of status.cronTasks) {
      lines.push(`  [${t.schedule}] ${t.task.slice(0, 60)}`);
    }
  }

  // Stats
  if (status.stats) {
    lines.push(`Today: ${status.stats.chatCount} chats, ${status.stats.errorCount} errors`);
  }

  return lines.join('\n');
}

// =============================================================================
// #7 Activity Summary (Diag + Behavior Awareness)
// =============================================================================

import type { Logger, DiagLogEntry, BehaviorLogEntry } from './logging.js';

export interface ActivitySummary {
  recentDiag: Array<{ time: string; context: string; error: string; snapshot?: Record<string, string> }>;
  recentBehavior: Array<{ time: string; actor: string; action: string; detail?: string }>;
}

/**
 * 取得活動摘要（診斷 + 行為）
 */
export function getActivitySummary(logger: Logger): ActivitySummary {
  const diagEntries = logger.queryDiagLogs(undefined, 5) as DiagLogEntry[];
  const behaviorEntries = logger.queryBehaviorLogs(undefined, 10) as BehaviorLogEntry[];

  return {
    recentDiag: diagEntries.map(e => ({
      time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
      context: e.data.context,
      error: e.data.error,
      snapshot: e.data.snapshot,
    })),
    recentBehavior: behaviorEntries.map(e => ({
      time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
      actor: e.data.actor,
      action: e.data.action,
      detail: e.data.detail,
    })),
  };
}

/**
 * 格式化活動摘要
 */
export function formatActivitySummary(summary: ActivitySummary): string {
  const lines: string[] = [];

  if (summary.recentDiag.length > 0) {
    lines.push(`Recent diagnostics (${summary.recentDiag.length}):`);
    for (const d of summary.recentDiag) {
      const snapshotStr = d.snapshot
        ? ' | ' + Object.entries(d.snapshot).map(([k, v]) => `${k}="${v}"`).join(' ')
        : '';
      lines.push(`  [${d.time}] [${d.context}] ${d.error.slice(0, 100)}${snapshotStr}`);
    }
  } else {
    lines.push('No recent diagnostics');
  }

  if (summary.recentBehavior.length > 0) {
    lines.push(`\nRecent behavior (${summary.recentBehavior.length}):`);
    for (const b of summary.recentBehavior) {
      const detail = b.detail ? `: ${b.detail.slice(0, 80)}` : '';
      lines.push(`  [${b.time}] [${b.actor}] ${b.action}${detail}`);
    }
  }

  return lines.join('\n');
}
