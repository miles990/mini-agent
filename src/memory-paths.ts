import path from 'node:path';

const MEMORY_DIR_ENV = 'MINI_AGENT_MEMORY_DIR';

export function getMemoryRootDir(cwd = process.cwd()): string {
  const configured = process.env[MEMORY_DIR_ENV]?.trim();
  if (configured) return path.resolve(configured);
  return path.join(cwd, 'memory');
}

export function getMemoryStateRootDir(cwd = process.cwd()): string {
  return path.join(getMemoryRootDir(cwd), 'state');
}

export function resolveMemoryPath(...segments: string[]): string {
  return path.join(getMemoryRootDir(), ...segments);
}

export function getMemoryDirSource(): 'env' | 'repo-default' {
  return process.env[MEMORY_DIR_ENV]?.trim() ? 'env' : 'repo-default';
}

