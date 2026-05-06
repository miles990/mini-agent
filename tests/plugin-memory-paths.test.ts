import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('plugin memory path policy', () => {
  it('does not force Issue Autopilot writes into the runtime checkout memory directory', () => {
    const script = readFileSync(path.join(process.cwd(), 'plugins', 'github-issues.sh'), 'utf-8');

    expect(script).toContain('MEMORY_DIR="${MINI_AGENT_MEMORY_DIR:-${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}}"');
    expect(script).toContain('MINI_AGENT_MEMORY_DIR="$MEMORY_DIR" node "$PROJECT_DIR/dist/issue-autopilot-cli.js"');
    expect(script).not.toContain('MINI_AGENT_MEMORY_DIR="$PROJECT_DIR/memory"');
  });

  it('reads handoffs from the configured memory root', () => {
    const script = readFileSync(path.join(process.cwd(), 'plugins', 'handoff-watcher.sh'), 'utf-8');

    expect(script).toContain('MEMORY_DIR="${MINI_AGENT_MEMORY_DIR:-${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}}"');
    expect(script).toContain('cd "$MEMORY_DIR/handoffs"');
    expect(script).not.toContain('../memory/handoffs');
  });
});
