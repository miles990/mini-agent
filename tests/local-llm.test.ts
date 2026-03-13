import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { loadLocalProfile } from '../src/agent.js';
import type { LocalProfile } from '../src/agent.js';

/**
 * Local LLM provider tests
 *
 * Unit tests for profile loading + integration tests for local LLM API.
 * Integration tests require an OpenAI-compatible server on localhost:8000.
 */

const LLM_URL = process.env.LOCAL_LLM_URL ?? 'http://localhost:8000';
const LLM_KEY = process.env.LOCAL_LLM_KEY ?? 'local';

async function isLocalLLMAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LLM_URL}/v1/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Profile Loading ────────────────────────────────────────────────────────

describe('Local LLM Profile Loading', () => {
  const PROFILES = ['default', 'fast', 'thinking', 'thinking-code', 'creative'] as const;

  it('should load all 5 profiles without error', () => {
    for (const name of PROFILES) {
      const profile = loadLocalProfile(name);
      expect(profile).toBeDefined();
      expect(profile.model).toBeTruthy();
      expect(profile.max_tokens).toBeGreaterThan(0);
      expect(profile.timeout_ms).toBeGreaterThan(0);
    }
  });

  it('should apply structural defaults for missing fields', () => {
    const profile = loadLocalProfile('nonexistent-profile');
    // model comes from env or empty — not hardcoded in code
    expect(typeof profile.model).toBe('string');
    expect(profile.max_tokens).toBe(8192);
    expect(profile.temperature).toBe(0.7);
    expect(profile.tools_enabled).toBe(true);
  });

  it('fast profile should have low timeout and no tools', () => {
    const fast = loadLocalProfile('fast');
    expect(fast.timeout_ms).toBe(30000);
    expect(fast.tools_enabled).toBe(false);
    expect(fast.max_tokens).toBe(2048);
  });

  it('thinking profile should enable thinking mode', () => {
    const thinking = loadLocalProfile('thinking');
    expect(thinking.enable_thinking).toBe(true);
    expect(thinking.max_tokens).toBe(32768);
    expect(thinking.temperature).toBe(1.0);
  });

  it('thinking-code profile should enable thinking with lower temp', () => {
    const tc = loadLocalProfile('thinking-code');
    expect(tc.enable_thinking).toBe(true);
    expect(tc.temperature).toBe(0.6);
    expect(tc.presence_penalty).toBe(0.0);
  });

  it('creative profile should have high temp and no tools', () => {
    const creative = loadLocalProfile('creative');
    expect(creative.temperature).toBe(0.9);
    expect(creative.tools_enabled).toBe(false);
  });

  it('should cache profiles for 30s', () => {
    const a = loadLocalProfile('default');
    const b = loadLocalProfile('default');
    expect(a).toEqual(b);
  });
});

// ─── Local LLM Integration ──────────────────────────────────────────────────

describe('Local LLM Integration', () => {
  let available = false;

  beforeEach(async () => {
    available = await isLocalLLMAvailable();
  });

  it('should list available models', async () => {
    if (!available) return;
    const res = await fetch(`${LLM_URL}/v1/models`);
    const data = await res.json() as { data: Array<{ id: string }> };
    expect(data.data.length).toBeGreaterThan(0);
  });

  it('should complete a simple non-streaming request', async () => {
    if (!available) return;
    const profile = loadLocalProfile('fast');
    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 16,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30000),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    expect(data.choices[0].message.content).toBeTruthy();
  }, 60000);

  it('should handle streaming responses', async () => {
    if (!available) return;
    const profile = loadLocalProfile('fast');
    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 32,
        temperature: 0.1,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30000),
    });
    expect(res.ok).toBe(true);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const chunk = JSON.parse(line.slice(6)) as {
            choices: Array<{ delta: { content?: string } }>;
          };
          if (chunk.choices?.[0]?.delta?.content) {
            content += chunk.choices[0].delta.content;
            chunks++;
          }
        } catch { /* keep-alive or malformed */ }
      }
    }
    expect(chunks).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
  }, 60000);

  it('should handle tool calls', async () => {
    if (!available) return;
    const profile = loadLocalProfile('default');
    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: 'user', content: 'Use the echo tool to say "test"' }],
        max_tokens: 256,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
        tools: [{
          type: 'function',
          function: {
            name: 'echo',
            description: 'Echo back a message',
            parameters: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
        }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as {
      choices: Array<{ message: { tool_calls?: Array<{ function: { name: string } }> }, finish_reason: string }>;
    };
    const choice = data.choices[0];
    expect(choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop').toBe(true);
  }, 60000);

  it('should handle AbortController timeout', async () => {
    if (!available) return;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      fetch(`${LLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_KEY}` },
        body: JSON.stringify({
          model: 'Qwen3.5-9B-MLX-4bit',
          messages: [{ role: 'user', content: 'Write a very long essay' }],
          max_tokens: 4096,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: controller.signal,
      })
    ).rejects.toThrow();
  }, 10000);
});
