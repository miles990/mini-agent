/**
 * Mini-Agent Instance Manager
 * 多實例生命週期管理
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  InstanceConfig,
  GlobalConfig,
  GlobalDefaults,
  CreateInstanceOptions,
  InstanceRole,
  InstanceStatus,
} from './types.js';

// =============================================================================
// Constants & Defaults
// =============================================================================

/**
 * 預設全域配置
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  defaults: {
    port: 3001,
    proactiveSchedule: '*/30 * * * *',
    claudeTimeout: 120000,
    maxSearchResults: 5,
  },
  instances: [],
};

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * 取得 mini-agent 資料目錄
 */
export function getDataDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return process.env.MINI_AGENT_DATA_DIR || path.join(homeDir, '.mini-agent');
}

/**
 * 取得實例目錄
 */
export function getInstanceDir(instanceId: string): string {
  return path.join(getDataDir(), 'instances', instanceId);
}

/**
 * 取得全域配置路徑
 */
export function getGlobalConfigPath(): string {
  return path.join(getDataDir(), 'config.yaml');
}

/**
 * 確保目錄存在
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * 初始化資料目錄結構
 */
export function initDataDir(): void {
  const dataDir = getDataDir();
  ensureDir(dataDir);
  ensureDir(path.join(dataDir, 'instances'));
  ensureDir(path.join(dataDir, 'shared'));

  // 創建預設的全域配置
  const globalConfigPath = getGlobalConfigPath();
  if (!fs.existsSync(globalConfigPath)) {
    fs.writeFileSync(globalConfigPath, stringifyYaml(DEFAULT_GLOBAL_CONFIG));
  }
}

/**
 * 創建實例的預設文件
 */
function createDefaultInstanceFiles(instanceDir: string): void {
  const memoryPath = path.join(instanceDir, 'MEMORY.md');
  const heartbeatPath = path.join(instanceDir, 'HEARTBEAT.md');
  const skillsPath = path.join(instanceDir, 'SKILLS.md');
  const dailyDir = path.join(instanceDir, 'daily');
  const logsDir = path.join(instanceDir, 'logs');

  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(
      memoryPath,
      `# Memory

Long-term memory storage for this instance.

## User Preferences

## Learned Patterns

## Important Facts

`
    );
  }

  if (!fs.existsSync(heartbeatPath)) {
    fs.writeFileSync(
      heartbeatPath,
      `# HEARTBEAT

Task list and reminders.

## Active Tasks

## Scheduled Tasks

`
    );
  }

  if (!fs.existsSync(skillsPath)) {
    fs.writeFileSync(
      skillsPath,
      `# Skills

Capabilities and tools available to this instance.

## Available Skills

- web-research: Search and summarize web content
- code-analysis: Analyze and explain code
- note-taking: Take and organize notes

`
    );
  }

  ensureDir(dailyDir);
  ensureDir(logsDir);
}

// =============================================================================
// Global Configuration
// =============================================================================

/**
 * 載入全域配置
 */
