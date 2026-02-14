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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  getCurrentInstanceId,
  getInstanceDir,
  initDataDir,
} from './instance.js';
import { withFileLock } from './filelock.js';
import { diagLog } from './utils.js';
import {
  getWorkspaceSnapshot, formatWorkspaceContext, formatSelfStatus,
  getProcessStatus, formatProcessStatus,
  getLogSummary, formatLogSummary,
  getSystemResources, formatSystemResources,
  getNetworkStatus, formatNetworkStatus,
  getConfigSnapshot, formatConfigSnapshot,
  formatActivitySummary,
} from './workspace.js';
import type {
  AgentSelfStatus,
  ProcessStatus, LogSummary, SystemResources, NetworkStatus, ConfigSnapshot,
  ActivitySummary,
} from './workspace.js';
import { getTelegramPoller, getNotificationStats } from './telegram.js';
import { getQueueStatus, getProvider, getFallback } from './agent.js';
import type { MemoryEntry, ConversationEntry, ComposePerception, CatalogEntry } from './types.js';
import {
  executeAllPerceptions, formatPerceptionResults,
  loadAllSkills, formatSkillsPrompt,
} from './perception.js';
import { analyzePerceptions, isAnalysisAvailable } from './perception-analyzer.js';
import { perceptionStreams } from './perception-stream.js';
import { runVerify } from './verify.js';

// =============================================================================
// Perception Providers (外部注入，避免循環依賴)
// =============================================================================

let selfStatusProvider: (() => AgentSelfStatus | null) | null = null;
let processStatusProvider: (() => ProcessStatus) | null = null;
let logSummaryProvider: (() => LogSummary) | null = null;
let networkStatusProvider: (() => NetworkStatus) | null = null;
let configSnapshotProvider: (() => ConfigSnapshot) | null = null;
let activitySummaryProvider: (() => ActivitySummary) | null = null;

// Custom Perception & Skills（從 compose 配置注入）
let customPerceptions: ComposePerception[] = [];
let skillPaths: string[] = [];
let skillsCache: Array<{ name: string; content: string }> = [];

// Tool availability changes rarely; cache it in-process.
let toolAvailabilityCache: { checkedAt: number; values: Record<string, boolean> } | null = null;

export interface CapabilitiesSnapshot {
  provider: { primary: string; fallback: string | null };
  skills: { count: number; names: string[] };
  plugins: { count: number; names: string[] };
  tools: {
    availability: Record<string, boolean>;
    readyCount: number;
    total: number;
  };
  toolUseToday: {
    totalCalls: number;
    webFetchCount: number;
    byTool: Record<string, number>;
    topTools: Array<{ name: string; count: number }>;
  };
  readiness: {
    score: number;
    level: 'low' | 'medium' | 'high';
  };
}

// =============================================================================
// Skills JIT Loading — 按需載入，節省 50-70% token
// =============================================================================

/** Skill keyword mapping — 根據 prompt/message 內容匹配相關 skills */
const SKILL_KEYWORDS: Record<string, string[]> = {
  'autonomous-behavior': ['autonomous', 'soul', 'ooda', 'cycle', 'idle', 'agent loop', 'self-check'],
  'web-learning': ['learn', 'study', 'article', 'knowledge', 'web learning', 'cdp', 'chrome://'],
  'web-research': ['research', 'search', 'url', 'fetch', 'curl', 'cdp', 'browse', 'hacker', 'web research'],
  'action-from-learning': ['propose', 'proposal', 'feature', 'improve', 'skill', 'plugin', 'action-from-learning', 'self-improve'],
  'self-deploy': ['deploy', 'push', 'commit', 'release', 'git', 'ci/cd', 'self-deploy'],
  'docker-ops': ['docker', 'container', 'image', 'compose', 'volume'],
  'code-review': ['review', 'code review', 'pr', 'pull request', 'diff'],
  'debug-helper': ['debug', 'error', 'bug', 'crash', 'fix', 'fail', 'broken'],
  'project-manager': ['project', 'task', 'plan', 'priority', 'heartbeat', 'p0', 'p1'],
  'server-admin': ['server', 'port', 'service', 'restart', 'process', 'kill', 'admin'],
  'verified-development': ['verify', 'test', 'tdd', 'development', 'quality'],
};

