/**
 * Configuration System - File-based settings
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_DIR = path.join(process.cwd(), 'memory');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Configuration schema
 */
export interface Config {
  /** Proactive schedule (cron expression) */
  proactiveSchedule: string;
  /** Auto-start proactive on server start */
  proactiveAutoStart: boolean;
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
  proactiveSchedule: '*/30 * * * *',  // Every 30 minutes
  proactiveAutoStart: false,
  model: 'default',
  outputDir: '.',
  maxSearchResults: 5,
  claudeTimeout: 120000,
};

/**
 * Read configuration
 */
export async function getConfig(): Promise<Config> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Update configuration (partial update)
 */
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const current = await getConfig();
  const updated = { ...current, ...updates };

  await fs.writeFile(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig(): Promise<Config> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  return { ...DEFAULT_CONFIG };
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