export function loadGlobalConfig(): GlobalConfig {
  initDataDir();
  const configPath = getGlobalConfigPath();

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as GlobalConfig;
    return {
      ...DEFAULT_GLOBAL_CONFIG,
      ...config,
      defaults: {
        ...DEFAULT_GLOBAL_CONFIG.defaults,
        ...config?.defaults,
      },
    };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

/**
 * 儲存全域配置
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, stringifyYaml(config));
}

/**
 * 取得全域預設值
 */
export function getGlobalDefaults(): GlobalDefaults {
  const globalConfig = loadGlobalConfig();
  return globalConfig.defaults;
}

/**
 * 更新全域預設值
 */
export function updateGlobalDefaults(updates: Partial<GlobalDefaults>): GlobalDefaults {
  const globalConfig = loadGlobalConfig();
  globalConfig.defaults = {
    ...globalConfig.defaults,
    ...updates,
  };
  saveGlobalConfig(globalConfig);
  return globalConfig.defaults;
}

// =============================================================================
// Instance Configuration
// =============================================================================

/**
 * 載入實例配置
 */
export function loadInstanceConfig(instanceId: string): InstanceConfig | null {
  const instanceDir = getInstanceDir(instanceId);
  const configPath = path.join(instanceDir, 'instance.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as InstanceConfig;

    // 合併全域預設值
    const globalConfig = loadGlobalConfig();
    return {
      ...config,
      port: config.port ?? globalConfig.defaults.port,
    };
  } catch {
    return null;
  }
}

/**
 * 儲存實例配置
 */
export function saveInstanceConfig(instanceId: string, config: InstanceConfig): void {
  const instanceDir = getInstanceDir(instanceId);
  ensureDir(instanceDir);

  const configPath = path.join(instanceDir, 'instance.yaml');
  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(configPath, stringifyYaml(config));
}

/**
 * 更新實例配置（部分更新）
 */
export function updateInstanceConfig(
  instanceId: string,
  updates: Partial<InstanceConfig>
): InstanceConfig | null {
  const config = loadInstanceConfig(instanceId);
  if (!config) {
    return null;
  }

  const updatedConfig: InstanceConfig = {
    ...config,
    ...updates,
    id: config.id, // ID 不可更改
    createdAt: config.createdAt, // 創建時間不可更改
  };

  saveInstanceConfig(instanceId, updatedConfig);
  return updatedConfig;
}

/**
 * 重置實例配置為預設值
 */
export function resetInstanceConfig(instanceId: string): InstanceConfig | null {
  const config = loadInstanceConfig(instanceId);
  if (!config) {
    return null;
  }

  const globalDefaults = getGlobalDefaults();
  const resetConfig: InstanceConfig = {
    id: config.id,
    name: config.name,
    role: config.role,
    port: globalDefaults.port,
    createdAt: config.createdAt,
  };

  saveInstanceConfig(instanceId, resetConfig);
  return resetConfig;
}

// =============================================================================
// Instance CRUD
// =============================================================================

/**
 * 尋找可用的 port
 */
function findAvailablePort(globalConfig: GlobalConfig): number {
  const usedPorts = new Set<number>();

  // 收集所有已使用的 port
  for (const instance of globalConfig.instances) {
    const config = loadInstanceConfig(instance.id);
    if (config) {
      usedPorts.add(config.port);
    }
  }

  // 從預設 port 開始尋找
  let port = globalConfig.defaults.port;
  while (usedPorts.has(port)) {
    port++;
  }

  return port;
}

/**
 * 創建新實例
 */
export function createInstance(options: CreateInstanceOptions = {}): InstanceConfig {
  initDataDir();

  const globalConfig = loadGlobalConfig();
  const id = uuidv4().substring(0, 8);
  const port = options.port ?? findAvailablePort(globalConfig);

  const config: InstanceConfig = {
    id,
    name: options.name,
    role: options.role ?? 'standalone',
    port,
    createdAt: new Date().toISOString(),
  };

  if (options.persona) {
    config.persona = {
      description: options.persona,
    };
  }

  // 創建實例目錄和文件
  const instanceDir = getInstanceDir(id);
  ensureDir(instanceDir);
  createDefaultInstanceFiles(instanceDir);

  // 儲存實例配置
  saveInstanceConfig(id, config);

  // 更新全域配置
  globalConfig.instances.push({ id, role: config.role });
  saveGlobalConfig(globalConfig);

  return config;
}

/**
 * 列出所有實例
 */
export function listInstances(): InstanceConfig[] {
  initDataDir();

  const instancesDir = path.join(getDataDir(), 'instances');
  if (!fs.existsSync(instancesDir)) {
    return [];
  }

  const instances: InstanceConfig[] = [];
  const dirs = fs.readdirSync(instancesDir);

  for (const dir of dirs) {
    const config = loadInstanceConfig(dir);
    if (config) {
      instances.push(config);
    }
  }

  return instances;
}

/**
 * 刪除實例
 */
export function deleteInstance(instanceId: string): boolean {
  const instanceDir = getInstanceDir(instanceId);
  if (!fs.existsSync(instanceDir)) {
    return false;
  }

  // 刪除實例目錄
  fs.rmSync(instanceDir, { recursive: true, force: true });

  // 更新全域配置
  const globalConfig = loadGlobalConfig();
  globalConfig.instances = globalConfig.instances.filter((i) => i.id !== instanceId);
  saveGlobalConfig(globalConfig);

  return true;
}

// =============================================================================
// Instance Manager Class
// =============================================================================

/**
 * 實例管理器
 */
export class InstanceManager {
  private runningInstances: Map<string, ChildProcess> = new Map();

  constructor() {
    initDataDir();
  }

  /**
   * 創建新實例
   */
  create(options: CreateInstanceOptions = {}): InstanceConfig {
    return createInstance(options);
  }

  /**
   * 取得實例配置
   */
  get(instanceId: string): InstanceConfig | null {
    return loadInstanceConfig(instanceId);
  }

  /**
   * 列出所有實例
   */
  list(): InstanceConfig[] {
    return listInstances();
  }

  /**
   * 更新實例配置
   */
  update(instanceId: string, updates: Partial<InstanceConfig>): InstanceConfig | null {
    return updateInstanceConfig(instanceId, updates);
  }

  /**
   * 刪除實例
   */
  delete(instanceId: string): boolean {
    // 先停止實例
    this.stop(instanceId);
    return deleteInstance(instanceId);
  }

  /**
   * 啟動實例
   */
  async start(instanceId: string): Promise<boolean> {
    const config = loadInstanceConfig(instanceId);
    if (!config) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    // 檢查是否已在運行
    if (this.isRunning(instanceId)) {
      return true;
    }

    // 啟動伺服器進程（使用 api.js）
    const logFile = path.join(getInstanceDir(instanceId), 'logs', 'server.log');
    ensureDir(path.dirname(logFile));
    const logFd = fs.openSync(logFile, 'a');

    const serverProcess = spawn(
      'node',
      [path.join(import.meta.dirname || __dirname, 'api.js')],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          MINI_AGENT_INSTANCE: instanceId,
          PORT: String(config.port),
        },
      }
    );

    serverProcess.unref();
    fs.closeSync(logFd);
    this.runningInstances.set(instanceId, serverProcess);

    // 記錄 PID
    const pidFile = path.join(getInstanceDir(instanceId), 'server.pid');
    if (serverProcess.pid) {
      fs.writeFileSync(pidFile, String(serverProcess.pid));
    }

    // Health check: 等待 server 真正 ready（最多 10 秒）
    const healthUrl = `http://localhost:${config.port}/health`;
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      // 檢查進程是否已退出
      if (serverProcess.exitCode !== null) {
        this.runningInstances.delete(instanceId);
        try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
        const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').slice(-500) : '';
        throw new Error(`Process exited with code ${serverProcess.exitCode}${log ? `\n${log}` : ''}`);
      }

      try {
        const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (resp.ok) return true; // Server is ready
      } catch {
        // Not ready yet, wait and retry
      }

      await new Promise(r => setTimeout(r, 200));
    }

    // Timeout — server spawned but never became healthy
    throw new Error(`Server started (pid ${serverProcess.pid}) but health check timed out on :${config.port}`);
  }

  /**
   * 停止實例
   */
  stop(instanceId: string): boolean {
    const proc = this.runningInstances.get(instanceId);
    if (proc) {
      proc.kill();
      this.runningInstances.delete(instanceId);
    }

    // 嘗試從 PID 文件停止
    const pidFile = path.join(getInstanceDir(instanceId), 'server.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        process.kill(pid);
      } catch {
        // 進程可能已經停止
      }
      fs.unlinkSync(pidFile);
    }

    return true;
  }

  /**
   * 檢查實例是否在運行
   */
  isRunning(instanceId: string): boolean {
    // 檢查內存中的進程
    const proc = this.runningInstances.get(instanceId);
    if (proc && !proc.killed) {
      return true;
    }

    // 檢查 PID 文件
    const pidFile = path.join(getInstanceDir(instanceId), 'server.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        // 檢查進程是否存在
        process.kill(pid, 0);
        return true;
      } catch {
        // 進程不存在，清理 PID 文件
        try {
          fs.unlinkSync(pidFile);
        } catch {
          // ignore
        }
      }
    }

    return false;
  }

  /**
   * 取得實例狀態
   */
  getStatus(instanceId: string): InstanceStatus | null {
    const config = loadInstanceConfig(instanceId);
    if (!config) {
      return null;
    }

    const running = this.isRunning(instanceId);
    let pid: number | undefined;

    const pidFile = path.join(getInstanceDir(instanceId), 'server.pid');
    if (fs.existsSync(pidFile)) {
      try {
        pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
      } catch {
        // ignore
      }
    }

    return {
      id: config.id,
      name: config.name,
      role: config.role,
      port: config.port,
      running,
      pid,
    };
  }

  /**
   * 列出所有實例狀態
   */
  listStatus(): InstanceStatus[] {
    const instances = this.list();
    return instances.map((config) => ({
      id: config.id,
      name: config.name,
      role: config.role,
      port: config.port,
      running: this.isRunning(config.id),
    }));
  }

  /**
   * 重啟實例
   */
  async restart(instanceId: string): Promise<boolean> {
    this.stop(instanceId);
    return this.start(instanceId);
  }

  /**
   * 停止所有實例
   */
  stopAll(): void {
    for (const instanceId of this.runningInstances.keys()) {
      this.stop(instanceId);
    }
  }
}

