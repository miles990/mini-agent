/**
 * SDK Client — Agent SDK 替代 CLI subprocess 的執行層
 *
 * Phase A of thinking-mechanisms-upgrade proposal.
 * Feature flag `USE_SDK=true` 啟用；預設走舊 `execClaude` CLI path。
 *
 * 設計原則：
 * - Signature 對齊現有 execClaude（input: fullPrompt + opts → output: Promise<string>）
 * - Auth：沿用 Claude Code 訂閱（SDK auto-detect），維持原 env filter
 * - Thinking：maxThinkingTokens 預設 0（不啟用），B8 之後 rubric 動態指派
 * - Timeout：AbortController 取代 process kill
 *
 * Known limits（per POC 2026-04-17）：
 * - 訂閱 mode 下 thinking content 被代理層過濾（只保留 signature）
 * - Quality benefit 可拿，trace-level observability 需 API key mode（Phase B B1-B6）
 */

import type { ExecOptions } from './agent.js';
import { slog } from './utils.js';

export async function execClaudeViaSdk(
  fullPrompt: string,
  opts?: ExecOptions,
): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const timeoutMs = opts?.timeoutMs ?? 1_500_000;
  const source = opts?.source ?? 'loop';
  const startTs = Date.now();

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort(new Error(`SDK query timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  // Maintain the same ANTHROPIC_API_KEY filter behavior as execClaude —
  // force subscription auth, never API-billed even if key exists in env.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  ) as Record<string, string>;

  const queryOptions: Parameters<typeof query>[0]['options'] = {
    abortController,
    env,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    tools: { type: 'preset', preset: 'claude_code' },
  };
  if (opts?.model) queryOptions.model = opts.model;
  if (opts?.maxThinkingTokens && opts.maxThinkingTokens > 0) {
    queryOptions.maxThinkingTokens = opts.maxThinkingTokens;
  }

  const chunks: string[] = [];
  let blockCount = 0;
  let thinkingSeen = false;
  let thinkingChars = 0;
  let signatureChars = 0;
  let stopReason: string | null = null;
  let resultUsage: Record<string, unknown> | null = null;
  let model: string | null = null;

  try {
    for await (const message of query({ prompt: fullPrompt, options: queryOptions })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          blockCount++;
          if (block.type === 'thinking') {
            thinkingSeen = true;
            const t = (block as { thinking?: string }).thinking ?? '';
            const sig = (block as { signature?: string }).signature ?? '';
            thinkingChars += t.length;
            signatureChars += sig.length;
          } else if ('text' in block && typeof block.text === 'string') {
            chunks.push(block.text);
          }
        }
        if (message.message.stop_reason) stopReason = message.message.stop_reason;
        if (message.message.model) model = message.message.model;
      } else if (message.type === 'result') {
        const durationMs = Date.now() - startTs;
        // Per Kuro msg 044: A3 canary 需 thinking length / stop_reason / usage delta 為 baseline
        const m = message as { usage?: Record<string, unknown> };
        resultUsage = m.usage ?? null;
        const inputTok = (resultUsage?.input_tokens as number | undefined) ?? 0;
        const outputTok = (resultUsage?.output_tokens as number | undefined) ?? 0;
        const cacheRead = (resultUsage?.cache_read_input_tokens as number | undefined) ?? 0;
        const cacheCreate = (resultUsage?.cache_creation_input_tokens as number | undefined) ?? 0;
        slog(
          'SDK',
          `source=${source} model=${model ?? '?'} blocks=${blockCount} ` +
            `thinking=${thinkingSeen}(chars=${thinkingChars},sig=${signatureChars}) ` +
            `stop=${stopReason ?? '?'} ` +
            `tok={in:${inputTok},out:${outputTok},cacheR:${cacheRead},cacheW:${cacheCreate}} ` +
            `duration=${durationMs}ms`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`SDK query failed: ${msg}`), {
      cause: err,
      duration: Date.now() - startTs,
      timeoutMs,
      source,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }

  return chunks.join('');
}

/**
 * Check if SDK path is enabled via feature flag.
 * Default: false (走舊 CLI path).
 */
export function isSdkEnabled(): boolean {
  const v = process.env.USE_SDK?.toLowerCase();
  return v === 'true' || v === '1';
}
