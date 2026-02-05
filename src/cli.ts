#!/usr/bin/env node
/**
 * Mini-Agent CLI
 *
 * Modes:
 *   (default)       - Interactive chat
 *   server          - HTTP API server
 *   Pipe mode       - echo "..." | mini-agent "prompt"
 *   File mode       - mini-agent file.txt "prompt"
 *
 * Instance Management:
 *   instance create - Create a new instance
 *   instance list   - List all instances
 *   instance delete - Delete an instance
 *   instance start  - Start an instance server
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import { searchMemory, readHeartbeat, appendMemory, createMemory } from './memory.js';
import { createApi } from './api.js';
import { getConfig, updateConfig, resetConfig } from './config.js';
import {
  getInstanceManager,
  loadInstanceConfig,
  listInstances,
  getCurrentInstanceId,
} from './instance.js';
import { getLogger, type LogType, type LogEntry, type ClaudeLogEntry } from './logging.js';
import type { InstanceConfig } from './types.js';

// =============================================================================
// Global Instance Context
// =============================================================================

let currentInstanceId = 'default';

/**
 * 設置當前實例 ID（用於 CLI）
 */
export function setCurrentInstance(instanceId: string): void {
  currentInstanceId = instanceId;
  process.env.MINI_AGENT_INSTANCE = instanceId;
}

// =============================================================================
// File Utilities
// =============================================================================

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.vue', '.svelte', '.astro', '.csv', '.log', '.env',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function readFileContent(filePath: string): { content: string; type: 'text' | 'image' | 'binary'; error?: string } {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { content: '', type: 'text', error: `File not found: ${filePath}` };
    }

    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      return { content: '', type: 'text', error: `Is a directory: ${filePath}` };
    }

    if (isTextFile(filePath)) {
      const content = fs.readFileSync(resolved, 'utf-8');
      return { content, type: 'text' };
    } else if (isImageFile(filePath)) {
      return { content: resolved, type: 'image' };
    } else {
      return { content: '', type: 'binary', error: `Unsupported file type: ${filePath}` };
    }
  } catch (err) {
    return { content: '', type: 'text', error: `Error reading file: ${err}` };
  }
}

// =============================================================================
// Logs Commands
// =============================================================================

