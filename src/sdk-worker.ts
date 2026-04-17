/**
 * SDK Worker — runs `@anthropic-ai/claude-agent-sdk` query() in a worker_threads thread.
 *
 * Why: SDK stream parsing + crypto/JSON work synchronously block the Node main event loop.
 * When a cycle is in flight, HTTP server / cron / perception all freeze. Isolating the SDK
 * in a worker lets the main thread stay responsive regardless of API latency.
 *
 * Protocol (parent → worker):
 *   - workerData: { fullPrompt, queryOptions, env, source, model }
 *   - parent message { type: 'abort', reason } → abort the in-flight query
 *
 * Protocol (worker → parent):
 *   - { type: 'sdk-message', message } — each message from the SDK async iterator
 *   - { type: 'done' } — iterator exhausted successfully
 *   - { type: 'error', message } — iterator threw
 */

import { parentPort, workerData } from 'node:worker_threads';

interface WorkerInit {
  fullPrompt: string;
  queryOptions: Record<string, unknown>;
  env: Record<string, string>;
  source: string;
  model?: string;
  maxThinkingTokens?: number;
}

if (!parentPort) {
  throw new Error('sdk-worker must be spawned as a worker_thread');
}

const init = workerData as WorkerInit;
const abortController = new AbortController();

parentPort.on('message', (msg: { type: string; reason?: string }) => {
  if (msg.type === 'abort') {
    abortController.abort(new Error(msg.reason ?? 'aborted by parent'));
  }
});

// Overwrite env on the worker's process.env so SDK auth picks up the filtered set
for (const [k, v] of Object.entries(init.env)) {
  process.env[k] = v;
}
// Explicit: never billed via API key, always subscription auth
delete process.env.ANTHROPIC_API_KEY;

(async () => {
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const options = {
      ...init.queryOptions,
      abortController,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
      tools: { type: 'preset' as const, preset: 'claude_code' as const },
    };
    if (init.model) (options as Record<string, unknown>).model = init.model;
    if (init.maxThinkingTokens && init.maxThinkingTokens > 0) {
      (options as Record<string, unknown>).maxThinkingTokens = init.maxThinkingTokens;
    }

    for await (const message of query({ prompt: init.fullPrompt, options: options as Parameters<typeof query>[0]['options'] })) {
      parentPort!.postMessage({ type: 'sdk-message', message });
    }
    parentPort!.postMessage({ type: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ type: 'error', message });
  }
})();
