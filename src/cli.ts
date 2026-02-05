#!/usr/bin/env node
/**
 * CLI Entry Point
 *
 * Supports two modes:
 * 1. Interactive mode: readline-based chat interface
 * 2. Pipe mode: read from stdin, output result (Unix pipe compatible)
 *
 * Examples:
 *   mini-agent                          # Interactive mode
 *   echo "Hello" | mini-agent           # Pipe mode with default prompt
 *   cat file.txt | mini-agent "summarize this"  # Pipe mode with custom prompt
 *   git diff | mini-agent "write commit message" | pbcopy
 */

import readline from 'node:readline';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import { searchMemory, readHeartbeat, appendMemory } from './memory.js';

// =============================================================================
// Pipe Mode
// =============================================================================

/**
 * Read all data from stdin (for pipe mode)
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

/**
 * Run in pipe mode: read stdin, process, output result
 */
async function runPipeMode(): Promise<void> {
  // Get prompt from command line args (default: "Process this input:")
  const prompt = process.argv[2] || 'Process this input:';

  // Read piped input
  const input = await readStdin();

  if (!input) {
    console.error('Error: No input received from pipe');
    process.exit(1);
  }

  // Combine prompt with input
  const fullPrompt = `${prompt}\n\n---\n\n${input}`;

  try {
    const response = await processMessage(fullPrompt);
    // Output only the content (suitable for piping to next command)
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

function startInteractiveMode(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle close event
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

    // Commands
    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      if (!isClosing) prompt();
      return;
    }

    // Process message
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

async function handleCommand(cmd: string): Promise<void> {
  const [command, ...args] = cmd.slice(1).split(' ');

  switch (command) {
    case 'help':
      console.log(`
Commands:
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

    case 'search':
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

    case 'heartbeat':
      const hb = await readHeartbeat();
      console.log(hb || '(empty)');
      break;

    case 'trigger':
      const result = await triggerHeartbeat();
      console.log(result ?? 'No action needed');
      break;

    case 'remember':
      const text = args.join(' ');
      if (!text) {
        console.log('Usage: /remember <text>');
        break;
      }
      await appendMemory(text);
      console.log('Remembered!');
      break;

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

// Check if stdin is a TTY (interactive) or a pipe
const isPiped = !process.stdin.isTTY;

if (isPiped) {
  // Pipe mode: read stdin, process, output
  runPipeMode().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  // Interactive mode: readline interface
  startInteractiveMode();
}
