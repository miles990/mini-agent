import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deploy script workspace janitor hook', () => {
  it('runs workspace janitor after successful health check without making deploy fail', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'deploy.sh'), 'utf-8');
    const successIndex = script.indexOf('log "Deployment successful"');
    const janitorIndex = script.indexOf('scripts/workspace-janitor.ts --apply');
    const exitIndex = script.indexOf('exit 0', successIndex);

    expect(successIndex).toBeGreaterThan(-1);
    expect(janitorIndex).toBeGreaterThan(successIndex);
    expect(janitorIndex).toBeLessThan(exitIndex);
    expect(script).toContain('MINI_AGENT_SKIP_WORKSPACE_JANITOR');
    expect(script).toContain('Workspace janitor failed (non-fatal)');
  });
});
