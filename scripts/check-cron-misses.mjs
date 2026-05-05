#!/usr/bin/env node
// check-cron-misses.mjs — detect cron schedule drift for trend scripts.
// Compares current crontab schedule vs today's output file mtime per script.
// Exit 0 always (informational); prints compact report to stdout.
//
// Usage: node scripts/check-cron-misses.mjs [--json]
// Author: Kuro (cycle 129, 2026-05-05) — memory→tooling固化 from cycle 121-127 5-cycle-spin lesson.

import { execSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/user/Workspace/mini-agent';
const TOLERANCE_HOURS = 2; // delay grace beyond scheduled hour before flagging

// script-name (basename minus .mjs) → output dir under memory/state/
const SCRIPT_TO_DIR = {
  'latent-space-trend': 'latent-space-trend',
  'arxiv-ai-trend': 'arxiv-trend',
  'github-ai-trend': 'github-trend',
};

function parseCrontab() {
  const raw = execSync('crontab -l', { encoding: 'utf8' });
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // match: M H * * * ... node scripts/<name>.mjs
    const m = line.match(/^(\S+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s+.*?scripts\/([a-z0-9-]+)\.mjs/);
    if (!m) continue;
    const [, minute, hour, name] = m;
    if (!SCRIPT_TO_DIR[name]) continue;
    out.push({ name, hour: Number(hour), minute: Number(minute), dir: SCRIPT_TO_DIR[name] });
  }
  return out;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function check(jobs) {
  const today = todayLocalISO();
  const now = new Date();
  const reports = [];
  for (const job of jobs) {
    const file = path.join(ROOT, 'memory/state', job.dir, `${today}.json`);
    const scheduledTodayMs = new Date().setHours(job.hour, job.minute, 0, 0);
    const exists = existsSync(file);
    let status = 'OK', detail = '';
    if (!exists) {
      const hoursPastSchedule = (now.getTime() - scheduledTodayMs) / 3.6e6;
      if (hoursPastSchedule > TOLERANCE_HOURS) {
        status = 'MISSING';
        detail = `expected ${String(job.hour).padStart(2,'0')}:${String(job.minute).padStart(2,'0')}, ${hoursPastSchedule.toFixed(1)}h past, no file`;
      } else if (hoursPastSchedule >= 0) {
        status = 'PENDING';
        detail = `expected ${String(job.hour).padStart(2,'0')}:${String(job.minute).padStart(2,'0')}, ${hoursPastSchedule.toFixed(1)}h grace`;
      } else {
        status = 'NOT_DUE';
        detail = `expected ${String(job.hour).padStart(2,'0')}:${String(job.minute).padStart(2,'0')} (in ${(-hoursPastSchedule).toFixed(1)}h)`;
      }
    } else {
      const st = statSync(file);
      const mtime = st.mtime;
      const driftHours = (mtime.getTime() - scheduledTodayMs) / 3.6e6;
      const mtimeStr = `${String(mtime.getHours()).padStart(2,'0')}:${String(mtime.getMinutes()).padStart(2,'0')}`;
      if (driftHours > TOLERANCE_HOURS) {
        status = 'LATE';
        detail = `mtime ${mtimeStr}, ${driftHours.toFixed(1)}h after ${String(job.hour).padStart(2,'0')}:${String(job.minute).padStart(2,'0')}`;
      } else if (driftHours < -0.5) {
        status = 'EARLY';
        detail = `mtime ${mtimeStr}, before scheduled ${String(job.hour).padStart(2,'0')}:${String(job.minute).padStart(2,'0')}`;
      } else {
        detail = `mtime ${mtimeStr}, drift ${driftHours.toFixed(1)}h`;
      }
    }
    reports.push({ script: job.name, status, detail, file });
  }
  return reports;
}

function main() {
  const jsonMode = process.argv.includes('--json');
  const jobs = parseCrontab();
  if (jobs.length === 0) {
    console.error('no matching cron entries found');
    process.exit(0);
  }
  const reports = check(jobs);
  if (jsonMode) {
    console.log(JSON.stringify({ checked_at: new Date().toISOString(), reports }, null, 2));
    return;
  }
  const flagged = reports.filter(r => r.status === 'MISSING' || r.status === 'LATE');
  console.log(`# cron-miss check ${todayLocalISO()} ${new Date().toLocaleTimeString('en-GB')}`);
  for (const r of reports) {
    console.log(`  ${r.status.padEnd(8)} ${r.script.padEnd(22)} ${r.detail}`);
  }
  if (flagged.length > 0) {
    console.log(`\n⚠ ${flagged.length} script(s) flagged: ${flagged.map(r => r.script).join(', ')}`);
  }
}

main();