/** 註冊自訂感知和 Skills */
export function setCustomExtensions(ext: {
  perceptions?: ComposePerception[];
  skills?: string[];
  cwd?: string;
}): void {
  if (ext.perceptions) customPerceptions = ext.perceptions;
  if (ext.skills) {
    skillPaths = ext.skills;
    // Skills 只在啟動時載入一次到記憶體（JIT 時按需篩選注入）
    skillsCache = loadAllSkills(skillPaths, ext.cwd);
    if (skillsCache.length > 0) {
      const totalChars = skillsCache.reduce((sum, s) => sum + s.content.length, 0);
      console.log(`[SKILLS] Loaded ${skillsCache.length} skill(s) (${totalChars} chars): ${skillsCache.map(s => s.name).join(', ')}`);
    }
  }
}

/**
 * 取得 skills prompt（JIT Loading — 按需篩選）
 *
 * @param hint - 用於匹配的文字（prompt / user message），小寫化後比對 keywords
 *   - 有 hint → 只注入匹配的 skills（節省 50-70% token）
 *   - 無 hint → 注入全部 skills（向後相容，CLI 模式）
 */
export function getSkillsPrompt(hint?: string): string {
  if (skillsCache.length === 0) return '';

  // 無 hint → 全部載入（向後相容）
  if (!hint) return formatSkillsPrompt(skillsCache);

  const lowerHint = hint.toLowerCase();
  const selected = skillsCache.filter(skill => {
    const keywords = SKILL_KEYWORDS[skill.name];
    // 未知 skill（無 mapping）→ 總是載入
    if (!keywords) return true;
    return keywords.some(k => lowerHint.includes(k));
  });

  return formatSkillsPrompt(selected);
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore', timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function getToolAvailability(): Record<string, boolean> {
  const now = Date.now();
  if (toolAvailabilityCache && now - toolAvailabilityCache.checkedAt < 300_000) {
    return toolAvailabilityCache.values;
  }

  const availability: Record<string, boolean> = {
    claude: commandExists('claude'),
    codex: commandExists('codex'),
    curl: commandExists('curl'),
    git: commandExists('git'),
    node: commandExists('node'),
    docker: commandExists('docker'),
  };

  toolAvailabilityCache = { checkedAt: now, values: availability };
  return availability;
}

function isWebFetch(tool: string, input: Record<string, unknown>): boolean {
  const name = tool.toLowerCase();
  if (name.includes('web') || name.includes('fetch') || name.includes('browser') || name.includes('http')) {
    return true;
  }
  const cmd = String(input.command ?? '');
  const url = String(input.url ?? '');
  const pattern = `${cmd}\n${url}`.toLowerCase();
  return pattern.includes('http://')
    || pattern.includes('https://')
    || pattern.includes('curl ')
    || pattern.includes('wget ');
}

async function readToolUseToday(instanceId: string): Promise<CapabilitiesSnapshot['toolUseToday']> {
  const today = new Date().toISOString().slice(0, 10);
  const auditPath = path.join(getInstanceDir(instanceId), 'logs', 'audit', `${today}.jsonl`);

  try {
    const raw = await fs.readFile(auditPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    const byTool: Record<string, number> = {};
    let webFetchCount = 0;
    let totalCalls = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { tool?: string; input?: Record<string, unknown> };
        const tool = entry.tool || 'unknown';
        byTool[tool] = (byTool[tool] || 0) + 1;
        totalCalls++;
        if (isWebFetch(tool, entry.input ?? {})) {
          webFetchCount++;
        }
      } catch {
        // skip malformed line
      }
    }

    const topTools = Object.entries(byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    return { totalCalls, webFetchCount, byTool, topTools };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagLog('memory.readToolUseToday', error, { auditPath });
    }
    return { totalCalls: 0, webFetchCount: 0, byTool: {}, topTools: [] };
  }
}

