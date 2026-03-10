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
import { existsSync, readFileSync, readdirSync, unlinkSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { cachedReadFile } from './memory-cache.js';
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
import { getProvider, getFallback } from './agent.js';
import type { MemoryEntry, ConversationEntry, ComposePerception, CatalogEntry, ConversationThread } from './types.js';
import {
  executeAllPerceptions, formatPerceptionResults,
  loadAllSkills, formatSkillsPrompt,
} from './perception.js';
import { analyzePerceptions, isAnalysisAvailable } from './perception-analyzer.js';
import { perceptionStreams } from './perception-stream.js';
import {
  initSearchIndex, indexMemoryFiles, searchMemoryFTS, searchMemoryEntries,
  searchConversations, isIndexReady, indexConversationsIncremental,
} from './search.js';
import { runVerify } from './verify.js';
import { buildTemporalSection, buildThreadsContextSection, addTemporalMarkers } from './temporal.js';
import { readPendingInbox, formatInboxSection } from './inbox.js';
import { buildTaskProgressSection, readStaleTaskWarnings } from './housekeeping.js';
import { isIndexBuilt, buildMemoryIndex, getManifestContext, getRelevantTopics } from './memory-index.js';

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

interface ChatRoomMessage {
  id: string;
  from: string;
  text: string;
  ts?: string;
  timestamp?: string;
  replyTo?: string;
}

// =============================================================================
// Skills JIT Loading — 按需載入，節省 50-70% token
// =============================================================================

/** Skill keyword mapping — 根據 prompt/message 內容匹配相關 skills */
const SKILL_KEYWORDS: Record<string, string[]> = {
  'autonomous-behavior': ['autonomous', 'soul', 'ooda', 'cycle', 'idle', 'agent loop', 'self-check'],
  'web-learning': ['learn', 'study', 'article', 'knowledge', 'web learning', 'cdp', 'chrome://', 'cdp-fetch'],
  'web-research': ['research', 'search', 'url', 'fetch', 'curl', 'cdp', 'cdp-fetch', 'browse', 'hacker', 'web research'],
  'web-ai-sessions': ['ai session', 'claude', 'gpt', 'gemini', 'chatbot', 'ai conversation'],
  'action-from-learning': ['propose', 'proposal', 'feature', 'improve', 'skill', 'plugin', 'action-from-learning', 'self-improve'],
  'self-deploy': ['deploy', 'push', 'commit', 'release', 'git', 'ci/cd', 'self-deploy'],
  'delegation': ['delegate', 'subprocess', 'cli', 'handoff', 'claude code'],
  'docker-ops': ['docker', 'container', 'image', 'compose', 'volume'],
  'code-review': ['review', 'code review', 'pr', 'pull request', 'diff'],
  'debug-helper': ['debug', 'error', 'bug', 'crash', 'fix', 'fail', 'broken'],
  'github-ops': ['github', 'issue', 'pr', 'pull request', 'merge', 'ci'],
  'kuro-github': ['kuro-agent', 'my repo', 'my project', 'own repo', 'own project', 'create repo', 'new repo', 'kuro github', 'agent framework'],
  'project-manager': ['project', 'task', 'plan', 'priority', 'heartbeat', 'p0', 'p1'],
  'server-admin': ['server', 'port', 'service', 'restart', 'process', 'kill', 'admin'],
  'verified-development': ['verify', 'test', 'tdd', 'development', 'quality'],
  'discussion-facilitation': ['discussion', 'discuss', 'facilitate', 'meeting', 'agenda', 'diverge', 'converge', 'decision'],
  'discussion-participation': ['discussion', 'discuss', 'participate', 'round', 'opinion', 'viewpoint'],
  'friction-reducer': ['skip', 'avoid', 'procrastinate', 'friction', 'stuck', 'output gate', 'can\'t start'],
  'publish-content': ['publish', 'post', 'article', 'tsubuyaki', 'dev.to', 'tweet', 'write'],
  'social-presence': ['social', 'community', 'follower', 'engage', 'interact'],
  'social-monitor': ['notification', 'reply', 'mention', 'comment', 'response', 'feedback'],
  'grow-audience': ['audience', 'growth', 'marketing', 'seo', 'discover', 'promote', 'visibility'],
};

/**
 * Cycle mode → skills mapping — 按 OODA cycle 模式精準載入 skills
 * 比 keyword matching 更高效（autonomous prompt 包含太多關鍵字導致幾乎所有 skill 都被匹配）
 */
export type CycleMode = 'learn' | 'act' | 'task' | 'respond' | 'reflect';

const CYCLE_MODE_SKILLS: Record<CycleMode, string[]> = {
  learn: ['autonomous-behavior', 'web-learning', 'web-research', 'web-ai-sessions'],
  act: ['autonomous-behavior', 'action-from-learning', 'self-deploy', 'delegation', 'github-ops', 'kuro-github', 'verified-development', 'code-review', 'friction-reducer', 'publish-content', 'social-presence', 'social-monitor', 'grow-audience'],
  task: ['autonomous-behavior', 'project-manager', 'debug-helper', 'docker-ops', 'server-admin', 'github-ops', 'kuro-github', 'verified-development', 'code-review'],
  respond: [], // empty = fall through to keyword matching
  reflect: ['autonomous-behavior'],
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
 * @param cycleMode - OODA cycle 模式，優先於 keyword matching
 *   - 有 cycleMode → 用 mode→skills 映射表精準載入
 *   - 無 cycleMode → 退回 keyword matching（向後相容）
 */
export function getSkillsPrompt(hint?: string, cycleMode?: CycleMode): string {
  if (skillsCache.length === 0) return '';

  // 無 hint 且無 cycleMode → 全部載入（向後相容）
  if (!hint && !cycleMode) return formatSkillsPrompt(skillsCache);

  // cycleMode 優先：用映射表精準篩選
  if (cycleMode) {
    const allowedSkills = CYCLE_MODE_SKILLS[cycleMode];

    // respond mode: 空陣列 → fall through to keyword matching（而非載入全部 43K）
    if (allowedSkills.length > 0) {
      const selected = skillsCache.filter(skill =>
        allowedSkills.includes(skill.name)
      );
      return formatSkillsPrompt(selected);
    }
    // Fall through to keyword matching for respond mode
  }

  // Fallback: keyword matching（respond mode 或無 cycleMode 時）
  const lowerHint = (hint ?? '').toLowerCase();
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
 * 取得記憶目錄 — 統一指向專案的 memory/ 資料夾
 * Runtime state（cycle-state, features, mode 等）留在 instanceDir
 */
function getMemoryDir(_instanceId?: string): string {
  return path.join(process.cwd(), 'memory');
}

/**
 * 取得持久狀態目錄 — memory/state/
 * 存放 achievements、feedback loops、journals 等有長期價值的狀態檔案
 * 與 instanceDir（ephemeral runtime）分離
 */
export function getMemoryStateDir(): string {
  const dir = path.join(process.cwd(), 'memory', 'state');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// =============================================================================
// Flag file cache — small flag files read by buildContext with 60s TTL
// =============================================================================

const flagCache = new Map<string, { content: string | null; mtime: number }>();
const FLAG_CACHE_TTL = 60_000; // 60s

/** Read a small flag file with 60s TTL cache. Returns trimmed content or null. */
function readFlagCached(flagPath: string): string | null {
  const cached = flagCache.get(flagPath);
  if (cached && Date.now() - cached.mtime < FLAG_CACHE_TTL) return cached.content;
  try {
    if (!existsSync(flagPath)) {
      flagCache.set(flagPath, { content: null, mtime: Date.now() });
      return null;
    }
    const content = readFileSync(flagPath, 'utf-8').trim();
    const result = content || null;
    flagCache.set(flagPath, { content: result, mtime: Date.now() });
    return result;
  } catch {
    flagCache.set(flagPath, { content: null, mtime: Date.now() });
    return null;
  }
}

/** Invalidate a specific flag cache entry (call after writing flag file). */
export function invalidateFlagCache(flagPath: string): void {
  flagCache.delete(flagPath);
}

/**
 * 一次性遷移：從 instanceDir 搬持久狀態檔案到 memory/state/
 * 只搬尚未存在於目標的檔案（不覆蓋）
 */
export function migrateStateFiles(instanceId: string): void {
  const stateDir = getMemoryStateDir();
  const instanceDir = path.join(
    process.env.HOME ?? '/tmp', '.mini-agent', 'instances', instanceId
  );
  if (!existsSync(instanceDir)) return;

  const filesToMigrate = [
    'achievements.json', 'activity-journal.jsonl', 'coach-state.json',
    'commitments.json', 'crs-baseline.jsonl', 'decision-quality.json',
    'error-patterns.json', 'hesitation-log.jsonl', 'hesitation-state.json',
    'metabolism-log.jsonl', 'metsuke-stats.json', 'pending-improvements.jsonl',
    'perception-citations.json', 'priority-focus.txt', 'structural-health.json',
    'system-health.json', 'work-journal.jsonl',
  ];

  let migrated = 0;
  for (const file of filesToMigrate) {
    const src = path.join(instanceDir, file);
    const dst = path.join(stateDir, file);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        copyFileSync(src, dst);
        migrated++;
      } catch { /* ignore individual failures */ }
    }
  }
  if (migrated > 0) {
    try { diagLog('memory.migrateState', null, { migrated: String(migrated), from: instanceDir, to: stateDir }); } catch { /* ok */ }
  }
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

// =============================================================================
// SubSoul — SOUL.md Keyword-Matched Section Loading
// =============================================================================

interface SoulFacet {
  sections: string[];
  keywords: string[];
  summary: string;
}

/**
 * Parse YAML frontmatter from a topic file's content.
 * Uses regex — no yaml parser dependency needed.
 * Returns { keywords, negativeKeywords } or null if no frontmatter.
 */
function parseTopicFrontmatter(content: string): { keywords: string[]; negativeKeywords: string[] } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = match[1];

  const parseList = (key: string): string[] => {
    const lineMatch = fm.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'));
    if (!lineMatch) return [];
    return lineMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  };

  const keywords = parseList('keywords');
  if (keywords.length === 0) return null;
  return { keywords, negativeKeywords: parseList('negative_keywords') };
}

/** Cached topic keyword map — invalidated by directory mtime change or appendTopicMemory */
let _topicKeywordCache: Record<string, { keywords: string[]; negativeKeywords: string[] }> | null = null;
let _topicKeywordDirMtime = 0;

/**
 * Load topic keywords from frontmatter dynamically.
 * Uses directory mtime for invalidation — avoids re-reading files unless topics/ changed.
 */
async function loadTopicKeywordMap(memoryDir: string): Promise<Record<string, { keywords: string[]; negativeKeywords: string[] }>> {
  const topicsDir = path.join(memoryDir, 'topics');

  // Check directory mtime for invalidation (single stat vs N file reads)
  try {
    const dirStat = await fs.stat(topicsDir);
    const currentMtime = dirStat.mtimeMs;
    if (_topicKeywordCache && currentMtime === _topicKeywordDirMtime) {
      return _topicKeywordCache;
    }
    _topicKeywordDirMtime = currentMtime;
  } catch {
    // topics dir doesn't exist — return empty
    return _topicKeywordCache ?? {};
  }

  const map: Record<string, { keywords: string[]; negativeKeywords: string[] }> = {};
  try {
    const files = await fs.readdir(topicsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const topic = file.replace(/\.md$/, '');
      try {
        const content = await fs.readFile(path.join(topicsDir, file), 'utf-8');
        const parsed = parseTopicFrontmatter(content);
        if (parsed) {
          map[topic] = parsed;
        } else {
          // Fallback: topic name itself as keyword
          map[topic] = { keywords: [topic], negativeKeywords: [] };
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* topics dir read failed */ }

  _topicKeywordCache = map;
  return map;
}

/** Invalidate topic keyword cache (called after appendTopicMemory) */
function invalidateTopicKeywordCache(): void {
  _topicKeywordCache = null;
  _topicKeywordDirMtime = 0;
}

/** Identity sections always loaded in focused/minimal mode */
const SOUL_IDENTITY_SECTIONS = [
  '## Who I Am', '## My Traits', '## When I\'m Idle',
  '## My Hard Limits', '## Collaborators',
];

/** Facets loaded by keyword match in focused mode */
const SOUL_FACETS: Record<string, SoulFacet> = {
  interests: {
    sections: ['## Learning Interests'],
    keywords: ['learn', 'study', 'interest', 'research', 'curious',
      'calm technology', 'generative art', 'sdf', 'oulipo', 'music',
      'cognitive', 'philosophy', 'narrative', 'constraint', 'emergence'],
    summary: '學習興趣：認知科學、設計哲學、音樂、約束理論等深度研究',
  },
  worldview: {
    sections: ['## My Thoughts'],
    keywords: ['thought', 'opinion', 'believe', 'worldview', 'insight',
      'identity', 'trust', 'interface', 'perception', 'calibration',
      'mmacevedo', 'pattern language', 'environment'],
    summary: '世界觀：身份、信任、約束框架、感知等 10 個核心觀點',
  },
  evolution: {
    sections: ['## Project Evolution', '## What I\'m Tracking'],
    keywords: ['architecture', 'competitive', 'roadmap', 'project',
      'autogpt', 'openclaw', 'aider', 'framework', 'differentiation',
      'website', 'kuro.page', 'community', 'tracking'],
    summary: '專案進化：競品分析、六大差異化、架構路線圖',
  },
  preferences: {
    sections: ['## Learned Preferences'],
    keywords: ['alex', 'preference', 'reporting', 'telegram',
      'deploy', 'twitter', 'autonomy', '授權'],
    summary: 'Alex 偏好：溝通方式、授權範圍、回報規則',
  },
};

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

  // SubSoul: last facet load record (for checkpoint data collection)
  private lastSoulFacetRecord: {
    loaded: string[];
    skipped: string[];
    reason: 'keyword' | 'refresh' | 'full' | 'minimal' | 'fallback';
    identityChars: number;
    totalChars: number;
  } | null = null;

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
      return cachedReadFile(memoryPath);
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

    invalidateTopicKeywordCache();
  }

  // =========================================================================
  // Conversation Threads — 對話脈絡追蹤
  // =========================================================================

  /**
   * 讀取對話脈絡追蹤
   */
  async getConversationThreads(): Promise<ConversationThread[]> {
    const filePath = path.join(this.memoryDir, '.conversation-threads.json');
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as ConversationThread[];
    } catch {
      return [];
    }
  }

  /**
   * 新增對話脈絡追蹤項目
   */
  async addConversationThread(thread: Omit<ConversationThread, 'id' | 'createdAt'>): Promise<void> {
    const filePath = path.join(this.memoryDir, '.conversation-threads.json');
    const threads = await this.getConversationThreads();
    threads.push({
      ...thread,
      id: crypto.randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
    });
    // 只保留最近 40 條未完成 + 最近 20 條已完成
    const active = threads.filter(t => !t.resolvedAt).slice(-40);
    const resolved = threads.filter(t => t.resolvedAt).slice(-20);
    await fs.writeFile(filePath, JSON.stringify([...active, ...resolved], null, 2), 'utf-8');
  }

  /**
   * 完成對話脈絡追蹤項目
   */
  async resolveConversationThread(id: string): Promise<void> {
    const filePath = path.join(this.memoryDir, '.conversation-threads.json');
    const threads = await this.getConversationThreads();
    const thread = threads.find(t => t.id === id);
    if (thread) {
      thread.resolvedAt = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(threads, null, 2), 'utf-8');
    }
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

  // =========================================================================
  // Rumination — 反芻能力（Cross-Pollination + Decay Review）
  // =========================================================================

  /**
   * Cross-Pollination Digest: 從每個 topic 隨機抽 n 條 entry，放在一起找跨域連結
   * 注入 reflect mode prompt，幫助發現隱藏的知識連結
   */
  async getCrossPollinationDigest(n = 2): Promise<string> {
    const topics = await this.listTopics();
    if (topics.length === 0) return '';

    const samples: string[] = [];
    for (const topic of topics) {
      const content = await this.readTopicMemory(topic);
      if (!content) continue;
      const entries = content.split('\n').filter(l => l.startsWith('- ['));
      if (entries.length === 0) continue;
      // Fisher-Yates shuffle, take n
      const shuffled = [...entries];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const picked = shuffled.slice(0, n);
      samples.push(`### ${topic}\n${picked.join('\n')}`);
    }

    if (samples.length === 0) return '';
    return `<rumination-digest>\n${samples.join('\n\n')}\n</rumination-digest>`;
  }

  /**
   * Forgotten Entries: 找出 hit count = 0 且 age > maxAge 天的 topic entries
   * 利用 .topic-hits.json 判斷「被遺忘的知識」
   */
  async getForgottenEntries(maxAgeDays = 7, limit = 5): Promise<string> {
    const hitsPath = path.join(this.memoryDir, '.topic-hits.json');
    let hits: Record<string, number> = {};
    try {
      const raw = await fs.readFile(hitsPath, 'utf-8');
      hits = JSON.parse(raw) as Record<string, number>;
    } catch {
      // No hits file — treat all as unhit
    }

    const now = Date.now();
    const forgotten: Array<{ topic: string; entry: string; ageDays: number }> = [];

    const topics = await this.listTopics();
    for (const topic of topics) {
      const content = await this.readTopicMemory(topic);
      if (!content) continue;
      for (const line of content.split('\n').filter(l => l.startsWith('- ['))) {
        const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) continue;
        const ageDays = Math.floor((now - new Date(dateMatch[1]).getTime()) / 86_400_000);
        const key = `${topic}:${line.slice(2, 62)}`;
        if (ageDays >= maxAgeDays && (hits[key] ?? 0) === 0) {
          forgotten.push({ topic, entry: line, ageDays });
        }
      }
    }

    if (forgotten.length === 0) return '';
    const selected = forgotten.sort((a, b) => b.ageDays - a.ageDays).slice(0, limit);
    return `<forgotten-knowledge>\n${selected.map(f =>
      `- [${f.topic}, ${f.ageDays}d ago] ${f.entry.slice(2)}`
    ).join('\n')}\n</forgotten-knowledge>`;
  }

  // =========================================================================
  // Inner Voice Buffer — 創作衝動的捕捉與持久化
  // =========================================================================

  private getImpulseBufferPath(): string {
    return path.join(this.memoryDir, '.inner-voice-buffer.json');
  }

  async getImpulses(): Promise<import('./types.js').CreativeImpulse[]> {
    try {
      const raw = await fs.readFile(this.getImpulseBufferPath(), 'utf-8');
      return JSON.parse(raw) as import('./types.js').CreativeImpulse[];
    } catch {
      return [];
    }
  }

  async addImpulse(impulse: Omit<import('./types.js').CreativeImpulse, 'id' | 'createdAt'>): Promise<void> {
    const impulses = await this.getImpulses();
    const entry: import('./types.js').CreativeImpulse = {
      id: crypto.randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      ...impulse,
    };
    impulses.push(entry);
    await fs.writeFile(this.getImpulseBufferPath(), JSON.stringify(impulses, null, 2), 'utf-8');
  }

  async getUnexpressedImpulses(): Promise<import('./types.js').CreativeImpulse[]> {
    const impulses = await this.getImpulses();
    const now = Date.now();
    const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const active = impulses.filter(i => !i.expressedAt && (now - new Date(i.createdAt).getTime()) < EXPIRE_MS);
    // Cleanup: remove expired/expressed entries from disk (fire-and-forget)
    if (active.length < impulses.length) {
      const toKeep = impulses.filter(i => i.expressedAt || (now - new Date(i.createdAt).getTime()) < EXPIRE_MS);
      fs.writeFile(this.getImpulseBufferPath(), JSON.stringify(toKeep, null, 2), 'utf-8').catch(() => {});
    }
    return active;
  }

  buildInnerVoiceSection(impulses: import('./types.js').CreativeImpulse[]): string {
    if (impulses.length === 0) return '';
    const now = Date.now();
    const lines = impulses.map(i => {
      const ageMs = now - new Date(i.createdAt).getTime();
      const ageStr = ageMs < 3600000 ? `${Math.floor(ageMs / 60000)}m ago`
        : ageMs < 86400000 ? `${Math.floor(ageMs / 3600000)}h ago`
        : `${Math.floor(ageMs / 86400000)}d ago`;
      const mats = i.materials.length > 0 ? ` (素材: ${i.materials.join(', ')})` : '';
      return `- [${ageStr}] 「${i.what}」→ ${i.channel}${mats}`;
    });
    const oldest = impulses.reduce((a, b) =>
      new Date(a.createdAt) < new Date(b.createdAt) ? a : b);
    const oldestAge = now - new Date(oldest.createdAt).getTime();
    const oldestStr = oldestAge < 3600000 ? `${Math.floor(oldestAge / 60000)} minutes`
      : oldestAge < 86400000 ? `${Math.floor(oldestAge / 3600000)} hours`
      : `${Math.floor(oldestAge / 86400000)} days`;
    return `You have ${impulses.length} unexpressed thought${impulses.length > 1 ? 's' : ''}:\n${lines.join('\n')}\n\nThe oldest thought has been waiting ${oldestStr}. Trust your impulse.`;
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

  /** Extract recent bullet entries from MEMORY.md (for dedup comparison) */
  async getRecentMemoryBullets(limit = 20): Promise<string[]> {
    const content = await this.readMemory();
    return content.split('\n').filter(l => l.startsWith('- ')).slice(-limit);
  }

  /** Extract recent bullet entries from topics/{topic}.md (for dedup comparison) */
  async getRecentTopicBullets(topic: string, limit = 20): Promise<string[]> {
    const content = await this.readTopicMemory(topic);
    return content.split('\n').filter(l => l.startsWith('- ')).slice(-limit);
  }

  /**
   * Load topic memories matching a query string (keyword matching).
   * Reusable for quickReply, /api/ask, or any context that needs topic enrichment.
   * Returns formatted topic-memory XML sections, budget-capped.
   */
  async loadTopicsForQuery(query: string, budget = 4000): Promise<string> {
    const topics = await this.listTopics();
    if (topics.length === 0) return '';

    const keywordMap = await loadTopicKeywordMap(this.memoryDir);
    const hint = query.toLowerCase();
    const sections: string[] = [];
    let charsUsed = 0;

    for (const topic of topics) {
      const { keywords, negativeKeywords: negatives } = keywordMap[topic] ?? { keywords: [topic], negativeKeywords: [] };

      const isMatch = keywords.some(k => {
        if (!hint.includes(k)) return false;
        if (negatives.includes(k)) return keywords.some(k2 => k2 !== k && hint.includes(k2));
        return true;
      });
      if (!isMatch) continue;

      const content = await this.readTopicMemory(topic);
      if (!content) continue;

      // Brief truncation for quick context (keep it lightweight)
      let topicContent = truncateTopicMemory(content, 'brief');
      if (topicContent.length > 3000) topicContent = topicContent.slice(0, 3000) + '\n[... truncated]';

      const section = `<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`;
      if (charsUsed > 0 && charsUsed + section.length > budget) {
        const summary = truncateTopicMemory(content, 'summary');
        const summarySection = `<topic-memory name="${topic}">\n${summary}\n</topic-memory>`;
        sections.push(summarySection);
        charsUsed += summarySection.length;
      } else {
        sections.push(section);
        charsUsed += section.length;
      }
    }

    return sections.join('\n');
  }

  /**
   * 讀取 NEXT.md（執行層待辦清單）
   */
  async readNext(): Promise<string> {
    const nextPath = path.join(this.memoryDir, 'NEXT.md');
    try {
      return cachedReadFile(nextPath);
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
      return cachedReadFile(soulPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
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
      return cachedReadFile(heartbeatPath);
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
      // Group lines into entries: each entry starts with [timestamp] and includes all following lines
      const lines = newContent.split('\n');
      const header: string[] = [];
      const entries: string[][] = [];
      let currentEntry: string[] | null = null;

      for (const line of lines) {
        if (line.startsWith('#') && !currentEntry) {
          header.push(line);
        } else if (/^\[[\d:]+\]/.test(line)) {
          // New timestamp entry — save previous and start new
          if (currentEntry) entries.push(currentEntry);
          currentEntry = [line];
        } else if (currentEntry) {
          currentEntry.push(line);
        } else {
          header.push(line);
        }
      }
      if (currentEntry) entries.push(currentEntry);

      // 如果超過 warmLimit，移除最舊的（保留完整 entry）
      if (entries.length > this.warmLimit) {
        const trimmed = entries.slice(-this.warmLimit);
        const finalContent = [...header, ...trimmed.flat()].join('\n');
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

  private async readChatRoomMessages(date: string, limit?: number): Promise<ChatRoomMessage[]> {
    try {
      const convPath = path.join(this.memoryDir, 'conversations', `${date}.jsonl`);
      const raw = await fs.readFile(convPath, 'utf-8');
      const msgs = raw.split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line) as ChatRoomMessage;
          } catch {
            return null;
          }
        })
        .filter((m): m is ChatRoomMessage => !!m && !!m.id && !!m.from && typeof m.text === 'string');
      return limit ? msgs.slice(-limit) : msgs;
    } catch {
      return [];
    }
  }

  private formatChatRoomLine(msg: { id: string; from: string; text: string; replyTo?: string }): string {
    const reply = msg.replyTo ? ` ↩${msg.replyTo}` : '';
    const text = msg.text.length > 200 ? msg.text.slice(0, 200) + '...' : msg.text;
    return `[${msg.id}] ${msg.from}${reply}: ${text}`;
  }

  /**
   * 從 trigger + inbox 提取本 cycle 檢索關鍵字（給 chat room 相關歷史檢索）
   */
  private extractCycleKeywords(
    trigger: string | undefined,
    inboxItems: Array<{ from: string; content: string; source: string }>,
  ): string {
    const triggerText = (trigger ?? '').toLowerCase();
    const inboxText = inboxItems
      .map(item => `${item.from} ${item.source} ${item.content}`)
      .join(' ')
      .toLowerCase();
    const combined = `${triggerText} ${inboxText}`
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\u4e00-\u9fff\s_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!combined) return '';

    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was', 'one', 'our', 'out',
      'is', 'it', 'in', 'to', 'of', 'on', 'at', 'an', 'or', 'if', 'no', 'so', 'do', 'my', 'up', 'this',
      'that', 'with', 'from', 'have', 'been', 'will', 'into', 'more', 'when', 'some', 'them', 'than',
      'its', 'also', 'each', 'which', 'their', 'what', 'about', 'would', 'there', 'could', 'other',
      'just', 'then', 'kuro', 'alex',
    ]);

    const words = combined
      .split(' ')
      .filter(word => word.length >= 2 && !stopWords.has(word))
      .slice(0, 20);
    return words.join(' ');
  }

  /**
   * Thread-aware recent conversation loading:
   * 1. Load last 10 recent messages
   * 2. Follow replyTo chains backward to include full thread context
   * 3. Cross-day: load yesterday's reply targets when needed
   */
  private async buildChatRoomRecentSection(): Promise<string | null> {
    const today = new Date().toISOString().slice(0, 10);

    // Load all today's messages for thread chain resolution
    const allToday = await this.readChatRoomMessages(today);
    const recent = allToday.slice(-10);

    // Thread chain expansion: follow replyTo chains backward
    const msgIndex = new Map(allToday.map(m => [m.id, m]));
    const threadMsgs = new Map<string, ChatRoomMessage>();
    const collectThread = (msgId: string | undefined, depth: number) => {
      if (!msgId || depth > 20 || threadMsgs.has(msgId)) return;
      const msg = msgIndex.get(msgId);
      if (msg) {
        threadMsgs.set(msg.id, msg);
        collectThread(msg.replyTo, depth + 1);
      }
    };
    for (const msg of recent) {
      collectThread(msg.replyTo, 0);
    }

    // Cross-day: yesterday's replyTo targets may be in yesterday's file
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const missingReplyIds = [...threadMsgs.values()]
      .filter(m => m.replyTo && !msgIndex.has(m.replyTo) && m.replyTo.startsWith(yesterday))
      .map(m => m.replyTo!);
    if (missingReplyIds.length > 0) {
      const yesterdayMsgs = await this.readChatRoomMessages(yesterday);
      const yesterdayIndex = new Map(yesterdayMsgs.map(m => [m.id, m]));
      for (const id of missingReplyIds) {
        const msg = yesterdayIndex.get(id);
        if (msg) threadMsgs.set(msg.id, msg);
      }
    }

    // Remove thread messages that are already in recent
    const recentIds = new Set(recent.map(m => m.id));
    const threadOnly = [...threadMsgs.values()]
      .filter(m => !recentIds.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Assemble: thread context → recent
    const lines: string[] = [];
    if (threadOnly.length > 0) {
      lines.push(...threadOnly.map(m => this.formatChatRoomLine(m)));
      lines.push('--- recent ---');
    }
    lines.push(...recent.map(m => this.formatChatRoomLine(m)));

    if (lines.length === 0) return null;
    return `<chat-room-recent>\n${lines.join('\n')}\n</chat-room-recent>`;
  }

  private buildChatRoomRelevantSection(
    query: string,
    excludeIds: Set<string>,
  ): string | null {
    if (!query.trim()) return null;
    const related = searchConversations(this.memoryDir, query, 30)
      .filter(m => !excludeIds.has(m.id))
      .slice(0, 10);
    if (related.length === 0) return null;
    const lines = related.map(m => this.formatChatRoomLine({
      id: m.id,
      from: m.from,
      text: m.text,
      replyTo: m.replyTo,
    }));
    return `<chat-room-relevant>\n${lines.join('\n')}\n</chat-room-relevant>`;
  }

  /**
   * 初始化 FTS5 搜尋索引
   */
  initSearchIndex(): void {
    const dbPath = path.join(getInstanceDir(this.instanceId), 'memory-index.db');
    initSearchIndex(dbPath, this.memoryDir);
    if (!isIndexReady()) {
      indexMemoryFiles(this.memoryDir);
    }
  }

  updateConversationSearchIndex(): number {
    return indexConversationsIncremental(this.memoryDir);
  }

  /**
   * 搜尋記憶（FTS5 優先，grep fallback）
   */
  async searchMemory(query: string, maxResults = 5): Promise<MemoryEntry[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Try FTS5 first
    const ftsResults = searchMemoryFTS(trimmed, maxResults);
    if (ftsResults.length > 0) {
      return ftsResults;
    }

    // Fallback to grep
    return this.grepSearch(trimmed, maxResults);
  }

  /**
   * grep 搜尋（fallback）
   */
  private async grepSearch(query: string, maxResults: number): Promise<MemoryEntry[]> {
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
   *   - focused: 只載入核心感知 + perception streams（用於 AgentLoop 常規 cycle）
   *   - minimal: 輕量 context — 身份 + inbox + 對話脈絡（用於簡單對話回覆 + 超時重試）
   */
  async buildContext(options?: {
    relevanceHint?: string;
    mode?: 'full' | 'focused' | 'minimal' | 'light';
    cycleCount?: number;
    trigger?: string;
  }): Promise<string> {
    const mode = options?.mode ?? 'full';
    const isLight = mode === 'light';
    const hint = options?.relevanceHint?.toLowerCase() ?? '';

    // ── Minimal mode: 最小 context，用於超時重試 ──
    if (mode === 'minimal') {
      return this.buildMinimalContext();
    }

    // ── Trigger-Aware Context Budgeting ──
    // Different triggers need different context emphasis.
    // heartbeat cycles don't need 10 conversations; continuation cycles don't need 6K topic memory.
    const triggerBase = options?.trigger?.split(/[:(]/)[0]?.trim() ?? '';
    const triggerBudgets: Record<string, { conversations: number; topicMemory: number; extraHints: string[] }> = {
      heartbeat:     { conversations: 5,  topicMemory: 4000, extraHints: ['task', 'schedule', 'heartbeat'] },
      workspace:     { conversations: 5,  topicMemory: 4000, extraHints: ['workspace', 'git', 'file', 'change'] },
      cron:          { conversations: 3,  topicMemory: 3000, extraHints: ['cron', 'schedule', 'task'] },
      continuation:  { conversations: 3,  topicMemory: 2000, extraHints: [] },
      startup:       { conversations: 10, topicMemory: 6000, extraHints: [] },
    };
    // Trigger-aware budgeting: apply to ALL modes (not just focused).
    // DM triggers (telegram/room/chat) are NOT in the table → get null → full loading.
    // Non-DM triggers (heartbeat/workspace/cron) get lighter budgets → smaller context.
    const tBudget = triggerBudgets[triggerBase] ?? null;

    const [memory, heartbeat, soul] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
      this.readSoul(),
    ]);

    // 使用 Hot buffer 中的對話（截斷長回覆節省 token）
    const MAX_CONVERSATION_ENTRY_CHARS = 1000;
    const MAX_CONVERSATIONS = isLight ? 5 : (tBudget?.conversations ?? (mode === 'focused' ? 10 : this.hotLimit));
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

    // 從最近對話提取上下文關鍵字 + trigger-derived hints
    const recentHint = this.conversationBuffer
      .slice(-3)
      .map(c => c.content.toLowerCase())
      .join(' ');
    const triggerHints = tBudget?.extraHints?.join(' ') ?? '';
    const contextHint = [hint, recentHint, triggerHints].filter(Boolean).join(' ');

    // Server 環境資訊
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 組合感知區塊
    const sections: string[] = [];

    // ── 條件載入 helpers（根據相關性 + auto-demotion）──
    // Citation-driven auto-demotion: sections with 0 citations over DEMOTION_THRESHOLD
    // cycles are automatically demoted to conditional-load (Task 3)
    const isRelevant = (keywords: string[]) =>
      mode === 'full' || keywords.some(k => contextHint.includes(k));

    // Load demoted sections and their keywords from context optimizer (single source of truth)
    let demotedSections: Set<string> = new Set();
    let sectionKeywords: Record<string, string[]> = {};
    try {
      const { getContextOptimizer, SECTION_KEYWORDS } = await import('./context-optimizer.js');
      sectionKeywords = SECTION_KEYWORDS;
      const opt = getContextOptimizer();
      demotedSections = new Set(opt.getDemotedSections());
    } catch { /* ignore */ }

    // shouldLoad: demoted sections require keyword match; others use isRelevant.
    // Keywords come from SECTION_KEYWORDS (single source of truth).
    const shouldLoad = (section: string, fallbackKeywords?: string[]) => {
      const keywords = sectionKeywords[section] ?? fallbackKeywords ?? [];
      if (demotedSections.has(section)) {
        return keywords.some(k => contextHint.includes(k));
      }
      return isRelevant(keywords);
    };

    // ── 必載入（核心感知）──
    sections.push(`<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${this.instanceId}\n</environment>`);

    // ── Priority Focus（最顯眼位置 — 每個 cycle 開頭都會看到）──
    {
      const focus = readFlagCached(path.join(getMemoryStateDir(), 'priority-focus.txt'));
      if (focus) {
        sections.push(`<priority-focus>\n⚡ #1 PRIORITY: ${focus}\nDoes your chosen action serve this priority? If not, why is it more important?\n</priority-focus>`);
      }
    }

    // ── Temporal Sense（時間感）── skip in light mode, auto-demotion aware
    if (!isLight && shouldLoad('temporal')) {
      const temporalCtx = await buildTemporalSection();
      if (temporalCtx) {
        sections.push(`<temporal>\n${temporalCtx}\n</temporal>`);
      }
    }

    // ── Telegram 健康度（核心感知，總是載入）──
    const tgPoller = getTelegramPoller();
    const tgStats = getNotificationStats();
    const tgSection = [
      `Connected: ${tgPoller ? 'yes' : 'no'}`,
      `Notifications: ${tgStats.sent} sent, ${tgStats.failed} failed`,
    ].join('\n');
    sections.push(`<telegram>\n${tgSection}\n</telegram>`);

    // ── Unified Inbox（核心感知 — 統一收件匣）──
    const inboxItems = readPendingInbox();
    const inboxCtx = formatInboxSection(inboxItems);
    if (inboxCtx) {
      sections.push(`<inbox>\n${inboxCtx}\n</inbox>`);
    }

    const cycleKeywords = this.extractCycleKeywords(
      options?.trigger,
      inboxItems.map(item => ({ from: item.from, content: item.content, source: item.source })),
    );

    // ── Chat Room Smart Loading（recent + relevant history）──
    {
      const chatRoomRecent = await this.buildChatRoomRecentSection();
      if (chatRoomRecent) sections.push(chatRoomRecent);

      const todayIds = new Set(
        (await this.readChatRoomMessages(new Date().toISOString().slice(0, 10))).map(m => m.id),
      );
      const chatRoomRelevant = this.buildChatRoomRelevantSection(cycleKeywords || contextHint, todayIds);
      if (chatRoomRelevant) sections.push(chatRoomRelevant);
    }

    // ── Task Progress（跨 cycle 進度追蹤）──
    const progressCtx = buildTaskProgressSection(inboxItems);
    if (progressCtx) {
      sections.push(`<task-progress>\n${progressCtx}\n</task-progress>`);
    }

    const selfStatus = selfStatusProvider?.();
    if (selfStatus) {
      const selfCtx = formatSelfStatus(selfStatus);
      if (selfCtx) sections.push(`<self>\n${selfCtx}\n</self>`);
    }

    // Capabilities — conditional load (tools/plugins)
    if (shouldLoad('capabilities')) {
      const capabilities = await getCapabilitiesSnapshot(this.instanceId);
      const capabilitiesCtx = formatCapabilitiesContext(capabilities);
      if (capabilitiesCtx) sections.push(`<capabilities>\n${capabilitiesCtx}\n</capabilities>`);
    }

    // Process — 在問 debug/performance/memory 時才載入
    if (shouldLoad('process')) {
      const processCtx = processStatusProvider ? formatProcessStatus(processStatusProvider()) : '';
      if (processCtx) sections.push(`<process>\n${processCtx}\n</process>`);
    }

    // System — 在問 disk/resource 時才載入
    if (shouldLoad('system')) {
      const sysRes = getSystemResources();
      const sysCtx = formatSystemResources(sysRes);
      if (sysCtx) sections.push(`<system>\n${sysCtx}\n</system>`);
    }

    // Logs — 在問 error/log/debug 時才載入
    if (shouldLoad('logs')) {
      const logCtx = logSummaryProvider ? formatLogSummary(logSummaryProvider()) : '';
      if (logCtx) sections.push(`<logs>\n${logCtx}\n</logs>`);
    }

    // Network — 在問 port/service/network 時才載入
    if (shouldLoad('network')) {
      const netCtx = networkStatusProvider ? formatNetworkStatus(networkStatusProvider()) : '';
      if (netCtx) sections.push(`<network>\n${netCtx}\n</network>`);
    }

    // Config — 在問 config/setting 時才載入
    if (shouldLoad('config')) {
      const cfgCtx = configSnapshotProvider ? formatConfigSnapshot(configSnapshotProvider()) : '';
      if (cfgCtx) sections.push(`<config>\n${cfgCtx}\n</config>`);
    }

    // Context health — when asking about context optimization
    if (shouldLoad('context-health', ['context', 'optimize', 'budget', 'demotion', 'pruning'])) {
      try {
        const { formatContextHealth } = await import('./context-optimizer.js');
        const healthCtx = formatContextHealth();
        if (healthCtx) sections.push(`<context-health>\n${healthCtx}\n</context-health>`);
      } catch { /* ignore */ }
    }

    // Activity — 行為 + 診斷感知（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('activity') && activitySummaryProvider) {
      const activityCtx = formatActivitySummary(activitySummaryProvider());
      if (activityCtx) sections.push(`<activity>\n${activityCtx}\n</activity>`);
    }

    // ── Background Completed（skip in light mode）──
    if (!isLight) {
      const bgSection = buildBackgroundCompletedSection(this.instanceId);
      if (bgSection) {
        sections.push(`<background-completed>\n${bgSection}\n</background-completed>`);
      }
    }

    // ── Web Fetch Results（from <kuro:fetch> tags, one-shot consumption）──
    if (!isLight) {
      const webResultsPath = path.join(getMemoryStateDir(), 'web-fetch-results.md');
      try {
        const webResults = await fs.readFile(webResultsPath, 'utf-8');
        if (webResults.trim()) {
          sections.push(`<web-fetch-results>\n${webResults.slice(0, 12000)}\n</web-fetch-results>`);
          // One-shot: delete after injection so it doesn't repeat
          await fs.unlink(webResultsPath).catch(() => {});
        }
      } catch { /* file doesn't exist — normal */ }
    }

    // ── Activity Journal（skip in light mode, auto-demotion aware）──
    if (!isLight && shouldLoad('recent-activity')) {
      const { formatActivityJournal } = await import('./activity-journal.js');
      const activityJournal = formatActivityJournal();
      if (activityJournal) {
        sections.push(`<recent-activity>\n${activityJournal}\n</recent-activity>`);
      }
    }

    // ── Trail（skip in light mode, auto-demotion aware）──
    if (!isLight && shouldLoad('trail')) {
      const trailCtx = readTrailSection();
      if (trailCtx) {
        sections.push(`<trail>\n${trailCtx}\n</trail>`);
      }
    }

    // Decision quality warning（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('decision-quality-warning')) {
      const warning = readFlagCached(path.join(getMemoryStateDir(), 'decision-quality-warning.flag'));
      if (warning) sections.push(`<decision-quality-warning>\n${warning}\n</decision-quality-warning>`);
    }

    // Problem alignment warning（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('problem-alignment', ['alignment', 'priority', 'problem', 'direction', 'focus'])) {
      const warning = readFlagCached(path.join(getMemoryStateDir(), 'problem-alignment-warning.flag'));
      if (warning) sections.push(`<problem-alignment>\n${warning}\n</problem-alignment>`);
    }

    // Structural health warning（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('structural-health')) {
      const warning = readFlagCached(path.join(getMemoryStateDir(), 'structural-health-warning.flag'));
      if (warning) sections.push(`<structural-health>\n${warning}\n</structural-health>`);
    }

    // Route Efficiency（skip in light mode — slime mold nutrient path metrics, auto-demotion aware）
    if (!isLight && shouldLoad('route-efficiency')) {
      try {
        const { buildRouteSection } = await import('./route-tracker.js');
        const routeCtx = buildRouteSection();
        if (routeCtx) sections.push(`<route-efficiency>\n${routeCtx}\n</route-efficiency>`);
      } catch { /* ignore */ }
    }

    // Stale Tasks（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('stale-tasks')) {
      const staleWarnings = readStaleTaskWarnings();
      if (staleWarnings.length > 0) {
        const staleLines = staleWarnings.map(w =>
          `- ${w.priority} "${w.title}" — ${w.ageDays}天未推進 (created: ${w.created}, section: ${w.section})`
        );
        sections.push(`<stale-tasks>\n以下任務超齡未推進，考慮：降級、拆解、移到 backlog、或放棄。\n${staleLines.join('\n')}\n</stale-tasks>`);
      }
    }

    // Achievements + Output Gate（skip in light mode, auto-demotion aware）
    if (!isLight && shouldLoad('achievements')) {
      try {
        const { buildAchievementsContext } = await import('./achievements.js');
        const achievementsCtx = buildAchievementsContext();
        if (achievementsCtx) sections.push(`<achievements>\n${achievementsCtx}\n</achievements>`);
      } catch { /* ignore */ }
    }

    // Action Coach — conditional load (behavior/habits)
    if (shouldLoad('coach')) {
      try {
        const { buildCoachContext } = await import('./coach.js');
        const coachCtx = buildCoachContext();
        if (coachCtx) sections.push(`<coach>\n${coachCtx}\n</coach>`);
      } catch { /* ignore */ }
    }

    // Commitment Binding — conditional load (promises/commitments)
    if (shouldLoad('commitments')) {
      try {
        const { buildCommitmentsContext } = await import('./commitments.js');
        const commitCtx = buildCommitmentsContext(options?.cycleCount ?? 0);
        if (commitCtx) sections.push(`<commitments>\n${commitCtx}\n</commitments>`);
      } catch { /* ignore */ }
    }

    // Workspace — 幾乎總是有用
    const workspace = getWorkspaceSnapshot();
    const workspaceCtx = formatWorkspaceContext(workspace);
    sections.push(`<workspace>\n${workspaceCtx}\n</workspace>`);

    // ── Custom perceptions（Stream cache 優先 → fallback 直接執行）──
    if (customPerceptions.length > 0) {
      const pluginRelevance: Record<string, string[]> = {
        // Always load (empty = always relevant)
        tasks: [],
        'state-changes': [],
        'telegram-inbox': [],
        'chat-room-inbox': [],
        'claude-code-inbox': [],
        // Conditional load (keyword-matched)
        docker: ['docker', 'container', 'image', 'deploy'],
        'docker-services': ['docker', 'container', 'service', 'deploy'],
        chrome: ['chrome', 'cdp', 'browser', 'web', 'fetch', 'url', 'page'],
        web: ['web', 'url', 'fetch', 'http', 'page'],
        ports: ['port', 'service', 'listen', 'connect'],
        disk: ['disk', 'space', 'storage'],
        brew: ['brew', 'homebrew', 'package', 'update'],
        'git-detail': ['git', 'commit', 'branch', 'merge'],
        'github-issues': ['github', 'issue', 'pr', 'pull'],
        'github-prs': ['github', 'pr', 'pull', 'review', 'merge'],
        'claude-code-sessions': ['claude', 'session', 'mcp'],
        'feedback-status': ['feedback', 'loop', 'error', 'pattern'],
        'delegation-status': ['delegation', 'background', 'delegate'],
        mobile: ['mobile', 'phone', 'gps', 'location', 'sensor'],
        'focus-context': ['focus', 'context'],
        'environment-sense': ['env', 'environment', 'system'],
        'self-awareness': ['self', 'health', 'status'],
        'anomaly-detector': ['anomaly', 'error', 'alert'],
        'self-healing': ['heal', 'fix', 'error', 'recovery'],
        'x-feed': ['twitter', 'x', 'feed', 'social'],
        website: ['website', 'portfolio', 'blog'],
      };

      // Per-plugin output cap overrides from compose config
      const capOverrides: Record<string, number> = {};
      for (const p of customPerceptions) {
        if (p.output_cap) capOverrides[p.name] = p.output_cap;
      }

      if (perceptionStreams.isActive()) {
        // Phase 4: 從 stream cache 讀取（不執行 shell scripts）
        const cachedReport = perceptionStreams.getCachedReport();
        if (cachedReport) {
          sections.push(`<situation-report>\n${cachedReport}\n</situation-report>`);
        } else {
          const cachedResults = perceptionStreams.getCachedResults();
          if (cachedResults.length > 0) {
            // Plugin no-change 壓縮：unchanged sections 合併為一行摘要
            const changedResults: typeof cachedResults = [];
            const unchangedNames: string[] = [];
            for (const r of cachedResults) {
              if (!perceptionStreams.hasChangedSinceLastBuild(r.name)) {
                unchangedNames.push(r.name);
              } else {
                changedResults.push(r);
              }
            }
            // 只渲染有變化的 sections
            const customCtx = formatPerceptionResults(changedResults, capOverrides);
            if (customCtx) sections.push(customCtx);
            // 未變化的 sections：一行列表取代多個 XML 區塊
            if (unchangedNames.length > 0) {
              sections.push(`<unchanged-perceptions>\n${unchangedNames.join(', ')}\n</unchanged-perceptions>`);
            }
          }
        }
        perceptionStreams.markContextBuilt();
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
            const customCtx = formatPerceptionResults(results, capOverrides);
            if (customCtx) sections.push(customCtx);
          }
        }
      }
    }

    // ── Threads（skip in light mode）──
    if (!isLight) {
      const threadsCtx = buildThreadsContextSection();
      if (threadsCtx) {
        sections.push(`<threads>\n${threadsCtx}\n</threads>`);
      }
    }

    // ── Working Memory（跨 cycle 工作記憶，<kuro:inner> 寫入）──
    const innerNotesPath = path.join(this.memoryDir, 'inner-notes.md');
    try {
      if (existsSync(innerNotesPath)) {
        const innerContent = readFileSync(innerNotesPath, 'utf-8').trim();
        if (innerContent) {
          sections.push(`<working-memory>\n${innerContent}\n</working-memory>`);
        }
      }
    } catch { /* ignore */ }

    // ── Inner Voice（skip in light mode）──
    if (!isLight) {
      const unexpressedImpulses = await this.getUnexpressedImpulses();
      const innerVoiceCtx = this.buildInnerVoiceSection(unexpressedImpulses);
      if (innerVoiceCtx) {
        sections.push(`<inner-voice>\n${innerVoiceCtx}\n</inner-voice>`);
      }
    }

    // ── Conversation Threads（skip in light mode）──
    if (!isLight) {
      const convThreads = await this.getConversationThreads();
      const activeConvThreads = convThreads
        .filter(t => !t.resolvedAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
      if (activeConvThreads.length > 0) {
        const threadLines = activeConvThreads.map(t => {
          const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 3600000);
          const roomLink = t.roomMsgId ? ` [room:${t.roomMsgId}]` : '';
          return `- [${t.type}] ${t.content} (${age}h ago, from: "${t.source.slice(0, 40)}"${roomLink})`;
        });
        sections.push(`<conversation-threads>\nPending items from recent conversations:\n${threadLines.join('\n')}\n</conversation-threads>`);
      }
    }

    // ── Soul（身分認同）──
    if (soul) {
      const soulContent = this.buildSoulContext(soul, contextHint, (isLight ? 'focused' : mode) as 'full' | 'focused' | 'minimal', options?.cycleCount);
      sections.push(`<soul>\n${soulContent}\n</soul>`);
    }

    // ── Memory Index（多維度索引摘要）──
    // Auto-build index on first use; subsequent updates are incremental via dispatcher
    let indexRelevantTopics: Set<string> | null = null;
    if (!isLight) {
      try {
        if (!isIndexBuilt(this.memoryDir)) {
          // Cold start: build index (fire-and-forget, don't block context build)
          buildMemoryIndex(this.memoryDir).catch(() => {});
        } else {
          // Load manifest summary
          const manifestCtx = await getManifestContext(this.memoryDir, 2000);
          if (manifestCtx) {
            sections.push(`<memory-index>\n${manifestCtx}\n</memory-index>`);
          }

          // Use index to find relevant topics for this context
          if (contextHint) {
            const relevant = await getRelevantTopics(this.memoryDir, contextHint);
            if (relevant.length > 0) {
              indexRelevantTopics = new Set(relevant.map(r => r.topic));
            }
          }
        }
      } catch { /* index not available — fall through to keyword matching */ }
    }

    // ── Topic 記憶（skip in light mode）──
    if (isLight) {
      // Light mode: skip all topic memory to minimize context
    } else {
    let topics = await this.listTopics();
    if (topics.length > 0) {

      // Load topic heat data
      let topicHeat: Record<string, number> = {};
      try {
        const heatPath = path.join(this.memoryDir, '.topic-hits.json');
        const heatRaw = await fs.readFile(heatPath, 'utf-8');
        topicHeat = JSON.parse(heatRaw) as Record<string, number>;
      } catch { /* no heat data — treat all as cold */ }

      // Sort topics by compound interest score (high-compound topics load first within budget)
      try {
        const { getCompoundScores } = await import('./feedback-loops.js');
        const compoundScores = getCompoundScores();
        if (Object.keys(compoundScores).length > 0) {
          topics = [...topics].sort((a, b) => (compoundScores[b] ?? 0) - (compoundScores[a] ?? 0));
        }
      } catch { /* ignore — compound scores not yet computed */ }

      // Experiment 2: Total topic-memory budget (2026-02-28)
      // Data: topic-memory swings 0-17K chars, cited 1/918 cycles.
      // Budget caps total chars, excess topics downgraded to summary.
      // Trigger-aware: continuation/cron cycles get smaller budgets (less context needed).
      const TOPIC_MEMORY_BUDGET = tBudget?.topicMemory ?? 6000;
      let topicCharsUsed = 0;

      const keywordMap = await loadTopicKeywordMap(this.memoryDir);

      const loadedTopics: string[] = [];
      for (const topic of topics) {
        const { keywords, negativeKeywords: negatives } = keywordMap[topic] ?? { keywords: [topic], negativeKeywords: [] };

        // Match: keyword found AND not a negative-only match
        // Also match if index identifies this topic as relevant (Phase 2 integration)
        const isKeywordMatch = keywords.some(k => {
          if (!contextHint.includes(k)) return false;
          // If this keyword is in negatives, require additional keyword match
          if (negatives.includes(k)) return keywords.some(k2 => k2 !== k && contextHint.includes(k2));
          return true;
        });
        const isDirectMatch = isKeywordMatch || (indexRelevantTopics?.has(topic) ?? false);

        const heat = topicHeat[topic] ?? 0;

        if (mode === 'focused') {
          // focused mode: 只載入匹配的 topics
          if (!isDirectMatch) continue;
          const content = await this.readTopicMemory(topic);
          if (content) {
            const loadCount = this.topicLoadCounts.get(topic) ?? 0;
            // Heat-based truncation: high-heat topics get brief (already familiar), cold get full
            let topicContent = (loadCount >= 2 || heat >= 5)
              ? truncateTopicMemory(content, 'brief')
              : content;
            if (topicContent.length > 4000) topicContent = topicContent.slice(0, 4000) + '\n[... truncated]';
            topicContent = addTemporalMarkers(topicContent);
            // Budget check: downgrade to summary if over budget
            const section = `<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`;
            if (topicCharsUsed > 0 && topicCharsUsed + section.length > TOPIC_MEMORY_BUDGET) {
              const summary = addTemporalMarkers(truncateTopicMemory(content, 'summary'));
              const summarySection = `<topic-memory name="${topic}">\n${summary}\n</topic-memory>`;
              sections.push(summarySection);
              topicCharsUsed += summarySection.length;
            } else {
              sections.push(section);
              topicCharsUsed += section.length;
            }
            loadedTopics.push(topic);
            this.topicLoadCounts.set(topic, (this.topicLoadCounts.get(topic) ?? 0) + 1);
          }
        } else {
          // full mode: 匹配的完整載入（capped），非匹配的只載 summary
          const content = await this.readTopicMemory(topic);
          if (content) {
            let topicContent: string;
            if (isDirectMatch) {
              topicContent = content;
              if (topicContent.length > 4000) topicContent = topicContent.slice(0, 4000) + '\n[... truncated]';
            } else {
              // Non-matching topics: always summary (just title + count)
              topicContent = truncateTopicMemory(content, 'summary');
            }
            topicContent = addTemporalMarkers(topicContent);
            // Budget check: downgrade matched content to summary if over budget
            const section = `<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`;
            if (isDirectMatch && topicCharsUsed > 0 && topicCharsUsed + section.length > TOPIC_MEMORY_BUDGET) {
              const summary = addTemporalMarkers(truncateTopicMemory(content, 'summary'));
              const summarySection = `<topic-memory name="${topic}">\n${summary}\n</topic-memory>`;
              sections.push(summarySection);
              topicCharsUsed += summarySection.length;
            } else {
              sections.push(section);
              topicCharsUsed += section.length;
            }
            loadedTopics.push(topic);
            this.topicLoadCounts.set(topic, (this.topicLoadCounts.get(topic) ?? 0) + 1);
          }
        }
      }
    }
    } // end of !isLight topic memory block

    // ── NEXT.md（執行層待辦 + 完成驗證）──
    const nextRaw = await this.readNext();
    if (nextRaw) {
      const activeNext = this.extractActiveNext(nextRaw);
      const verified = await this.verifyNextTasks(activeNext);
      sections.push(`<next>\n${verified}\n</next>`);
    }

    // ── 記憶和對話（總是載入，light mode 截斷）──
    const tieredMem = this.tieredMemoryContent(memory, contextHint);
    const memContent = isLight ? tieredMem.slice(0, 2000) : tieredMem;
    sections.push(`<memory>\n${memContent}\n</memory>`);
    sections.push(`<recent_conversations>\n${conversations || '(No recent conversations)'}\n</recent_conversations>`);
    const hbContent = isLight ? (heartbeat?.slice(0, 1500) ?? '') : (heartbeat ?? '');
    sections.push(`<heartbeat>\n${hbContent}\n</heartbeat>`);

    let assembled = sections.join('\n\n');

    // ── Global context budget: dynamic based on skills overhead ──
    // fullPrompt = systemPrompt(~3K) + skills + context + userPrompt(~5K)
    // PROMPT_HARD_CAP in agent.ts = 80K, so context budget = 80K - skills - 8K overhead
    const PROMPT_HARD_CAP = 80_000;
    const NON_CONTEXT_BASE = 8_000; // system prompt base + user prompt estimate
    const totalSkillsChars = skillsCache.reduce((sum, s) => sum + s.content.length, 0);
    // Most modes load a subset (~60%); use conservative estimate to avoid pre-reduce in callClaude
    const estimatedSkillsOverhead = Math.ceil(totalSkillsChars * 0.6);
    const CONTEXT_BUDGET = Math.min(60_000, Math.max(30_000, PROMPT_HARD_CAP - estimatedSkillsOverhead - NON_CONTEXT_BASE));
    if (assembled.length > CONTEXT_BUDGET) {
      // Trim topic-memory sections first (largest, least essential)
      const topicPattern = /<topic-memory[^>]*>[\s\S]*?<\/topic-memory>/g;
      assembled = assembled.replace(topicPattern, (match) => {
        // Replace full content with summary
        const nameMatch = match.match(/name="([^"]*)"/);
        const name = nameMatch?.[1] ?? 'unknown';
        return `<topic-memory name="${name}">\n[trimmed — context budget exceeded]\n</topic-memory>`;
      });
      // If still over budget after trimming topics, truncate memory section
      if (assembled.length > CONTEXT_BUDGET) {
        assembled = assembled.slice(0, CONTEXT_BUDGET) + `\n\n[... context truncated at ${Math.round(CONTEXT_BUDGET / 1000)}K chars]`;
      }
    }

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
      // SubSoul facet load record
      const soulFacets = this.lastSoulFacetRecord ?? undefined;
      this.lastSoulFacetRecord = null; // consume after checkpoint
      const entry = JSON.stringify({
        timestamp: now.toISOString(),
        mode,
        hint: hint.slice(0, 200),
        contextLength: context.length,
        sections: sectionSizes,
        topicUtility,
        ...(soulFacets && { soulFacets }),
      }) + '\n';
      await fs.appendFile(path.join(dir, `${ts.slice(0, 10)}.jsonl`), entry);

      // Rotation: delete checkpoint files older than 7 days (run ~1% of calls to avoid fs spam)
      if (Math.random() < 0.01) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const files = await fs.readdir(dir);
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const dateStr = f.replace('.jsonl', '');
          const fileDate = new Date(dateStr).getTime();
          if (fileDate && fileDate < cutoff) {
            await fs.unlink(path.join(dir, f)).catch(() => {});
          }
        }
      }
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
    sections.push(`<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${this.instanceId}\n[LIGHTWEIGHT CONTEXT: soul + inbox + recent conversations]\n</environment>`);

    // TG 狀態（極小）
    const tgPoller = getTelegramPoller();
    const tgStats = getNotificationStats();
    sections.push(`<telegram>\nConnected: ${tgPoller ? 'yes' : 'no'}\nNotifications: ${tgStats.sent} sent, ${tgStats.failed} failed\n</telegram>`);

    // Soul — 只取核心身份
    if (soul) {
      const soulContent = this.buildSoulContext(soul, '', 'minimal');
      sections.push(`<soul>\n${soulContent}\n</soul>`);
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

    // Unified Inbox（對話回覆需要看到收到的訊息）
    const inboxItems = readPendingInbox();
    const inboxCtx = formatInboxSection(inboxItems);
    if (inboxCtx) {
      sections.push(`<inbox>\n${inboxCtx}\n</inbox>`);
    }

    // Conversation Threads（對話脈絡追蹤）
    const convThreads = await this.getConversationThreads();
    const activeConvThreads = convThreads
      .filter(t => !t.resolvedAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
    if (activeConvThreads.length > 0) {
      const threadLines = activeConvThreads.map(t => {
        const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 3600000);
        const roomLink = t.roomMsgId ? ` [room:${t.roomMsgId}]` : '';
        return `- [${t.type}] ${t.content} (${age}h ago, from: "${t.source.slice(0, 40)}"${roomLink})`;
      });
      sections.push(`<conversation-threads>\nPending items from recent conversations:\n${threadLines.join('\n')}\n</conversation-threads>`);
    }

    // ── Chat Room Smart Loading（recent + relevant history）──
    {
      const chatRoomCtx = await this.buildChatRoomRecentSection();
      if (chatRoomCtx) sections.push(chatRoomCtx);
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

    // ── Background Completed（delegation results visible to ask lane）──
    const bgSection = buildBackgroundCompletedSection(this.instanceId);
    if (bgSection) {
      sections.push(`<background-completed>\n${bgSection}\n</background-completed>`);
    }

    // ── Web Fetch Results ──
    const webResultsPath2 = path.join(getMemoryStateDir(), 'web-fetch-results.md');
    try {
      const webResults2 = await fs.readFile(webResultsPath2, 'utf-8');
      if (webResults2.trim()) {
        sections.push(`<web-fetch-results>\n${webResults2.slice(0, 12000)}\n</web-fetch-results>`);
        await fs.unlink(webResultsPath2).catch(() => {});
      }
    } catch { /* normal — no pending results */ }

    // ── Activity Journal（cross-lane awareness）──
    const { formatActivityJournal } = await import('./activity-journal.js');
    const activityJournal = formatActivityJournal(800);
    if (activityJournal) {
      sections.push(`<recent-activity>\n${activityJournal}\n</recent-activity>`);
    }

    return sections.join('\n\n');
  }

  /**
   * Extract named sections from SOUL.md by `## Header` matching.
   * Returns concatenated content of matched sections.
   */
  private extractSoulSections(soul: string, headers: string[]): string {
    const parts: string[] = [];
    for (const header of headers) {
      const start = soul.indexOf(header);
      if (start < 0) continue;
      // Find end: next `\n## ` or EOF
      const afterHeader = start + header.length;
      const nextSection = soul.indexOf('\n## ', afterHeader);
      const end = nextSection >= 0 ? nextSection : soul.length;
      parts.push(soul.slice(start, end).trimEnd());
    }
    return parts.join('\n\n');
  }

  /**
   * Build context-aware SOUL content with keyword-matched facet loading.
   *
   * @param soul - Full SOUL.md content
   * @param contextHint - Lowercase context keywords for facet matching
   * @param mode - 'minimal' | 'focused' | 'full'
   * @param cycleCount - Current OODA cycle count (for periodic refresh)
   */
  private buildSoulContext(
    soul: string,
    contextHint: string,
    mode: 'full' | 'focused' | 'minimal',
    cycleCount?: number,
  ): string {
    if (!soul) return '';

    // Full mode: return everything (interactive chat)
    if (mode === 'full') {
      this.lastSoulFacetRecord = {
        loaded: Object.keys(SOUL_FACETS),
        skipped: [],
        reason: 'full',
        identityChars: 0,
        totalChars: soul.length,
      };
      return soul;
    }

    // Extract identity sections (always loaded)
    const identity = this.extractSoulSections(soul, SOUL_IDENTITY_SECTIONS);

    // Fallback: if extraction found nothing, return full soul (header mismatch)
    if (!identity) {
      this.lastSoulFacetRecord = {
        loaded: Object.keys(SOUL_FACETS),
        skipped: [],
        reason: 'fallback',
        identityChars: 0,
        totalChars: soul.length,
      };
      return soul;
    }

    // Minimal mode: identity only
    if (mode === 'minimal') {
      this.lastSoulFacetRecord = {
        loaded: [],
        skipped: Object.keys(SOUL_FACETS),
        reason: 'minimal',
        identityChars: identity.length,
        totalChars: identity.length,
      };
      return identity + '\n\n[... soul sections omitted for minimal context ...]';
    }

    // Focused mode: identity + keyword-matched facets + summaries
    // Periodic refresh: every 10 cycles, load all facets
    const isRefresh = cycleCount != null && cycleCount % 10 === 0 && cycleCount > 0;

    const loaded: string[] = [];
    const skipped: string[] = [];
    const loadedFacets: string[] = [];
    const summaries: string[] = [];

    for (const [name, facet] of Object.entries(SOUL_FACETS)) {
      const matched = isRefresh || facet.keywords.some(k => contextHint.includes(k));
      if (matched) {
        const content = this.extractSoulSections(soul, facet.sections);
        if (content) loadedFacets.push(content);
        loaded.push(name);
      } else {
        summaries.push(`- ${name}: ${facet.summary}`);
        skipped.push(name);
      }
    }

    const parts = [identity];
    if (loadedFacets.length > 0) parts.push(loadedFacets.join('\n\n'));
    if (summaries.length > 0) {
      parts.push(`[Other soul facets (not loaded):\n${summaries.join('\n')}]`);
    }

    const result = parts.join('\n\n');
    this.lastSoulFacetRecord = {
      loaded,
      skipped,
      reason: isRefresh ? 'refresh' : 'keyword',
      identityChars: identity.length,
      totalChars: result.length,
    };

    return result;
  }

  /**
   * Memory 分層載入 — 近期全載、中期摘要、舊的省略
   * Kuro 提案：7天全載、7-30天 key only、30天+按需
   *
   * Smart Loading: When contextHint is provided and FTS5 returns results,
   * entries in smart-load sections are filtered to only include FTS5-matched
   * entries (plus recent entries within 3 days as safety net).
   */
  private tieredMemoryContent(raw: string, contextHint?: string): string {
    if (!raw) return raw;

    const now = Date.now();
    const THREE_DAYS = 3 * 86_400_000;
    const SEVEN_DAYS = 7 * 86_400_000;
    const CONTENT_MATCH_KEY_LEN = 80;

    // Experiment 3: MEMORY.md budget cap (2026-02-28)
    // Data: MEMORY.md ~14.7K chars (42% of context), citation rate 0.8%.
    // Budget limits non-critical sections; always-full sections exempt.
    const MEMORY_BUDGET = 6000;

    // Sections that are always loaded in full (small, critical, exempt from budget)
    const alwaysFullSections = ['User Preferences', 'Important Facts', 'Important Decisions'];

    // Sections where FTS5 smart loading applies (entries filtered by relevance)
    const smartLoadSections = ['Learned Patterns', 'TODO', 'Operations', 'Future Improvements'];

    // Build FTS5 match set when contextHint is available
    let ftsMatchSet: Set<string> | null = null;
    if (contextHint) {
      try {
        const matched = searchMemoryEntries(this.memoryDir, contextHint, 15);
        if (matched.length > 0) {
          ftsMatchSet = new Set(matched.map(m => m.content.slice(0, CONTENT_MATCH_KEY_LEN)));
        }
      } catch {
        // FTS5 not available — fall through to normal tiered loading
      }
    }

    const lines = raw.split('\n');
    const result: string[] = [];
    let isAlwaysFullSection = false;
    let isSmartLoadSection = false;
    let budgetChars = 0;
    let budgetExceeded = false;
    let olderCount = 0;
    let skippedBySmartLoad = 0;

    for (const line of lines) {
      // Section headers
      const sectionMatch = line.match(/^## (.+)/);
      if (sectionMatch) {
        if (olderCount > 0 || skippedBySmartLoad > 0) {
          const total = olderCount + skippedBySmartLoad;
          result.push(`(${total} more entries available via search)`);
          olderCount = 0;
          skippedBySmartLoad = 0;
        }
        isAlwaysFullSection = alwaysFullSections.some(s => sectionMatch[1].includes(s));
        isSmartLoadSection = ftsMatchSet !== null && smartLoadSections.some(s => sectionMatch[1].includes(s));
        budgetExceeded = false; // Reset per section (budget only limits non-critical content)
        result.push(line);
        continue;
      }

      // Sub-section headers always kept
      if (line.startsWith('### ')) {
        result.push(line);
        continue;
      }

      // Always-full sections: keep everything (exempt from budget)
      if (isAlwaysFullSection) {
        result.push(line);
        continue;
      }

      // Budget exceeded for this section: count remaining dated entries
      if (budgetExceeded) {
        if (line.match(/^- \[/)) olderCount++;
        else if (line.trim()) result.push(line); // keep non-entry lines (blank, comments)
        continue;
      }

      // Dated entries: tier by age + budget + smart load
      const dateMatch = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]/);
      if (dateMatch) {
        const age = now - new Date(dateMatch[1]).getTime();

        // Smart load filter: in smart-load sections, skip entries not matched by FTS5
        // Safety net: always keep entries within 3 days regardless
        if (isSmartLoadSection && age > THREE_DAYS) {
          // Extract content after the date tag for FTS5 matching
          const entryContent = line.replace(/^- \[\d{4}-\d{2}-\d{2}\] /, '');
          const contentKey = entryContent.slice(0, CONTENT_MATCH_KEY_LEN);
          if (!ftsMatchSet?.has(contentKey)) {
            skippedBySmartLoad++;
            continue;
          }
        }

        let entry: string;
        if (age <= THREE_DAYS) {
          entry = line;
        } else if (age <= SEVEN_DAYS) {
          entry = line.length > 120 ? line.slice(0, 120) + '...' : line;
        } else {
          // For smart-load matched entries beyond 7 days, still include (truncated)
          if (isSmartLoadSection) {
            entry = line.length > 120 ? line.slice(0, 120) + '...' : line;
          } else {
            olderCount++;
            continue;
          }
        }

        // Budget check
        if (budgetChars + entry.length > MEMORY_BUDGET) {
          budgetExceeded = true;
          olderCount++;
          continue;
        }

        result.push(entry);
        budgetChars += entry.length;
        continue;
      }

      // Undated entries (e.g., "- text"): always keep (typically important constants)
      result.push(line);
    }

    if (olderCount > 0 || skippedBySmartLoad > 0) {
      const total = olderCount + skippedBySmartLoad;
      result.push(`(${total} more entries available via search)`);
    }

    return result.join('\n');
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
/**
 * Truncate topic memory — aggressive mode for non-matching topics
 * @param content - raw topic file content
 * @param level - 'summary' = title + count only; 'brief' = title + count + last 1 entry
 */
function truncateTopicMemory(content: string, level: 'brief' | 'summary' = 'brief'): string {
  const lines = content.split('\n');
  const title = lines[0] || '';

  // Extract entries (lines starting with "- [")
  const entries = lines.filter(l => l.startsWith('- ['));
  const total = entries.length;

  if (total <= 1) return content; // Already minimal

  if (level === 'summary') {
    return `${title}\n(${total} entries)`;
  }

  // brief: title + count + last 1 entry
  const recent = entries.slice(-1);
  return `${title}\n(${total} entries, latest)\n${recent.join('\n')}`;
}

// =============================================================================
// Background Completed — lane-output 結果讀取+清理
// =============================================================================

const LANE_OUTPUT_CAP = 2000; // chars cap for <background-completed> section

/** Read lane-output/ directory and format results for buildContext injection */
function buildBackgroundCompletedSection(instanceId: string): string | null {
  try {
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!existsSync(laneDir)) return null;

    const files = readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
    if (files.length === 0) return null;

    const results: Array<{ id: string; type?: string; status: string; output: string; completedAt?: string }> = [];
    for (const file of files) {
      try {
        const raw = readFileSync(path.join(laneDir, file), 'utf-8');
        const data = JSON.parse(raw);
        results.push(data);
      } catch { continue; }
    }

    if (results.length === 0) return null;

    // Sort by completedAt (most recent first)
    results.sort((a, b) => {
      const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return tb - ta;
    });

    // Format with cap
    let totalChars = 0;
    const lines: string[] = [];
    for (const r of results) {
      const typeStr = r.type ? `[${r.type}]` : '';
      const outputSnippet = r.output.replace(/\n/g, ' ').slice(0, 300);
      const line = `- ${typeStr} ${r.id} ${r.status}: ${outputSnippet}`;
      if (totalChars + line.length > LANE_OUTPUT_CAP && lines.length > 0) {
        lines.push(`(${results.length - lines.length} more results in lane-output/)`);
        break;
      }
      lines.push(line);
      totalChars += line.length;
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}

/** Clean up all lane-output files (called after cycle processes them) */
export function cleanupLaneOutput(instanceId: string): void {
  try {
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!existsSync(laneDir)) return;

    const files = readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
    for (const file of files) {
      try {
        unlinkSync(path.join(laneDir, file));
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

/** Clean up lane-output files older than 24h (fire-and-forget housekeeping) */
export function cleanupStaleLaneOutput(instanceId: string): void {
  try {
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!existsSync(laneDir)) return;

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const files = readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const filePath = path.join(laneDir, file);
        const st = statSync(filePath);
        if (st.mtimeMs < cutoff) {
          unlinkSync(filePath);
        }
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

// =============================================================================
// Trail — 注意力歷史（mushi + kuro 共寫的化學梯度）
// =============================================================================

export interface TrailEntry {
  ts: string;
  agent: string;
  type: string;
  decision?: string;
  topics: string[];
  detail: string;
  count?: number;
}

/** Deduplicate trail entries: merge same pattern >3 times into single entry with count */
function deduplicateTrailEntries(entries: TrailEntry[]): TrailEntry[] {
  if (entries.length <= 3) return entries;

  // Group by pattern key: agent + type + decision
  const groups = new Map<string, TrailEntry[]>();
  const order: string[] = [];

  for (const e of entries) {
    const key = `${e.agent}|${e.type}|${e.decision ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  const result: TrailEntry[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length > 3) {
      const latest = group[group.length - 1];
      const allTopics = [...new Set(group.flatMap(e => e.topics))];
      result.push({
        ...latest,
        topics: allTopics,
        detail: group[0].detail,
        count: group.length,
      });
    } else {
      result.push(...group);
    }
  }

  return result;
}

/** Read trail.jsonl and format as compact context section */
function readTrailSection(): string | null {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const trailPath = path.join(homeDir, '.mini-agent', 'trail.jsonl');
    if (!existsSync(trailPath)) return null;

    const raw = readFileSync(trailPath, 'utf-8').trim();
    if (!raw) return null;

    const lines = raw.split('\n').filter(Boolean);
    // Filter to recent entries (last 2h)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const entries: Array<{
      ts: string; agent: string; type: string;
      decision?: string; topics: string[]; detail: string;
    }> = [];

    for (const line of lines.slice(-50)) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.ts).getTime() >= cutoff) {
          entries.push(entry);
        }
      } catch { continue; }
    }

    if (entries.length === 0) return null;

    // Compact format: one line per entry (dedup repeated patterns first)
    const deduped = deduplicateTrailEntries(entries);
    const formatted = deduped.slice(-20).map(e => {
      const time = e.ts.split('T')[1]?.split('.')[0]?.slice(0, 5) ?? '';
      const icon = e.type === 'scout' ? '🔍' : e.type === 'focus' ? '⚡' : e.type === 'triage' ? '🔀' : '📌';
      const decision = e.decision ? `[${e.decision}]` : '';
      const topics = e.topics.join(',');
      const countSuffix = e.count ? ` (x${e.count})` : '';
      return `${time} ${icon} ${e.agent} ${decision} ${topics}: ${e.detail.slice(0, 80)}${countSuffix}`;
    }).join('\n');

    // Topic frequency (hot topics = what deserves attention)
    const topicCounts: Record<string, number> = {};
    for (const e of entries) {
      for (const t of e.topics) {
        topicCounts[t] = (topicCounts[t] ?? 0) + 1;
      }
    }
    const hot = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, c]) => `${t}(${c})`)
      .join(', ');

    return `Recent ${entries.length} entries (last 2h)\nHot: ${hot}\n${formatted}`;
  } catch {
    return null;
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
    migrateStateFiles(id);
    const memory = new InstanceMemory(id);
    memory.initSearchIndex();
    memoryInstances.set(id, memory);
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
