/**
 * Workspace Perception — Minimal Core Enhanced
 *
 * Lightweight workspace awareness via git commands.
 * Returns formatted status for OODA context injection.
 */

import { execFileSync } from 'node:child_process';

/**
 * Get workspace status: git status + recent commits
 */
export function getWorkspaceStatus(cwd?: string): string {
  const dir = cwd ?? process.cwd();
  const lines: string[] = [];

  // Git status (uncommitted changes)
  try {
    const status = execFileSync('git', ['status', '--short'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (status) {
      lines.push('Uncommitted changes:');
      // Limit to 15 lines
      const statusLines = status.split('\n');
      lines.push(...statusLines.slice(0, 15));
      if (statusLines.length > 15) lines.push(`  ... and ${statusLines.length - 15} more`);
    } else {
      lines.push('Working tree clean');
    }
  } catch {
    lines.push('(git status unavailable)');
  }

  // Recent commits
  try {
    const log = execFileSync(
      'git',
      ['log', '--oneline', '--format=%h %s', '-5'],
      { cwd: dir, encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (log) {
      lines.push('');
      lines.push('Recent commits:');
      lines.push(log);
    }
  } catch { /* not a git repo or git unavailable */ }

  // Current branch
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (branch) lines.unshift(`Branch: ${branch}`);
  } catch { /* ignore */ }

  return lines.join('\n');
}
