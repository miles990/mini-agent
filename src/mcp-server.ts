/**
 * Agent MCP Server — Phase 1
 *
 * stdio-based MCP server wrapping mini-agent HTTP API.
 * Auto-detects agent name at startup from /api/instance.
 * Designed to be spawned by Claude Code via MCP config.
 *
 * Usage:
 *   AGENT_URL=http://localhost:3001 node dist/mcp-server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';

// =============================================================================
// Config
// =============================================================================

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const API_KEY = process.env.MINI_AGENT_API_KEY || '';
const HTTP_TIMEOUT = 5_000;
const DISCUSS_POLL_INTERVAL = 10_000;
const DISCUSS_TIMEOUT = 300_000;

// =============================================================================
// HTTP helpers
// =============================================================================

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

async function agentFetch(path: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
  const timeout = init?.timeout ?? HTTP_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${AGENT_URL}${path}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers as Record<string, string> ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function agentGet(path: string, timeout?: number): Promise<unknown> {
  const res = await agentFetch(path, { timeout });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function agentPost(path: string, body?: unknown): Promise<unknown> {
  const res = await agentFetch(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

// =============================================================================
// Agent name detection
// =============================================================================

let agentName = process.env.AGENT_NAME || 'Agent';
let mention = `@${agentName.toLowerCase()}`;

async function detectAgentName(): Promise<void> {
  try {
    const info = await agentGet('/api/instance') as { name?: string; config?: { name?: string } };
    const detected = info?.name || info?.config?.name;
    if (detected) {
      agentName = detected;
      mention = `@${agentName.toLowerCase()}`;
    }
  } catch {
    // Agent offline — use fallback name
  }
}

// =============================================================================
// MCP Server
// =============================================================================

async function main() {
  await detectAgentName();

  const server = new McpServer({
    name: 'mini-agent',
    version: '1.0.0',
  });

  // ─── Status tools (read-only) ─────────────────────────────────────────

  server.tool(
    'agent_status',
    `Check ${agentName}'s current system status (loop, claude, cron, telegram)`,
    {},
    async () => {
      try {
        const data = await agentGet('/status');
        return textResult(JSON.stringify(data, null, 2));
      } catch (e) {
        return errorResult(`${agentName} is offline or unreachable: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_context',
    `Get ${agentName}'s current perception context (all perception sections)`,
    {},
    async () => {
      try {
        const data = await agentGet('/context') as { context?: string };
        return textResult(data?.context ?? 'No context available');
      } catch (e) {
        return errorResult(`Failed to get context: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_logs',
    `Get ${agentName}'s recent log summary`,
    {},
    async () => {
      try {
        const data = await agentGet('/logs');
        return textResult(JSON.stringify(data, null, 2));
      } catch (e) {
        return errorResult(`Failed to get logs: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_memory_search',
    `Search ${agentName}'s memory (topics, MEMORY.md, etc.)`,
    { query: z.string().describe('Search query') },
    async ({ query }) => {
      try {
        const data = await agentGet(`/memory/search?q=${encodeURIComponent(query)}`);
        return textResult(JSON.stringify(data, null, 2));
      } catch (e) {
        return errorResult(`Search failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_read_messages',
    `Read today's Chat Room messages (${agentName} + Alex + Claude Code)`,
    {
      date: z.string().optional().describe('Date in YYYY-MM-DD format (default: today)'),
    },
    async ({ date }) => {
      try {
        const d = date || new Date().toISOString().slice(0, 10);
        const data = await agentGet(`/api/room?date=${d}`) as { messages?: unknown[] };
        if (!data?.messages?.length) return textResult('No messages today.');
        return textResult(JSON.stringify(data.messages, null, 2));
      } catch (e) {
        return errorResult(`Failed to read messages: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  // ─── Control tools ────────────────────────────────────────────────────

  server.tool(
    'agent_loop_pause',
    `Pause ${agentName}'s OODA loop`,
    {},
    async () => {
      try {
        await agentPost('/loop/pause');
        return textResult(`${agentName}'s loop paused.`);
      } catch (e) {
        return errorResult(`Failed to pause loop: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_loop_resume',
    `Resume ${agentName}'s OODA loop`,
    {},
    async () => {
      try {
        await agentPost('/loop/resume');
        return textResult(`${agentName}'s loop resumed.`);
      } catch (e) {
        return errorResult(`Failed to resume loop: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_loop_trigger',
    `Manually trigger one ${agentName} OODA cycle`,
    {},
    async () => {
      try {
        await agentPost('/loop/trigger');
        return textResult(`${agentName} cycle triggered.`);
      } catch (e) {
        return errorResult(`Failed to trigger cycle: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_feature_toggle',
    `Toggle a feature flag on ${agentName}`,
    {
      name: z.string().describe('Feature flag name'),
      enabled: z.boolean().optional().describe('Set to true/false, or omit to toggle'),
    },
    async ({ name, enabled }) => {
      try {
        const body = enabled !== undefined ? { enabled } : {};
        const data = await agentPost(`/api/features/${encodeURIComponent(name)}`, body);
        return textResult(JSON.stringify(data, null, 2));
      } catch (e) {
        return errorResult(`Failed to toggle feature: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  // ─── Mode tools ────────────────────────────────────────────────────────

  server.tool(
    'agent_get_mode',
    `Get ${agentName}'s current control mode (calm/reserved/autonomous)`,
    {},
    async () => {
      try {
        const data = await agentGet('/api/mode');
        return textResult(JSON.stringify(data, null, 2));
      } catch (e) {
        return errorResult(`Failed to get mode: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_set_mode',
    `Set ${agentName}'s control mode: "calm" (minimal, only direct messages), "reserved" (normal ops, no proactive outreach), "autonomous" (fully autonomous)`,
    {
      mode: z.enum(['calm', 'reserved', 'autonomous']).describe('Control mode'),
    },
    async ({ mode }) => {
      try {
        const data = await agentPost('/api/mode', { mode });
        return textResult(`${agentName} switched to "${mode}" mode.\n${JSON.stringify(data, null, 2)}`);
      } catch (e) {
        return errorResult(`Failed to set mode: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  // ─── Collaboration tools (core value) ─────────────────────────────────

  server.tool(
    'agent_chat',
    `Send a message to ${agentName} via Chat Room (one-way, doesn't wait for reply)`,
    { message: z.string().describe('Message to send') },
    async ({ message }) => {
      try {
        const text = message.includes(mention) ? message : `${mention} ${message}`;
        await agentPost('/api/room', { from: 'claude-code', text });
        return textResult(`Message sent to ${agentName}.`);
      } catch (e) {
        return errorResult(`Failed to send message: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_discuss',
    `Send a message to ${agentName} and wait for a response (up to 5 min). Works in all modes — calm mode uses direct message wake.`,
    { message: z.string().describe('Message to send') },
    async ({ message }) => {
      try {
        // 1. Get current latest message ID
        const today = new Date().toISOString().slice(0, 10);
        const before = await agentGet(`/api/room?date=${today}`) as { messages?: Array<{ id: string; from: string }> };
        const lastId = before?.messages?.length
          ? before.messages[before.messages.length - 1].id
          : '';

        // 2. Send message with mention
        const text = message.includes(mention) ? message : `${mention} ${message}`;
        await agentPost('/api/room', { from: 'claude-code', text });

        // 3. Poll for agent reply
        const nameLower = agentName.toLowerCase();
        const deadline = Date.now() + DISCUSS_TIMEOUT;
        let lastProgressAt = Date.now();

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, DISCUSS_POLL_INTERVAL));

          const current = await agentGet(`/api/room?date=${today}`) as {
            messages?: Array<{ id: string; from: string; text: string }>
          };

          if (current?.messages) {
            const reply = current.messages.find(
              m => m.from === nameLower && m.id > lastId,
            );
            if (reply) {
              return textResult(reply.text);
            }
          }

          if (Date.now() - lastProgressAt >= 60_000) {
            lastProgressAt = Date.now();
            const elapsed = Math.round((Date.now() - (deadline - DISCUSS_TIMEOUT)) / 1000);
            process.stderr.write(`[agent_discuss] Waiting for ${agentName}... (${elapsed}s elapsed)\n`);
          }
        }

        return textResult(`${agentName} did not respond within ${DISCUSS_TIMEOUT / 1000}s. The message was sent — ${agentName} may respond later in the Chat Room.`);
      } catch (e) {
        return errorResult(`Discussion failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  server.tool(
    'agent_ask',
    `Ask ${agentName} a direct question (synchronous, 5-15s). Always available regardless of mode.`,
    { question: z.string().describe('Question to ask') },
    async ({ question }) => {
      try {
        const res = await agentFetch('/api/ask', {
          method: 'POST',
          body: JSON.stringify({ question }),
          timeout: 30_000,
        });
        if (!res.ok) return errorResult(`Ask failed: HTTP ${res.status}`);
        const data = await res.json() as { answer?: string; contextAge?: string };
        const suffix = data.contextAge ? `\n\n_[感知資料截至 ${data.contextAge}]_` : '';
        return textResult((data.answer ?? '(no response)') + suffix);
      } catch (e) {
        return errorResult(`Ask failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  );

  // ─── Start server ─────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
