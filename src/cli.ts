#!/usr/bin/env node
/**
 * Mini-Agent CLI (Docker-style)
 *
 * Modes:
 *   (default)       - Interactive chat (default instance)
 *   Pipe mode       - echo "..." | mini-agent "prompt"
 *   File mode       - mini-agent file.txt "prompt"
 *
 * Commands:
 *   list              - List all instances
 *   up [options]      - Create and start instance (attach by default, -d for detached)
 *   down <id|--all>   - Stop instance(s)
 *   attach <id>       - Attach to running instance
 *   start <id>        - Start a stopped instance
 *   restart <id>      - Restart an instance
 *   kill <id|--all>   - Kill (delete) instance(s)
 *   status [id]       - Show instance status
 *   logs [type]       - Show logs
 */

import readline from 'node:readline';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn as spawnChild } from 'node:child_process';
import { postProcess } from './dispatcher.js';
import { callClaude } from './agent.js';
import { searchMemory, appendMemory, createMemory, getMemory, setSelfStatusProvider, setPerceptionProviders, setCustomExtensions, buildContext } from './memory.js';
import {
  getProcessStatus, getLogSummary, getNetworkStatus, getConfigSnapshot,
  getActivitySummary,
} from './workspace.js';
import { createApi, setLoopRef, setSlogPrefix } from './api.js';
import { getConfig, updateConfig, resetConfig } from './config.js';
import {
  getInstanceManager,
  getInstanceDir,
  loadInstanceConfig,
  loadGlobalConfig,
  listInstances,
  getCurrentInstanceId,
  startHeartbeat,
  stopHeartbeat,
} from './instance.js';
import { getLogger, type LogType, type LogEntry, type ClaudeLogEntry } from './logging.js';
import {
  findComposeFile,
  readComposeFile,
  createDefaultComposeFile,
  composeUp,
  composeDown,
  composeStatus,
  DEFAULT_COMPOSE_FILE,
  type ComposeOptions,
} from './compose.js';
import { startCronTasks, stopCronTasks, getCronTaskCount, getActiveCronTasks } from './cron.js';
import { startComposeWatcher, stopComposeWatcher } from './watcher.js';
import { AgentLoop } from './loop.js';
import { parseInterval } from './cycle-tasks.js';
import { initObservability } from './observability.js';
import { initActivityJournal } from './activity-journal.js';
import { perceptionStreams } from './perception-stream.js';
import { initClaudeMdJIT } from './claudemd-jit.js';
import type { InstanceConfig } from './types.js';

// =============================================================================
// Global Instance Context
// =============================================================================

let currentInstanceId = 'default';

/**
 * 設置當前實例 ID（用於 CLI）
 */
export function setCurrentInstance(instanceId: string): void {
  currentInstanceId = instanceId;
  process.env.MINI_AGENT_INSTANCE = instanceId;
}

// =============================================================================
// File Utilities
// =============================================================================

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.vue', '.svelte', '.astro', '.csv', '.log', '.env',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function readFileContent(filePath: string): { content: string; type: 'text' | 'image' | 'binary'; error?: string } {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { content: '', type: 'text', error: `File not found: ${filePath}` };
    }

    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      return { content: '', type: 'text', error: `Is a directory: ${filePath}` };
    }

    if (isTextFile(filePath)) {
      const content = fs.readFileSync(resolved, 'utf-8');
      return { content, type: 'text' };
    } else if (isImageFile(filePath)) {
      return { content: resolved, type: 'image' };
    } else {
      return { content: '', type: 'binary', error: `Unsupported file type: ${filePath}` };
    }
  } catch (err) {
    return { content: '', type: 'text', error: `Error reading file: ${err}` };
  }
}

// =============================================================================
// Logs Commands
// =============================================================================

// ANSI color codes for instance labels
const INSTANCE_COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
  '\x1b[91m',  // bright red
];
const RESET = '\x1b[0m';

/**
 * 解析實例 ID（支援完整 ID、短 ID、名稱匹配）
 */
function resolveInstanceId(specifiedId?: string): string | null {
  if (!specifiedId) return null;

  const all = listInstances();

  // 完整 ID
  const exact = all.find(i => i.id === specifiedId);
  if (exact) return exact.id;

  // 短 ID 前綴匹配
  const prefix = all.filter(i => i.id.startsWith(specifiedId));
  if (prefix.length === 1) return prefix[0].id;

  // 名稱匹配（不區分大小寫）
  const byName = all.find(i => i.name?.toLowerCase() === specifiedId.toLowerCase());
  if (byName) return byName.id;

  return specifiedId; // fallback: 原樣傳回
}

/**
 * 取得所有 compose 定義的實例 ID 列表
 */
function resolveAllInstanceIds(): Array<{ id: string; name: string }> {
  const composeFile = findComposeFile();
  const manager = getInstanceManager();
  const instances = manager.list();

  if (composeFile) {
    const compose = readComposeFile(composeFile);
    const byName = new Map(instances.map(i => [i.name, i]));
    const result: Array<{ id: string; name: string }> = [];
    for (const [, def] of Object.entries(compose.agents)) {
      const name = def.name || '';
      const inst = byName.get(name);
      if (inst) result.push({ id: inst.id, name: inst.name || inst.id });
    }
    if (result.length > 0) return result;
  }

  // 全部實例
  return instances.map(i => ({ id: i.id, name: i.name || i.id }));
}

/**
 * 讀取日誌檔案的最後 N 行，每行加上實例標籤
 */
function readLogTail(logFile: string, label: string, color: string, tailCount: number): Array<{ line: string; ts: string }> {
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const start = Math.max(0, lines.length - tailCount);
  return lines.slice(start).map(line => {
    // 提取時間戳用於排序（格式：2026-02-06 09:38:27）
    const ts = line.slice(0, 19);
    return { line: `${color}${label}${RESET} | ${line}`, ts };
  });
}

