import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deploy script workspace janitor hook', () => {
  it('serializes deployments with a process lock', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'deploy.sh'), 'utf-8');
    const lockIndex = script.indexOf('LOCK_DIR="$HOME/.mini-agent/deploy.lock"');
    const acquireIndex = script.indexOf('acquire_lock');
    const startIndex = script.indexOf('log "Starting deployment..."');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(acquireIndex).toBeGreaterThan(lockIndex);
    expect(acquireIndex).toBeLessThan(startIndex);
    expect(script).toContain('Another deploy is already running');
    expect(script).toContain('waiting up to ${DEPLOY_LOCK_WAIT_SECONDS}s');
    expect(script).toContain('requesting graceful shutdown');
    expect(script).toContain('kill -TERM "$LOCK_PID"');
    expect(script).toContain('force killing before new deploy');
    expect(script).toContain("trap 'rm -rf \"$LOCK_DIR\"' EXIT");
  });

  it('runs workspace janitor after successful health check without making deploy fail', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'deploy.sh'), 'utf-8');
    const successIndex = script.indexOf('log "Deployment successful"');
    const janitorIndex = script.indexOf('scripts/workspace-janitor.ts --apply');
    const exitIndex = script.indexOf('exit 0', successIndex);

    expect(successIndex).toBeGreaterThan(-1);
    expect(janitorIndex).toBeGreaterThan(successIndex);
    expect(janitorIndex).toBeLessThan(exitIndex);
    expect(script).toContain('MINI_AGENT_SKIP_WORKSPACE_JANITOR');
    expect(script).toContain('Skipping workspace janitor because deploy checkout is not on runtime/main');
    expect(script).toContain('Skipping workspace janitor because deploy checkout has unresolved conflicts');
    expect(script).toContain('Workspace janitor failed (non-fatal)');
  });

  it('exports external memory paths before starting the runtime service', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'deploy.sh'), 'utf-8');
    const defaultMemoryIndex = script.indexOf('DEFAULT_MEMORY_DIR="$(dirname "$DEPLOY_DIR")/mini-agent-memory/memory"');
    const exportIndex = script.indexOf('export MINI_AGENT_MEMORY_DIR="${MINI_AGENT_MEMORY_DIR:-$DEFAULT_MEMORY_DIR}"');
    const startIndex = script.indexOf('node "$DEPLOY_DIR/dist/cli.js" up -d');

    expect(defaultMemoryIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeGreaterThan(defaultMemoryIndex);
    expect(exportIndex).toBeLessThan(startIndex);
    expect(script).toContain('export MINI_AGENT_MEMORY="${MINI_AGENT_MEMORY:-$MINI_AGENT_MEMORY_DIR}"');
  });
});