// =============================================================================
// Singleton & Helpers
// =============================================================================

let instanceManager: InstanceManager | null = null;

/**
 * 取得實例管理器
 */
export function getInstanceManager(): InstanceManager {
  if (!instanceManager) {
    instanceManager = new InstanceManager();
  }
  return instanceManager;
}

/**
 * 驗證實例 ID
 */
export function validateInstanceId(instanceId: string): boolean {
  if (!instanceId || typeof instanceId !== 'string') {
    return false;
  }

  // 只允許字母、數字、連字號
  const validPattern = /^[a-zA-Z0-9-]+$/;
  return validPattern.test(instanceId);
}

/**
 * 取得或創建預設實例
 */
export function getOrCreateDefaultInstance(): InstanceConfig {
  initDataDir();
  let config = loadInstanceConfig('default');

  if (!config) {
    // 手動創建 default 實例（不走 createInstance 以避免 UUID）
    const globalConfig = loadGlobalConfig();
    config = {
      id: 'default',
      name: 'Default Instance',
      role: 'standalone',
      port: globalConfig.defaults.port,
      createdAt: new Date().toISOString(),
    };
    saveInstanceConfig('default', config);
  }

  return config;
}

/**
 * 取得當前實例 ID（從環境變數或使用 default）
 */
export function getCurrentInstanceId(): string {
  return process.env.MINI_AGENT_INSTANCE || 'default';
}
