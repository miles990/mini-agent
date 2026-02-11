/**
 * Memory System - Minimal Core
 *
 * Stripped down to ~300 lines while keeping core functionality:
 * - File-based memory (MEMORY.md, SOUL.md, HEARTBEAT.md)
 * - Hot conversation buffer + daily notes
 * - Topic memory scoping
 * - Context building with custom perceptions
 * - grep-based search
 *
 * Removed:
 * - Perception provider injection
 * - Context checkpoints
 * - NEXT.md verification
 * - Instance.ts dependency (memoryDir passed directly)
 * - File locking (personal use, single process)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CustomPerception } from './perception.js';
import {
  executeAllPerceptions,
  formatPerceptionResults,
  loadAllSkills,
  formatSkillsPrompt,
} from './perception.js';

// =============================================================================
// Types
// =============================================================================

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface MemoryEntry {
  content: string;
  source: string;
  date: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_HOT_LIMIT = 20;

// =============================================================================
// Memory Class
// =============================================================================

export class InstanceMemory {
  private memoryDir: string;
  private conversationBuffer: ConversationEntry[] = [];
  private hotLimit: number;
  private customPerceptions: CustomPerception[] = [];
  private skills: string[] = [];

  constructor(
    memoryDir: string,
    options?: {
      hot?: number;
      perceptions?: CustomPerception[];
      skills?: string[];
    }
  ) {
    this.memoryDir = memoryDir;
    this.hotLimit = options?.hot ?? DEFAULT_HOT_LIMIT;
    this.customPerceptions = options?.perceptions ?? [];
    this.skills = options?.skills ?? [];
  }

  // ---------------------------------------------------------------------------
  // Directory Management
  // ---------------------------------------------------------------------------

  getMemoryDir(): string {
    return this.memoryDir;
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // Core Memory Files
  // ---------------------------------------------------------------------------

  async readMemory(): Promise<string> {
    const memoryPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      return await fs.readFile(memoryPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.readMemory]', error);
      }
      return '';
    }
  }

  async appendMemory(content: string, section = 'Learned Patterns'): Promise<void> {
    await this.ensureDir(this.memoryDir);
    const memoryPath = path.join(this.memoryDir, 'MEMORY.md');

    const current = await this.readMemory();
    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `\n- [${timestamp}] ${content}`;
    const sectionHeader = `## ${section}`;

    let updated: string;
    if (current.includes(sectionHeader)) {
      updated = current.replace(sectionHeader, `${sectionHeader}${entry}`);
    } else {
      updated = current + `\n${sectionHeader}${entry}\n`;
    }

    await fs.writeFile(memoryPath, updated, 'utf-8');
  }

  async readSoul(): Promise<string> {
    const soulPath = path.join(this.memoryDir, 'SOUL.md');
    try {
      return await fs.readFile(soulPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.readSoul]', error);
      }
      return '';
    }
  }

  async readHeartbeat(): Promise<string> {
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');
    try {
      return await fs.readFile(heartbeatPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.readHeartbeat]', error);
      }
      return '';
    }
  }

  async updateHeartbeat(content: string): Promise<void> {
    await this.ensureDir(this.memoryDir);
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');
    await fs.writeFile(heartbeatPath, content, 'utf-8');
  }

  async addTask(task: string, schedule?: string): Promise<void> {
    await this.ensureDir(this.memoryDir);
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');

    let current = '';
    try {
      current = await fs.readFile(heartbeatPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.addTask.read]', error);
      }
      current = `# HEARTBEAT\n\n## Active Tasks\n`;
    }

    const timestamp = new Date().toISOString();
    const scheduleNote = schedule ? ` (${schedule})` : '';
    const taskEntry = `\n- [ ] ${task}${scheduleNote} <!-- added: ${timestamp} -->`;

    let updated: string;
    if (current.includes('## Active Tasks')) {
      updated = current.replace('## Active Tasks', `## Active Tasks${taskEntry}`);
    } else {
      updated = current + `\n## Active Tasks${taskEntry}\n`;
    }

    await fs.writeFile(heartbeatPath, updated, 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Topic Memory
  // ---------------------------------------------------------------------------

  async appendTopicMemory(topic: string, content: string): Promise<void> {
    const topicsDir = path.join(this.memoryDir, 'topics');
    await this.ensureDir(topicsDir);
    const topicPath = path.join(topicsDir, `${topic}.md`);

    let current = '';
    try {
      current = await fs.readFile(topicPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.appendTopicMemory]', error);
      }
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `- [${timestamp}] ${content}\n`;

    if (current) {
      await fs.writeFile(topicPath, current.trimEnd() + '\n' + entry, 'utf-8');
    } else {
      await fs.writeFile(topicPath, `# ${topic}\n\n${entry}`, 'utf-8');
    }
  }

  private async listTopics(): Promise<string[]> {
    const topicsDir = path.join(this.memoryDir, 'topics');
    try {
      const files = await fs.readdir(topicsDir);
      return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  private async readTopicMemory(topic: string): Promise<string> {
    const topicPath = path.join(this.memoryDir, 'topics', `${topic}.md`);
    try {
      return await fs.readFile(topicPath, 'utf-8');
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Daily Notes
  // ---------------------------------------------------------------------------

  async readDailyNotes(): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(this.memoryDir, 'daily', `${today}.md`);
    try {
      return await fs.readFile(dailyPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.readDailyNotes]', error);
      }
      return '';
    }
  }

  async appendDailyNote(content: string): Promise<void> {
    const dailyDir = path.join(this.memoryDir, 'daily');
    await this.ensureDir(dailyDir);

    const today = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(dailyDir, `${today}.md`);
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    let current = '';
    try {
      current = await fs.readFile(dailyPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[memory.appendDailyNote.read]', error);
      }
      current = `# Daily Notes - ${today}\n`;
    }

    const newContent = current + `\n[${timestamp}] ${content}`;
    await fs.writeFile(dailyPath, newContent, 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Conversation Management (Hot Buffer)
  // ---------------------------------------------------------------------------

  async appendConversation(role: 'user' | 'assistant', content: string): Promise<void> {
    const timestamp = new Date().toISOString();

    // Add to hot buffer
    this.conversationBuffer.push({ role, content, timestamp });

    // Rotate if over limit
    if (this.conversationBuffer.length > this.hotLimit) {
      this.conversationBuffer = this.conversationBuffer.slice(-this.hotLimit);
    }

    // Write to daily notes
    const prefix = role === 'user' ? '(alex)' : '(kuro)';
    await this.appendDailyNote(`${prefix} ${content}`);
  }

  getHotConversations(): ConversationEntry[] {
    return [...this.conversationBuffer];
  }

  clearHotBuffer(): void {
    this.conversationBuffer = [];
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    // Sanitize query
    const sanitized = query.replace(/["`$\\;|&(){}[\]<>!#*?~\n\r]/g, '');
    if (!sanitized.trim()) return [];

    try {
      const { execFileSync } = await import('node:child_process');
      const grepResult = execFileSync(
        'grep',
        ['-rni', '--include=*.md', sanitized, this.memoryDir],
        { encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 1024 }
      );

      return grepResult
        .split('\n')
        .filter(line => line.trim())
        .slice(0, maxResults)
        .map(line => {
          const [filePath, ...rest] = line.split(':');
          return {
            content: rest.join(':').trim(),
            source: path.basename(filePath),
            date: new Date().toISOString().split('T')[0],
          };
        });
    } catch (error) {
      const exitCode = (error as { status?: number })?.status;
      if (exitCode !== 1) {
        console.error('[memory.searchMemory]', error);
      }
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Context Building (THE CORE FUNCTION)
  // ---------------------------------------------------------------------------

  async buildContext(options?: { mode?: 'full' | 'focused' }): Promise<string> {
    const mode = options?.mode ?? 'full';

    // Read core memory files in parallel
    const [memory, heartbeat, soul] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
      this.readSoul(),
    ]);

    // Build hot conversations string
    const conversations = this.conversationBuffer
      .map(c => {
        const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
        const who = c.role === 'user' ? '(alex)' : '(kuro)';
        return `[${time}] ${who} ${c.content}`;
      })
      .join('\n');

    const sections: string[] = [];

    // Environment
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour12: false,
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const instanceId = path.basename(this.memoryDir);

    sections.push(
      `<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${instanceId}\n</environment>`
    );

    // Custom perceptions (if provided)
    if (this.customPerceptions.length > 0) {
      const results = await executeAllPerceptions(this.customPerceptions);
      const customCtx = formatPerceptionResults(results);
      if (customCtx) sections.push(customCtx);
    }

    // Soul
    if (soul) sections.push(`<soul>\n${soul}\n</soul>`);

    // Topic memories (load all, will be trimmed by budget)
    const topicSections: Array<{ name: string; content: string }> = [];
    const topics = await this.listTopics();
    for (const topic of topics) {
      const content = await this.readTopicMemory(topic);
      if (content) topicSections.push({ name: topic, content });
    }
    // Sort by size ascending so we trim largest first when over budget
    topicSections.sort((a, b) => a.content.length - b.content.length);
    for (const t of topicSections) {
      sections.push(`<topic-memory name="${t.name}">\n${t.content}\n</topic-memory>`);
    }

    // Memory
    if (memory) sections.push(`<memory>\n${memory}\n</memory>`);

    // Conversations
    sections.push(
      `<recent_conversations>\n${conversations || '(No recent conversations)'}\n</recent_conversations>`
    );

    // Heartbeat
    if (heartbeat) sections.push(`<heartbeat>\n${heartbeat}\n</heartbeat>`);

    // Budget enforcement: hard cap at 30K chars
    const CONTEXT_BUDGET = 30_000;
    let result = sections.join('\n\n');
    if (result.length > CONTEXT_BUDGET) {
      // Trim topic memories first (largest first = last in array)
      while (result.length > CONTEXT_BUDGET && topicSections.length > 0) {
        const removed = topicSections.pop()!;
        const tag = `<topic-memory name="${removed.name}">\n${removed.content}\n</topic-memory>`;
        const idx = sections.indexOf(tag);
        if (idx >= 0) sections.splice(idx, 1);
        result = sections.join('\n\n');
      }
      // If still over, trim conversation buffer
      if (result.length > CONTEXT_BUDGET && this.conversationBuffer.length > 2) {
        this.conversationBuffer = this.conversationBuffer.slice(-5);
        const trimmedConv = this.conversationBuffer
          .map(c => {
            const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
            const who = c.role === 'user' ? '(alex)' : '(kuro)';
            return `[${time}] ${who} ${c.content}`;
          })
          .join('\n');
        const convIdx = sections.findIndex(s => s.startsWith('<recent_conversations>'));
        if (convIdx >= 0) {
          sections[convIdx] = `<recent_conversations>\n${trimmedConv}\n</recent_conversations>`;
        }
        result = sections.join('\n\n');
      }
      console.log(`[MEMORY] Context trimmed to ${result.length} chars (budget: ${CONTEXT_BUDGET})`);
    }

    return result;
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

const memoryInstances = new Map<string, InstanceMemory>();

export function createMemory(
  memoryDir: string,
  options?: {
    hot?: number;
    perceptions?: CustomPerception[];
    skills?: string[];
  }
): InstanceMemory {
  if (!memoryInstances.has(memoryDir)) {
    memoryInstances.set(memoryDir, new InstanceMemory(memoryDir, options));
  }
  return memoryInstances.get(memoryDir)!;
}

export function getMemory(memoryDir?: string): InstanceMemory {
  if (memoryDir) return createMemory(memoryDir);
  if (defaultMemoryInstance) return defaultMemoryInstance;
  throw new Error('No memory instance available. Provide memoryDir or call createMemory() first.');
}

// =============================================================================
// Backward Compatibility - Module-level functions
// =============================================================================

// For backward compatibility, we need a default memory instance.
// This will need to be set by the caller (e.g., agent.ts or cli.ts)
let defaultMemoryInstance: InstanceMemory | null = null;

export function setDefaultMemory(memory: InstanceMemory): void {
  defaultMemoryInstance = memory;
}

function getDefaultMemory(): InstanceMemory {
  if (!defaultMemoryInstance) {
    throw new Error('Default memory instance not set. Call setDefaultMemory() first.');
  }
  return defaultMemoryInstance;
}

export async function readMemory(): Promise<string> {
  return getDefaultMemory().readMemory();
}

export async function appendMemory(content: string, section = 'Learned Patterns'): Promise<void> {
  return getDefaultMemory().appendMemory(content, section);
}

export async function appendTopicMemory(topic: string, content: string): Promise<void> {
  return getDefaultMemory().appendTopicMemory(topic, content);
}

export async function readDailyNotes(): Promise<string> {
  return getDefaultMemory().readDailyNotes();
}

export async function appendDailyNote(content: string): Promise<void> {
  return getDefaultMemory().appendDailyNote(content);
}

export async function searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
  return getDefaultMemory().searchMemory(query, maxResults);
}

export async function readHeartbeat(): Promise<string> {
  return getDefaultMemory().readHeartbeat();
}

export async function updateHeartbeat(content: string): Promise<void> {
  return getDefaultMemory().updateHeartbeat(content);
}

export async function addTask(task: string, schedule?: string): Promise<void> {
  return getDefaultMemory().addTask(task, schedule);
}

export async function buildContext(): Promise<string> {
  return getDefaultMemory().buildContext();
}

export async function readSoul(): Promise<string> {
  return getDefaultMemory().readSoul();
}
