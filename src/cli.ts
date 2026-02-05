#!/usr/bin/env node
/**
 * Mini-Agent CLI
 *
 * Commands:
 *   (default)     - Interactive chat mode
 *   chat          - Interactive chat mode
 *   server        - Start HTTP API server
 *   install       - Install globally via npm link
 *   uninstall     - Remove global installation
 *
 * Pipe mode:
 *   echo "text" | mini-agent "prompt"
 */

import readline from 'node:readline';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import { searchMemory, readHeartbeat, appendMemory } from './memory.js';
import { createApi } from './api.js';

// =============================================================================
// CLI Commands
// =============================================================================

function showHelp(): void {
  console.log(`
Mini-Agent - Personal AI with Memory + Proactivity

Usage:
  mini-agent                     Interactive chat (default)
  mini-agent server [--port]     Start HTTP API server
  echo "..." | mini-agent "..."  Pipe mode

Options:
  -p, --port <port>   Port for server (default: 3001)

Install:
  curl -fsSL https://raw.githubusercontent.com/user/mini-agent/main/install.sh | bash

Pipe Examples:
  echo "Hello" | mini-agent "translate to Chinese"
  cat file.txt | mini-agent "summarize"
  git diff | mini-agent "write commit message"
`);
}

function runServer(port: number): void {
  const app = createApi(port);
  app.listen(port, () => {
    console.log(`Mini-Agent API server running on http://localhost:${port}`);
    console.log('\nEndpoints:');
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
// Interactive Mode
// =============================================================================

let rl: readline.Interface;
let isClosing = false;

function runChat(): void {
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

  console.log('Mini-Agent - Memory + Proactivity');
  console.log('Type /help for commands, or just chat.\n');
  prompt();
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

function parseArgs(): { command: string; port: number; prompt: string } {
  const args = process.argv.slice(2);
  let command = '';  // Empty = interactive mode (default)
  let port = 3001;
  let prompt = 'Process this input:';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      port = parseInt(args[++i] || '3001', 10);
    } else if (arg === 'server' || arg === 'help') {
      command = arg;
    } else if (!arg.startsWith('-')) {
      // Treat as prompt for pipe mode
      prompt = arg;
    }
  }

  return { command, port, prompt };
}

async function main(): Promise<void> {
  const { command, port, prompt } = parseArgs();

  // Check if stdin is piped (has data waiting)
  // Note: isTTY is undefined when piped, true when terminal
  const isPiped = process.stdin.isTTY === undefined && command === '';

  // Pipe mode: when stdin is piped and no explicit command
  if (isPiped) {
    await runPipeMode(prompt);
    return;
  }

  // Execute command
  switch (command) {
    case 'help':
      showHelp();
      break;
    case 'server':
      runServer(port);
      break;
    default:
      // Default: interactive chat mode
      runChat();
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
