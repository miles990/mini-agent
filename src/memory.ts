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
import {
  getWorkspaceSnapshot, formatWorkspaceContext, formatSelfStatus,
  getProcessStatus, formatProcessStatus,
  getLogSummary, formatLogSummary,
  getSystemResources, formatSystemResources,
  getNetworkStatus, formatNetworkStatus,
  getConfigSnapshot, formatConfigSnapshot,
} from './workspace.js';
import type {
  AgentSelfStatus,
  ProcessStatus, LogSummary, SystemResources, NetworkStatus, ConfigSnapshot,
} from './workspace.js';
import type { MemoryEntry, ConversationEntry, ComposePerception } from './types.js';
import {
  executeAllPerceptions, formatPerceptionResults,
  loadAllSkills, formatSkillsPrompt,
} from './perception.js';

// =============================================================================
// Perception Providers (外部注入，避免循環依賴)
// =============================================================================

let selfStatusProvider: (() => AgentSelfStatus | null) | null = null;
let processStatusProvider: (() => ProcessStatus) | null = null;
let logSummaryProvider: (() => LogSummary) | null = null;
let networkStatusProvider: (() => NetworkStatus) | null = null;
let configSnapshotProvider: (() => ConfigSnapshot) | null = null;

// Custom Perception & Skills（從 compose 配置注入）
let customPerceptions: ComposePerception[] = [];
let skillPaths: string[] = [];
let skillsPromptCache: string = '';

/** 註冊自訂感知和 Skills */
export function setCustomExtensions(ext: {
  perceptions?: ComposePerception[];
  skills?: string[];
  cwd?: string;
}): void {
  if (ext.perceptions) customPerceptions = ext.perceptions;
  if (ext.skills) {
    skillPaths = ext.skills;
    // Skills 只在啟動時載入一次（不像 perception 每次循環都跑）
    const loaded = loadAllSkills(skillPaths, ext.cwd);
    skillsPromptCache = formatSkillsPrompt(loaded);
    if (loaded.length > 0) {
      console.log(`[SKILLS] Loaded ${loaded.length} skill(s): ${loaded.map(s => s.name).join(', ')}`);
    }
  }
}

/** 取得 skills prompt（給 agent.ts 用） */
export function getSkillsPrompt(): string {
  return skillsPromptCache;
}

/** 註冊 Agent 自我狀態提供者 */
export function setSelfStatusProvider(provider: () => AgentSelfStatus | null): void {
  selfStatusProvider = provider;
}