async function handleLogsCommand(args: string[]): Promise<void> {
  const logger = getLogger();
  const subCommand = args[0] || 'stats';

  // Parse options
  let date: string | undefined;
  let limit = 20;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date' && args[i + 1]) {
      date = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  switch (subCommand) {
    case 'stats': {
      const stats = await logger.getStats(date);
      const dates = await logger.getAvailableDates();
      console.log('\nLog Statistics:');
      console.log(`  Date: ${stats.date}`);
      console.log(`  Claude calls: ${stats.claude}`);
      console.log(`  API requests: ${stats.api}`);
      console.log(`  Proactive: ${stats.proactive}`);
      console.log(`  Errors: ${stats.error}`);
      console.log(`  Total: ${stats.total}`);
      console.log('\nAvailable dates:');
      for (const d of dates.slice(0, 10)) {
        console.log(`  ${d}`);
      }
      break;
    }

    case 'claude': {
      const entries = logger.queryClaudeLogs(date, limit);
      console.log(`\nClaude Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const input = (entry as ClaudeLogEntry).data.input.userMessage.slice(0, 50);
        const output = (entry as ClaudeLogEntry).data.output.content.slice(0, 50);
        const duration = entry.metadata.duration ?? 0;
        console.log(`[${time}] (${duration}ms)`);
        console.log(`  In:  ${input}...`);
        console.log(`  Out: ${output}...`);
        console.log('');
      }
      break;
    }

    case 'errors': {
      const entries = logger.queryErrorLogs(date, limit);
      console.log(`\nError Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const error = entry.data.error as string;
        const context = entry.data.context as string | undefined;
        console.log(`[${time}] ${error}`);
        if (context) {
          console.log(`  Context: ${context}`);
        }
        console.log('');
      }
      break;
    }

    case 'proactive': {
      const entries = logger.queryProactiveLogs(date, limit);
      console.log(`\nProactive Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const action = entry.data.action as string;
        const result = entry.data.result as string | undefined;
        console.log(`[${time}] ${action}`);
        if (result) {
          console.log(`  Result: ${result.slice(0, 100)}...`);
        }
        console.log('');
      }
      break;
    }

    case 'api': {
      const entries = logger.queryApiLogs(date, limit);
      console.log(`\nAPI Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const req = entry.data.request as { method: string; path: string };
        const res = entry.data.response as { status: number };
        const duration = entry.metadata.duration ?? 0;
        console.log(`[${time}] ${req.method} ${req.path} → ${res.status} (${duration}ms)`);
      }
      break;
    }

    case 'all': {
      const entries = logger.query({ date, limit });
      console.log(`\nAll Logs (${entries.length} entries):\n`);
      for (const entry of entries) {
        const time = entry.timestamp.split('T')[1].split('.')[0];
        const type = entry.type.padEnd(12);
        const success = entry.metadata.success ? '✓' : '✗';
        console.log(`[${time}] ${type} ${success}`);
      }
      break;
    }

    default:
      console.log(`
Logs Management:

Commands:
  mini-agent logs                     Show log statistics
  mini-agent logs stats               Show log statistics
  mini-agent logs claude              Show Claude operation logs
  mini-agent logs errors              Show error logs
  mini-agent logs proactive           Show proactive system logs
  mini-agent logs api                 Show API request logs
  mini-agent logs all                 Show all logs

Options:
  --date <YYYY-MM-DD>    Filter by date
  --limit <n>            Limit results (default: 20)

Examples:
  mini-agent logs claude --date 2026-02-05
  mini-agent logs errors --limit 10
`);
  }
}

// =============================================================================
// Instance Commands
// =============================================================================