async function handleLogsCommand(args: string[]): Promise<void> {
  // Parse flags first
  let follow = false;
  let tail = 50;
  let date: string | undefined;
  let limit = 20;
  const cleanArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-f' || arg === '--follow') {
      follow = true;
    } else if (arg === '--tail' && args[i + 1]) {
      tail = parseInt(args[++i], 10);
    } else if (arg === '--date' && args[i + 1]) {
      date = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else {
      cleanArgs.push(arg);
    }
  }

  const subCommand = cleanArgs[0] || '';

  // 結構化日誌子命令
  const structuredCommands = ['stats', 'claude', 'errors', 'cron', 'loop', 'api', 'all'];
  if (structuredCommands.includes(subCommand)) {
    await handleStructuredLogs(subCommand, date, limit);
    return;
  }

  // ── 確定要顯示哪些實例 ──
  const specifiedId = resolveInstanceId(cleanArgs[0]);
  let targets: Array<{ id: string; name: string }>;

  if (specifiedId) {
    // 指定了實例 → 單一實例
    const inst = listInstances().find(i => i.id === specifiedId);
    targets = [{ id: specifiedId, name: inst?.name || specifiedId }];
  } else {
    // 未指定 → 全部實例
    targets = resolveAllInstanceIds();
  }

  if (targets.length === 0) {
    console.error('No instances found. Create one with: mini-agent init');
    process.exit(1);
  }

  // ── 單實例模式（原始行為，不加前綴雜訊） ──
  if (targets.length === 1) {
    const logFile = path.join(getInstanceDir(targets[0].id), 'logs', 'server.log');
    if (!fs.existsSync(logFile)) {
      console.error(`No logs found for ${targets[0].name} (${targets[0].id})`);
      return;
    }

    if (follow) {
      const tailProc = spawnChild('tail', ['-f', '-n', String(tail), logFile], {
        stdio: 'inherit',
      });
      process.on('SIGINT', () => { tailProc.kill(); process.exit(0); });
      await new Promise<void>(resolve => { tailProc.on('exit', () => resolve()); });
    } else {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, lines.length - tail);
      const output = lines.slice(start).join('\n').trimEnd();
      console.log(output || '(empty log)');
    }
    return;
  }

  // ── 多實例合併模式 ──
  if (follow) {
    // tail -f: 啟動多個 tail 進程，每行加上染色標籤
    const procs: ReturnType<typeof spawnChild>[] = [];
    const readline = await import('node:readline');

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const logFile = path.join(getInstanceDir(t.id), 'logs', 'server.log');
      if (!fs.existsSync(logFile)) continue;

      const color = INSTANCE_COLORS[i % INSTANCE_COLORS.length];
      const label = t.name.padEnd(16).slice(0, 16);
      const proc = spawnChild('tail', ['-f', '-n', String(Math.ceil(tail / targets.length)), logFile]);
      procs.push(proc);

      const rl = readline.createInterface({ input: proc.stdout! });
      rl.on('line', (line: string) => {
        process.stdout.write(`${color}${label}${RESET} | ${line}\n`);
      });
    }

    if (procs.length === 0) {
      console.error('No log files found for any instance');
      return;
    }

    process.on('SIGINT', () => {
      for (const p of procs) p.kill();
      process.exit(0);
    });
    await new Promise<void>(() => {}); // 持續運行直到 Ctrl+C
  } else {
    // 靜態模式：讀取各實例最後 N 行，合併按時間排序
    const allLines: Array<{ line: string; ts: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const logFile = path.join(getInstanceDir(t.id), 'logs', 'server.log');
      const color = INSTANCE_COLORS[i % INSTANCE_COLORS.length];
      const label = t.name.padEnd(16).slice(0, 16);
      allLines.push(...readLogTail(logFile, label, color, tail));
    }

    // 按時間排序
    allLines.sort((a, b) => a.ts.localeCompare(b.ts));

    // 取最後 tail 行
    const output = allLines.slice(-tail);
    if (output.length === 0) {
      console.log('(no logs)');
    } else {
      for (const entry of output) {
        console.log(entry.line);
      }
    }
  }
}