/** 註冊所有感知提供者 */
export function setPerceptionProviders(providers: {
  process?: () => ProcessStatus;
  logs?: () => LogSummary;
  network?: () => NetworkStatus;
  config?: () => ConfigSnapshot;
}): void {
  if (providers.process) processStatusProvider = providers.process;
  if (providers.logs) logSummaryProvider = providers.logs;
  if (providers.network) networkStatusProvider = providers.network;
  if (providers.config) configSnapshotProvider = providers.config;
}

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
   * 讀取 SOUL.md（Agent 身分認同）
   */
  async readSoul(): Promise<string> {
    const soulPath = path.join(this.memoryDir, 'SOUL.md');
    try {
      return await fs.readFile(soulPath, 'utf-8');
    } catch {
      return '';
    }
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
   *
   * 格式支援:
   * - [ ] P0: urgent task @due:2026-02-10 <!-- added: ... -->
   * - [ ] P1: important task <!-- added: ... -->
   * - [ ] task without priority (default P2)
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

      // 按優先級插入（P0 在最前面）
      let updated: string;
      if (current.includes('## Active Tasks')) {
        // 找到插入位置：P0 在最前、P1 在 P0 後、其他在最後
        const priority = this.extractPriority(task);
        const lines = current.split('\n');
        const sectionIdx = lines.findIndex(l => l.includes('## Active Tasks'));

        if (sectionIdx >= 0) {
          let insertIdx = sectionIdx + 1;
          // 找到適合的位置
          for (let i = sectionIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## ') && !line.includes('Active Tasks')) break; // 下一個 section
            if (!line.startsWith('- [ ]')) continue;
            const linePriority = this.extractPriority(line);
            if (linePriority <= priority) {
              insertIdx = i + 1;
            } else {
              break;
            }
          }
          lines.splice(insertIdx, 0, `- [ ] ${task}${scheduleNote} <!-- added: ${timestamp} -->`);
          updated = lines.join('\n');
        } else {
          updated = current.replace('## Active Tasks', `## Active Tasks${taskEntry}`);
        }
      } else {
        updated = current + `\n## Active Tasks${taskEntry}\n`;
      }

      await fs.writeFile(heartbeatPath, updated, 'utf-8');
    });
  }

  /**
   * 解析任務優先級（P0=0, P1=1, P2=2, 無=2）
   */
  private extractPriority(text: string): number {
    const match = text.match(/P(\d)/);
    return match ? parseInt(match[1], 10) : 2;
  }

  /**
   * 取得過期任務
   */
  async getOverdueTasks(): Promise<string[]> {
    const heartbeat = await this.readHeartbeat();
    const now = new Date();
    const overdue: string[] = [];

    for (const line of heartbeat.split('\n')) {
      if (!line.includes('- [ ]')) continue;
      const dueMatch = line.match(/@due:(\d{4}-\d{2}-\d{2})/);
      if (dueMatch) {
        const dueDate = new Date(dueMatch[1]);
        if (dueDate < now) {
          overdue.push(line.replace(/^\s*- \[ \]\s*/, '').replace(/\s*<!--.*-->/, ''));
        }
      }
    }
    return overdue;
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
   *
   * @param options.relevanceHint - 關鍵字提示，用於篩選相關感知（可選）
   * @param options.mode - 'full' | 'focused'。focused 模式只載入核心感知（用於 AgentLoop）
   */
  async buildContext(options?: {
    relevanceHint?: string;
    mode?: 'full' | 'focused';
  }): Promise<string> {
    const mode = options?.mode ?? 'full';
    const hint = options?.relevanceHint?.toLowerCase() ?? '';

    const [memory, heartbeat, soul] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
      this.readSoul(),
    ]);

    // 使用 Hot buffer 中的對話
    const conversations = this.conversationBuffer
      .map(c => {
        const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
        const role = c.role === 'user' ? 'User' : 'Assistant';
        return `[${time}] ${role}: ${c.content}`;
      })
      .join('\n');

    // 從最近對話提取上下文關鍵字
    const recentHint = this.conversationBuffer
      .slice(-3)
      .map(c => c.content.toLowerCase())
      .join(' ');
    const contextHint = hint || recentHint;

    // Server 環境資訊
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 組合感知區塊
    const sections: string[] = [];

    // ── 必載入（核心感知）──
    sections.push(`<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${this.instanceId}\n</environment>`);

    const selfStatus = selfStatusProvider?.();
    if (selfStatus) {
      const selfCtx = formatSelfStatus(selfStatus);
      if (selfCtx) sections.push(`<self>\n${selfCtx}\n</self>`);
    }

    // ── 條件載入（根據相關性）──
    const isRelevant = (keywords: string[]) =>
      mode === 'full' || keywords.some(k => contextHint.includes(k));

    // Process — 在問 debug/performance/memory 時才載入
    if (isRelevant(['process', 'memory', 'cpu', 'pid', 'debug', 'slow', 'performance', 'kill'])) {
      const processCtx = processStatusProvider ? formatProcessStatus(processStatusProvider()) : '';
      if (processCtx) sections.push(`<process>\n${processCtx}\n</process>`);
    }

    // System — 在問 disk/resource 時才載入
    if (isRelevant(['system', 'disk', 'cpu', 'resource', 'space', 'full'])) {
      const sysRes = getSystemResources();
      const sysCtx = formatSystemResources(sysRes);
      if (sysCtx) sections.push(`<system>\n${sysCtx}\n</system>`);
    }

    // Logs — 在問 error/log/debug 時才載入
    if (isRelevant(['error', 'log', 'fail', 'bug', 'debug', 'crash'])) {
      const logCtx = logSummaryProvider ? formatLogSummary(logSummaryProvider()) : '';
      if (logCtx) sections.push(`<logs>\n${logCtx}\n</logs>`);
    }

    // Network — 在問 port/service/network 時才載入
    if (isRelevant(['port', 'network', 'service', 'connect', 'http', 'api', 'url'])) {
      const netCtx = networkStatusProvider ? formatNetworkStatus(networkStatusProvider()) : '';
      if (netCtx) sections.push(`<network>\n${netCtx}\n</network>`);
    }

    // Config — 在問 config/setting 時才載入
    if (isRelevant(['config', 'setting', 'compose', 'cron', 'loop', 'skill'])) {
      const cfgCtx = configSnapshotProvider ? formatConfigSnapshot(configSnapshotProvider()) : '';
      if (cfgCtx) sections.push(`<config>\n${cfgCtx}\n</config>`);
    }

    // Workspace — 幾乎總是有用
    const workspace = getWorkspaceSnapshot();
    const workspaceCtx = formatWorkspaceContext(workspace);
    sections.push(`<workspace>\n${workspaceCtx}\n</workspace>`);

    // ── Custom perceptions（Smart 載入）──
    if (customPerceptions.length > 0) {
      // 定義每個 plugin 的關聯詞
      const pluginRelevance: Record<string, string[]> = {
        docker: ['docker', 'container', 'image', 'deploy'],
        chrome: ['chrome', 'cdp', 'browser', 'web', 'fetch', 'url', 'page'],
        web: ['web', 'url', 'fetch', 'http', 'page'],
        ports: ['port', 'service', 'listen', 'connect'],
        tasks: [], // 任務追蹤永遠載入
        'state-changes': [], // 狀態變化永遠載入
        disk: ['disk', 'space', 'storage'],
        brew: ['brew', 'homebrew', 'package', 'update'],
        'git-detail': ['git', 'commit', 'branch', 'merge'],
      };

      const relevantPlugins = customPerceptions.filter(p => {
        const keywords = pluginRelevance[p.name] ?? [];
        // 空關鍵字列表 = 永遠載入
        if (keywords.length === 0) return true;
        if (mode === 'full') return true;
        return keywords.some(k => contextHint.includes(k));
      });

      if (relevantPlugins.length > 0) {
        const results = executeAllPerceptions(relevantPlugins);
        const customCtx = formatPerceptionResults(results);
        if (customCtx) sections.push(customCtx);
      }
    }

    // ── Soul（身分認同，總是載入）──
    if (soul) sections.push(`<soul>\n${soul}\n</soul>`);

    // ── 記憶和對話（總是載入）──
    sections.push(`<memory>\n${memory}\n</memory>`);
    sections.push(`<recent_conversations>\n${conversations || '(No recent conversations)'}\n</recent_conversations>`);
    sections.push(`<heartbeat>\n${heartbeat}\n</heartbeat>`);

    return sections.join('\n\n');
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
