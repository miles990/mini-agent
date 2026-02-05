#!/usr/bin/env node
/**
 * Mini-Agent CLI
 *
 * Modes:
 *   (default)       - Interactive chat
 *   server          - HTTP API server
 *   Pipe mode       - echo "..." | mini-agent "prompt"
 *   File mode       - mini-agent file.txt "prompt"
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import { searchMemory, readHeartbeat, appendMemory } from './memory.js';
import { createApi } from './api.js';

// =============================================================================
// File Utilities
// =============================================================================

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.vue', '.svelte', '.astro', '.csv', '.log', '.env',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function readFileContent(filePath: string): { content: string; type: 'text' | 'binary'; error?: string } {
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
    } else {
      return { content: '', type: 'binary', error: `Binary file not supported in CLI mode: ${filePath}\nUse: claude (interactive mode) for images` };
    }
  } catch (err) {
    return { content: '', type: 'text', error: `Error reading file: ${err}` };
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

Options:
  -p, --port <port>   Port for server (default: 3001)

Examples:
  mini-agent readme.md "summarize"
  mini-agent src/app.ts "review this code"
  mini-agent a.txt b.txt "compare these files"
  echo "Hello" | mini-agent "translate to Chinese"
  git diff | mini-agent "write commit message"

Note: Binary files (images, etc.) require interactive mode: claude

Install:
  curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash
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
// File Mode
// =============================================================================

async function runFileMode(files: string[], prompt: string): Promise<void> {
  const fileContents: string[] = [];

  for (const file of files) {
    const result = readFileContent(file);

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    const fileName = path.basename(file);
    fileContents.push(`=== ${fileName} ===\n${result.content}`);
  }

  const fullPrompt = `${prompt}\n\n---\n\n${fileContents.join('\n\n')}`;

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

interface ParsedArgs {
  command: string;
  port: number;
  prompt: string;
  files: string[];
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command = '';
  let port = 3001;
  let prompt = 'Process this:';
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      port = parseInt(args[++i] || '3001', 10);
    } else if (arg === 'server' || arg === 'help') {
      command = arg;
    } else if (!arg.startsWith('-')) {
      // Check if it's a file or prompt
      if (fs.existsSync(arg)) {
        files.push(arg);
      } else {
        // Last non-file argument is the prompt
        prompt = arg;
      }
    }
  }

  return { command, port, prompt, files };
}

async function main(): Promise<void> {
  const { command, port, prompt, files } = parseArgs();

  // Check if stdin is piped
  const isPiped = process.stdin.isTTY === undefined && command === '' && files.length === 0;

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

  // Execute command
  switch (command) {
    case 'help':
      showHelp();
      break;
    case 'server':
      runServer(port);
      break;
    default:
      runChat();
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
