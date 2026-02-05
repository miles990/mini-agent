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
import { getConfig, updateConfig, resetConfig } from './config.js';

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
      // For images, return the absolute path - Claude will read it directly
      return { content: resolved, type: 'image' };
    } else {
      return { content: '', type: 'binary', error: `Unsupported file type: ${filePath}` };
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

async function runServer(port: number): Promise<void> {
  const app = createApi(port);

  // Get config and auto-start proactive
  const config = await getConfig();

  app.listen(port, () => {
    console.log(`Mini-Agent API server running on http://localhost:${port}`);

    // Auto-start proactive mode
    startProactive({ schedule: config.proactiveSchedule });
    console.log(`\n[Proactive] Auto-started with schedule: ${config.proactiveSchedule}`);
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
      // For images, collect the absolute path
      imagePaths.push(`[Image: ${fileName}]: ${result.content}`);
    } else {
      // For text files, include the content
      textContents.push(`=== ${fileName} ===\n${result.content}`);
    }
  }

  // Build prompt with text content and image references
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
// Prompt Mode (single prompt without file)
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
        // Show current config
        const config = await getConfig();
        console.log('\nCurrent Configuration:');
        for (const [k, v] of Object.entries(config)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      } else if (subCmd === 'set' && key) {
        // Set a config value
        let parsedValue: unknown = value;
        // Try to parse as JSON for booleans/numbers
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }
        const config = await updateConfig({ [key]: parsedValue });
        console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      } else if (subCmd === 'reset') {
        const config = await resetConfig();
        console.log('Configuration reset to defaults');
      } else {
        console.log('Usage:');
        console.log('  /config           - Show current config');
        console.log('  /config show      - Show current config');
        console.log('  /config set <key> <value> - Set a config value');
        console.log('  /config reset     - Reset to defaults');
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
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command = '';
  let port = 3001;
  let prompt = 'Process this:';
  let hasExplicitPrompt = false;
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
        hasExplicitPrompt = true;
      }
    }
  }

  return { command, port, prompt, files, hasExplicitPrompt };
}

async function main(): Promise<void> {
  const { command, port, prompt, files, hasExplicitPrompt } = parseArgs();

  // Check if stdin is piped
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

  // Prompt-only mode: mini-agent "do something"
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
