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
import { execFileSync } from 'node:child_process';

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
  } catch {
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
