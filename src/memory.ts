/**
 * Memory System - Instance-isolated, File-based
 *
 * 每個實例有獨立的記憶目錄：
 * - ~/.mini-agent/instances/{id}/MEMORY.md
 * - ~/.mini-agent/instances/{id}/HEARTBEAT.md
 * - ~/.mini-agent/instances/{id}/daily/
 *
 * 向後兼容：default 實例使用本地 ./memory/ 目錄
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  getCurrentInstanceId,
  getInstanceDir,
  initDataDir,
} from './instance.js';
import type { MemoryEntry } from './types.js';

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * 取得實例的記憶目錄
 */
function getMemoryDir(instanceId?: string): string {
  const id = instanceId ?? getCurrentInstanceId();

  // 向後兼容：default 實例在當前工作目錄
  if (id === 'default' && process.cwd().includes('mini-agent')) {
    return path.join(process.cwd(), 'memory');
  }

  return getInstanceDir(id);
}

/**
 * 確保目錄存在
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// =============================================================================
// Memory Class (Instance-specific)
// =============================================================================

/**
 * 實例隔離的記憶系統
 */
export class InstanceMemory {
  private instanceId: string;
  private memoryDir: string;

  constructor(instanceId?: string) {
    this.instanceId = instanceId ?? getCurrentInstanceId();
    this.memoryDir = getMemoryDir(this.instanceId);
  }

  /**
   * 取得記憶目錄
   */
  getMemoryDir(): string {
    return this.memoryDir;
  }

  /**
   * 讀取長期記憶
   */
  async readMemory(): Promise<string> {
    const memoryPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      return await fs.readFile(memoryPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 附加到長期記憶
   */
  async appendMemory(content: string, section = 'Learned Patterns'): Promise<void> {
    await ensureDir(this.memoryDir);
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

  /**
   * 讀取 HEARTBEAT.md
   */
  async readHeartbeat(): Promise<string> {
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');
    try {
      return await fs.readFile(heartbeatPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 更新 HEARTBEAT.md
   */
  async updateHeartbeat(content: string): Promise<void> {
    await ensureDir(this.memoryDir);
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');
    await fs.writeFile(heartbeatPath, content, 'utf-8');
  }

  /**
   * 添加任務到 HEARTBEAT.md
   */
  async addTask(task: string, schedule?: string): Promise<void> {
    await ensureDir(this.memoryDir);
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');

    let current = '';
    try {
      current = await fs.readFile(heartbeatPath, 'utf-8');
    } catch {
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

  /**
   * 讀取今日日記
   */
  async readDailyNotes(): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(this.memoryDir, 'daily', `${today}.md`);
    try {
      return await fs.readFile(dailyPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 附加到今日日記
   */
  async appendDailyNote(content: string): Promise<void> {
    const dailyDir = path.join(this.memoryDir, 'daily');
    await ensureDir(dailyDir);

    const today = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(dailyDir, `${today}.md`);
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    let current = '';
    try {
      current = await fs.readFile(dailyPath, 'utf-8');
    } catch {
      current = `# Daily Notes - ${today}\n`;
    }

    await fs.writeFile(dailyPath, current + `\n[${timestamp}] ${content}`, 'utf-8');
  }

  /**
   * 搜尋記憶
   */
  async searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    try {
      const result = execSync(
        `grep -rni "${query.replace(/"/g, '\\"')}" "${this.memoryDir}" --include="*.md" | head -${maxResults}`,
        { encoding: 'utf-8', timeout: 5000 }
      );

      return result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [filePath, ...rest] = line.split(':');
          return {
            content: rest.join(':').trim(),
            source: path.basename(filePath),
            date: new Date().toISOString().split('T')[0],
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * 建構 LLM 上下文
   */
  async buildContext(): Promise<string> {
    const [memory, daily, heartbeat] = await Promise.all([
      this.readMemory(),
      this.readDailyNotes(),
      this.readHeartbeat(),
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
}

// =============================================================================
// Factory & Singleton
// =============================================================================

const memoryInstances = new Map<string, InstanceMemory>();

/**
 * 創建或取得實例的記憶系統
 */
export function createMemory(instanceId?: string): InstanceMemory {
  const id = instanceId ?? getCurrentInstanceId();

  if (!memoryInstances.has(id)) {
    memoryInstances.set(id, new InstanceMemory(id));
  }

  return memoryInstances.get(id)!;
}

/**
 * 取得當前實例的記憶系統
 */
export function getMemory(): InstanceMemory {
  return createMemory();
}

// =============================================================================
// Backward Compatibility - Module-level functions
// =============================================================================

// 使用當前實例的記憶系統
const defaultMemory = () => getMemory();

/**
 * Read long-term memory
 */
export async function readMemory(): Promise<string> {
  return defaultMemory().readMemory();
}

/**
 * Append to long-term memory
 */
export async function appendMemory(content: string, section = 'Learned Patterns'): Promise<void> {
  return defaultMemory().appendMemory(content, section);
}

/**
 * Read today's daily notes
 */
export async function readDailyNotes(): Promise<string> {
  return defaultMemory().readDailyNotes();
}

/**
 * Append to daily notes
 */
export async function appendDailyNote(content: string): Promise<void> {
  return defaultMemory().appendDailyNote(content);
}

/**
 * Search memory using grep
 */
export async function searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
  return defaultMemory().searchMemory(query, maxResults);
}

/**
 * Read HEARTBEAT.md
 */
export async function readHeartbeat(): Promise<string> {
  return defaultMemory().readHeartbeat();
}

/**
 * Update HEARTBEAT.md
 */
export async function updateHeartbeat(content: string): Promise<void> {
  return defaultMemory().updateHeartbeat(content);
}

/**
 * Add a task to HEARTBEAT.md
 */
export async function addTask(task: string, schedule?: string): Promise<void> {
  return defaultMemory().addTask(task, schedule);
}

/**
 * Build context for LLM
 */
export async function buildContext(): Promise<string> {
  return defaultMemory().buildContext();
}
