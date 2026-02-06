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
import { withFileLock } from './filelock.js';
import type { MemoryEntry, ConversationEntry } from './types.js';

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

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_HOT_LIMIT = 20;   // Context 中的對話數量
const DEFAULT_WARM_LIMIT = 100; // 每日保留的對話數量

/**
 * 實例隔離的記憶系統
 */
export class InstanceMemory {
  private instanceId: string;
  private memoryDir: string;

  // Hot: 記憶體中的對話 buffer
  private conversationBuffer: ConversationEntry[] = [];
  private hotLimit: number;
  private warmLimit: number;

  constructor(instanceId?: string, options?: { hot?: number; warm?: number }) {
    this.instanceId = instanceId ?? getCurrentInstanceId();
    this.memoryDir = getMemoryDir(this.instanceId);
    this.hotLimit = options?.hot ?? DEFAULT_HOT_LIMIT;
    this.warmLimit = options?.warm ?? DEFAULT_WARM_LIMIT;
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

    await withFileLock(memoryPath, async () => {
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
    });
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
    await withFileLock(heartbeatPath, async () => {
      await fs.writeFile(heartbeatPath, content, 'utf-8');
    });
  }

  /**
   * 添加任務到 HEARTBEAT.md
   */
  async addTask(task: string, schedule?: string): Promise<void> {
    await ensureDir(this.memoryDir);
    const heartbeatPath = path.join(this.memoryDir, 'HEARTBEAT.md');

    await withFileLock(heartbeatPath, async () => {
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
    });
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
   * 附加到今日日記（支援 Warm rotate）
   */
  async appendDailyNote(content: string): Promise<void> {
    const dailyDir = path.join(this.memoryDir, 'daily');
    await ensureDir(dailyDir);

    const today = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(dailyDir, `${today}.md`);

    await withFileLock(dailyPath, async () => {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

      let current = '';
      try {
        current = await fs.readFile(dailyPath, 'utf-8');
      } catch {
        current = `# Daily Notes - ${today}\n`;
      }

      // 添加新內容
      const newContent = current + `\n[${timestamp}] ${content}`;

      // Warm rotate: 限制每日筆數
      const lines = newContent.split('\n');
      const headerLines = lines.filter(l => l.startsWith('#') || l.trim() === '');
      const contentLines = lines.filter(l => !l.startsWith('#') && l.trim() !== '' && l.startsWith('['));

      // 如果超過 warmLimit，移除最舊的
      if (contentLines.length > this.warmLimit) {
        const trimmed = contentLines.slice(-this.warmLimit);
        const finalContent = [...headerLines, ...trimmed].join('\n');
        await fs.writeFile(dailyPath, finalContent, 'utf-8');
      } else {
        await fs.writeFile(dailyPath, newContent, 'utf-8');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Conversation Management (Hot/Warm)
  // ---------------------------------------------------------------------------

  /**
   * 添加對話到 Hot buffer 和 Warm storage
   */
  async appendConversation(role: 'user' | 'assistant', content: string): Promise<void> {
    const timestamp = new Date().toISOString();

    // 1. 添加到 Hot buffer
    this.conversationBuffer.push({ role, content, timestamp });

    // Hot rotate: 超過限制就移除最舊的
    if (this.conversationBuffer.length > this.hotLimit) {
      this.conversationBuffer = this.conversationBuffer.slice(-this.hotLimit);
    }

    // 2. 寫入 Warm storage (daily notes)
    const prefix = role === 'user' ? 'User' : 'Assistant';
    await this.appendDailyNote(`${prefix}: ${content}`);
  }

  /**
   * 取得 Hot buffer 中的對話
   */
  getHotConversations(): ConversationEntry[] {
    return [...this.conversationBuffer];
  }

  /**
   * 清空 Hot buffer
   */
  clearHotBuffer(): void {
    this.conversationBuffer = [];
  }

  /**
   * 取得對話歷史（從 Warm storage）
   */
  async getConversationHistory(limit?: number): Promise<ConversationEntry[]> {
    const daily = await this.readDailyNotes();
    const lines = daily.split('\n').filter(l => l.match(/^\[\d{2}:\d{2}:\d{2}\]/));

    const conversations: ConversationEntry[] = [];
    for (const line of lines) {
      const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (User|Assistant): (.+)$/);
      if (match) {
        const [, time, role, content] = match;
        const today = new Date().toISOString().split('T')[0];
        conversations.push({
          role: role.toLowerCase() as 'user' | 'assistant',
          content,
          timestamp: `${today}T${time}`,
        });
      }
    }

    return limit ? conversations.slice(-limit) : conversations;
  }

  /**
   * 搜尋記憶
   */
  async searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    // Sanitize query: remove shell metacharacters to prevent command injection
    const sanitized = query.replace(/["`$\\;|&(){}[\]<>!#*?~\n\r]/g, '');
    if (!sanitized.trim()) return [];

    try {
      // Use execFileSync to avoid shell interpretation entirely
      const { execFileSync } = await import('node:child_process');
      const grepResult = execFileSync(
        'grep',
        ['-rni', '--include=*.md', sanitized, this.memoryDir],
        { encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 1024 }
      );

      return grepResult
        .split('\n')
        .filter((line) => line.trim())
        .slice(0, maxResults)
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
   * 使用 Hot buffer 的對話（不是全部 daily notes）
   */
  async buildContext(): Promise<string> {
    const [memory, heartbeat] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
    ]);

    // 使用 Hot buffer 中的對話
    const conversations = this.conversationBuffer
      .map(c => {
        const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
        const role = c.role === 'user' ? 'User' : 'Assistant';
        return `[${time}] ${role}: ${c.content}`;
      })
      .join('\n');

    // Server 環境資訊（讓 Agent 感知時間和環境）
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return `
<environment>
Current time: ${timeStr} (${tz})
Instance: ${this.instanceId}
</environment>

<memory>
${memory}
</memory>

<recent_conversations>
${conversations || '(No recent conversations)'}
</recent_conversations>

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
