/**
 * Memory System - File-based, No Database
 *
 * Simple memory using Markdown files:
 * - MEMORY.md: Long-term knowledge
 * - daily/YYYY-MM-DD.md: Daily notes
 * - Search via grep (no embedding)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MEMORY_DIR = path.join(process.cwd(), 'memory');

export interface MemoryEntry {
  content: string;
  source: string;
  date: string;
}

/**
 * Read long-term memory
 */
export async function readMemory(): Promise<string> {
  const memoryPath = path.join(MEMORY_DIR, 'MEMORY.md');
  try {
    return await fs.readFile(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Append to long-term memory
 */
export async function appendMemory(content: string, section = 'Learned Patterns'): Promise<void> {
  const memoryPath = path.join(MEMORY_DIR, 'MEMORY.md');
  const current = await readMemory();

  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `\n- [${timestamp}] ${content}`;

  // Find section and append
  const sectionHeader = `## ${section}`;
  if (current.includes(sectionHeader)) {
    const updated = current.replace(
      sectionHeader,
      `${sectionHeader}${entry}`
    );
    await fs.writeFile(memoryPath, updated, 'utf-8');
  } else {
    // Append at end
    await fs.writeFile(memoryPath, current + `\n${sectionHeader}${entry}\n`, 'utf-8');
  }
}

/**
 * Get today's date string
 */
function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Read today's daily notes
 */
export async function readDailyNotes(): Promise<string> {
  const dailyPath = path.join(MEMORY_DIR, 'daily', `${getToday()}.md`);
  try {
    return await fs.readFile(dailyPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Append to daily notes
 */
export async function appendDailyNote(content: string): Promise<void> {
  const dailyDir = path.join(MEMORY_DIR, 'daily');
  await fs.mkdir(dailyDir, { recursive: true });

  const dailyPath = path.join(dailyDir, `${getToday()}.md`);
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

  let current = '';
  try {
    current = await fs.readFile(dailyPath, 'utf-8');
  } catch {
    current = `# Daily Notes - ${getToday()}\n`;
  }

  await fs.writeFile(dailyPath, current + `\n[${timestamp}] ${content}`, 'utf-8');
}

/**
 * Search memory using grep (simple but effective)
 */
export async function searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
  try {
    // Use grep to search all .md files
    const result = execSync(
      `grep -rni "${query.replace(/"/g, '\\"')}" "${MEMORY_DIR}" --include="*.md" | head -${maxResults}`,
      { encoding: 'utf-8', timeout: 5000 }
    );

    return result.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [filePath, ...rest] = line.split(':');
        return {
          content: rest.join(':').trim(),
          source: path.basename(filePath),
          date: getToday(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Read HEARTBEAT.md
 */
export async function readHeartbeat(): Promise<string> {
  const heartbeatPath = path.join(MEMORY_DIR, 'HEARTBEAT.md');
  try {
    return await fs.readFile(heartbeatPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Update HEARTBEAT.md
 */
export async function updateHeartbeat(content: string): Promise<void> {
  const heartbeatPath = path.join(MEMORY_DIR, 'HEARTBEAT.md');
  await fs.writeFile(heartbeatPath, content, 'utf-8');
}

/**
 * Add a task to HEARTBEAT.md
 */
export async function addTask(task: string, schedule?: string): Promise<void> {
  const heartbeatPath = path.join(MEMORY_DIR, 'HEARTBEAT.md');
  await fs.mkdir(MEMORY_DIR, { recursive: true });

  let current = '';
  try {
    current = await fs.readFile(heartbeatPath, 'utf-8');
  } catch {
    current = `# HEARTBEAT\n\n## Active Tasks\n`;
  }

  const timestamp = new Date().toISOString();
  const scheduleNote = schedule ? ` (${schedule})` : '';
  const taskEntry = `\n- [ ] ${task}${scheduleNote} <!-- added: ${timestamp} -->`;

  // Add to Active Tasks section
  if (current.includes('## Active Tasks')) {
    const updated = current.replace(
      '## Active Tasks',
      `## Active Tasks${taskEntry}`
    );
    await fs.writeFile(heartbeatPath, updated, 'utf-8');
  } else {
    await fs.writeFile(heartbeatPath, current + `\n## Active Tasks${taskEntry}\n`, 'utf-8');
  }
}

/**
 * Build context for LLM (memory + heartbeat)
 */
export async function buildContext(): Promise<string> {
  const [memory, daily, heartbeat] = await Promise.all([
    readMemory(),
    readDailyNotes(),
    readHeartbeat(),
  ]);

  return `
<memory>
${memory}
</memory>

<today>
${daily}
</today>

<heartbeat>
${heartbeat}
</heartbeat>
`.trim();
}
