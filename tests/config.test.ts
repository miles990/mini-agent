import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock the instance module before importing config
vi.mock('../src/instance.js', () => ({
  getCurrentInstanceId: () => 'test-config',
  getInstanceDir: (id: string) => path.join(os.tmpdir(), `mini-agent-config-test-${process.pid}`, id),
  loadInstanceConfig: () => null,
  getGlobalDefaults: () => ({
    port: 3001,
    proactiveSchedule: '*/30 * * * *',
    claudeTimeout: 120000,
    maxSearchResults: 5,
  }),
  initDataDir: () => {},
}));

import { getConfig, updateConfig, resetConfig, DEFAULT_CONFIG } from '../src/config.js';

const configDir = path.join(os.tmpdir(), `mini-agent-config-test-${process.pid}`, 'test-config');

describe('Config', () => {
  beforeEach(async () => {
    await fs.mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.join(os.tmpdir(), `mini-agent-config-test-${process.pid}`), {
      recursive: true,
      force: true,
    });
  });

  it('should return defaults when no config file exists', async () => {
    const config = await getConfig();
    expect(config.proactiveAutoStart).toBe(DEFAULT_CONFIG.proactiveAutoStart);
    expect(config.model).toBe('default');
    expect(config.claudeTimeout).toBe(120000);
  });

  it('should merge local config with defaults', async () => {
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ model: 'gpt-4', proactiveAutoStart: true }),
      'utf-8'
    );

    const config = await getConfig();
    expect(config.model).toBe('gpt-4');
    expect(config.proactiveAutoStart).toBe(true);
    // Defaults should still apply for unset values
    expect(config.outputDir).toBe('.');
  });

  it('should update config partially', async () => {
    const updated = await updateConfig({ model: 'claude-3' });
    expect(updated.model).toBe('claude-3');
    // Other values should be preserved
    expect(updated.claudeTimeout).toBe(120000);
  });

  it('should reset config to defaults', async () => {
    await updateConfig({ model: 'custom-model' });
    const reset = await resetConfig();
    expect(reset.model).toBe('default');
  });
});