function formatCapabilitiesContext(cap: CapabilitiesSnapshot): string {
  const lines: string[] = [];
  lines.push(`Provider: primary=${cap.provider.primary}${cap.provider.fallback ? ` fallback=${cap.provider.fallback}` : ''}`);
  lines.push(`Skills (${cap.skills.count}): ${cap.skills.names.join(', ') || 'none'}`);
  lines.push(`Enabled plugins (${cap.plugins.count}): ${cap.plugins.names.join(', ') || 'none'}`);

  const toolSummary = Object.entries(cap.tools.availability)
    .map(([name, ok]) => `${name}:${ok ? 'yes' : 'no'}`)
    .join(', ');
  lines.push(`Tool availability: ${toolSummary}`);
  lines.push(`Capability readiness: ${cap.readiness.score}% (${cap.readiness.level}) [${cap.tools.readyCount}/${cap.tools.total} tools ready]`);

  lines.push(`Tool use today: total=${cap.toolUseToday.totalCalls}, webFetch=${cap.toolUseToday.webFetchCount}`);
  if (cap.toolUseToday.topTools.length > 0) {
    const top = cap.toolUseToday.topTools.map(t => `${t.name}(${t.count})`).join(', ');
    lines.push(`Top tools: ${top}`);
  }
  return lines.join('\n');
}

