/**
 * Configuration System - Instance-aware settings
 *
 * 支援：
 * - 全域配置（~/.mini-agent/config.yaml）
 * - 實例配置（~/.mini-agent/instances/{id}/instance.yaml）
 * - 本地配置（./memory/config.json）作為向後兼容
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getCurrentInstanceId,
  getInstanceDir,
  loadInstanceConfig,
  getGlobalDefaults,
  initDataDir,
} from './instance.js';
import type { GlobalDefaults, InstanceConfig } from './types.js';

// 本地配置目錄（向後兼容）
const LOCAL_CONFIG_DIR = path.join(process.cwd(), 'memory');
const LOCAL_CONFIG_FILE = path.join(LOCAL_CONFIG_DIR, 'config.json');

/**
 * Configuration schema
 */
export interface Config {
  /** Default model (if supported) */
  model: string;
  /** Output directory for generated files */
  outputDir: string;
  /** Max memory search results */
  maxSearchResults: number;
  /** Claude CLI timeout (ms) */
  claudeTimeout: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Config = {
  model: 'default',
  outputDir: '.',
  maxSearchResults: 5,
  claudeTimeout: 120000,
};

/**
 * 從 GlobalDefaults 轉換為 Config
 */
function globalDefaultsToConfig(defaults: GlobalDefaults): Partial<Config> {
  return {
    maxSearchResults: defaults.maxSearchResults,
    claudeTimeout: defaults.claudeTimeout,
  };
}

/**
 * 取得實例的配置目錄
 */
function getConfigDir(): string {
  const instanceId = getCurrentInstanceId();

  // 如果是 default 實例，優先使用本地目錄（向後兼容）
  if (instanceId === 'default' && process.cwd().includes('mini-agent')) {
    return LOCAL_CONFIG_DIR;
  }

  return getInstanceDir(instanceId);
}

/**
 * 取得配置檔案路徑
 */
function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Read configuration
 * 優先級：實例配置 > 全域配置 > 本地配置 > 預設值
 */
export async function getConfig(): Promise<Config> {
  // 初始化資料目錄
  initDataDir();

  // 取得全域預設值
  const globalDefaults = getGlobalDefaults();
  const globalConfig = globalDefaultsToConfig(globalDefaults);

  // 嘗試讀取本地配置
  let localConfig: Partial<Config> = {};
  try {
    const content = await fs.readFile(getConfigPath(), 'utf-8');
    localConfig = JSON.parse(content);
  } catch {
    // 沒有本地配置
  }

  // 合併配置
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...localConfig,
  };
}

/**
 * Update configuration (partial update)
 */
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });

  const current = await getConfig();
  const updated = { ...current, ...updates };

  await fs.writeFile(getConfigPath(), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig(): Promise<Config> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });

  // 取得全域預設值
  const globalDefaults = getGlobalDefaults();
  const globalConfig = globalDefaultsToConfig(globalDefaults);

  const resetted = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
  };

  await fs.writeFile(getConfigPath(), JSON.stringify(resetted, null, 2), 'utf-8');
  return resetted;
}

/**
 * Get a single config value
 */
export async function getConfigValue<K extends keyof Config>(key: K): Promise<Config[K]> {
  const config = await getConfig();
  return config[key];
}

/**
 * Set a single config value
 */
export async function setConfigValue<K extends keyof Config>(
  key: K,
  value: Config[K]
): Promise<Config> {
  return updateConfig({ [key]: value } as Partial<Config>);
}

/**
 * 取得實例完整配置（包含實例特定的設定）
 */
export async function getInstanceFullConfig(): Promise<{
  instance: InstanceConfig | null;
  config: Config;
}> {
  const instanceId = getCurrentInstanceId();
  const instance = loadInstanceConfig(instanceId);
  const config = await getConfig();

  return { instance, config };
}
