/**
 * SDK Worker — spawned via `child_process.fork` to run the Anthropic Agent SDK
 * in a fully isolated Node process.
 *
 * Why fork instead of worker_threads:
 *   2026-04-17 D16 diagnostic showed that running the SDK in a worker_thread
 *   still blocked the parent's main event loop for the entire API call (180s
 *   lag SPIKE = 180s API duration). Node worker_threads share libuv resources
 *   with the parent, and the pattern of "parent awaits long I/O from worker"
 *   apparently stalls parent timers. child_process.fork spawns a separate OS
 *   process with its own event loop — no shared libuv, no shared memory,
 *   IPC is pure async, parent event loop never blocks.
 *
 * Protocol (parent → child):
 *   - { type: 'init', init: WorkerInit } — first message kicks off query
 *   - { type: 'abort', reason: string } — abort the in-flight query
 *
 * Protocol (child → parent):
 *   - { type: 'sdk-message', message } — each message from the SDK async iterator
 *   - { type: 'done' } — iterator exhausted successfully
 *   - { type: 'error', message: string } — iterator threw
 *
 * After emitting 'done' or 'error', the child exits so the parent can clean up.
 */

interface WorkerInit {
  fullPrompt: string;
  queryOptions: Record<string, unknown>;
  env: Record<string, string>;
  source: string;
  model?: string;
  maxThinkingTokens?: number;
  cwd?: string;
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

if (!process.send) {
  throw new Error('sdk-worker must be spawned via child_process.fork (process.send unavailable)');
}

const abortController = new AbortController();
let initialized = false;

process.on('message', (msg: { type: string; init?: WorkerInit; reason?: string }) => {
  if (msg.type === 'init' && msg.init && !initialized) {
    initialized = true;
    void run(msg.init);
    return;
  }
  if (msg.type === 'abort') {
    abortController.abort(new Error(msg.reason ?? 'aborted by parent'));
  }
});

async function run(init: WorkerInit): Promise<void> {
  // Overwrite env on the child's process.env so SDK auth picks up the filtered set.
  // This is safe: the child is its own process.
  for (const [k, v] of Object.entries(init.env)) {
    process.env[k] = v;
  }
  // Explicit: never billed via API key, always subscription auth.
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const options: Record<string, unknown> = {
      ...init.queryOptions,
      abortController,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
      tools: { type: 'preset' as const, preset: 'claude_code' as const },
    };
    if (init.model) options.model = init.model;
    if (init.maxThinkingTokens && init.maxThinkingTokens > 0) {
      options.maxThinkingTokens = init.maxThinkingTokens;
    }
    if (init.cwd) options.cwd = init.cwd;
    if (init.allowedTools && init.allowedTools.length > 0) options.allowedTools = init.allowedTools;
    if (init.maxTurns && init.maxTurns > 0) options.maxTurns = init.maxTurns;
    if (init.permissionMode) options.permissionMode = init.permissionMode;

    let turnsUsed = 0;
    for await (const message of query({
      prompt: init.fullPrompt,
      options: options as Parameters<typeof query>[0]['options'],
    })) {
      if ((message as { type?: string }).type === 'assistant') turnsUsed++;
      process.send!({ type: 'sdk-message', message });
    }
    process.send!({ type: 'done', turns_used: turnsUsed, max_turns: init.maxTurns ?? null });
    // Let the parent observe 'done' then exit cleanly.
    setTimeout(() => process.exit(0), 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.send!({ type: 'error', message });
    setTimeout(() => process.exit(1), 100);
  }
}
