import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Bucket {
  calls: number;
  promptChars: number;
  estInputTokens: number;
  durationMs: number;
}

function add(bucket: Map<string, Bucket>, key: string, promptChars: number, durationMs = 0): void {
  const current = bucket.get(key) ?? { calls: 0, promptChars: 0, estInputTokens: 0, durationMs: 0 };
  current.calls += 1;
  current.promptChars += promptChars;
  current.estInputTokens += Math.round(promptChars / 4);
  current.durationMs += durationMs;
  bucket.set(key, current);
}

function classifyPrompt(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('check heartbeat.md for pending tasks')) return 'heartbeat-cron';
  if (p.includes('binding="open-cycle"') || p.includes('open cycle')) return 'open-cycle/discovery';
  if (p.includes('binding="scheduler"') || p.includes('scheduler task') || p.includes('autonomy closure')) return 'autonomy-closure/scheduler';
  if (p.includes('continue-current') || p.includes('binding="continue"')) return 'continue-current';
  if (p.includes('telegram-user') || p.includes('chat-room-inbox') || p.includes('room-priority')) return 'foreground/status-room';
  if (p.includes('delegation') || p.includes('background-completed')) return 'delegation-absorb';
  return 'other';
}

function readJsonl(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function findClaudeLogs(date: string, root = path.join(os.homedir(), '.mini-agent', 'instances')): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, 'logs', 'claude', `${date}.jsonl`))
    .filter(file => fs.existsSync(file));
}

function formatTable(title: string, buckets: Map<string, Bucket>): void {
  const rows = [...buckets.entries()]
    .sort((a, b) => b[1].estInputTokens - a[1].estInputTokens);
  const totalTokens = rows.reduce((sum, [, b]) => sum + b.estInputTokens, 0);
  const totalCalls = rows.reduce((sum, [, b]) => sum + b.calls, 0);

  console.log(`\n${title}`);
  console.log(`total_calls=${totalCalls} est_input_tokens=${totalTokens}${totalTokens === 0 ? ' token_telemetry=missing' : ''}`);
  for (const [name, b] of rows) {
    const pct = totalTokens === 0 ? 0 : Math.round((b.estInputTokens / totalTokens) * 100);
    const sec = Math.round(b.durationMs / 1000);
    const tokenCell = totalTokens === 0
      ? 'tokens=unknown'
      : `tokens=${String(b.estInputTokens).padStart(8)} pct=${String(pct).padStart(3)}%`;
    console.log(`${name.padEnd(30)} calls=${String(b.calls).padStart(4)} ${tokenCell} duration_s=${sec}`);
  }
}

function main(): void {
  const date = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? new Date().toISOString().slice(0, 10);
  const memoryDir = process.env.MINI_AGENT_MEMORY_DIR ?? path.join(process.cwd(), 'memory');
  const cloud = new Map<string, Bucket>();

  for (const file of findClaudeLogs(date)) {
    for (const row of readJsonl(file)) {
      const obj = row as {
        data?: { input?: { userMessage?: string }, duration?: number },
        metadata?: { duration?: number },
      };
      const prompt = obj.data?.input?.userMessage ?? '';
      if (!prompt) continue;
      const durationMs = Number(obj.data?.duration ?? obj.metadata?.duration ?? 0);
      add(cloud, classifyPrompt(prompt), prompt.length, Number.isFinite(durationMs) ? durationMs : 0);
    }
  }

  const brain = new Map<string, Bucket>();
  const brainRuns = path.join(memoryDir, 'index', 'brain-runs.jsonl');
  for (const row of readJsonl(brainRuns)) {
    const obj = row as {
      createdAt?: string,
      actor?: string,
      status?: string,
      intent?: string,
      event?: string,
      usageEstimate?: { totalTokens?: number, promptTokens?: number, systemTokens?: number, contextTokens?: number },
      durationMs?: number,
    };
    if (!obj.createdAt?.startsWith(date)) continue;
    const key = `${obj.actor ?? 'runtime'}:${obj.status ?? 'unknown'}:${obj.intent ?? obj.event ?? 'unknown'}`;
    const usageTokens = Number(
      obj.usageEstimate?.totalTokens
      ?? ((obj.usageEstimate?.promptTokens ?? 0) + (obj.usageEstimate?.systemTokens ?? 0) + (obj.usageEstimate?.contextTokens ?? 0)),
    );
    add(brain, key, Number.isFinite(usageTokens) ? usageTokens * 4 : 0, Number(obj.durationMs ?? 0));
  }

  formatTable(`Cloud Claude prompt usage ${date}`, cloud);
  formatTable(`BrainRuntime usage ${date}`, brain);

  const cloudTokens = [...cloud.values()].reduce((sum, b) => sum + b.estInputTokens, 0);
  const shellCalls = [...brain.entries()]
    .filter(([name]) => name.startsWith('shell:'))
    .reduce((sum, [, b]) => sum + b.calls, 0);
  const brainCalls = [...brain.values()].reduce((sum, b) => sum + b.calls, 0);
  console.log(`\nroute_hint cloud_tokens=${cloudTokens} shell_calls=${shellCalls}/${brainCalls} shell_call_ratio=${brainCalls === 0 ? 0 : Math.round((shellCalls / brainCalls) * 100)}%`);
}

main();
