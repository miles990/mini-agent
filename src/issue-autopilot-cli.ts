#!/usr/bin/env node
import path from 'node:path';
import { detectGitHubRepo, readOpenIssuesFromGitHub, syncGitHubIssuesToTasks } from './issue-autopilot.js';

const args = new Set(process.argv.slice(2));
const repo = readArg('--repo') ?? process.env.MINI_AGENT_GITHUB_REPO ?? detectGitHubRepo();
const memoryDir = path.resolve(readArg('--memory') ?? process.env.MINI_AGENT_MEMORY_DIR ?? 'memory');
const limit = Number(readArg('--limit') ?? process.env.MINI_AGENT_GITHUB_ISSUE_LIMIT ?? '50');
const dryRun = args.has('--dry-run');
const json = args.has('--json');

if (!repo) {
  process.stderr.write('[issue-autopilot] missing repo. Pass --repo owner/name or set MINI_AGENT_GITHUB_REPO.\n');
  process.exit(2);
}

try {
  const issues = readOpenIssuesFromGitHub(repo, limit);
  const result = await syncGitHubIssuesToTasks(memoryDir, issues, { repo, dryRun });
  if (json) {
    process.stdout.write(JSON.stringify({
      scanned: result.scanned,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      tasks: result.plans.map(plan => ({
        id: plan.id,
        issue: plan.issueNumber,
        priority: plan.priority,
        summary: plan.summary,
      })),
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`[issue-autopilot] scanned=${result.scanned} created=${result.created} updated=${result.updated} skipped=${result.skipped}\n`);
  }
} catch (error) {
  process.stderr.write(`[issue-autopilot] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}