async function handleStructuredLogs(subCommand: string, date?: string, limit = 20): Promise<void> {
  const logger = getLogger();

  switch (subCommand) {
    case 'stats': {
      const stats = await logger.getStats(date);
      const dates = await logger.getAvailableDates();
      console.log('\nLog Statistics:');
      console.log(`  Date: ${stats.date}`);
      console.log(`  Claude calls: ${stats.claude}`);
      console.log(`  API requests: ${stats.api}`);
      console.log(`  Cron: ${stats.cron}`);
      console.log(`  Errors: ${stats.error}`);
      console.log(`  Total: ${stats.total}`);
      console.log('\nAvailable dates:');
      for (const d of dates.slice(0, 10)) {
        console.log(`  ${d}`);
      }
      break;
    }

    case 'claude': {
      const entries = logger.queryClaudeLogs(date, limit);
      console.log(`\nClaude Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const input = (entry as ClaudeLogEntry).data.input.userMessage.slice(0, 50);
        const output = (entry as ClaudeLogEntry).data.output.content.slice(0, 50);
        const duration = entry.metadata.duration ?? 0;
        console.log(`[${time}] (${duration}ms)`);
        console.log(`  In:  ${input}...`);
        console.log(`  Out: ${output}...`);
        console.log('');
      }
      break;
    }

    case 'errors': {
      const entries = logger.queryErrorLogs(date, limit);
      console.log(`\nError Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const error = entry.data.error as string;
        const context = entry.data.context as string | undefined;
        console.log(`[${time}] ${error}`);
        if (context) {
          console.log(`  Context: ${context}`);
        }
        console.log('');
      }
      break;
    }

    case 'cron': {
      const entries = logger.queryCronLogs(date, limit);
      console.log(`\nCron Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const action = entry.data.action as string;
        const result = entry.data.result as string | undefined;
        console.log(`[${time}] ${action}`);
        if (result) {
          console.log(`  Result: ${result.slice(0, 100)}...`);
        }
        console.log('');
      }
      break;
    }

    case 'loop': {
      const entries = logger.queryLoopLogs(date, limit);
      console.log(`\nAgentLoop Logs (${entries.length} entries):\n`);
      if (entries.length === 0) {
        console.log('  No loop cycles recorded yet.');
        break;
      }
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const result = entry.data.result as string | undefined;
        const duration = entry.metadata.duration ?? 0;
        const icon = result && result !== 'No action' && result !== 'No active tasks' ? '⚡' : '💤';
        console.log(`${icon} [${time}] ${duration > 0 ? `(${(duration / 1000).toFixed(1)}s)` : ''}`);
        if (result) {
          const summary = result.split('\n')[0].slice(0, 120);
          console.log(`  ${summary}${result.length > 120 ? '...' : ''}`);
        } else {
          console.log('  No action needed');
        }
        console.log('');
      }
      break;
    }

    case 'api': {
      const entries = logger.queryApiLogs(date, limit);
      console.log(`\nAPI Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const req = entry.data.request as { method: string; path: string };
        const res = entry.data.response as { status: number };
        const duration = entry.metadata.duration ?? 0;
        console.log(`[${time}] ${req.method} ${req.path} → ${res.status} (${duration}ms)`);
      }
      break;
    }

    case 'all': {
      const entries = logger.query({ date, limit });
      console.log(`\nAll Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const type = entry.type.padEnd(12);
        const success = entry.metadata.success ? '✓' : '✗';
        console.log(`[${time}] ${type} ${success}`);
      }
      break;
    }
  }
}

// =============================================================================
// Instance Commands
// =============================================================================

// =============================================================================
// Direct Commands (simplified from "instance" subcommands)
// =============================================================================

async function handleUpCommand(args: string[]): Promise<void> {
  const manager = getInstanceManager();
  let detached = false;
  let composeFilePath: string | undefined;
  let initCompose = false;
  let customName: string | undefined;
  let customPort: number | undefined;
  let customPersona: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--detach') {
      detached = true;
    } else if (arg === '-f' || arg === '--file') {
      composeFilePath = args[++i];
    } else if (arg === '--init') {
      initCompose = true;
    } else if (arg === '--name') {
      customName = args[++i];
    } else if (arg === '--port') {
      customPort = parseInt(args[++i], 10);
    } else if (arg === '--persona') {
      customPersona = args[++i];
    }
  }

  const composeOptions = (customName || customPort || customPersona)
    ? { name: customName, port: customPort, persona: customPersona }
    : undefined;

  // --init: 產生 compose 模板
  if (initCompose) {
    const filePath = createDefaultComposeFile(composeFilePath, true, composeOptions);
    console.log(`Created ${filePath}`);
    console.log('\nEdit the file and run: mini-agent up');
    return;
  }

  // 檢查是否有 compose 檔案，沒有就自動產生（使用自定義參數）
  let composeFile = findComposeFile(composeFilePath);
  if (!composeFile) {
    const filePath = createDefaultComposeFile(undefined, false, composeOptions);
    console.log(`Created ${filePath}\n`);
    composeFile = filePath;
  }

  // 使用 compose 檔案啟動
  console.log(`Using: ${composeFile}\n`);
  const compose = readComposeFile(composeFile);
  const result = await composeUp(compose, detached);

  // 顯示結果
  if (result.started.length > 0) {
    console.log('Started:');
    for (const id of result.started) {
      const agentDef = compose.agents[id];
      console.log(`  🟢 ${id} (${agentDef.name || id}) - port ${agentDef.port || 3001}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log('\nAlready running:');
    for (const id of result.skipped) {
      console.log(`  ⚪ ${id}`);
    }
  }

  if (result.failed.length > 0) {
    console.log('\nFailed:');
    for (const { id, error } of result.failed) {
      console.log(`  ❌ ${id}: ${error}`);
    }
  }

  console.log(`\n${result.started.length} agent(s) started`);

  // 單一 agent 且非 detached 時自動 attach
  if (!detached && result.started.length === 1) {
    const agentId = result.started[0];
    const agentDef = compose.agents[agentId];
    const instances = manager.list();
    const inst = instances.find(i => i.name === (agentDef.name || agentId));
    if (inst) {
      console.log('\nAttaching... (Ctrl+C or /detach to exit)\n');
      await runAttachedMode(inst.id, inst.port);
    }
  }
}

function handleListCommand(): void {
  const manager = getInstanceManager();
  const instances = manager.listStatus();

  if (instances.length === 0) {
    console.log('No instances found');
    return;
  }

  console.log('Instances:');
  console.log('');
  console.log('ID        Name              Role        Port   Status');
  console.log('--------  ----------------  ----------  -----  ------');

  for (const inst of instances) {
    const name = (inst.name ?? '(unnamed)').padEnd(16).substring(0, 16);
    const role = inst.role.padEnd(10);
    const port = String(inst.port).padEnd(5);
    const status = inst.running ? '🟢 running' : '⚪ stopped';
    console.log(`${inst.id.padEnd(8)}  ${name}  ${role}  ${port}  ${status}`);
  }
}

function handleKillCommand(args: string[]): void {
  const manager = getInstanceManager();
  const hasAll = args.includes('--all');
  const instanceId = args.find(a => !a.startsWith('-'));

  if (!instanceId && !hasAll) {
    console.error('Usage: mini-agent kill <id> | --all');
    process.exit(1);
  }

  if (hasAll) {
    // Kill all instances (except default)
    const instances = manager.listStatus();
    let killed = 0;
    for (const inst of instances) {
      try {
        manager.delete(inst.id);
        console.log(`Killed: ${inst.id}`);
        killed++;
      } catch (err) {
        console.error(`Failed to kill ${inst.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`\nKilled ${killed} instance(s)`);
    return;
  }

  try {
    const deleted = manager.delete(instanceId!);
    if (deleted) {
      console.log(`Killed instance: ${instanceId}`);
    } else {
      console.error(`Instance not found: ${instanceId}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function handleStartCommand(instanceId: string): Promise<void> {
  if (!instanceId) {
    console.error('Usage: mini-agent start <id>');
    process.exit(1);
  }

  const manager = getInstanceManager();

  try {
    await manager.start(instanceId);
    const status = manager.getStatus(instanceId);
    console.log(`Started instance: ${instanceId}`);
    console.log(`  Port: ${status?.port}`);
    console.log(`  PID: ${status?.pid}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function handleDownCommand(args: string[]): void {
  const manager = getInstanceManager();
  const hasAll = args.includes('--all');
  let composeFilePath: string | undefined;

  // 解析 -f 選項
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-f' || args[i] === '--file') && args[i + 1]) {
      composeFilePath = args[++i];
    }
  }

  const instanceId = args.find(a => !a.startsWith('-') && a !== composeFilePath);

  // 檢查是否有 compose 檔案
  const foundComposeFile = findComposeFile(composeFilePath);

  // 如果有 compose 檔案且沒指定特定實例，使用 compose 模式
  if (foundComposeFile && !instanceId) {
    console.log(`Using compose file: ${foundComposeFile}\n`);
    const compose = readComposeFile(foundComposeFile);
    const result = composeDown(compose);

    if (result.started.length > 0) {
      console.log('Stopped:');
      for (const id of result.started) {
        console.log(`  ⚪ ${id}`);
      }
    }

    if (result.skipped.length > 0) {
      console.log('\nAlready stopped:');
      for (const id of result.skipped) {
        console.log(`  - ${id}`);
      }
    }

    console.log(`\n${result.started.length} agent(s) stopped`);
    return;
  }

  // 原有邏輯
  if (!instanceId && !hasAll) {
    console.error('Usage: mini-agent down <id> | --all | (with agent-compose.yaml)');
    process.exit(1);
  }

  if (hasAll) {
    // Stop all running instances
    const instances = manager.listStatus();
    let stopped = 0;
    for (const inst of instances) {
      if (inst.running) {
        manager.stop(inst.id);
        console.log(`Down: ${inst.id}`);
        stopped++;
      }
    }
    console.log(`\nStopped ${stopped} instance(s)`);
    return;
  }

  manager.stop(instanceId!);
  console.log(`Down: ${instanceId}`);
}

async function handleRestartCommand(instanceId: string): Promise<void> {
  if (!instanceId) {
    console.error('Usage: mini-agent restart <id>');
    process.exit(1);
  }

  const manager = getInstanceManager();

  try {
    await manager.restart(instanceId);
    const status = manager.getStatus(instanceId);
    console.log(`Restarted instance: ${instanceId}`);
    console.log(`  Port: ${status?.port}`);
    console.log(`  PID: ${status?.pid}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function handleStatusCommand(instanceId?: string): void {
  const manager = getInstanceManager();

  // 如果沒指定 ID，顯示所有實例狀態
  if (!instanceId) {
    handleListCommand();
    return;
  }

  const status = manager.getStatus(instanceId);
  if (!status) {
    console.error(`Instance not found: ${instanceId}`);
    process.exit(1);
  }

  console.log(`Instance: ${status.id}`);
  console.log(`  Name: ${status.name ?? '(unnamed)'}`);
  console.log(`  Role: ${status.role}`);
  console.log(`  Port: ${status.port}`);
  console.log(`  Status: ${status.running ? '🟢 running' : '⚪ stopped'}`);
  if (status.pid) {
    console.log(`  PID: ${status.pid}`);
  }
}

function handleUpdateCommand(): void {
  console.log('Updating mini-agent to latest version...\n');

  const installScript = 'curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash';

  try {
    execSync(installScript, {
      stdio: 'inherit',
      shell: '/bin/bash',
    });
  } catch (error) {
    console.error('\nUpdate failed:', error instanceof Error ? error.message : error);
    console.error('\nYou can try manually:');
    console.error(`  ${installScript}`);
    process.exit(1);
  }
}

async function handleAttachCommand(instanceId: string): Promise<void> {
  if (!instanceId) {
    console.error('Usage: mini-agent attach <id>');
    process.exit(1);
  }

  const manager = getInstanceManager();
  const status = manager.getStatus(instanceId);

  if (!status) {
    console.error(`Instance not found: ${instanceId}`);
    process.exit(1);
  }

  if (!status.running) {
    console.error(`Instance not running: ${instanceId}`);
    console.error('Start it first: mini-agent start ' + instanceId);
    process.exit(1);
  }

  await runAttachedMode(instanceId, status.port);
}

// =============================================================================
// CLI Commands
// =============================================================================

function showHelp(): void {
  console.log(`
Mini-Agent - Personal AI with Memory + Proactivity

Usage:
  mini-agent                          Interactive chat (default instance)
  mini-agent <file> "prompt"          Process a file
  mini-agent <file1> <file2> "prompt" Process multiple files
  echo "..." | mini-agent "prompt"    Pipe mode

Commands:
  mini-agent list                     List all instances
  mini-agent up                       Start from agent-compose.yaml
  mini-agent up -d                    Start in detached mode
  mini-agent up --init                Generate agent-compose.yaml template
  mini-agent down                     Stop all (from compose file)
  mini-agent down <id|--all>          Stop specific or all instances
  mini-agent attach <id>              Attach to running instance
  mini-agent start <id>               Start a stopped instance
  mini-agent restart <id>             Restart an instance
  mini-agent status [id]              Show instance status
  mini-agent kill <id|--all>          Kill (delete) instance(s)
  mini-agent logs [-f] [--tail N]     Show all instance logs (merged, color-coded)
  mini-agent logs [-f] <id|name>      Show logs for specific instance
  mini-agent logs stats               Show structured log statistics
  mini-agent update                   Update to latest version
  mini-agent doctor                   Check environment health

Up Options:
  -d, --detach            Run in background (don't attach)
  -f, --file <path>       Specify compose file (default: agent-compose.yaml)
  --init                  Generate agent-compose.yaml template (with examples)
  --name <name>           Custom agent name (for auto-generated compose)
  --port <port>           Custom port (for auto-generated compose)
  --persona <desc>        Custom persona (for auto-generated compose)

Down Options:
  -f, --file <path>       Specify compose file
  --all                   Stop all instances

Logs Options:
  -f, --follow            Follow log output (tail -f)
  --tail <n>              Number of lines to show (default: 50)
  --date <YYYY-MM-DD>     Filter by date (structured logs)
  --limit <n>             Limit results (default: 20, structured logs)

Global Options:
  -i, --instance <id>     Use specific instance
  --data-dir <path>       Custom data directory

Examples:
  mini-agent up                           # Start from agent-compose.yaml
  mini-agent up -d                        # Start in background
  mini-agent up --init                    # Generate compose template
  mini-agent up --name "Research" --port 3002  # Custom compose
  mini-agent down                         # Stop all (from compose)
  mini-agent down --all                   # Stop all instances
  mini-agent attach abc12345              # Attach to instance
  mini-agent logs                        # Show all instance logs (merged)
  mini-agent logs -f                      # Follow all instance logs (color-coded)
  mini-agent logs 481a71fc                # Show logs for specific instance
  mini-agent logs "My Assistant"          # Filter by instance name
  mini-agent logs --tail 100              # Show last 100 lines
  mini-agent logs claude --date 2026-02-05
`);
}


// =============================================================================
// Doctor — Environment Health Check
// =============================================================================

function handleDoctorCommand(): void {
  console.log('\nmini-agent doctor\n');
  let issues = 0;
  let warnings = 0;

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 20) {
    console.log(`  ✓ Node.js ${nodeVersion}`);
  } else {
    console.log(`  ✗ Node.js ${nodeVersion} (need >= 20)`);
    issues++;
  }

  // 2. Claude CLI
  try {
    const claudeVersion = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' }).trim();
    console.log(`  ✓ Claude CLI ${claudeVersion}`);
  } catch {
    console.log('  ✗ Claude CLI not found');
    console.log('    Install: https://docs.anthropic.com/en/docs/claude-code');
    issues++;
  }

  // 3. Git
  try {
    execSync('git --version 2>/dev/null', { encoding: 'utf-8' });
    console.log('  ✓ Git available');
  } catch {
    console.log('  ✗ Git not found');
    issues++;
  }

  // 4. Disk space
  try {
    const dfOutput = execSync('df -h . 2>/dev/null', { encoding: 'utf-8' });
    const lines = dfOutput.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const available = parts[3] || 'unknown';
      const usePercent = parseInt(parts[4] || '0', 10);
      if (usePercent > 95) {
        console.log(`  ✗ Disk almost full (${available} free, ${usePercent}% used)`);
        issues++;
      } else if (usePercent > 90) {
        console.log(`  ! Disk space low (${available} free, ${usePercent}% used)`);
        warnings++;
      } else {
        console.log(`  ✓ Disk space OK (${available} free)`);
      }
    }
  } catch {
    console.log('  ? Disk space: could not check');
  }

  // 5. Compose file
  const composeFile = findComposeFile();
  if (composeFile) {
    console.log(`  ✓ Compose file: ${composeFile}`);
    try {
      const config = readComposeFile(composeFile);
      const agentNames = Object.keys(config.agents || {});
      console.log(`  ✓ Agents defined: ${agentNames.join(', ') || 'none'}`);

      // Check perception plugins exist
      for (const [name, agent] of Object.entries(config.agents || {})) {
        const customs = (agent as Record<string, unknown>).perception &&
          ((agent as Record<string, unknown>).perception as Record<string, unknown>).custom;
        if (Array.isArray(customs)) {
          for (const p of customs) {
            const script = (p as Record<string, string>).script;
            if (script && !fs.existsSync(path.resolve(path.dirname(composeFile), script))) {
              console.log(`  ! ${name}: plugin script not found: ${script}`);
              warnings++;
            }
          }
        }
        // Check skills exist
        const skills = (agent as Record<string, unknown>).skills;
        if (Array.isArray(skills)) {
          for (const s of skills) {
            if (typeof s === 'string' && !fs.existsSync(path.resolve(path.dirname(composeFile), s))) {
              console.log(`  ! ${name}: skill not found: ${s}`);
              warnings++;
            }
          }
        }
      }
    } catch (e) {
      console.log(`  ✗ Compose file is invalid: ${(e as Error).message}`);
      issues++;
    }
  } else {
    console.log('  - No compose file (will be created on first run)');
  }

  // 6. Memory directory
  if (fs.existsSync('memory')) {
    console.log('  ✓ Memory directory exists');
  } else {
    console.log('  - No memory directory (will be created on first run)');
  }

  // 7. Optional: Docker
  try {
    execSync('docker --version 2>/dev/null', { encoding: 'utf-8' });
    console.log('  ✓ Docker available');
  } catch {
    console.log('  - Docker not found (optional)');
  }

  // Summary
  console.log('');
  if (issues === 0 && warnings === 0) {
    console.log('  All checks passed. Ready to go!\n');
  } else if (issues === 0) {
    console.log(`  ${warnings} warning(s), but no blockers. Ready to go!\n`);
  } else {
    console.log(`  ${issues} issue(s), ${warnings} warning(s). Fix issues above before running.\n`);
  }
}


// =============================================================================
// CLI Dispatch — callClaude + postProcess (OODA-Only)
// =============================================================================

async function cliDispatch(message: string): Promise<{ content: string; shouldRemember?: string; taskAdded?: string }> {
  const context = await buildContext();
  const result = await callClaude(message, context, 2, { source: 'loop' });
  const processed = await postProcess(message, result.response, {
    lane: 'cli',
    duration: result.duration,
    source: 'cli',
    systemPrompt: result.systemPrompt,
    context,
  });
  return processed;
}

// =============================================================================
// Pipe Mode
// =============================================================================

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

async function runPipeMode(prompt: string): Promise<void> {
  const input = await readStdin();

  if (!input) {
    console.error('Error: No input received from pipe');
    process.exit(1);
  }

  const fullPrompt = `${prompt}\n\n---\n\n${input}`;

  try {
    const response = await cliDispatch(fullPrompt);
    console.log(response.content);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// File Mode
// =============================================================================

async function runFileMode(files: string[], prompt: string): Promise<void> {
  const textContents: string[] = [];
  const imagePaths: string[] = [];

  for (const file of files) {
    const result = readFileContent(file);

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    const fileName = path.basename(file);
    if (result.type === 'image') {
      imagePaths.push(`[Image: ${fileName}]: ${result.content}`);
    } else {
      textContents.push(`=== ${fileName} ===\n${result.content}`);
    }
  }

  let fullPrompt = prompt;
  if (textContents.length > 0) {
    fullPrompt += `\n\n---\n\n${textContents.join('\n\n')}`;
  }
  if (imagePaths.length > 0) {
    fullPrompt += `\n\n---\n\nImages:\n${imagePaths.join('\n')}`;
  }

  try {
    const response = await cliDispatch(fullPrompt);
    console.log(response.content);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// Prompt Mode
// =============================================================================

async function runPromptMode(prompt: string): Promise<void> {
  try {
    const response = await cliDispatch(prompt);
    console.log(response.content);

    if (response.shouldRemember) {
      console.log(`\n[Remembered: ${response.shouldRemember}]`);
    }
    if (response.taskAdded) {
      console.log(`\n[Task added: ${response.taskAdded}]`);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// Attached Mode (connect to running instance via API)
// =============================================================================

async function runAttachedMode(instanceId: string, port: number): Promise<void> {
  const baseUrl = `http://localhost:${port}`;

  // 驗證連接
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) throw new Error('Health check failed');
  } catch {
    console.error(`Cannot connect to instance at ${baseUrl}`);
    process.exit(1);
  }

  console.log(`Attached to instance: ${instanceId}`);
  console.log(`API: ${baseUrl}`);
  console.log('Type /detach to disconnect (instance keeps running)');
  console.log('Type /help for commands\n');

  const attachedRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let detached = false;

  attachedRl.on('close', () => {
    if (!detached) {
      console.log('\nDetached. Instance still running.');
    }
    process.exit(0);
  });

  const promptAttached = (): void => {
    if (detached) return;

    attachedRl.question(`[${instanceId}]> `, async (input) => {
      if (detached) return;

      const trimmed = input?.trim() ?? '';
      if (!trimmed) {
        promptAttached();
        return;
      }

      // Handle detach
      if (trimmed === '/detach' || trimmed === '/quit' || trimmed === '/exit') {
        detached = true;
        console.log('Detached. Instance still running.');
        attachedRl.close();
        return;
      }

      // Handle local commands
      if (trimmed === '/help') {
        console.log(`
Attached Mode Commands:
  /detach         - Disconnect (instance keeps running)
  /status         - Show instance status
  /memory         - Show memory
  /logs           - Show recent logs
  (any text)      - Chat with the agent
`);
        promptAttached();
        return;
      }

      if (trimmed === '/status') {
        try {
          const res = await fetch(`${baseUrl}/health`);
          const data = await res.json();
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      if (trimmed === '/memory') {
        try {
          const res = await fetch(`${baseUrl}/memory`);
          const data = await res.json() as { memory: string };
          console.log(data.memory || '(empty)');
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      if (trimmed === '/logs') {
        try {
          const res = await fetch(`${baseUrl}/logs/claude?limit=5`);
          const data = await res.json() as { entries: Array<{ timestamp: string; data: { input: { userMessage: string }; output: { content: string } } }> };
          if (data.entries?.length) {
            for (const entry of data.entries) {
              const time = entry.timestamp.split('T')[1].split('.')[0];
              console.log(`[${time}] ${entry.data.input.userMessage.slice(0, 40)}...`);
            }
          } else {
            console.log('No logs');
          }
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      // Chat with agent via API
      console.log('\n[Thinking...]\n');
      try {
        const res = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        });
        const data = await res.json() as { content: string; shouldRemember?: string; taskAdded?: string; error?: string };

        if (data.error) {
          console.error('Error:', data.error);
        } else {
          console.log(data.content);
          if (data.shouldRemember) {
            console.log(`\n[Remembered: ${data.shouldRemember}]`);
          }
          if (data.taskAdded) {
            console.log(`\n[Task added: ${data.taskAdded}]`);
          }
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      console.log('');
      promptAttached();
    });
  };

  promptAttached();
}

// =============================================================================
// Interactive Mode
// =============================================================================

let rl: readline.Interface;
let isClosing = false;
let agentLoop: AgentLoop | null = null;

/**
 * 首次啟動互動式設定 — 引導用戶為個人助理取名、設定個性
 */
async function runFirstRunSetup(): Promise<ComposeOptions> {
  const setupRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise(resolve => setupRl.question(question, resolve));

  console.log('\n╭───────────────────────────────────────────╮');
  console.log('│  Setting up your personal AI assistant    │');
  console.log('╰───────────────────────────────────────────╯\n');

  const name = await ask('  What should your assistant be called? (default: My Assistant): ');
  const persona = await ask('  Describe its personality in a sentence\n  (default: A helpful personal AI assistant): ');

  setupRl.close();

  const trimmedName = name.trim();
  const trimmedPersona = persona.trim();

  if (trimmedName || trimmedPersona) {
    console.log(`\n  ✓ ${trimmedName || 'My Assistant'} is ready.\n`);
  }

  return {
    name: trimmedName || undefined,
    persona: trimmedPersona || undefined,
  };
}

interface PluginHealthStatus {
  name: string;
  script: string;
  exists: boolean;
  executable: boolean;
}

function getPluginHealthStatus(
  perceptions: Array<{ name: string; script: string }>,
  composeDir: string,
): PluginHealthStatus[] {
  return perceptions.map(plugin => {
    const resolved = path.resolve(composeDir, plugin.script);
    let executable = false;
    let exists = false;

    try {
      const stat = fs.statSync(resolved);
      exists = true;
      executable = (stat.mode & 0o111) !== 0;
    } catch {
      exists = false;
      executable = false;
    }

    return {
      name: plugin.name,
      script: plugin.script,
      exists,
      executable,
    };
  });
}

function describeCapability(pluginName: string): string {
  const descriptions: Record<string, string> = {
    tasks: 'HEARTBEAT task tracking',
    'state-changes': 'workspace change detection',
    'self-awareness': 'agent runtime self-status',
    'chat-room-inbox': 'team chat inbox monitoring',
    'claude-code-inbox': 'Claude Code inbox monitoring',
    'delegation-status': 'background delegation status',
    'anomaly-detector': 'anomaly signals from behavior logs',
    'git': 'git repository change tracking',
    'ports': 'service port monitoring',
    'disk': 'disk usage alerts',
  };
  return descriptions[pluginName] || 'custom perception stream';
}

async function runChat(port: number): Promise<void> {
  // 同時啟動 API server
  const app = createApi(port);
  const config = await getConfig();
  const instanceId = getCurrentInstanceId();

  // 設定 slog 前綴
  const instConfig = loadInstanceConfig(instanceId);
  setSlogPrefix(instanceId, instConfig?.name);

  // 讀取或建立 compose 檔案
  let composeFile = findComposeFile();
  let isFirstRun = false;
  if (!composeFile) {
    // 互動式引導：讓用戶為自己的助理取名、設定個性
    const setupOptions = await runFirstRunSetup();
    composeFile = createDefaultComposeFile(undefined, false, setupOptions);
    isFirstRun = true;
    console.log(`Created ${composeFile}`);
  }

  // 讀取 cron 任務
  let cronCount = 0;
  const compose = readComposeFile(composeFile);
  // 找到當前 instance 對應的 agent（用 name 或第一個）
  const agents = Object.values(compose.agents);
  const currentAgent = agents.find(a => a.name === instanceId) || agents[0];
  if (currentAgent?.cron && currentAgent.cron.length > 0) {
    startCronTasks(currentAgent.cron);
    cronCount = getCronTaskCount();
  }

  // 啟動熱重載 watcher
  const watcherResult = startComposeWatcher(composeFile);

  // AgentLoop: 從 compose 讀取 loop 配置
  const loopConfig = currentAgent?.loop;
  const loopEnabled = loopConfig?.enabled !== false; // 預設啟用
  if (loopEnabled) {
    const intervalMs = loopConfig?.interval ? parseInterval(loopConfig.interval) : undefined;
    const activeHours = loopConfig?.activeHours
      ? { start: loopConfig.activeHours.start ?? 8, end: loopConfig.activeHours.end ?? 23 }
      : undefined;
    agentLoop = new AgentLoop({ enabled: true, ...(intervalMs ? { intervalMs } : {}), ...(activeHours ? { activeHours } : {}) });
    setLoopRef(agentLoop);
  }

  // Self-awareness: 注入 Agent 自我狀態提供者
  const serverStartedAt = new Date().toISOString();
  const agentName = currentAgent?.name || instanceId;
  const agentPersona = currentAgent?.persona;
  const agentPort = currentAgent?.port || port;

  setSelfStatusProvider(() => {
    const loopStatus = agentLoop?.getStatus() ?? null;
    const cronTasks = getActiveCronTasks();

    return {
      name: agentName,
      role: 'standalone',
      port: agentPort,
      persona: agentPersona,
      startedAt: serverStartedAt,
      loop: loopStatus ? {
        running: loopStatus.running,
        paused: loopStatus.paused,
        cycleCount: loopStatus.cycleCount,
        lastAction: loopStatus.lastAction,
        nextCycleAt: loopStatus.nextCycleAt,
      } : null,
      cronTasks: cronTasks.map(t => ({ schedule: t.schedule, task: t.task })),
    };
  });

  // ── Perception Providers ──
  const logger = getLogger();
  const instManager = getInstanceManager();

  setPerceptionProviders({
    process: () => getProcessStatus(
      () => instManager.listStatus()
        .filter(s => s.id !== instanceId)
        .map(s => ({ id: s.id, name: s.name, port: s.port, running: s.running })),
      () => {
        const today = new Date().toISOString().split('T')[0];
        return {
          claude: logger.queryClaudeLogs(today, 0).length,
          api: logger.queryApiLogs(today, 0).length,
          cron: logger.queryCronLogs(today, 0).length,
          error: logger.queryErrorLogs(today, 0).length,
        };
      },
    ),
    logs: () => getLogSummary(
      () => logger.queryErrorLogs(undefined, 5).map(e => ({
        time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
        message: e.data.error,
      })),
      () => logger.query({ limit: 10 }).map(e => ({
        time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
        type: e.type,
        summary: e.type === 'error'
          ? (e.data as { error: string }).error
          : e.type === 'claude-call'
            ? `chat: ${((e.data as { input: { userMessage: string } }).input?.userMessage ?? '').slice(0, 60)}`
            : e.type === 'cron'
              ? (e.data as { action: string }).action
              : `${(e.data as { request?: { method?: string; path?: string } }).request?.method ?? ''} ${(e.data as { request?: { method?: string; path?: string } }).request?.path ?? ''}`,
      })),
    ),
    network: () => getNetworkStatus(port),
    config: () => getConfigSnapshot(
      () => ({
        agents: Object.entries(compose.agents).map(([id, a]) => ({
          id,
          name: a.name || id,
          port: a.port || 3001,
          persona: a.persona,
          loop: a.loop ? { enabled: a.loop.enabled !== false, interval: a.loop.interval } : undefined,
          cronCount: a.cron?.length ?? 0,
        })),
      }),
      () => {
        try { return loadGlobalConfig().defaults as unknown as Record<string, unknown>; } catch { return null; }
      },
      () => loadInstanceConfig(instanceId) as unknown as Record<string, unknown> | null,
    ),
    activity: () => getActivitySummary(logger),
  });

  // Custom Perception & Skills（從 compose 配置）
  const composeDir = composeFile ? path.dirname(path.resolve(composeFile)) : process.cwd();
  const enabledPerceptions = currentAgent?.perception?.custom?.filter(p => p.enabled !== false);
  setCustomExtensions({
    perceptions: enabledPerceptions,
    skills: currentAgent?.skills,
    cwd: composeDir,
  });

  // Phase 4: 啟動 perception streams (PERCEPTION_DISABLED env gate — see api.ts comment)
  if (process.env.PERCEPTION_DISABLED !== 'true' && enabledPerceptions && enabledPerceptions.length > 0) {
    perceptionStreams.start(enabledPerceptions, composeDir);
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Mini-Agent - Memory + Cron + Loop`);
    console.log(`Instance: ${instanceId}`);
    console.log(`API server: http://localhost:${port}`);
    if (cronCount > 0) {
      console.log(`Cron: ${cronCount} task(s) active`);
    }
    initObservability();
    createMemory(); // ensure migrateStateFiles() runs before journal init
    initClaudeMdJIT(); // parse CLAUDE.md sections for JIT loading
    initActivityJournal();
    if (agentLoop) {
      agentLoop.start();
    }
    if (watcherResult.watching) {
      console.log(`Hot reload: enabled`);
    }
    if (isFirstRun) {
      const health = getPluginHealthStatus(enabledPerceptions ?? [], composeDir);
      const healthyCount = health.filter(p => p.exists && p.executable).length;

      console.log('\n──────────────────────────────────────────');
      console.log(`  ${agentName} is online.`);
      console.log('──────────────────────────────────────────');

      // Run a quick perception scan to show what the agent can see
      console.log('\n  Scanning your environment...\n');
      const scanResults: string[] = [];
      for (const plugin of health) {
        if (plugin.exists && plugin.executable) {
          try {
            const resolved = path.resolve(composeDir, plugin.script);
            const result = execSync(`bash "${resolved}"`, {
              timeout: 5000,
              encoding: 'utf-8',
              env: { ...process.env, INSTANCE_DIR: getInstanceDir(instanceId) },
              cwd: composeDir,
            }).trim();
            if (result) {
              // Extract first meaningful line from output
              const firstLine = result.split('\n').find(l => l.trim() && !l.startsWith('<') && !l.startsWith('#'));
              if (firstLine) {
                scanResults.push(`    ${describeCapability(plugin.name)}: ${firstLine.trim().slice(0, 80)}`);
              }
            }
          } catch {
            // Plugin failed — skip silently
          }
        }
      }
      if (scanResults.length > 0) {
        console.log("  Here's what I can see right now:");
        for (const line of scanResults.slice(0, 5)) {
          console.log(line);
        }
        console.log('');
      }

      console.log(`  Perception: ${healthyCount}/${health.length} plugins ready`);
      for (const plugin of health) {
        if (plugin.exists && plugin.executable) {
          console.log(`    ✓ ${plugin.name}: ${describeCapability(plugin.name)}`);
        } else if (!plugin.exists) {
          console.log(`    ✗ ${plugin.name} missing: ${plugin.script}`);
        } else {
          console.log(`    ! ${plugin.name} not executable: ${plugin.script}`);
        }
      }

      console.log('');
      console.log('  The autonomous loop checks every 5 minutes.\n');
      console.log('  Try talking to your assistant:');
      console.log('    "What can you see right now?"');
      console.log('    "Watch my git commits and summarize daily"');
      console.log('    "Alert me if disk usage goes above 80%"');
      console.log('    "Help me organize my tasks"\n');
      console.log('  Edit agent-compose.yaml to customize further.\n');
    } else {
      console.log('\nType /help for commands, or just chat.\n');
    }
    prompt();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Try: mini-agent kill --all, or use --port <port>\n`);
      process.exit(1);
    }
    throw err;
  });

  // ── HTTPS Server (optional, for mobile sensor permissions) ──
  if (process.env.HTTPS_ENABLED === 'true') {
    const certPath = process.env.HTTPS_CERT
      || path.join(os.homedir(), '.mini-agent', 'tls', 'cert.pem');
    const keyPath = process.env.HTTPS_KEY
      || path.join(os.homedir(), '.mini-agent', 'tls', 'key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const httpsPort = parseInt(process.env.HTTPS_PORT || String(port + 442), 10);
      const httpsServer = https.createServer({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      }, app);

      httpsServer.listen(httpsPort, () => {
        console.log(`HTTPS server: https://localhost:${httpsPort}`);
      });

      httpsServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`HTTPS port ${httpsPort} already in use, skipping HTTPS`);
        } else {
          console.error(`HTTPS server error: ${err.message}`);
        }
      });
    } else {
      console.error(`HTTPS enabled but certs not found at ${certPath}`);
    }
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('close', () => {
    if (!isClosing) {
      console.log('\nBye!');
      process.exit(0);
    }
  });
}

function prompt(): void {
  if (isClosing) return;

  rl.question('> ', async (input) => {
    if (isClosing) return;

    const trimmed = input?.trim() ?? '';

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed.startsWith('/')) {
      await handleChatCommand(trimmed);
      if (!isClosing) prompt();
      return;
    }

    agentLoop?.pause();
    try {
      console.log('\n[Thinking...]\n');
      const response = await cliDispatch(trimmed);
      console.log(response.content);

      if (response.shouldRemember) {
        console.log(`\n[Remembered: ${response.shouldRemember}]`);
      }
      if (response.taskAdded) {
        console.log(`\n[Task added: ${response.taskAdded}]`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    } finally {
      agentLoop?.resume();
    }

    console.log('');
    if (!isClosing) prompt();
  });
}

async function handleChatCommand(cmd: string): Promise<void> {
  const [command, ...args] = cmd.slice(1).split(' ');

  switch (command) {
    case 'help':
      console.log(`
Chat Commands:
  /help           - Show this help
  /search <query> - Search memory
  /remember <text>- Add to memory
  /history [n]    - Show conversation history (default: 20)
  /config         - Show current config
  /config set <key> <value> - Update config
  /config reset   - Reset to defaults
  /instance       - Show current instance
  /instances      - List all instances
  /logs           - Show log statistics
  /logs claude    - Show Claude operation logs
  /logs errors    - Show error logs
  /loop           - Show AgentLoop status
  /loop pause     - Pause the loop
  /loop resume    - Resume the loop
  /loop trigger   - Manually run one cycle
  /quit           - Exit
`);
      break;

    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log('Usage: /search <query>');
        break;
      }
      const results = await searchMemory(query);
      if (results.length === 0) {
        console.log('No results found');
      } else {
        results.forEach((r) => {
          console.log(`[${r.source}] ${r.content}`);
        });
      }
      break;
    }

    case 'remember': {
      const text = args.join(' ');
      if (!text) {
        console.log('Usage: /remember <text>');
        break;
      }
      await appendMemory(text);
      console.log('Remembered!');
      break;
    }

    case 'config': {
      const subCmd = args[0];
      const key = args[1];
      const value = args.slice(2).join(' ');

      if (!subCmd || subCmd === 'show') {
        const config = await getConfig();
        console.log('\nCurrent Configuration:');
        for (const [k, v] of Object.entries(config)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      } else if (subCmd === 'set' && key) {
        let parsedValue: unknown = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }
        await updateConfig({ [key]: parsedValue });
        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } else if (subCmd === 'reset') {
        await resetConfig();
        console.log('Configuration reset to defaults');
      } else {
        console.log('Usage:');
        console.log('  /config           - Show current config');
        console.log('  /config set <key> <value> - Set a config value');
        console.log('  /config reset     - Reset to defaults');
      }
      break;
    }

    case 'instance': {
      const instanceId = getCurrentInstanceId();
      const config = loadInstanceConfig(instanceId);
      console.log(`\nCurrent Instance: ${instanceId}`);
      if (config) {
        console.log(`  Name: ${config.name ?? '(unnamed)'}`);
        console.log(`  Role: ${config.role}`);
        console.log(`  Port: ${config.port}`);
      }
      break;
    }

    case 'instances': {
      const instances = listInstances();
      console.log('\nInstances:');
      for (const inst of instances) {
        const current = inst.id === getCurrentInstanceId() ? ' (current)' : '';
        console.log(`  ${inst.id}: ${inst.name ?? '(unnamed)'}${current}`);
      }
      break;
    }

    case 'logs': {
      const logger = getLogger();
      const subCmd = args[0];

      if (!subCmd || subCmd === 'stats') {
        const stats = await logger.getStats();
        console.log('\nToday\'s Log Statistics:');
        console.log(`  Claude calls: ${stats.claude}`);
        console.log(`  API requests: ${stats.api}`);
        console.log(`  Cron: ${stats.cron}`);
        console.log(`  Errors: ${stats.error}`);
        console.log(`  Total: ${stats.total}`);
      } else if (subCmd === 'claude') {
        const entries = logger.queryClaudeLogs(undefined, 10);
        console.log(`\nRecent Claude Logs (${entries.length}):\n`);
        for (const entry of entries) {
          const time = entry.timestamp.split('T')[1].split('.')[0];
          const input = (entry as ClaudeLogEntry).data.input.userMessage.slice(0, 40);
          const duration = entry.metadata.duration ?? 0;
          console.log(`[${time}] ${input}... (${duration}ms)`);
        }
      } else if (subCmd === 'errors') {
        const entries = logger.queryErrorLogs(undefined, 10);
        console.log(`\nRecent Errors (${entries.length}):\n`);
        for (const entry of entries) {
          const time = entry.timestamp.split('T')[1].split('.')[0];
          const error = entry.data.error as string;
          console.log(`[${time}] ${error}`);
        }
      } else if (subCmd === 'loop') {
        const entries = logger.queryLoopLogs(undefined, 10);
        console.log(`\nAgentLoop Logs (${entries.length}):\n`);
        if (entries.length === 0) {
          console.log('  No loop cycles recorded yet.');
        }
        for (const entry of entries) {
          const time = entry.timestamp.split('T')[1].split('.')[0];
          const result = entry.data.result as string | undefined;
          const duration = entry.metadata.duration ?? 0;
          const icon = result && result !== 'No action' && result !== 'No active tasks' ? '⚡' : '💤';
          console.log(`${icon} [${time}] ${duration > 0 ? `(${(duration / 1000).toFixed(1)}s)` : ''}`);
          if (result) {
            console.log(`  ${result.split('\n')[0].slice(0, 100)}`);
          } else {
            console.log('  No action needed');
          }
        }
      } else {
        console.log('Usage: /logs [stats|claude|errors|loop]');
      }
      break;
    }

    case 'history': {
      const mem = getMemory();
      const limit = args[0] ? parseInt(args[0], 10) : 20;
      const history = await mem.getConversationHistory(limit);

      if (history.length === 0) {
        console.log('\nNo conversation history today.');
      } else {
        console.log(`\nConversation History (${history.length} entries):\n`);
        for (const entry of history) {
          const time = entry.timestamp.split('T')[1]?.split('.')[0] ?? '';
          const role = entry.role === 'user' ? 'User' : 'Assistant';
          const content = entry.content.length > 80
            ? entry.content.slice(0, 80) + '...'
            : entry.content;
          console.log(`[${time}] ${role}: ${content}`);
        }
      }
      break;
    }

    case 'loop': {
      if (!agentLoop) {
        console.log('AgentLoop is not enabled');
        break;
      }
      const loopSub = args[0];
      if (loopSub === 'pause') {
        agentLoop.pause();
        console.log('AgentLoop paused');
      } else if (loopSub === 'resume') {
        agentLoop.resume();
        console.log('AgentLoop resumed');
      } else if (loopSub === 'trigger') {
        console.log('[AgentLoop] Running cycle...');
        agentLoop.pause();
        try {
          const result = await agentLoop.trigger();
          console.log(result ? `Action: ${result}` : 'No action needed');
        } finally {
          agentLoop.resume();
        }
      } else {
        const s = agentLoop.getStatus();
        console.log(`\nAgentLoop Status:`);
        console.log(`  Running: ${s.running}`);
        console.log(`  Paused: ${s.paused}`);
        console.log(`  Cycles: ${s.cycleCount}`);
        console.log(`  Interval: ${s.currentInterval / 1000}s`);
        if (s.lastCycleAt) console.log(`  Last cycle: ${s.lastCycleAt}`);
        if (s.lastAction) console.log(`  Last action: ${s.lastAction}`);
        if (s.nextCycleAt) console.log(`  Next cycle: ${s.nextCycleAt}`);
      }
      break;
    }

    case 'quit':
    case 'exit':
      agentLoop?.stop();
      isClosing = true;
      console.log('Bye!');
      rl.close();
      process.exit(0);

    default:
      console.log(`Unknown command: ${command}. Try /help`);
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

// 直接命令列表（不需要 instance 前綴）
const DIRECT_COMMANDS = ['list', 'up', 'attach', 'start', 'down', 'restart', 'status', 'kill', 'logs', 'help', 'update', 'doctor'];

interface ParsedArgs {
  command: string;
  port: number;
  prompt: string;
  files: string[];
  hasExplicitPrompt: boolean;
  instanceId: string;
  dataDir?: string;
  commandArgs: string[];
  init: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command = '';
  let port = 3001;
  let prompt = 'Process this:';
  let hasExplicitPrompt = false;
  let instanceId = 'default';
  let dataDir: string | undefined;
  let init = false;
  const files: string[] = [];
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      port = parseInt(args[++i] || '3001', 10);
    } else if (arg === '--instance' || arg === '-i') {
      instanceId = args[++i] || 'default';
    } else if (arg === '--data-dir') {
      dataDir = args[++i];
    } else if (arg === '--init') {
      init = true;
    } else if (DIRECT_COMMANDS.includes(arg) && command === '') {
      command = arg;
      // 收集命令的所有後續參數
      commandArgs.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith('-')) {
      if (fs.existsSync(arg)) {
        files.push(arg);
      } else {
        prompt = arg;
        hasExplicitPrompt = true;
      }
    }
  }

  return { command, port, prompt, files, hasExplicitPrompt, instanceId, dataDir, commandArgs, init };
}

async function main(): Promise<void> {
  const { command, port, prompt, files, hasExplicitPrompt, instanceId, dataDir, commandArgs, init } = parseArgs();

  // 設置資料目錄
  if (dataDir) {
    process.env.MINI_AGENT_DATA_DIR = dataDir;
  }

  // --init: 只建立 compose 檔案，不進入互動模式
  if (init) {
    const existing = findComposeFile();
    if (existing) {
      console.log(`Compose file already exists: ${existing}`);
    } else {
      const filePath = createDefaultComposeFile(undefined, true);
      console.log(`Created ${filePath}`);
      console.log('\nEdit the file and run: mini-agent');
    }
    return;
  }

  // 設置當前實例
  setCurrentInstance(instanceId);

  // 直接命令
  switch (command) {
    case 'help':
      showHelp();
      return;
    case 'list':
      handleListCommand();
      return;
    case 'up':
      await handleUpCommand(commandArgs);
      return;
    case 'attach':
      await handleAttachCommand(commandArgs[0]);
      return;
    case 'start':
      await handleStartCommand(commandArgs[0]);
      return;
    case 'down':
      handleDownCommand(commandArgs);
      return;
    case 'restart':
      await handleRestartCommand(commandArgs[0]);
      return;
    case 'status':
      handleStatusCommand(commandArgs[0]);
      return;
    case 'kill':
      handleKillCommand(commandArgs);
      return;
    case 'logs':
      await handleLogsCommand(commandArgs);
      return;
    case 'update':
      handleUpdateCommand();
      return;
    case 'doctor':
      handleDoctorCommand();
      return;
  }

  // 檢查是否為管道輸入（stdin 不是 TTY 且有 prompt）
  const isPiped = !process.stdin.isTTY && command === '' && files.length === 0 && hasExplicitPrompt;

  // Pipe mode
  if (isPiped) {
    await runPipeMode(prompt);
    return;
  }

  // File mode
  if (files.length > 0) {
    await runFileMode(files, prompt);
    return;
  }

  // Prompt-only mode
  if (hasExplicitPrompt && command === '') {
    await runPromptMode(prompt);
    return;
  }

  // Default: Interactive chat mode
  await runChat(port);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
