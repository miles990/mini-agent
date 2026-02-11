#!/usr/bin/env node
/**
 * Mini-Agent Minimal Core — Entry Point
 *
 * Starts: HTTP server + Telegram poller + AgentLoop
 * That's it. No instance management, no compose, no multi-agent.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { createMemory, getMemory, setDefaultMemory } from './memory.js';
import { callClaude, parseTags, getSystemPrompt, restoreQueue } from './agent.js';
import { createTelegramPoller, notifyTelegram, flushSummary } from './telegram.js';
import { AgentLoop, parseInterval } from './loop.js';
import { schedule, startCron, stopCron, getCronTaskCount } from './cron.js';
import { loadAllSkills, formatSkillsPrompt } from './perception.js';
import { setBehaviorLogDir } from './utils.js';
import type { CustomPerception } from './perception.js';

// =============================================================================
// Minimal .env loader (zero dependencies)
// =============================================================================

function loadEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv();

// =============================================================================
// Config
// =============================================================================

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const MEMORY_DIR = path.join(process.cwd(), 'memory');

// =============================================================================
// Simple YAML-ish compose loader
// =============================================================================

interface ComposeAgent {
  name?: string;
  port?: number;
  persona?: string;
  loop?: { enabled?: boolean; interval?: string };
  perception?: { custom?: CustomPerception[] };
  skills?: string[];
}

function loadCompose(): ComposeAgent | null {
  const composePath = path.join(process.cwd(), 'agent-compose.yaml');
  if (!fs.existsSync(composePath)) return null;
  try {
    const content = fs.readFileSync(composePath, 'utf-8');
    // Extract what we need with regex — avoid full YAML parser dependency
    const nameMatch = content.match(/name:\s*["']?([^"'\n]+)/);
    const portMatch = content.match(/port:\s*(\d+)/);
    const personaMatch = content.match(/persona:\s*["']?([^"'\n]+)/);
    const loopIntervalMatch = content.match(/interval:\s*["']?(\d+[smh])["']?/);
    const loopEnabledMatch = content.match(/enabled:\s*(true|false)/);

    // Extract skills list
    const skills: string[] = [];
    const skillsSection = content.match(/skills:\n((?:\s+-\s+.+\n?)*)/);
    if (skillsSection) {
      for (const m of skillsSection[1].matchAll(/^\s+-\s+(.+)/gm)) {
        skills.push(m[1].trim().replace(/["']/g, ''));
      }
    }

    // Extract custom perceptions
    const perceptions: CustomPerception[] = [];
    const customSection = content.match(/custom:\n((?:\s+-.+\n(?:\s+\w+:.+\n)*)*)/);
    if (customSection) {
      for (const m of customSection[1].matchAll(/- name:\s*(\S+)\n\s+script:\s*(\S+)(?:\n\s+timeout:\s*(\d+))?/g)) {
        perceptions.push({
          name: m[1],
          script: m[2],
          timeout: m[3] ? parseInt(m[3], 10) : undefined,
        });
      }
    }

    return {
      name: nameMatch?.[1],
      port: portMatch ? parseInt(portMatch[1], 10) : undefined,
      persona: personaMatch?.[1],
      loop: {
        enabled: loopEnabledMatch ? loopEnabledMatch[1] === 'true' : true,
        interval: loopIntervalMatch?.[1],
      },
      perception: { custom: perceptions },
      skills,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Post-process helper
// =============================================================================

async function postProcess(userMsg: string, response: string): Promise<string> {
  const memory = getMemory();
  const tags = parseTags(response);

  await memory.appendConversation('user', userMsg);
  await memory.appendConversation('assistant', response);

  if (tags.remember) {
    if (tags.remember.topic) {
      await memory.appendTopicMemory(tags.remember.topic, tags.remember.content);
    } else {
      await memory.appendMemory(tags.remember.content);
    }
  }
  if (tags.task) {
    await memory.addTask(tags.task.content, tags.task.schedule);
  }
  for (const chatText of tags.chats) {
    await notifyTelegram(`💬 ${chatText}`);
  }
  for (const show of tags.shows) {
    await notifyTelegram(`🌐 ${show.desc}${show.url ? `\n🔗 ${show.url}` : ''}`);
  }

  return tags.cleanContent;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const compose = loadCompose();
  const agentName = compose?.name ?? 'Kuro';
  const port = process.env.PORT ? PORT : (compose?.port ?? PORT);
  const perceptions = compose?.perception?.custom ?? [];
  const skillPaths = compose?.skills ?? [];

  console.log(`\n  Mini-Agent Minimal Core`);
  console.log(`  ${agentName} :${port}\n`);

  // Initialize memory with perception plugins
  const memory = createMemory(MEMORY_DIR, { perceptions });
  setDefaultMemory(memory);

  // Load skills for system prompt
  const skills = loadAllSkills(skillPaths, process.cwd());
  const skillsPrompt = formatSkillsPrompt(skills);
  if (skills.length > 0) {
    console.log(`  Skills: ${skills.map(s => s.name).join(', ')}`);
  }

  // Store config for agent.ts getSystemPrompt()
  (globalThis as Record<string, unknown>).__miniAgentSkillsPrompt = skillsPrompt;
  (globalThis as Record<string, unknown>).__miniAgentPersona = compose?.persona;

  // Initialize behavior log + restore queue
  setBehaviorLogDir(path.join(MEMORY_DIR, 'logs'));
  restoreQueue();

  // Initialize Telegram
  const tgPoller = createTelegramPoller(MEMORY_DIR, async (text: string) => {
    const context = await memory.buildContext();
    const response = await callClaude(text, context);
    return postProcess(text, response);
  });

  if (tgPoller) {
    tgPoller.start();
    console.log(`  Telegram: connected`);
  }

  // Initialize AgentLoop
  const loop = new AgentLoop({
    enabled: compose?.loop?.enabled ?? true,
    intervalMs: compose?.loop?.interval
      ? parseInterval(compose.loop.interval)
      : 300_000,
  });
  loop.start();

  // Cron tasks
  schedule('heartbeat-check', 'every 30m', async () => {
    const heartbeat = await memory.readHeartbeat();
    if (heartbeat.includes('- [ ]')) {
      const context = await memory.buildContext();
      const response = await callClaude(
        'Check HEARTBEAT.md for pending tasks and execute them if any',
        context,
      );
      await postProcess('Check HEARTBEAT.md for pending tasks and execute them if any', response);
    }
  });

  schedule('summary-flush', 'every 6h', async () => {
    const digest = flushSummary();
    if (digest) await notifyTelegram(digest);
  });

  startCron();
  const cronCount = getCronTaskCount();
  if (cronCount > 0) console.log(`  Cron: ${cronCount} task(s)`);

  // HTTP Server — minimal endpoints
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', agent: agentName }));
      return;
    }

    if (url.pathname === '/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        agent: agentName,
        uptime: process.uptime(),
        loop: loop.getStatus(),
        telegram: { connected: !!tgPoller },
      }));
      return;
    }

    if (url.pathname === '/context') {
      const context = await memory.buildContext();
      res.writeHead(200);
      res.end(JSON.stringify({ context }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const { message } = JSON.parse(body) as { message: string };
          const context = await memory.buildContext();
          const response = await callClaude(message, context);
          const content = await postProcess(message, response);
          res.writeHead(200);
          res.end(JSON.stringify({ content }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (url.pathname === '/loop/status') {
      res.writeHead(200);
      res.end(JSON.stringify(loop.getStatus()));
      return;
    }
    if (url.pathname === '/loop/pause') {
      loop.pause();
      res.writeHead(200);
      res.end(JSON.stringify({ paused: true }));
      return;
    }
    if (url.pathname === '/loop/resume') {
      loop.resume();
      res.writeHead(200);
      res.end(JSON.stringify({ paused: false }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ❌ Port ${port} is already in use. Try: PORT=3099 mini-agent\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`  HTTP: http://localhost:${port}`);
    console.log(`\n  Ready.\n`);
  });

  // Interactive CLI (if stdin is a TTY)
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt(`${agentName}> `);
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }
      if (input === '/quit' || input === '/exit') {
        shutdown();
        return;
      }
      if (input === '/status') {
        console.log(JSON.stringify(loop.getStatus(), null, 2));
        rl.prompt();
        return;
      }

      const context = await memory.buildContext();
      const response = await callClaude(input, context);
      const content = await postProcess(input, response);
      console.log(`\n${content}\n`);
      rl.prompt();
    });
  }

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\n  Shutting down...');
    loop.stop();
    tgPoller?.stop();
    stopCron();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