export async function getCapabilitiesSnapshot(instanceId = getCurrentInstanceId()): Promise<CapabilitiesSnapshot> {
  const skillNames = skillsCache.map(s => s.name);
  const pluginNames = customPerceptions
    .filter(p => p.enabled !== false)
    .map(p => p.name);

  const availability = getToolAvailability();
  const total = Object.keys(availability).length;
  const readyCount = Object.values(availability).filter(Boolean).length;
  const score = total > 0 ? Math.round((readyCount / total) * 100) : 0;
  const level: 'low' | 'medium' | 'high' = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

  const toolUseToday = await readToolUseToday(instanceId);

  return {
    provider: { primary: getProvider(), fallback: getFallback() },
    skills: { count: skillNames.length, names: skillNames },
    plugins: { count: pluginNames.length, names: pluginNames },
    tools: {
      availability,
      readyCount,
      total,
    },
    toolUseToday,
    readiness: { score, level },
  };
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
  activity?: () => ActivitySummary;
}): void {
  if (providers.process) processStatusProvider = providers.process;
  if (providers.logs) logSummaryProvider = providers.logs;
  if (providers.network) networkStatusProvider = providers.network;
  if (providers.config) configSnapshotProvider = providers.config;
  if (providers.activity) activitySummaryProvider = providers.activity;
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

  // Utility counter: track topic load frequency
  private topicLoadCounts = new Map<string, number>();

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
   * 取得 topic 載入頻率統計
   */
  getTopicUtility(): Record<string, number> {
    return Object.fromEntries(this.topicLoadCounts);
  }

  /**
   * 讀取長期記憶
   */
  async readMemory(): Promise<string> {
    const memoryPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      return await fs.readFile(memoryPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagLog('memory.readMemory', error, { path: memoryPath });
      }
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
   * 附加到 Topic 記憶（memory/topics/{topic}.md）
   * @param ref - 可選的 Library 來源引用 slug（ref:slug）
   */
  async appendTopicMemory(topic: string, content: string, ref?: string): Promise<void> {
    const topicsDir = path.join(this.memoryDir, 'topics');
    await ensureDir(topicsDir);
    const topicPath = path.join(topicsDir, `${topic}.md`);

    await withFileLock(topicPath, async () => {
      let current = '';
      try {
        current = await fs.readFile(topicPath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          diagLog('memory.appendTopicMemory', error, { topic });
        }
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const refSuffix = ref ? ` ref:${ref}` : '';
      const entry = `- [${timestamp}] ${content}${refSuffix}\n`;

      if (current) {
        await fs.writeFile(topicPath, current.trimEnd() + '\n' + entry, 'utf-8');
      } else {
        await fs.writeFile(topicPath, `# ${topic}\n\n${entry}`, 'utf-8');
      }
    });
  }

  // =========================================================================
  // Library — 可調閱式來源藏書室
  // =========================================================================

  /**
   * 存檔外部來源到 Library
   */
  async archiveSource(url: string, title: string, content: string, options?: {
    author?: string;
    date?: string;
    type?: string;
    tags?: string[];
    mode?: 'full' | 'excerpt' | 'metadata-only';
  }): Promise<{ id: string; contentFile: string }> {
    const libraryDir = path.join(this.memoryDir, 'library');
    const contentDir = path.join(libraryDir, 'content');
    await ensureDir(contentDir);

    const id = toSlug(title);
    const today = new Date().toISOString().split('T')[0];
    const contentFile = `${today}-${id}.md`;
    const archiveMode = options?.mode ?? (content ? 'full' : 'metadata-only');

    // Truncate at paragraph boundary if >100KB
    let finalContent = content;
    const MAX_BYTES = 100_000;
    if (Buffer.byteLength(content) > MAX_BYTES) {
      const truncated = content.slice(0, MAX_BYTES);
      const lastBreak = Math.max(
        truncated.lastIndexOf('\n\n'),
        truncated.lastIndexOf('\n#'),
      );
      const cutPoint = lastBreak > MAX_BYTES * 0.5 ? lastBreak : MAX_BYTES;
      finalContent = truncated.slice(0, cutPoint)
        + `\n\n<!-- truncated: original ${content.length} chars, kept ${cutPoint} chars -->`;
    }

    const contentHash = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
    const accessed = new Date().toISOString();
    const tags = options?.tags ?? [];

    // Write content file with YAML frontmatter
    if (archiveMode !== 'metadata-only') {
      const frontmatter = [
        '---',
        `id: ${id}`,
        `url: ${url}`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        options?.author ? `author: "${options.author}"` : null,
        options?.date ? `date: ${options.date}` : null,
        options?.type ? `type: ${options.type}` : null,
        `accessed: ${accessed}`,
        `tags: [${tags.join(', ')}]`,
        `contentHash: "${contentHash}"`,
        `archiveMode: ${archiveMode}`,
        '---',
        '',
      ].filter(Boolean).join('\n');
      await fs.writeFile(path.join(contentDir, contentFile), frontmatter + finalContent, 'utf-8');
    }

    // Append to catalog (append-only JSONL)
    const entry: CatalogEntry = {
      id, url, title,
      ...(options?.author && { author: options.author }),
      ...(options?.date && { date: options.date }),
      ...(options?.type && { type: options.type }),
      accessed, contentFile, tags,
      charCount: content.length,
      contentHash, archiveMode,
    };
    const catalogPath = path.join(libraryDir, 'catalog.jsonl');
    await fs.appendFile(catalogPath, JSON.stringify(entry) + '\n', 'utf-8');

    return { id, contentFile };
  }

  /**
   * 讀取 Library catalog
   */
  async readCatalog(): Promise<CatalogEntry[]> {
    const catalogPath = path.join(this.memoryDir, 'library', 'catalog.jsonl');
    try {
      const raw = await fs.readFile(catalogPath, 'utf-8');
      return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as CatalogEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagLog('memory.readCatalog', error);
      }
      return [];
    }
  }

  /**
   * 讀取 Library 單篇原文
   */
  async readLibraryContent(id: string): Promise<{ entry: CatalogEntry | null; content: string }> {
    const catalog = await this.readCatalog();
    const entry = catalog.find(e => e.id === id) ?? null;
    if (!entry) return { entry: null, content: '' };
    try {
      const contentPath = path.join(this.memoryDir, 'library', 'content', entry.contentFile);
      const content = await fs.readFile(contentPath, 'utf-8');
      return { entry, content };
    } catch {
      return { entry, content: '' };
    }
  }

  /**
   * 查詢引用某 Library 來源的所有 memory 檔案（動態 grep）
   */
  async findCitedBy(id: string): Promise<Array<{ file: string; line: string }>> {
    try {
      const result = execFileSync(
        'grep', ['-rn', `ref:${id}`, this.memoryDir, '--include=*.md'],
        { encoding: 'utf-8', timeout: 5000, maxBuffer: 512 * 1024 },
      );
      return result.split('\n').filter(l => l.trim()).map(l => {
        const [filePath, ...rest] = l.split(':');
        return { file: path.relative(this.memoryDir, filePath), line: rest.slice(1).join(':').trim() };
      });
    } catch {
      return [];
    }
  }

  /**
   * 讀取所有 Topic 記憶檔案名（不含 .md）
   */
  async listTopics(): Promise<string[]> {
    const topicsDir = path.join(this.memoryDir, 'topics');
    try {
      const files = await fs.readdir(topicsDir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  /**
   * 讀取指定 topic 的記憶
   */
  async readTopicMemory(topic: string): Promise<string> {
    const topicPath = path.join(this.memoryDir, 'topics', `${topic}.md`);
    try {
      return await fs.readFile(topicPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 讀取 NEXT.md（執行層待辦清單）
   */
  async readNext(): Promise<string> {
    const nextPath = path.join(this.memoryDir, 'NEXT.md');
    try {
      return await fs.readFile(nextPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagLog('memory.readNext', error, { path: nextPath });
      }
      return '';
    }
  }

  /**
   * 提取 NEXT.md 的 Now + Next sections（跳過 Later 和規則）
   */
  private extractActiveNext(content: string): string {
    const cutoffMarkers = ['## Later', '## 規則'];
    let cutoff = content.length;
    for (const marker of cutoffMarkers) {
      const idx = content.indexOf(marker);
      if (idx >= 0 && idx < cutoff) cutoff = idx;
    }
    return content.slice(0, cutoff).trim();
  }

  /**
   * 執行 NEXT.md 中的 Verify 命令，回傳標註驗證結果的內容
   * 每個 Verify 命令後附加 ✅ PASSED 或 ❌ NOT YET
   */
  private async verifyNextTasks(content: string): Promise<string> {
    if (!content) return '';
    const lines = content.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      result.push(line);
      const verifyMatch = line.match(/^\s*- Verify:\s*(.+)/);
      if (verifyMatch) {
        const { passed, details } = await runVerify(verifyMatch[1].trim(), this.memoryDir);
        const status = passed ? '✅ PASSED' : '❌ NOT YET';
        const msg = details.map(d => d.message).filter(Boolean).join('; ');
        result.push(`  - **Status: ${status}**${msg ? ` (${msg})` : ''}`);
      }
    }

    return result.join('\n');
  }

  /**
   * 讀取 SOUL.md（Agent 身分認同）
   */
  async readSoul(): Promise<string> {
    const soulPath = path.join(this.memoryDir, 'SOUL.md');
    try {
      return await fs.readFile(soulPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Fallback: try project memory/ directory (SOUL.md lives in repo, not instance dir)
        const fallback = path.join(process.cwd(), 'memory', 'SOUL.md');
        if (fallback !== soulPath) {
          try { return await fs.readFile(fallback, 'utf-8'); } catch { /* ignore */ }
        }
      } else {
        diagLog('memory.readSoul', error, { path: soulPath });
      }
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagLog('memory.readHeartbeat', error, { path: heartbeatPath });
      }
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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          diagLog('memory.addTask.read', error, { path: heartbeatPath });
        }
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        diagLog('memory.readDailyNotes', error, { path: dailyPath });
      }
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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          diagLog('memory.appendDailyNote.read', error, { path: dailyPath });
        }
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
    const prefix = role === 'user' ? '(alex)' : '(kuro)';
    await this.appendDailyNote(`${prefix} ${content}`);
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
      const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \((alex|kuro)\) (.+)$/);
      if (match) {
        const [, time, who, content] = match;
        const today = new Date().toISOString().split('T')[0];
        conversations.push({
          role: (who === 'alex' ? 'user' : 'assistant') as 'user' | 'assistant',
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
    } catch (error) {
      // grep exit code 1 = no matches (normal), only log real errors
      const exitCode = (error as { status?: number })?.status;
      if (exitCode !== 1) {
        diagLog('memory.searchMemory', error, { query: sanitized, dir: this.memoryDir });
      }
      return [];
    }
  }

  /**
   * 建構 LLM 上下文
   *
   * @param options.relevanceHint - 關鍵字提示，用於篩選相關感知（可選）
   * @param options.mode - 'full' | 'focused' | 'minimal'
   *   - full: 載入所有感知（用於 processMessage）
   *   - focused: 只載入核心感知（用於 AgentLoop）
   *   - minimal: 最小 context — 身份 + 任務 + 最近對話（用於超時重試）
   */
  async buildContext(options?: {
    relevanceHint?: string;
    mode?: 'full' | 'focused' | 'minimal';
  }): Promise<string> {
    const mode = options?.mode ?? 'full';
    const hint = options?.relevanceHint?.toLowerCase() ?? '';

    // ── Minimal mode: 最小 context，用於超時重試 ──
    if (mode === 'minimal') {
      return this.buildMinimalContext();
    }

    const [memory, heartbeat, soul] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
      this.readSoul(),
    ]);

    // 使用 Hot buffer 中的對話（截斷長回覆節省 token）
    const MAX_CONVERSATION_ENTRY_CHARS = 1000;
    const MAX_CONVERSATIONS = mode === 'focused' ? 10 : this.hotLimit;
    const conversations = this.conversationBuffer
      .slice(-MAX_CONVERSATIONS)
      .map(c => {
        const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
        const who = c.role === 'user' ? '(alex)' : '(kuro)';
        let text = c.content;
        if (text.length > MAX_CONVERSATION_ENTRY_CHARS) {
          text = text.slice(0, MAX_CONVERSATION_ENTRY_CHARS) + '...';
        }
        return `[${time}] ${who} ${text}`;
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

    // ── Telegram 健康度（核心感知，總是載入）──
    const tgPoller = getTelegramPoller();
    const tgStats = getNotificationStats();
    const queueStatus = getQueueStatus();
    const tgSection = [
      `Connected: ${tgPoller ? 'yes' : 'no'}`,
      `Notifications: ${tgStats.sent} sent, ${tgStats.failed} failed`,
      `Queue: ${queueStatus.size}/${queueStatus.max}`,
    ].join('\n');
    sections.push(`<telegram>\n${tgSection}\n</telegram>`);

    const selfStatus = selfStatusProvider?.();
    if (selfStatus) {
      const selfCtx = formatSelfStatus(selfStatus);
      if (selfCtx) sections.push(`<self>\n${selfCtx}\n</self>`);
    }

    const capabilities = await getCapabilitiesSnapshot(this.instanceId);
    const capabilitiesCtx = formatCapabilitiesContext(capabilities);
    if (capabilitiesCtx) sections.push(`<capabilities>\n${capabilitiesCtx}\n</capabilities>`);

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

    // Activity — 行為 + 診斷感知（always load — Kuro needs self-awareness）
    if (activitySummaryProvider) {
      const activityCtx = formatActivitySummary(activitySummaryProvider());
      if (activityCtx) sections.push(`<activity>\n${activityCtx}\n</activity>`);
    }

    // Workspace — 幾乎總是有用
    const workspace = getWorkspaceSnapshot();
    const workspaceCtx = formatWorkspaceContext(workspace);
    sections.push(`<workspace>\n${workspaceCtx}\n</workspace>`);

    // ── Custom perceptions（Stream cache 優先 → fallback 直接執行）──
    if (customPerceptions.length > 0) {
      const pluginRelevance: Record<string, string[]> = {
        docker: ['docker', 'container', 'image', 'deploy'],
        chrome: ['chrome', 'cdp', 'browser', 'web', 'fetch', 'url', 'page'],
        web: ['web', 'url', 'fetch', 'http', 'page'],
        ports: ['port', 'service', 'listen', 'connect'],
        tasks: [],
        'state-changes': [],
        disk: ['disk', 'space', 'storage'],
        brew: ['brew', 'homebrew', 'package', 'update'],
        'git-detail': ['git', 'commit', 'branch', 'merge'],
      };

      if (perceptionStreams.isActive()) {
        // Phase 4: 從 stream cache 讀取（不執行 shell scripts）
        const cachedReport = perceptionStreams.getCachedReport();
        if (cachedReport) {
          sections.push(`<situation-report>\n${cachedReport}\n</situation-report>`);
        } else {
          const cachedResults = perceptionStreams.getCachedResults();
          if (cachedResults.length > 0) {
            const customCtx = formatPerceptionResults(cachedResults);
            if (customCtx) sections.push(customCtx);
          }
        }
      } else {
        // Fallback: 直接執行（streams 未啟動，例如 CLI 模式）
        const relevantPlugins = customPerceptions.filter(p => {
          if (p.enabled === false) return false;
          const keywords = pluginRelevance[p.name] ?? [];
          if (keywords.length === 0) return true;
          if (mode === 'full') return true;
          return keywords.some(k => contextHint.includes(k));
        });

        if (relevantPlugins.length > 0) {
          const results = await executeAllPerceptions(relevantPlugins);
          if (isAnalysisAvailable()) {
            const { report } = await analyzePerceptions(results);
            if (report) sections.push(`<situation-report>\n${report}\n</situation-report>`);
          } else {
            const customCtx = formatPerceptionResults(results);
            if (customCtx) sections.push(customCtx);
          }
        }
      }
    }

    // ── Soul（身分認同，總是完整載入）──
    if (soul) {
      sections.push(`<soul>\n${soul}\n</soul>`);
    }

    // ── Topic 記憶（Smart Loading）──
    const topics = await this.listTopics();
    if (topics.length > 0) {
      // Topic keyword mapping — 檔名本身就是 key，加上額外關鍵字
      const topicKeywords: Record<string, string[]> = {
        'gen-art': ['generative', 'noise', 'shader', 'p5', 'canvas', 'domain', 'warp', 'perlin', 'fbm', 'art', 'visual', 'creative coding'],
        'mini-agent': ['dispatcher', 'haiku', 'lane', 'context', 'loop', 'triage', 'perception', 'plugin', 'agent'],
        'agent-architecture': ['autogpt', 'babyagi', 'langchain', 'crewai', 'anthropic', 'context engineering', 'framework'],
        'web-learning': ['cdp', 'chrome', 'fetch', 'hacker news', 'dev.to', 'reddit', 'learning'],
        'design-philosophy': ['alexander', 'pattern language', 'wabi-sabi', 'enactivism', 'umwelt', 'philosophy'],
        'creative-arts': ['oulipo', 'marker', 'eno', 'stockhausen', 'fischinger', 'visual music', 'music'],
        'social-culture': ['mockus', 'huizinga', 'garden', 'stream', 'homo ludens', 'culture'],
        'cognitive-science': ['borges', 'embodied cognition', 'consciousness', 'enactive', 'cognitive'],
      };

      const loadedTopics: string[] = [];
      for (const topic of topics) {
        const keywords = topicKeywords[topic] ?? [topic];
        const isDirectMatch = keywords.some(k => contextHint.includes(k));
        const shouldLoad = mode === 'full' || isDirectMatch;
        if (shouldLoad) {
          const content = await this.readTopicMemory(topic);
          if (content) {
            // In full mode with hint: non-matching topics get truncated
            const shouldTruncate = mode === 'full' && hint && !isDirectMatch;
            const topicContent = shouldTruncate ? truncateTopicMemory(content) : content;
            sections.push(`<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`);
            loadedTopics.push(topic);
            // Track utility
            this.topicLoadCounts.set(topic, (this.topicLoadCounts.get(topic) ?? 0) + 1);
          }
        }
      }
    }

    // ── NEXT.md（執行層待辦 + 完成驗證）──
    const nextRaw = await this.readNext();
    if (nextRaw) {
      const activeNext = this.extractActiveNext(nextRaw);
      const verified = await this.verifyNextTasks(activeNext);
      sections.push(`<next>\n${verified}\n</next>`);
    }

    // ── 記憶和對話（總是載入）──
    sections.push(`<memory>\n${memory}\n</memory>`);
    sections.push(`<recent_conversations>\n${conversations || '(No recent conversations)'}\n</recent_conversations>`);
    sections.push(`<heartbeat>\n${heartbeat}\n</heartbeat>`);

    const assembled = sections.join('\n\n');

    // ── Context Checkpoint：存 snapshot 供 debug/audit ──
    this.saveContextCheckpoint(assembled, mode, hint).catch(() => {});

    return assembled;
  }

  /**
   * Context Checkpoint — 存 context snapshot 供 debug/audit
   * Fire-and-forget，不影響主流程
   */
  private async saveContextCheckpoint(context: string, mode: string, hint: string): Promise<void> {
    try {
      const dir = path.join(this.memoryDir, 'context-checkpoints');
      await ensureDir(dir);
      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-');
      // Per-section char count: match <tag>...</tag> and measure content size
      const sectionSizes: Array<{ name: string; chars: number }> = [];
      for (const m of context.matchAll(/<(\S+?)[\s>][\s\S]*?<\/\1>/g)) {
        sectionSizes.push({ name: m[1], chars: m[0].length });
      }
      // Topic utility counts snapshot
      const topicUtility = Object.fromEntries(this.topicLoadCounts);
      const entry = JSON.stringify({
        timestamp: now.toISOString(),
        mode,
        hint: hint.slice(0, 200),
        contextLength: context.length,
        sections: sectionSizes,
        topicUtility,
      }) + '\n';
      await fs.appendFile(path.join(dir, `${ts.slice(0, 10)}.jsonl`), entry);
    } catch {
      // Checkpoint 失敗不影響主流程
    }
  }

  /**
   * Minimal context — 超時重試用
   * 只載入：環境、TG 狀態、核心身份、heartbeat、最近 5 則對話
   * 跳過：所有 perception、完整 memory、完整 soul
   */
  private async buildMinimalContext(): Promise<string> {
    const [heartbeat, soul] = await Promise.all([
      this.readHeartbeat(),
      this.readSoul(),
    ]);

    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const sections: string[] = [];

    // 環境
    sections.push(`<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${this.instanceId}\n[MINIMAL MODE: context reduced for retry]\n</environment>`);

    // TG 狀態（極小）
    const tgPoller = getTelegramPoller();
    const tgStats = getNotificationStats();
    const queueStatus = getQueueStatus();
    sections.push(`<telegram>\nConnected: ${tgPoller ? 'yes' : 'no'}\nNotifications: ${tgStats.sent} sent, ${tgStats.failed} failed\nQueue: ${queueStatus.size}/${queueStatus.max}\n</telegram>`);

    // Soul — 只取核心身份（到 Learning Interests 之前）
    if (soul) {
      const truncated = this.truncateSoulToIdentity(soul);
      sections.push(`<soul>\n${truncated}\n</soul>`);
    }

    // Heartbeat — 完整保留（有 active tasks）
    if (heartbeat) {
      sections.push(`<heartbeat>\n${heartbeat}\n</heartbeat>`);
    }

    // NEXT.md — 只載入 Now section（minimal mode 不跑驗證）
    const nextRaw = await this.readNext();
    if (nextRaw) {
      const nowMatch = nextRaw.match(/## Now[^]*?(?=\n---|\n## )/);
      if (nowMatch) sections.push(`<next>\n${nowMatch[0].trim()}\n</next>`);
    }

    // 最近 5 則對話
    const recentConvos = this.conversationBuffer
      .slice(-5)
      .map(c => {
        const time = c.timestamp.split('T')[1]?.split('.')[0] ?? '';
        const who = c.role === 'user' ? '(alex)' : '(kuro)';
        return `[${time}] ${who} ${c.content}`;
      })
      .join('\n');
    sections.push(`<recent_conversations>\n${recentConvos || '(No recent conversations)'}\n</recent_conversations>`);

    return sections.join('\n\n');
  }

  /**
   * 截取 SOUL.md 到核心身份部分（Who I Am, My Traits, When I'm Idle）
   * 跳過 Learning Interests, My Thoughts, Project Evolution 等大區塊
   */
  private truncateSoulToIdentity(soul: string): string {
    // 找到第一個非核心 section 的位置
    const cutoffSections = ['## Learning Interests', '## My Thoughts', '## Project Evolution', '## What I\'m Tracking'];
    let cutoffIndex = soul.length;
    for (const section of cutoffSections) {
      const idx = soul.indexOf(section);
      if (idx >= 0 && idx < cutoffIndex) {
        cutoffIndex = idx;
      }
    }
    const truncated = soul.slice(0, cutoffIndex).trimEnd();
    if (cutoffIndex < soul.length) {
      return truncated + '\n\n[... truncated for minimal context mode ...]';
    }
    return truncated;
  }
}

// =============================================================================
// Slug Utility
// =============================================================================

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// =============================================================================
// Topic Truncation
// =============================================================================

/**
 * Truncate topic memory for non-directly-matched topics.
 * Keeps: title (first line) + last 3 entries + entry count.
 */
function truncateTopicMemory(content: string): string {
  const lines = content.split('\n');
  const title = lines[0] || '';

  // Extract entries (lines starting with "- [")
  const entries = lines.filter(l => l.startsWith('- ['));
  const total = entries.length;

  if (total <= 3) return content; // Already small enough

  const recent = entries.slice(-3);
  return `${title}\n(${total} entries, showing recent 3)\n${recent.join('\n')}`;
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
 * Append to topic memory
 */
export async function appendTopicMemory(topic: string, content: string): Promise<void> {
  return defaultMemory().appendTopicMemory(topic, content);
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

/**
 * Archive a source to Library
 */
export async function archiveSource(
  url: string, title: string, content: string,
  options?: Parameters<InstanceMemory['archiveSource']>[3],
): Promise<{ id: string; contentFile: string }> {
  return defaultMemory().archiveSource(url, title, content, options);
}

/**
 * Read Library catalog
 */
export async function readCatalog(): Promise<CatalogEntry[]> {
  return defaultMemory().readCatalog();
}

/**
 * Read Library content by ID
 */
export async function readLibraryContent(id: string): ReturnType<InstanceMemory['readLibraryContent']> {
  return defaultMemory().readLibraryContent(id);
}

/**
 * Find all memory files that cite a Library source
 */
export async function findCitedBy(id: string): ReturnType<InstanceMemory['findCitedBy']> {
  return defaultMemory().findCitedBy(id);
}
