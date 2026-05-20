import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  BrainProvider,
  BrainRequest,
  BrainResult,
  ProviderCapabilities,
  ProviderHealth,
  WorkIntent,
} from './brain-types.js';

type SpawnFn = typeof spawn;
type ExecFileFn = typeof execFile;

export interface CodexCliProviderOptions {
  spawn?: SpawnFn;
  execFile?: ExecFileFn;
  timeoutMs?: number;
}

const BEST_FOR: WorkIntent[] = ['code', 'diagnose', 'verify', 'review'];

export class CodexCliProvider implements BrainProvider {
  readonly id = 'codex' as const;
  readonly capabilities: ProviderCapabilities = {
    canWrite: true,
    canUseShell: true,
    canUseMcp: false,
    bestFor: BEST_FOR,
  };

  private readonly spawnFn: SpawnFn;
  private readonly execFileFn: ExecFileFn;
  private readonly defaultTimeoutMs: number;

  constructor(opts: CodexCliProviderOptions = {}) {
    this.spawnFn = opts.spawn ?? spawn;
    this.execFileFn = opts.execFile ?? execFile;
    this.defaultTimeoutMs = opts.timeoutMs ?? 900_000;
  }

  async health(): Promise<ProviderHealth> {
    return new Promise(resolve => {
      this.execFileFn('sh', ['-lc', 'command -v codex'], { timeout: 3000 }, (err, stdout) => {
        if (err || !String(stdout || '').trim()) {
          resolve({
            available: false,
            detail: 'codex CLI unavailable; install/authenticate codex or set MINI_AGENT_CODEX_PROVIDER=middleware explicitly',
          });
          return;
        }
        resolve({ available: true, detail: 'codex CLI available' });
      });
    });
  }

  async run(req: BrainRequest): Promise<BrainResult> {
    const startedAt = Date.now();
    try {
      const text = await this.execCodex(this.formatPrompt(req), req);
      return {
        provider: 'codex',
        text,
        toolCalls: [],
        usage: { backend: 'codex-cli' },
        durationMs: Date.now() - startedAt,
        finishReason: 'success',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finishReason = /rate[_ -]?limit|quota|usage limit|out of extra usage|maximum budget/i.test(message)
        ? 'rate_limit'
        : /timeout|timed out/i.test(message) ? 'timeout' : 'error';
      return {
        provider: 'codex',
        text: message,
        toolCalls: [],
        usage: { backend: 'codex-cli' },
        durationMs: Date.now() - startedAt,
        finishReason,
      };
    }
  }

  async abort(_taskId: string, _reason: string): Promise<void> {
    // BrainRuntime does not currently keep Codex CLI child handles across calls.
    // Per-call timeouts still kill the process group in execCodex.
  }

  private formatPrompt(req: BrainRequest): string {
    return [
      req.systemPrompt.trim(),
      `<brain-request task="${req.taskId}" intent="${req.intent}" risk="${req.risk}" source="${req.source}">`,
      req.prompt.trim(),
      '</brain-request>',
    ].filter(Boolean).join('\n\n');
  }

  private execCodex(prompt: string, req: BrainRequest): Promise<string> {
    const timeoutMs = Math.min(req.timeoutMs || this.defaultTimeoutMs, this.defaultTimeoutMs);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== 'OPENAI_API_KEY'),
    ) as NodeJS.ProcessEnv;
    const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
    if (process.env.CODEX_MODEL) args.push('-m', process.env.CODEX_MODEL);

    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let buffer = '';
      let resultText = '';
      let timedOut = false;

      const child = this.spawnFn('codex', args, {
        cwd: req.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      }) as ChildProcessWithoutNullStreams;

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch { /* ignore */ }
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
          } catch { /* ignore */ }
        }, 5000);
      }, timeoutMs);

      child.stdout.on('data', chunk => {
        const text = chunk.toString('utf8');
        stdout += text;
        buffer += text;
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) resultText = extractCodexAgentText(line) ?? resultText;
        }
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (buffer.trim()) resultText = extractCodexAgentText(buffer.trim()) ?? resultText;
        if (code === 0 && resultText.trim()) {
          resolve(resultText.trim());
          return;
        }
        const detail = [stderr.trim(), resultText.trim(), stdout.trim()].filter(Boolean).join('\n').slice(0, 4000);
        reject(new Error(timedOut
          ? `Codex CLI timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ''}`
          : `Codex CLI exited with code ${code}${detail ? `: ${detail}` : ''}`));
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

function extractCodexAgentText(line: string): string | null {
  try {
    const event = JSON.parse(line);
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      return event.item.text;
    }
  } catch { /* ignore non-JSON output */ }
  return null;
}