async function handleInstanceCommand(args: string[]): Promise<void> {
  const subCommand = args[0];
  const manager = getInstanceManager();

  switch (subCommand) {
    case 'create': {
      const options: { name?: string; role?: 'master' | 'worker' | 'standalone'; port?: number; persona?: string } = {};

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--name' && args[i + 1]) {
          options.name = args[++i];
        } else if (arg === '--role' && args[i + 1]) {
          options.role = args[++i] as 'master' | 'worker' | 'standalone';
        } else if (arg === '--port' && args[i + 1]) {
          options.port = parseInt(args[++i], 10);
        } else if (arg === '--persona' && args[i + 1]) {
          options.persona = args[++i];
        }
      }

      const instance = manager.create(options);
      console.log(`Created instance: ${instance.id}`);
      console.log(`  Name: ${instance.name ?? '(unnamed)'}`);
      console.log(`  Role: ${instance.role}`);
      console.log(`  Port: ${instance.port}`);

      // 自動在背景啟動 API server
      manager.start(instance.id);
      const status = manager.getStatus(instance.id);
      console.log(`  Status: 🟢 running (PID: ${status?.pid})`);
      console.log(`  API: http://localhost:${instance.port}`);
      break;
    }

    case 'list': {
      const instances = manager.listStatus();
      if (instances.length === 0) {
        console.log('No instances found');
        return;
      }

      console.log('Instances:');
      console.log('');
      console.log('ID        Name              Role        Port   Status');
      console.log('--------  ----------------  ----------  -----  ------');

      for (const inst of instances) {
        const name = (inst.name ?? '(unnamed)').padEnd(16).substring(0, 16);
        const role = inst.role.padEnd(10);
        const port = String(inst.port).padEnd(5);
        const status = inst.running ? '🟢 running' : '⚪ stopped';
        console.log(`${inst.id.padEnd(8)}  ${name}  ${role}  ${port}  ${status}`);
      }
      break;
    }

    case 'delete': {
      const instanceId = args[1];
      if (!instanceId) {
        console.error('Usage: mini-agent instance delete <id>');
        process.exit(1);
      }

      try {
        const deleted = manager.delete(instanceId);
        if (deleted) {
          console.log(`Deleted instance: ${instanceId}`);
        } else {
          console.error(`Instance not found: ${instanceId}`);
          process.exit(1);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
      break;
    }

    case 'start': {
      const instanceId = args[1];
      if (!instanceId) {
        console.error('Usage: mini-agent instance start <id>');
        process.exit(1);
      }

      try {
        manager.start(instanceId);
        const status = manager.getStatus(instanceId);
        console.log(`Started instance: ${instanceId}`);
        console.log(`  Port: ${status?.port}`);
        console.log(`  PID: ${status?.pid}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      const instanceId = args[1];
      if (!instanceId) {
        console.error('Usage: mini-agent instance stop <id>');
        process.exit(1);
      }

      manager.stop(instanceId);
      console.log(`Stopped instance: ${instanceId}`);
      break;
    }

    case 'status': {
      const instanceId = args[1];
      if (!instanceId) {
        console.error('Usage: mini-agent instance status <id>');
        process.exit(1);
      }

      const status = manager.getStatus(instanceId);
      if (!status) {
        console.error(`Instance not found: ${instanceId}`);
        process.exit(1);
      }

      console.log(`Instance: ${status.id}`);
      console.log(`  Name: ${status.name ?? '(unnamed)'}`);
      console.log(`  Role: ${status.role}`);
      console.log(`  Port: ${status.port}`);
      console.log(`  Status: ${status.running ? '🟢 running' : '⚪ stopped'}`);
      if (status.pid) {
        console.log(`  PID: ${status.pid}`);
      }
      break;
    }

    case 'attach': {
      const instanceId = args[1];
      if (!instanceId) {
        console.error('Usage: mini-agent instance attach <id>');
        process.exit(1);
      }

      const status = manager.getStatus(instanceId);
      if (!status) {
        console.error(`Instance not found: ${instanceId}`);
        process.exit(1);
      }

      if (!status.running) {
        console.error(`Instance not running: ${instanceId}`);
        console.error('Start it first: mini-agent instance start ' + instanceId);
        process.exit(1);
      }

      await runAttachedMode(instanceId, status.port);
      break;
    }

    default:
      console.log(`
Instance Management:

Commands:
  mini-agent instance create [options]  Create new instance (auto-starts)
  mini-agent instance list              List all instances
  mini-agent instance attach <id>       Attach to running instance
  mini-agent instance start <id>        Start an instance
  mini-agent instance stop <id>         Stop an instance
  mini-agent instance status <id>       Show instance status
  mini-agent instance delete <id>       Delete an instance

Create Options:
  --name <name>     Instance name
  --role <role>     Role: master, worker, standalone (default)
  --port <port>     Server port
  --persona <desc>  Persona description

Examples:
  mini-agent instance create --name "Research" --port 3002
  mini-agent instance attach abc12345
  mini-agent instance list
`);
  }
}

// =============================================================================
// CLI Commands
// =============================================================================

function showHelp(): void {
  console.log(`
Mini-Agent - Personal AI with Memory + Proactivity

Usage:
  mini-agent                          Interactive chat (default)
  mini-agent <file> "prompt"          Process a file
  mini-agent <file1> <file2> "prompt" Process multiple files
  mini-agent server [--port]          Start HTTP API server
  echo "..." | mini-agent "prompt"    Pipe mode

Instance Management:
  mini-agent instance create [options]  Create new instance (auto-starts)
  mini-agent instance list              List all instances
  mini-agent instance attach <id>       Attach to running instance
  mini-agent instance start <id>        Start an instance
  mini-agent instance stop <id>         Stop an instance
  mini-agent instance delete <id>       Delete an instance

Logs Management:
  mini-agent logs                       Show log statistics
  mini-agent logs claude                Claude operation logs
  mini-agent logs errors                Error logs
  mini-agent logs proactive             Proactive system logs
  mini-agent logs api                   API request logs

Options:
  -p, --port <port>       Port for server (default: 3001)
  -i, --instance <id>     Use specific instance
  --data-dir <path>       Custom data directory
  --date <YYYY-MM-DD>     Filter logs by date
  --limit <n>             Limit log results

Examples:
  mini-agent readme.md "summarize"
  mini-agent src/app.ts "review this code"
  mini-agent --instance abc123 "hello"
  mini-agent instance create --name "Assistant" --port 3002
  mini-agent logs claude --date 2026-02-05
  echo "Hello" | mini-agent "translate to Chinese"

Install:
  curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash
`);
}

async function runServer(port: number): Promise<void> {
  const app = createApi(port);
  const config = await getConfig();
  const instanceId = getCurrentInstanceId();

  app.listen(port, () => {
    console.log(`Mini-Agent API server running on http://localhost:${port}`);
    console.log(`Instance: ${instanceId}`);

    startProactive({ schedule: config.proactiveSchedule });
    console.log(`\n[Proactive] Auto-started with schedule: ${config.proactiveSchedule}`);
    console.log('\nEndpoints:');
    console.log('  GET  /api/instance      - Current instance info');
    console.log('  GET  /api/instances     - List all instances');
    console.log('  POST /chat              - Send a message');
    console.log('  GET  /memory            - Read long-term memory');
    console.log('  GET  /memory/search?q=  - Search memory');
    console.log('  POST /memory            - Add to memory');
    console.log('  GET  /heartbeat         - Read HEARTBEAT.md');
    console.log('  POST /heartbeat/trigger - Trigger heartbeat');
    console.log('  POST /proactive/start   - Start proactive mode');
    console.log('  POST /proactive/stop    - Stop proactive mode');
    console.log('\nPress Ctrl+C to stop');
  });
}

// =============================================================================
// Pipe Mode
// =============================================================================

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

async function runPipeMode(prompt: string): Promise<void> {
  const input = await readStdin();

  if (!input) {
    console.error('Error: No input received from pipe');
    process.exit(1);
  }

  const fullPrompt = `${prompt}\n\n---\n\n${input}`;

  try {
    const response = await processMessage(fullPrompt);
    console.log(response.content);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// File Mode
// =============================================================================

async function runFileMode(files: string[], prompt: string): Promise<void> {
  const textContents: string[] = [];
  const imagePaths: string[] = [];

  for (const file of files) {
    const result = readFileContent(file);

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    const fileName = path.basename(file);
    if (result.type === 'image') {
      imagePaths.push(`[Image: ${fileName}]: ${result.content}`);
    } else {
      textContents.push(`=== ${fileName} ===\n${result.content}`);
    }
  }

  let fullPrompt = prompt;
  if (textContents.length > 0) {
    fullPrompt += `\n\n---\n\n${textContents.join('\n\n')}`;
  }
  if (imagePaths.length > 0) {
    fullPrompt += `\n\n---\n\nImages:\n${imagePaths.join('\n')}`;
  }

  try {
    const response = await processMessage(fullPrompt);
    console.log(response.content);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// Prompt Mode
// =============================================================================

async function runPromptMode(prompt: string): Promise<void> {
  try {
    const response = await processMessage(prompt);
    console.log(response.content);

    if (response.shouldRemember) {
      console.log(`\n[Remembered: ${response.shouldRemember}]`);
    }
    if (response.taskAdded) {
      console.log(`\n[Task added: ${response.taskAdded}]`);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// =============================================================================
// Attached Mode (connect to running instance via API)
// =============================================================================

async function runAttachedMode(instanceId: string, port: number): Promise<void> {
  const baseUrl = `http://localhost:${port}`;

  // 驗證連接
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) throw new Error('Health check failed');
  } catch {
    console.error(`Cannot connect to instance at ${baseUrl}`);
    process.exit(1);
  }

  console.log(`Attached to instance: ${instanceId}`);
  console.log(`API: ${baseUrl}`);
  console.log('Type /detach to disconnect (instance keeps running)');
  console.log('Type /help for commands\n');

  const attachedRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let detached = false;

  attachedRl.on('close', () => {
    if (!detached) {
      console.log('\nDetached. Instance still running.');
    }
    process.exit(0);
  });

  const promptAttached = (): void => {
    if (detached) return;

    attachedRl.question(`[${instanceId}]> `, async (input) => {
      if (detached) return;

      const trimmed = input?.trim() ?? '';
      if (!trimmed) {
        promptAttached();
        return;
      }

      // Handle detach
      if (trimmed === '/detach' || trimmed === '/quit' || trimmed === '/exit') {
        detached = true;
        console.log('Detached. Instance still running.');
        attachedRl.close();
        return;
      }

      // Handle local commands
      if (trimmed === '/help') {
        console.log(`
Attached Mode Commands:
  /detach         - Disconnect (instance keeps running)
  /status         - Show instance status
  /memory         - Show memory
  /heartbeat      - Show HEARTBEAT.md
  /logs           - Show recent logs
  (any text)      - Chat with the agent
`);
        promptAttached();
        return;
      }

      if (trimmed === '/status') {
        try {
          const res = await fetch(`${baseUrl}/health`);
          const data = await res.json();
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      if (trimmed === '/memory') {
        try {
          const res = await fetch(`${baseUrl}/memory`);
          const data = await res.json() as { memory: string };
          console.log(data.memory || '(empty)');
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      if (trimmed === '/heartbeat') {
        try {
          const res = await fetch(`${baseUrl}/heartbeat`);
          const data = await res.json() as { heartbeat: string };
          console.log(data.heartbeat || '(empty)');
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      if (trimmed === '/logs') {
        try {
          const res = await fetch(`${baseUrl}/logs/claude?limit=5`);
          const data = await res.json() as { entries: Array<{ timestamp: string; data: { input: { userMessage: string }; output: { content: string } } }> };
          if (data.entries?.length) {
            for (const entry of data.entries) {
              const time = entry.timestamp.split('T')[1].split('.')[0];
              console.log(`[${time}] ${entry.data.input.userMessage.slice(0, 40)}...`);
            }
          } else {
            console.log('No logs');
          }
        } catch (err) {
          console.error('Error:', err);
        }
        promptAttached();
        return;
      }

      // Chat with agent via API
      console.log('\n[Thinking...]\n');
      try {
        const res = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        });
        const data = await res.json() as { content: string; shouldRemember?: string; taskAdded?: string; error?: string };

        if (data.error) {
          console.error('Error:', data.error);
        } else {
          console.log(data.content);
          if (data.shouldRemember) {
            console.log(`\n[Remembered: ${data.shouldRemember}]`);
          }
          if (data.taskAdded) {
            console.log(`\n[Task added: ${data.taskAdded}]`);
          }
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      console.log('');
      promptAttached();
    });
  };

  promptAttached();
}

// =============================================================================
// Interactive Mode
// =============================================================================

let rl: readline.Interface;
let isClosing = false;

async function runChat(port: number): Promise<void> {
  // 同時啟動 API server
  const app = createApi(port);
  const config = await getConfig();
  const instanceId = getCurrentInstanceId();

  app.listen(port, () => {
    console.log(`Mini-Agent - Memory + Proactivity`);
    console.log(`Instance: ${instanceId}`);
    console.log(`API server: http://localhost:${port}`);
    startProactive({ schedule: config.proactiveSchedule });
    console.log(`Proactive: ${config.proactiveSchedule}`);
    console.log('\nType /help for commands, or just chat.\n');
    prompt();
  });

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('close', () => {
    if (!isClosing) {
      console.log('\nBye!');
      process.exit(0);
    }
  });
}

function prompt(): void {
  if (isClosing) return;

  rl.question('> ', async (input) => {
    if (isClosing) return;

    const trimmed = input?.trim() ?? '';

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed.startsWith('/')) {
      await handleChatCommand(trimmed);
      if (!isClosing) prompt();
      return;
    }

    try {
      console.log('\n[Thinking...]\n');
      const response = await processMessage(trimmed);
      console.log(response.content);

      if (response.shouldRemember) {
        console.log(`\n[Remembered: ${response.shouldRemember}]`);
      }
      if (response.taskAdded) {
        console.log(`\n[Task added: ${response.taskAdded}]`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }

    console.log('');
    if (!isClosing) prompt();
  });
}

async function handleChatCommand(cmd: string): Promise<void> {
  const [command, ...args] = cmd.slice(1).split(' ');

  switch (command) {
    case 'help':
      console.log(`
Chat Commands:
  /help           - Show this help
  /search <query> - Search memory
  /heartbeat      - Show HEARTBEAT.md
  /trigger        - Trigger heartbeat check
  /remember <text>- Add to memory
  /proactive on   - Start proactive mode
  /proactive off  - Stop proactive mode
  /config         - Show current config
  /config set <key> <value> - Update config
  /config reset   - Reset to defaults
  /instance       - Show current instance
  /instances      - List all instances
  /logs           - Show log statistics
  /logs claude    - Show Claude operation logs
  /logs errors    - Show error logs
  /quit           - Exit
`);
      break;

    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log('Usage: /search <query>');
        break;
      }
      const results = await searchMemory(query);
      if (results.length === 0) {
        console.log('No results found');
      } else {
        results.forEach((r) => {
          console.log(`[${r.source}] ${r.content}`);
        });
      }
      break;
    }

    case 'heartbeat': {
      const hb = await readHeartbeat();
      console.log(hb || '(empty)');
      break;
    }

    case 'trigger': {
      const result = await triggerHeartbeat();
      console.log(result ?? 'No action needed');
      break;
    }

    case 'remember': {
      const text = args.join(' ');
      if (!text) {
        console.log('Usage: /remember <text>');
        break;
      }
      await appendMemory(text);
      console.log('Remembered!');
      break;
    }

    case 'proactive':
      if (args[0] === 'on') {
        startProactive({
          onHeartbeat: (r) => console.log(`\n[Heartbeat] ${r}\n> `),
        });
      } else if (args[0] === 'off') {
        stopProactive();
      } else {
        console.log('Usage: /proactive on|off');
      }
      break;

    case 'config': {
      const subCmd = args[0];
      const key = args[1];
      const value = args.slice(2).join(' ');

      if (!subCmd || subCmd === 'show') {
        const config = await getConfig();
        console.log('\nCurrent Configuration:');
        for (const [k, v] of Object.entries(config)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      } else if (subCmd === 'set' && key) {
        let parsedValue: unknown = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }
        await updateConfig({ [key]: parsedValue });
        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } else if (subCmd === 'reset') {
        await resetConfig();
        console.log('Configuration reset to defaults');
      } else {
        console.log('Usage:');
        console.log('  /config           - Show current config');
        console.log('  /config set <key> <value> - Set a config value');
        console.log('  /config reset     - Reset to defaults');
      }
      break;
    }

    case 'instance': {
      const instanceId = getCurrentInstanceId();
      const config = loadInstanceConfig(instanceId);
      console.log(`\nCurrent Instance: ${instanceId}`);
      if (config) {
        console.log(`  Name: ${config.name ?? '(unnamed)'}`);
        console.log(`  Role: ${config.role}`);
        console.log(`  Port: ${config.port}`);
      }
      break;
    }

    case 'instances': {
      const instances = listInstances();
      console.log('\nInstances:');
      for (const inst of instances) {
        const current = inst.id === getCurrentInstanceId() ? ' (current)' : '';
        console.log(`  ${inst.id}: ${inst.name ?? '(unnamed)'}${current}`);
      }
      break;
    }

    case 'logs': {
      const logger = getLogger();
      const subCmd = args[0];

      if (!subCmd || subCmd === 'stats') {
        const stats = await logger.getStats();
        console.log('\nToday\'s Log Statistics:');
        console.log(`  Claude calls: ${stats.claude}`);
        console.log(`  API requests: ${stats.api}`);
        console.log(`  Proactive: ${stats.proactive}`);
        console.log(`  Errors: ${stats.error}`);
        console.log(`  Total: ${stats.total}`);
      } else if (subCmd === 'claude') {
        const entries = logger.queryClaudeLogs(undefined, 10);
        console.log(`\nRecent Claude Logs (${entries.length}):\n`);
        for (const entry of entries) {
          const time = entry.timestamp.split('T')[1].split('.')[0];
          const input = (entry as ClaudeLogEntry).data.input.userMessage.slice(0, 40);
          const duration = entry.metadata.duration ?? 0;
          console.log(`[${time}] ${input}... (${duration}ms)`);
        }
      } else if (subCmd === 'errors') {
        const entries = logger.queryErrorLogs(undefined, 10);
        console.log(`\nRecent Errors (${entries.length}):\n`);
        for (const entry of entries) {
          const time = entry.timestamp.split('T')[1].split('.')[0];
          const error = entry.data.error as string;
          console.log(`[${time}] ${error}`);
        }
      } else {
        console.log('Usage: /logs [stats|claude|errors]');
      }
      break;
    }

    case 'quit':
    case 'exit':
      isClosing = true;
      console.log('Bye!');
      rl.close();
      process.exit(0);

    default:
      console.log(`Unknown command: ${command}. Try /help`);
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

interface ParsedArgs {
  command: string;
  port: number;
  prompt: string;
  files: string[];
  hasExplicitPrompt: boolean;
  instanceId: string;
  dataDir?: string;
  instanceArgs: string[];
  logsArgs: string[];
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command = '';
  let port = 3001;
  let prompt = 'Process this:';
  let hasExplicitPrompt = false;
  let instanceId = 'default';
  let dataDir: string | undefined;
  const files: string[] = [];
  const instanceArgs: string[] = [];
  const logsArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      port = parseInt(args[++i] || '3001', 10);
    } else if (arg === '--instance' || arg === '-i') {
      instanceId = args[++i] || 'default';
    } else if (arg === '--data-dir') {
      dataDir = args[++i];
    } else if (arg === 'server' || arg === 'help') {
      command = arg;
    } else if (arg === 'instance') {
      command = 'instance';
      // 收集 instance 子命令的所有參數
      instanceArgs.push(...args.slice(i + 1));
      break;
    } else if (arg === 'logs') {
      command = 'logs';
      // 收集 logs 子命令的所有參數
      logsArgs.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith('-')) {
      if (fs.existsSync(arg)) {
        files.push(arg);
      } else {
        prompt = arg;
        hasExplicitPrompt = true;
      }
    }
  }

  return { command, port, prompt, files, hasExplicitPrompt, instanceId, dataDir, instanceArgs, logsArgs };
}

async function main(): Promise<void> {
  const { command, port, prompt, files, hasExplicitPrompt, instanceId, dataDir, instanceArgs, logsArgs } = parseArgs();

  // 設置資料目錄
  if (dataDir) {
    process.env.MINI_AGENT_DATA_DIR = dataDir;
  }

  // 設置當前實例
  setCurrentInstance(instanceId);

  // Instance 命令
  if (command === 'instance') {
    await handleInstanceCommand(instanceArgs);
    return;
  }

  // Logs 命令
  if (command === 'logs') {
    await handleLogsCommand(logsArgs);
    return;
  }

  // 檢查是否為管道輸入
  const isPiped = process.stdin.isTTY === undefined && command === '' && files.length === 0 && !hasExplicitPrompt;

  // Pipe mode
  if (isPiped) {
    await runPipeMode(prompt);
    return;
  }

  // File mode
  if (files.length > 0) {
    await runFileMode(files, prompt);
    return;
  }

  // Prompt-only mode
  if (hasExplicitPrompt && command === '') {
    await runPromptMode(prompt);
    return;
  }

  // Execute command
  switch (command) {
    case 'help':
      showHelp();
      break;
    case 'server':
      await runServer(port);
      break;
    default:
      await runChat(port);
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
