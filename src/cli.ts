#!/usr/bin/env node
/**
 * CLI Entry Point
 *
 * Interactive command-line interface for mini-agent
 */

import readline from 'node:readline';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import { searchMemory, readHeartbeat, appendMemory } from './memory.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let isClosing = false;

// Handle close event
rl.on('close', () => {
  if (!isClosing) {
    console.log('\nBye!');
    process.exit(0);
  }
});

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

// Main
console.log('Mini-Agent - Memory + Proactivity');
console.log('Type /help for commands, or just chat.\n');
prompt();
