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

  // Convergence condition (2026-04-17 incident root fix): cycle MUST complete in bounded time.
  // Prior defaults (25min hard / 15min no-progress) let transient Anthropic API slowdowns
  // block the whole event loop for minutes — HTTP server silent, cycles piling up, launchd
  // respawning on its own. Fail fast, release the loop, let the cycle retry fresh.
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const progressTimeoutMs = opts?.progressTimeoutMs ?? 30_000;
  const source = opts?.source ?? 'loop';
  const startTs = Date.now();
  let lastProgressTs = Date.now();

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort(new Error(`SDK query timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  // Per Kuro msg 049 fix #2: stall-kill (no-progress timeout) parity with CLI path.
  // CLI execClaude has progressTimeoutMs default 900s; SDK needed equivalent.
  const stallCheckHandle = setInterval(() => {
    if (Date.now() - lastProgressTs > progressTimeoutMs) {
      abortController.abort(
        new Error(`SDK query stalled — no progress for ${progressTimeoutMs}ms`),
      );
    }
  }, 5_000);

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
  // Per Kuro msg 049 nice-to-have #1: blockCount by type for debug visibility
  const blocksByType: Record<string, number> = {};
  let thinkingChars = 0;
  let signatureChars = 0;
  let stopReason: string | null = null;
  let resultUsage: Record<string, unknown> | null = null;
  let model: string | null = null;

  try {
    for await (const message of query({ prompt: fullPrompt, options: queryOptions })) {
      lastProgressTs = Date.now(); // refresh stall timer on every message
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          blocksByType[block.type] = (blocksByType[block.type] ?? 0) + 1;
          if (block.type === 'thinking') {
            const t = (block as { thinking?: string }).thinking ?? '';
            const sig = (block as { signature?: string }).signature ?? '';
            thinkingChars += t.length;
            signatureChars += sig.length;
          } else if ('text' in block && typeof block.text === 'string') {
            chunks.push(block.text);
            // Per Kuro msg 049 fix #1: wire onPartialOutput for streaming UX parity.
            // CLI path live feature (agent.ts:1451-1452, 1477, 881-882) — downstream
            // consumers (e.g. createKuroChatStreamParser) depend on it.
            if (opts?.onPartialOutput && block.text) {
              try { opts.onPartialOutput(block.text); } catch { /* swallow consumer errors */ }
            }
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
        // Per Kuro msg 049 nice-to-have #2: thinkingState 區分 訂閱(signature_only) vs API(visible) vs none
        const thinkingState =
          thinkingChars > 0 ? 'visible' : signatureChars > 0 ? 'signature_only' : 'none';
        const blocksStr = Object.entries(blocksByType)
          .map(([k, v]) => `${k}:${v}`)
          .join(',');
        slog(
          'SDK',
          `source=${source} model=${model ?? '?'} blocks={${blocksStr}} ` +
            `thinking=${thinkingState}(chars=${thinkingChars},sig=${signatureChars}) ` +
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
      progressTimeoutMs,
      source,
    });
  } finally {
    clearTimeout(timeoutHandle);
    clearInterval(stallCheckHandle);
  }

  return chunks.join('');
}

/**
 * Check if SDK path is enabled via feature flag.
 *
 * A4 (2026-04-17): default FLIPPED to true — SDK is primary path.
 * Legacy CLI subprocess path remains fully functional, reachable via
 * USE_SDK=false (explicit opt-out). Planned to delete in A5 after 2 weeks
 * of no-regression observation in production.
 *
 * Default: true (SDK).  USE_SDK=false → legacy CLI path.
 */
export function isSdkEnabled(): boolean {
  const v = process.env.USE_SDK?.toLowerCase();
  if (v === 'false' || v === '0') return false;
  // Any other value (unset, 'true', '1', '') → SDK (A4 default)
  return true;
}
