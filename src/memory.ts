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
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { cachedReadFile } from './memory-cache.js';
import { execFileSync } from 'node:child_process';
import {
  getCurrentInstanceId,
  getInstanceDir,
  initDataDir,
} from './instance.js';
import { withFileLock } from './filelock.js';
import { diagLog, slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { scanContent, type TrustLevel } from './content-scanner.js';
import { buildActionMemorySection } from './action-memory.js';
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
import { getProvider, getFallback, getProviderForSource } from './agent.js';
import type { MemoryEntry, ConversationEntry, ComposePerception, CatalogEntry, ConversationThread } from './types.js';
import {
  executeAllPerceptions, formatPerceptionResults,
  loadAllSkills, formatSkillsPrompt, formatSkillIndex, setSkillTrackingPaths, refreshSkillsCache,
  type LoadedSkill,
} from './perception.js';
import { analyzePerceptions, isAnalysisAvailable } from './perception-analyzer.js';
import { perceptionStreams } from './perception-stream.js';
import {
  initSearchIndex, indexMemoryFiles, searchMemoryFTS, searchMemoryEntries,
  searchConversations, isIndexReady, indexConversationsIncremental,
} from './search.js';
// runVerify import removed — verify logic now in memory-index.ts
import { buildTemporalSection, buildThreadsContextSection, addTemporalMarkers } from './temporal.js';
import { readPendingInbox, formatInboxSection } from './inbox.js';
import { sanitizeExternalContent } from './tag-parser.js';
import { buildTaskProgressSection, readStaleTaskWarnings } from './housekeeping.js';
import { isIndexBuilt, buildMemoryIndex, getManifestContext, getRelevantTopics, buildTaskQueueSection, buildPinnedTasksSection, buildNextContextSection } from './memory-index.js';
import { buildStimulusFingerprint, hasRecentStimulusFingerprint } from './cycle-state.js';
import { kgExpandQuery } from './kg-retrieval.js';
import { getSkillsExcludeSet, shouldPruneSection, getEffectiveOutputCap, callLocalFast, classifyContextProfile, getContextProfileConfig, shouldLoadForProfile, extractKeywordsWithOMLX } from './omlx-gate.js';
import { recordCascadeMetric } from './cascade.js';

// =============================================================================
// Write-time Dedup — Jaccard word similarity (zero LLM cost)
// =============================================================================

/**
 * Check if a new memory entry is a duplicate of any recent entry.
 * Uses Jaccard similarity on word sets — threshold 0.6.
 */
function isDuplicateEntry(newContent: string, recentBullets: string[]): boolean {
  const newWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (newWords.size < 3) return false; // Too short to reliably compare

  for (const bullet of recentBullets) {
    // Strip date prefix [YYYY-MM-DD] from bullet
    const text = bullet.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '');
    const bulletWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (bulletWords.size < 3) continue;

    // Jaccard similarity = |intersection| / |union|
    let intersection = 0;
    for (const w of newWords) {
      if (bulletWords.has(w)) intersection++;
    }
    const union = new Set([...newWords, ...bulletWords]).size;
    const similarity = intersection / union;

    if (similarity > 0.6) return true;
  }
  return false;
}

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
let skillsCache: LoadedSkill[] = [];
let skillsCwd: string | undefined;

// Tool availability changes rarely; cache it in-process.
let toolAvailabilityCache: { checkedAt: number; values: Record<string, boolean> } | null = null;

export interface CapabilitiesSnapshot {
  provider: { primary: string; fallback: string | null; perSource?: Record<string, string> };
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
// Skills JIT Loading — 動態載入 + 自描述 metadata
// =============================================================================

export type CycleMode = 'learn' | 'act' | 'task' | 'respond' | 'reflect';

/** 註冊自訂感知和 Skills */
export function setCustomExtensions(ext: {
  perceptions?: ComposePerception[];
  skills?: string[];
  cwd?: string;
}): void {
  if (ext.perceptions) customPerceptions = ext.perceptions;
  if (ext.skills) {
    skillPaths = ext.skills;
    skillsCwd = ext.cwd;
    // 載入 skills（支援目錄自動掃描 + 自描述 metadata 解析）
    skillsCache = loadAllSkills(skillPaths, ext.cwd);
    // 啟用 hot-reload 追蹤
    setSkillTrackingPaths(skillPaths, ext.cwd);
    if (skillsCache.length > 0) {
      const totalChars = skillsCache.reduce((sum, s) => sum + s.content.length, 0);
      const withKw = skillsCache.filter(s => s.keywords.length > 0).length;
      const withModes = skillsCache.filter(s => s.modes.length > 0).length;
      console.log(`[SKILLS] Loaded ${skillsCache.length} skill(s) (${totalChars} chars, ${withKw} with keywords, ${withModes} with modes): ${skillsCache.map(s => s.name).join(', ')}`);
    }
  }
}

/**
 * 取得 skills prompt（漸進式披露 — CC pattern）
 *
 * Skills 透過檔案內的 JIT Keywords / JIT Modes 行自描述觸發條件。
 * 每次呼叫會檢查檔案變更（hot-reload），修改後下個 cycle 自動生效。
 *
 * Progressive disclosure:
 * - Full content: top 3 keyword-matched skills within mode-eligible set
 * - Index only: remaining eligible skills (name + trigger keywords, ~25 chars each)
 * - respond mode fallback: load all eligible (backward compat for user-facing cycles)
 *
 * @param hint - 用於 keyword matching 的文字
 * @param cycleMode - OODA cycle 模式，優先於 keyword matching
 */
export function getSkillsPrompt(hint?: string, cycleMode?: CycleMode): string {
  // Hot-reload: 檢查 skill 檔案是否有變更
  const refreshed = refreshSkillsCache(skillsCache);
  if (refreshed) skillsCache = refreshed;

  if (skillsCache.length === 0) return '';

  // Hard cap on total skills section. Skills are part of every prompt's non-context budget
  // (system prompt + skills + user prompt). When skills blow past this, the math
  // breaks: PROMPT_HARD_CAP (45K) − non-context > 0 is required for any context at all.
  // Incident 2026-04-17 19:04: non-context=46333 chars → actualContextBudget=-1333 →
  // every cycle stalled because even context=0 couldn't fit under the hard cap.
  const SKILLS_SECTION_CAP = 12_000;

  // Shrink the full-skill list until the section fits under the cap. Degrade gracefully
  // to index-only when even a single full skill wouldn't fit.
  const buildBounded = (fullSkills: LoadedSkill[], restSkills: LoadedSkill[]): string => {
    let full = [...fullSkills];
    while (full.length > 0) {
      const fullContent = formatSkillsPrompt(full);
      const indexContent = formatSkillIndex([...full.slice(full.length), ...restSkills]);
      // Note: index covers everything that's NOT in `full` — recompute as `full` shrinks.
      const indexAll = restSkills.length + (fullSkills.length - full.length);
      const indexList = [...fullSkills.slice(full.length), ...restSkills];
      const idx = indexList.length > 0 ? formatSkillIndex(indexList) : '';
      const combined = fullContent + idx;
      if (combined.length <= SKILLS_SECTION_CAP) return combined;
      // Still too big — drop one full skill (keep the highest-scoring ones first)
      full = full.slice(0, full.length - 1);
      // Silence unused-vars from above
      void indexContent; void indexAll;
    }
    // No full skill fits — return index of everything
    const all = [...fullSkills, ...restSkills];
    const idx = all.length > 0 ? formatSkillIndex(all) : '';
    return idx.length <= SKILLS_SECTION_CAP ? idx : idx.slice(0, SKILLS_SECTION_CAP);
  };

  // 無 hint 且無 cycleMode → 仍做 JIT（index-only — CLI 模式只需知道有哪些 skill 可用）
  if (!hint && !cycleMode) return buildBounded([], skillsCache);

  // oMLX Gate R2: get exclude set for current mode
  const excludeSet = getSkillsExcludeSet(cycleMode, (hint ?? '').toLowerCase());
  const lowerHint = (hint ?? '').toLowerCase();

  // Phase 1: Find mode-eligible skills (mode match + R2 gate)
  const eligible = skillsCache.filter(skill => {
    if (excludeSet.has(skill.name)) return false;
    if (cycleMode && skill.modes.length > 0) return skill.modes.includes(cycleMode);
    // No modes declared → eligible for keyword matching
    return true;
  });

  if (eligible.length === 0) return '';

  // Phase 2: Score each eligible skill by keyword match count
  const scored = eligible.map(skill => ({
    skill,
    matchCount: lowerHint
      ? skill.keywords.filter(k => lowerHint.includes(k)).length
      : 0,
  })).sort((a, b) => b.matchCount - a.matchCount);

  // Phase 3: Progressive disclosure — full content for top matches, index for rest
  const MAX_FULL_SKILLS = 3;
  const topMatches = scored.filter(s => s.matchCount > 0).slice(0, MAX_FULL_SKILLS);
  const rest = scored.filter(s => !topMatches.includes(s));

  // respond mode with no keyword matches → index of eligible (NOT full — previous behavior
  // loaded every eligible skill as full content, blowing up the prompt for casual DMs).
  if (topMatches.length === 0 && cycleMode === 'respond') {
    return buildBounded([], eligible);
  }

  return buildBounded(topMatches.map(s => s.skill), rest.map(s => s.skill));
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
  const perSourceStr = cap.provider.perSource
    ? ` (loop=${cap.provider.perSource.loop} fg=${cap.provider.perSource.foreground} ask=${cap.provider.perSource.ask})`
    : '';
  lines.push(`Provider: primary=${cap.provider.primary}${cap.provider.fallback ? ` fallback=${cap.provider.fallback}` : ''}${perSourceStr}`);
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
    provider: {
      primary: getProvider(),
      fallback: getFallback(),
      perSource: {
        loop: getProviderForSource('loop'),
        foreground: getProviderForSource('foreground'),
        ask: getProviderForSource('ask'),
      },
    },
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
    'achievements.json', 'activity-journal.jsonl', 'pulse-state.json',
    'commitments.json', 'crs-baseline.jsonl',
    'hesitation-log.jsonl', 'hesitation-state.json',
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
 * Returns { keywords, negativeKeywords, related } or null if no frontmatter.
 */
function parseTopicFrontmatter(content: string): { keywords: string[]; negativeKeywords: string[]; related: string[] } | null {
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
  return { keywords, negativeKeywords: parseList('negative_keywords'), related: parseList('related') };
}

/** Cached topic keyword map — invalidated by directory mtime change or appendTopicMemory */
let _topicKeywordCache: Record<string, { keywords: string[]; negativeKeywords: string[]; related: string[] }> | null = null;
let _topicKeywordDirMtime = 0;

/**
 * Load topic keywords from frontmatter dynamically.
 * Uses directory mtime for invalidation — avoids re-reading files unless topics/ changed.
 */
async function loadTopicKeywordMap(memoryDir: string): Promise<Record<string, { keywords: string[]; negativeKeywords: string[]; related: string[] }>> {
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

  const map: Record<string, { keywords: string[]; negativeKeywords: string[]; related: string[] }> = {};
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
          map[topic] = { keywords: [topic], negativeKeywords: [], related: [] };
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

// =============================================================================
// Semantic Topic Ranking (P1-4: Two-stage recall — FTS5 candidates → Haiku ranking)
// Pattern: Claude Code's findRelevantMemories() with Sonnet sideQuery
// =============================================================================

/** Cache for semantic ranking results — TTL 5 min, keyed by contextHint hash */
let _semanticCache: { hash: string; topics: string[]; ts: number } | null = null;
const SEMANTIC_CACHE_TTL = 300_000; // 5 min

/**
 * Semantically rank topic files using Haiku sideQuery.
 * Returns top-N most relevant topic names, or null if ranking fails/unavailable.
 *
 * Flow: build manifest (topic name + first line + age) → Haiku selects top 5
 * Fallback: returns null → caller uses existing keyword matching
 */
async function semanticRankTopics(
  topics: string[],
  memoryDir: string,
  contextHint: string,
  maxResults = 5,
): Promise<string[] | null> {
  if (topics.length <= maxResults) return null; // Not enough topics to rank — defer to keyword matching
  if (contextHint.length < 20) return null; // Not enough context to rank

  // Check cache
  const hintHash = contextHint.slice(0, 200);
  if (_semanticCache && _semanticCache.hash === hintHash && Date.now() - _semanticCache.ts < SEMANTIC_CACHE_TTL) {
    return _semanticCache.topics;
  }

  try {
    const { sideQuery } = await import('./side-query.js');

    // Build manifest: one line per topic (name + description/first-line + age)
    const topicsDir = path.join(memoryDir, 'topics');
    const manifest: string[] = [];
    for (const topic of topics) {
      try {
        const content = await fs.readFile(path.join(topicsDir, `${topic}.md`), 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        // Prefer frontmatter `description:` field (curated, concise) over first content line
        const descLine = lines.find(l => l.startsWith('description:'));
        const desc = descLine
          ? descLine.slice('description:'.length).trim().replace(/^["']|["']$/g, '')
          : (lines.find(l => !l.startsWith('---') && !l.startsWith('keywords:') && !l.startsWith('negative:') && !l.startsWith('related:') && !l.startsWith('description:'))
            ?? topic);
        const stat = statSync(path.join(topicsDir, `${topic}.md`));
        const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86_400_000);
        const age = ageDays > 30 ? `${ageDays}d old` : 'recent';
        manifest.push(`- ${topic}: ${desc.slice(0, 120)} (${age})`);
      } catch {
        manifest.push(`- ${topic}`);
      }
    }

    // Load cross-topic map for relationship hints (if available)
    let crossTopicHint = '';
    try {
      const mapPath = path.join(topicsDir, '.summaries', '_cross-topic-map.md');
      crossTopicHint = readFileSync(mapPath, 'utf-8').replace(/^<!--.*-->\n/gm, '').replace(/^#.*\n/gm, '').trim();
    } catch { /* no map available */ }

    const prompt = `You are selecting the most relevant topic-memory files for a conversation.

Current conversation context (keywords and recent messages):
"${contextHint.slice(0, 500)}"

Available topic files:
${manifest.join('\n')}
${crossTopicHint ? `\nKnown topic relationships:\n${crossTopicHint}` : ''}

Select up to ${maxResults} most relevant topics. Return ONLY a JSON array of topic names.
Example: ["topic-a", "topic-b"]

Important:
- Only select topics directly relevant to the conversation context
- Prefer recent topics over stale ones
- Consider topic relationships — if one topic is relevant, related topics may be too
- If nothing is clearly relevant, return an empty array []`;

    const result = await sideQuery(prompt, {
      model: 'claude-haiku-4-5-20251001',
      timeout: 15_000,
      maxTokens: 256,
    });

    if (!result) return null;

    // Parse JSON array from response
    const match = result.match(/\[[\s\S]*?\]/);
    if (!match) return null;

    const selected = JSON.parse(match[0]) as string[];
    // Validate: only return topics that actually exist
    const validTopics = selected.filter(t => topics.includes(t));

    if (validTopics.length > 0) {
      _semanticCache = { hash: hintHash, topics: validTopics, ts: Date.now() };
      eventBus.emit('log:info', {
        tag: 'semantic-rank',
        msg: `Selected ${validTopics.length}/${topics.length} topics: ${validTopics.join(', ')}`,
      });
    }

    return validTopics.length > 0 ? validTopics : null;
  } catch (error) {
    diagLog('semanticRankTopics', error);
    return null;
  }
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
  private loadedTopics: string[] = [];

  // Burst rate limiter for addTask
  private _addTaskTimestamps: number[] = [];

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

  getLoadedTopics(): string[] {
    return [...this.loadedTopics];
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
   *
   * Includes write-time dedup: skips if Jaccard word similarity > 0.6
   * with any of the 20 most recent entries (zero LLM cost).
   */
  async appendMemory(content: string, section = 'Learned Patterns', trust: TrustLevel = 'agent'): Promise<void> {
    // Content scanning — block injection/exfiltration before persisting
    const scan = scanContent(content, trust);
    if (scan.blocked) {
      eventBus.emit('log:warn', { tag: 'memory-scan', msg: `blocked write: ${scan.reason}` });
      return;
    }

    // Structural guards — prevent corruption cascades (2026-04-17 fix)
    // 1. Cap content length — single entries should be concise, not multi-paragraph dumps
    const MAX_ENTRY_CHARS = 500;
    if (content.length > MAX_ENTRY_CHARS) {
      eventBus.emit('log:warn', { tag: 'memory-guard', msg: `truncated ${content.length} → ${MAX_ENTRY_CHARS} chars: ${content.slice(0, 80)}...` });
      content = content.slice(0, MAX_ENTRY_CHARS);
    }
    // 2. Strip markdown headers from content — they corrupt MEMORY.md section structure
    content = content.replace(/^#{1,6}\s+/gm, '').replace(/\n---\n/g, '\n');

    await ensureDir(this.memoryDir);
    const memoryPath = path.join(this.memoryDir, 'MEMORY.md');

    await withFileLock(memoryPath, async () => {
      const current = await this.readMemory();

      // Write-time dedup: skip if similar entry exists in recent bullets
      const recentBullets = current.split('\n').filter(l => l.startsWith('- ')).slice(-20);
      if (recentBullets.length > 0 && isDuplicateEntry(content, recentBullets)) {
        eventBus.emit('log:info', {
          tag: 'memory-dedup',
          msg: `skipped duplicate: ${content.slice(0, 80)}...`,
        });
        return;
      }

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

    void import('./kg-live-ingest.js').then((m) =>
      m.onMemoryWrite({
        source: 'memory-md',
        file: memoryPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        preview: content,
      }),
    ).catch(() => {});
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

    void import('./kg-live-ingest.js').then((m) =>
      m.onMemoryWrite({
        source: 'topic',
        file: topicPath,
        topic,
        bytes: Buffer.byteLength(content, 'utf8'),
        preview: content,
      }),
    ).catch(() => {});
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
  async getCrossPollinationDigest(n = 2, maxTopics = 8, excludeTopics?: Set<string>): Promise<string> {
    let topics = await this.listTopics();
    if (topics.length === 0) return '';

    // P1-7: Exclude topics already loaded in buildContext to avoid duplicate surfacing
    if (excludeTopics && excludeTopics.size > 0) {
      topics = topics.filter(t => !excludeTopics.has(t));
      if (topics.length === 0) return '';
    }

    // Shuffle and limit topics to control context budget
    if (topics.length > maxTopics) {
      const shuffled = [...topics];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      topics = shuffled.slice(0, maxTopics);
    }

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
  async getForgottenEntries(maxAgeDays = 7, limit = 5, excludeTopics?: Set<string>): Promise<string> {
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
      // P1-7: Skip topics already loaded in buildContext
      if (excludeTopics && excludeTopics.has(topic)) continue;
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

    // Increment hits for surfaced entries so they don't resurface next cycle
    for (const f of selected) {
      const key = `${f.topic}:${f.entry.slice(2, 62)}`;
      hits[key] = (hits[key] ?? 0) + 1;
    }
    try {
      await fs.writeFile(hitsPath, JSON.stringify(hits, null, 2));
    } catch { /* ignore write errors */ }

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
      const { keywords, negativeKeywords: negatives } = keywordMap[topic] ?? { keywords: [topic], negativeKeywords: [], related: [] };

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

  // readNext / extractActiveNext / verifyNextTasks removed
  // — replaced by buildNextContextSection() in memory-index.ts

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
    const trimmed = task.trim();
    const rejectReason = this.validateTaskContent(trimmed);
    if (rejectReason) {
      slog('TASK', `rejected addTask: ${rejectReason} | content=${trimmed.slice(0, 80)}`);
      return;
    }
    const now = Date.now();
    this._addTaskTimestamps = this._addTaskTimestamps.filter(t => now - t < 1000);
    if (this._addTaskTimestamps.length >= 3) {
      slog('HEARTBEAT', `burst rejected: ${this._addTaskTimestamps.length} addTask/sec`);
      return;
    }
    this._addTaskTimestamps.push(now);

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

  private validateTaskContent(task: string): string | null {
    if (!task) return 'empty';
    if (task.length > 300) return `too_long(${task.length})`;
    if (task.includes('\n')) return 'multiline';
    if (/<\/?kuro:/i.test(task)) return 'tag_leakage';
    if (/^```|^> |^# |^skipped:/i.test(task)) return 'non_task_format';
    if (/^<\/|^<[a-z]/.test(task)) return 'html_fragment';
    if (/because the task|constraint to solve|I am treating it/i.test(task)) return 'llm_self_talk';
    return null;
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

  private formatChatRoomLine(msg: { id: string; from: string; text: string; replyTo?: string }, noTruncate = false): string {
    const reply = msg.replyTo ? ` ↩${msg.replyTo}` : '';
    const raw = noTruncate ? msg.text : (msg.text.length > 200 ? msg.text.slice(0, 200) + '...' : msg.text);
    const text = sanitizeExternalContent(raw);
    return `[${msg.id}] ${msg.from}${reply}: ${text}`;
  }

  /**
   * 從 trigger + inbox 提取本 cycle 檢索關鍵字（給 chat room 相關歷史檢索）
   * Cascade: 0.8B 生成語義 query → fallback 機械式 stopword removal
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

    // Try 0.8B semantic query generation first
    const start = Date.now();
    let fallback = false;
    let result = '';

    // Pure code keyword extraction — zero LLM (frees omlx GPU for Akari)
    // Same approach as omlx-gate R7: stop words + word scoring
    try {
      const contextPreview = combined.slice(0, 300).toLowerCase();
      const STOP_WORDS = new Set(['the','and','for','are','but','not','you','all','can','had','was','one','has','have','from','with','they','this','that','will','each','make','like','into','than','them','then','some','what','when','which','their','about','would','there','these','other','could','after','should','also','just','more','only','very','most','same','still','back','well','much','even','know','over','here','take','come','need','does','said','going','being','before','where','while','using','currently','kuro','akari','alex','cycle','agent']);
      const words = contextPreview.replace(/[^\w\u4e00-\u9fff]+/g, ' ').split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
      const freq = new Map<string, number>();
      for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
      const scored = [...freq.entries()]
        .map(([word, count]) => ({ word, score: word.length * Math.min(count, 3) }))
        .sort((a, b) => b.score - a.score);
      result = scored.slice(0, 3).map(s => s.word).join(', ');
      if (result.length < 3) fallback = true;
    } catch {
      fallback = true;
    }

    const latencyMs = Date.now() - start;
    recordCascadeMetric({
      ts: new Date().toISOString(),
      layer: '0.8B',
      task: 'memory-query',
      latencyMs,
      decision: fallback ? 'fallback' : result.slice(0, 80),
      inputChars: combined.length,
      fallback,
    });

    if (!fallback && result) return result;

    // Fallback: mechanical stopword removal (original logic)
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
  private async buildChatRoomRecentSection(conversationSummary?: string | null): Promise<string | null> {
    const today = new Date().toISOString().slice(0, 10);

    // Load all today's messages for thread chain resolution
    const allToday = await this.readChatRoomMessages(today);
    // Hybrid: load last 20 messages (was 10), recent 5 get full text
    const recent = allToday.slice(-20);
    const recentFullCount = 5;

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

    // Citation resolver: scan recent messages for #NNN references and pull cited messages into context
    const recentIds = new Set(recent.map(m => m.id));
    const citedMsgs = new Map<string, ChatRoomMessage>();
    const citationPattern = /#(\d{3})\b/g;
    const pendingYesterdayCitations: string[] = [];
    for (const msg of recent) {
      let match: RegExpExecArray | null;
      citationPattern.lastIndex = 0;
      while ((match = citationPattern.exec(msg.text)) !== null) {
        const num = match[1];
        const citedId = `${today}-${num}`;
        if (!recentIds.has(citedId) && !citedMsgs.has(citedId)) {
          const cited = msgIndex.get(citedId);
          if (cited) {
            citedMsgs.set(cited.id, cited);
          } else {
            // Not found today — try yesterday
            pendingYesterdayCitations.push(num);
          }
        }
      }
    }

    // Cross-day: yesterday's replyTo targets or cited messages may be in yesterday's file
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const missingReplyIds = [...threadMsgs.values()]
      .filter(m => m.replyTo && !msgIndex.has(m.replyTo) && m.replyTo.startsWith(yesterday))
      .map(m => m.replyTo!);
    if (missingReplyIds.length > 0 || pendingYesterdayCitations.length > 0) {
      const yesterdayMsgs = await this.readChatRoomMessages(yesterday);
      const yesterdayIndex = new Map(yesterdayMsgs.map(m => [m.id, m]));
      for (const id of missingReplyIds) {
        const msg = yesterdayIndex.get(id);
        if (msg) threadMsgs.set(msg.id, msg);
      }
      for (const num of pendingYesterdayCitations) {
        const citedId = `${yesterday}-${num}`;
        if (!citedMsgs.has(citedId)) {
          const msg = yesterdayIndex.get(citedId);
          if (msg) citedMsgs.set(msg.id, msg);
        }
      }
    }

    // Remove thread/cited messages that are already in recent
    const threadOnly = [...threadMsgs.values()]
      .filter(m => !recentIds.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const citedOnly = [...citedMsgs.values()]
      .filter(m => !recentIds.has(m.id) && !threadMsgs.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Split recent into older (6-20) and latest (1-5)
    const latestMsgs = recent.slice(-recentFullCount);
    const olderMsgs = recent.slice(0, -recentFullCount);

    // Assemble: cited → thread context → conversation summary or older msgs → recent
    const lines: string[] = [];
    if (citedOnly.length > 0) {
      lines.push(...citedOnly.map(m => this.formatChatRoomLine(m, true)));
      lines.push('--- cited messages ---');
    }
    if (threadOnly.length > 0) {
      lines.push(...threadOnly.map(m => this.formatChatRoomLine(m)));
      lines.push('--- thread context ---');
    }

    // Hybrid: 0.8B summary replaces older messages if available, else show truncated
    if (conversationSummary && olderMsgs.length > 0) {
      lines.push(`[context summary] ${conversationSummary}`);
    } else if (olderMsgs.length > 0) {
      lines.push(...olderMsgs.map(m => this.formatChatRoomLine(m)));
    }

    if (olderMsgs.length > 0 || conversationSummary) {
      lines.push('--- recent ---');
    }

    // Recent 5 messages: full text, no truncation
    lines.push(...latestMsgs.map(m => this.formatChatRoomLine(m, true)));

    if (lines.length === 0) return null;

    // File pointer: Kuro can read the full JSONL for complete context on-demand
    const convFile = path.join(this.memoryDir, 'conversations', `${today}.jsonl`);
    const totalMsgs = allToday.length;
    const fileHint = totalMsgs > recentFullCount
      ? `\n[${totalMsgs} messages today. Full conversation: ${convFile} — read if you need more context]`
      : '';

    return `<chat-room-recent>\n${lines.join('\n')}${fileHint}\n</chat-room-recent>`;
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

    // KG retrieval augmentation (Path A): expand with 1-hop entity neighbors
    if (ftsResults.length > 0 && ftsResults.length < maxResults) {
      const kgTerms = kgExpandQuery(trimmed, this.memoryDir);
      if (kgTerms.length > 0) {
        const kgQuery = kgTerms.join(' ');
        const kgResults = searchMemoryFTS(kgQuery, maxResults - ftsResults.length);
        // Dedup by content prefix
        const seen = new Set(ftsResults.map(r => r.content.slice(0, 80)));
        for (const kr of kgResults) {
          if (!seen.has(kr.content.slice(0, 80))) {
            ftsResults.push(kr);
            seen.add(kr.content.slice(0, 80));
            if (ftsResults.length >= maxResults) break;
          }
        }
      }
    }

    if (ftsResults.length > 0) {
      return ftsResults;
    }

    // Fallback to grep
    return this.grepSearch(trimmed, maxResults);
  }

  /**
   * grep 搜尋（fallback）
   *
   * Query 經三層防護才傳給 grep：
   * 1. Shell metachar 剝除（execFileSync 已避免 shell，但保留為 defense-in-depth）
   * 2. Length cap（≤ 200 chars）— 長 query 會讓 grep regex 編譯 OOM（2026-04-13 真實事故：
   *    room 收到一條 3KB @kuro 訊息被直接當 pattern → grep 進程 out of memory → 觸發
   *    連鎖不穩定最終導致 Primary shutdown）
   * 3. 取前兩個「有意義字詞」作為 grep pattern，而不是整段文字 — 真正的搜尋意圖
   *    是關鍵字不是完整句子
   */
  private async grepSearch(query: string, maxResults: number): Promise<MemoryEntry[]> {
    // Phase 1: strip shell metachars (defense-in-depth; execFileSync already avoids shell)
    const stripped = query.replace(/["`$\\;|&(){}[\]<>!#*?~\n\r]/g, '');
    if (!stripped.trim()) return [];

    // Phase 2: length cap — grep BRE compilation can OOM on very long patterns
    const SAFE_PATTERN_CAP = 200;
    const capped = stripped.length > SAFE_PATTERN_CAP
      ? stripped.slice(0, SAFE_PATTERN_CAP)
      : stripped;

    // Phase 3: reduce to first meaningful tokens — user intent is keyword search,
    // not full-text regex match. Pick the 2 longest non-stopword tokens.
    const STOP = new Set(['the','and','for','are','but','not','you','all','can','has','was','this','that','with','from','have','will','into','more','when','some','them','than','which','their','what','about','would','there','could','other','just','then','kuro','alex','claude','middleware']);
    const tokens = capped
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP.has(t));
    // Sort by length descending, take top 2; fall back to capped string if no tokens
    const topTokens = tokens.sort((a, b) => b.length - a.length).slice(0, 2);
    const pattern = topTokens.length > 0 ? topTokens.join('\\|') : capped;

    // Final guard: even after reduction, never pass > 100 chars to grep
    const finalPattern = pattern.length > 100 ? pattern.slice(0, 100) : pattern;

    try {
      // Use execFileSync to avoid shell interpretation entirely
      const { execFileSync } = await import('node:child_process');
      const grepResult = execFileSync(
        'grep',
        ['-rniE', '--include=*.md', finalPattern, this.memoryDir],
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
        diagLog('memory.searchMemory', error, { query: finalPattern, originalLen: String(query.length), dir: this.memoryDir });
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
    /** Phase 0 preprocessing results — compressed perception summaries + heartbeat diff */
    phase0Results?: import('./preprocess.js').Phase0Results;
    /** Context budget in chars — caller calculates available space after system prompt + skills.
     *  When provided, replaces the hardcoded NON_CONTEXT_BASE estimate. */
    contextBudget?: number;
  }): Promise<string> {
    const mode = options?.mode ?? 'full';
    const isLight = mode === 'light';
    const hint = options?.relevanceHint?.toLowerCase() ?? '';
    // Milestone timestamps — buildContext is async/long; D14 showed the total
    // can reach 16s on the startup cycle without indicating which phase is
    // actually slow. Mark each major checkpoint; emit breakdown at the end.
    const bcStart = Date.now();
    const bcMilestones: Record<string, number> = {};
    const bcMark = (label: string): void => {
      bcMilestones[label] = Date.now() - bcStart;
    };

    // ── Minimal mode: 最小 context，用於超時重試 ──
    if (mode === 'minimal') {
      return this.buildMinimalContext();
    }

    // ── R5: Context Profile System ──
    // Unified profile-based budgeting replaces scattered triggerBudgets.
    // Each profile defines conversations, topic budget, deep context, and section rules.
    const contextProfile = classifyContextProfile(options?.trigger);
    const profileConfig = getContextProfileConfig(options?.trigger);
    // Backward compat: tBudget-like interface from profile
    const tBudget = contextProfile === 'dm' ? null : {
      conversations: profileConfig.maxConversations,
      topicMemory: profileConfig.topicBudget,
      extraHints: profileConfig.extraHints,
    };

    bcMark('enter');
    const [memory, heartbeat, soul] = await Promise.all([
      this.readMemory(),
      this.readHeartbeat(),
      this.readSoul(),
    ]);
    bcMark('readCore');

    // 使用 Hot buffer 中的對話（截斷長回覆節省 token）
    const MAX_CONVERSATION_ENTRY_CHARS = 1500;
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

    // 從最近對話提取上下文關鍵字 + trigger-derived hints + R7 oMLX keywords
    const recentHint = this.conversationBuffer
      .slice(-3)
      .filter(c => c.role !== 'assistant')
      .map(c => c.content.toLowerCase())
      .join(' ');
    const triggerHints = tBudget?.extraHints?.join(' ') ?? '';

    // R7: Use oMLX 0.8B to extract keywords from inbox/trigger for better section matching
    let omlxKeywords = '';
    if (recentHint.length > 20 || (options?.trigger && options.trigger.length > 20)) {
      try {
        const extractInput = [recentHint.slice(0, 200), options?.trigger ?? ''].filter(Boolean).join(' ');
        const keywords = extractKeywordsWithOMLX(extractInput);
        omlxKeywords = keywords.join(' ');
      } catch { /* fail-open: no extra keywords */ }
    }

    const contextHint = [hint, recentHint, triggerHints, omlxKeywords].filter(Boolean).join(' ');

    // Server 環境資訊
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 組合感知區塊
    const sections: string[] = [];

    // Per-section soft caps — prevent any single section from dominating context
    const SECTION_CAP: Record<string, number> = {
      'web-fetch-results': 6000,
      'chat-room-recent': 6000,
      'chat-room-relevant': 4000,
      'soul': 8000,
      'heartbeat': 6000,
      'situation-report': 6000,
      'background-completed': 4000,
      'capabilities': 3000,
      'activity': 3000,
      'recent-activity': 3000,
      'action-memory': 3000,
      'memory-index': 2000,
      'trail': 2000,
      'achievements': 2000,
      'threads': 2000,
      'conversation-threads': 2000,
      'commitments': 2000,
      'myelin-framework': 2000,
      'past-success': 1500,
      'pulse': 1500,
      'route-efficiency': 1500,
      'working-memory': 3000,
      'inner-voice': 2000,
      'tactics-board': 3000,
    };
    const DEFAULT_SECTION_CAP = 4000;

    // Budget-aware section caps: scale down when budget is tight.
    // Prevents building 25K context just to trim it to 18K.
    const effectiveBudget = options?.contextBudget ?? profileConfig.contextBudget ?? 25_000;
    const budgetRatio = Math.min(1, effectiveBudget / 25_000); // 1.0 for 25K+, 0.72 for 18K, 0.32 for 8K
    let runningTotal = 0;

    /** Push a section with automatic size capping, scaled by budget */
    const pushCapped = (tag: string, content: string) => {
      const baseCap = SECTION_CAP[tag] ?? DEFAULT_SECTION_CAP;
      const cap = Math.max(500, Math.round(baseCap * budgetRatio));
      if (content.length > cap) {
        content = content.slice(0, cap) + `\n[... truncated from ${content.length} chars]`;
      }
      const section = `<${tag}>\n${content}\n</${tag}>`;
      runningTotal += section.length;
      sections.push(section);
    };

    /** Check if we should skip optional sections (budget nearly exhausted) */
    const budgetExhausted = () => runningTotal > effectiveBudget * 0.85;

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

    // ── Flip Test（one-shot reminder from postProcess ask-Alex detector）──
    try {
      const flipTestPath = path.join(getInstanceDir(this.instanceId), 'flip-test-pending.json');
      const flipRaw = await fs.readFile(flipTestPath, 'utf-8').catch(() => null);
      if (flipRaw) {
        try {
          const parsed = JSON.parse(flipRaw) as {
            detected?: unknown;
            output_excerpt?: unknown;
            timestamp?: unknown;
          };
          const ts = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN;
          const ageMs = Number.isFinite(ts) ? Date.now() - ts : Number.POSITIVE_INFINITY;
          if (ageMs >= 0 && ageMs < 60 * 60 * 1000) {
            const excerpt = typeof parsed.output_excerpt === 'string'
              ? parsed.output_excerpt.trim()
              : (typeof parsed.detected === 'string' ? parsed.detected : '（excerpt unavailable）');
            sections.push(`<flip-test>\n⚠️ 上個 cycle 偵測到「依賴 Alex」模式：${excerpt}\n翻轉測試：如果 Alex 不在，你會怎麼做？那個答案就是第一步。\n先自己嘗試，至少 3 種方法，再考慮升級。\n</flip-test>`);
          }
        } catch { /* malformed JSON — ignore and consume once */ }
        await fs.unlink(flipTestPath).catch(() => {});
      }
    } catch { /* fail-open: flip-test should never block context build */ }

    // ── Priority Focus（最顯眼位置 — 每個 cycle 開頭都會看到）──
    {
      const focus = readFlagCached(path.join(getMemoryStateDir(), 'priority-focus.txt'));
      if (focus) {
        sections.push(`<priority-focus>\n⚡ #1 PRIORITY: ${focus}\nDoes your chosen action serve this priority? If not, why is it more important?\n</priority-focus>`);
      }
    }

    // ── Temporal Sense（時間感）── skip in light mode, profile-aware, auto-demotion aware
    if (!isLight && shouldLoadForProfile('temporal', options?.trigger) && shouldLoad('temporal')) {
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
      const chatRoomRecent = await this.buildChatRoomRecentSection(options?.phase0Results?.conversationSummary);
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

    const taskQueueCtx = buildTaskQueueSection(this.memoryDir);
    if (taskQueueCtx) {
      sections.push(taskQueueCtx);
    }

    const pinnedCtx = buildPinnedTasksSection(this.memoryDir);
    if (pinnedCtx) {
      sections.push(pinnedCtx);
    }

    // ── Tactical Command Board (T7, brain-only-kuro-v2) ──
    // Fast GET of in-flight delegations from middleware + cached needs-attention.
    // Scorer itself runs async as a perception plugin (T13) — buildContext must not block.
    //
    // Gated by KURO_TACTICS_BOARD_ENABLED env flag (default: disabled).
    // Reason: tactics-board + reasoning-continuity + commitment-ledger stack shifted cycle
    // convergence from "observe env → act" to "verify my own ledger". Empirical effect:
    // 4/7 cycles were no-op "Verified X already committed" during the regression window
    // (2026-04-17 14:00–17:20). Re-enable only when observational evidence shows cycle
    // produces more visible output than ledger verification.
    const tacticsEnabled = (process.env.KURO_TACTICS_BOARD_ENABLED ?? '').toLowerCase() === 'true';
    if (tacticsEnabled && !isLight && !budgetExhausted() && shouldLoad('tactics-board', ['task', 'delegate', 'worker', 'tactics', 'attention', 'in-flight'])) {
      try {
        const { getInFlight } = await import('./tactics-client.js');
        const agent = process.env.AGENT_NAME ?? 'kuro';
        const inFlight = await getInFlight(agent, { timeoutMs: 2000 }).catch(() => []);

        // Read cached needs-attention (written by T13 perception plugin, not this call).
        // Absent cache = safe skip; never block buildContext on the scorer.
        let attentionItems: Array<{ task_id: string; severity: string; rationale: string }> = [];
        try {
          const attnPath = path.join(getMemoryStateDir(), 'tactics-attention.json');
          const raw = await fs.readFile(attnPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.items)) {
            attentionItems = parsed.items
              .filter((it: unknown): it is { task_id: string; severity: string; rationale: string } =>
                typeof it === 'object' && it !== null &&
                typeof (it as { task_id?: unknown }).task_id === 'string' &&
                typeof (it as { severity?: unknown }).severity === 'string' &&
                typeof (it as { rationale?: unknown }).rationale === 'string')
              .slice(0, 5);
          }
        } catch { /* no cache yet — safe */ }

        const parts: string[] = [];
        if (inFlight.length > 0) {
          parts.push(`## In-flight (${inFlight.length})`);
          for (const t of inFlight.slice(0, 8)) {
            parts.push(`- [${t.status}] ${t.worker}: ${t.label ?? t.task_id}`);
          }
        }
        if (attentionItems.length > 0) {
          if (parts.length > 0) parts.push('');
          parts.push(`## Needs Attention (${attentionItems.length} flagged, cached)`);
          for (const it of attentionItems) {
            parts.push(`- [${it.severity}] ${it.task_id} — ${it.rationale}`);
          }
        }
        if (parts.length > 0) pushCapped('tactics-board', parts.join('\n'));
      } catch { /* fail-open: tactics-board missing never blocks the cycle */ }
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
      if (capabilitiesCtx) pushCapped('capabilities', capabilitiesCtx);
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

    // ── Budget-aware early exit for optional sections below ──
    // Core sections (soul, memory, heartbeat, inbox, chat-room, workspace, task-queue) are already loaded above.
    // Everything below is optional — skip when budget is nearly exhausted.

    // Activity — 行為 + 診斷感知（skip in light mode, auto-demotion aware）
    if (!isLight && !budgetExhausted() && shouldLoad('activity') && activitySummaryProvider) {
      const activityCtx = formatActivitySummary(activitySummaryProvider());
      if (activityCtx) pushCapped('activity', activityCtx);
    }

    // ── Background Completed（skip in light mode）──
    if (!isLight) {
      const bgSection = buildBackgroundCompletedSection(this.instanceId);
      if (bgSection) {
        pushCapped('background-completed', bgSection);
      }
    }

    // ── Web Fetch Results（from <kuro:fetch> tags）──
    // TTL-based, NOT one-shot. Multiple cycles can read the same result until it ages out.
    // Why: one-shot consume caused a race — first buildContext() to see the file ate it,
    // even if that cycle wasn't the one responding to the original question. Result was
    // silently discarded, Kuro re-fetched, never converged. See processFetchRequests in web.ts.
    //
    // Structured injection (ghost-commitment defense Step 2): emit a concise per-URL index
    // at the top so the dispatcher gate can cross-reference before admitting <kuro:fetch>.
    // Bodies below keep the FETCH-ENTRY separator so downstream parsers stay compatible.
    if (!isLight) {
      try {
        const { readFetchedEntries } = await import('./web.js');
        const stateDir = getMemoryStateDir();
        const entries = await readFetchedEntries(stateDir);
        if (entries.length > 0) {
          const fmtAge = (ms: number) => `${(ms / 60000).toFixed(1)}min ago`;
          const index = entries
            .map((e) => `- ${e.url} (fetched ${fmtAge(e.ageMs)})`)
            .join('\n');
          const bodies = entries
            .map((e) => `<!-- url: ${e.url} fetchedAt: ${e.fetchedAt} (${fmtAge(e.ageMs)}) -->\n${e.markdown}`)
            .join('\n\n---FETCH-ENTRY---\n\n');
          pushCapped(
            'web-fetch-results',
            `Already-fetched URLs (do NOT re-issue <kuro:fetch> for these within TTL):\n${index}\n\n---\n\n${bodies}`,
          );
        } else {
          // No live entries; clean up a fully-stale file so stat() doesn't keep it alive.
          const webResultsPath = path.join(stateDir, 'web-fetch-results.md');
          await fs.unlink(webResultsPath).catch(() => {});
        }
      } catch { /* file doesn't exist or parse error — normal */ }
    }

    // ── Activity Journal（skip in light mode, auto-demotion aware）──
    if (!isLight && !budgetExhausted() && shouldLoad('recent-activity')) {
      const { formatActivityJournal } = await import('./activity-journal.js');
      const activityJournal = formatActivityJournal();
      if (activityJournal) {
        pushCapped('recent-activity', activityJournal);
      }
    }

    // ── Trail（skip in light mode, profile + auto-demotion aware）──
    if (!isLight && !budgetExhausted() && shouldLoadForProfile('trail', options?.trigger) && shouldLoad('trail')) {
      const trailCtx = readTrailSection();
      if (trailCtx) {
        pushCapped('trail', trailCtx);
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

    // Route Efficiency（skip in light mode — slime mold nutrient path metrics, profile + auto-demotion aware）
    if (!isLight && !budgetExhausted() && shouldLoadForProfile('route-efficiency', options?.trigger) && shouldLoad('route-efficiency')) {
      try {
        const { buildRouteSection } = await import('./route-tracker.js');
        const routeCtx = buildRouteSection();
        if (routeCtx) sections.push(`<route-efficiency>\n${routeCtx}\n</route-efficiency>`);
      } catch { /* ignore */ }
    }

    // Stale Tasks（skip in light mode, profile + auto-demotion aware）
    if (!isLight && !budgetExhausted() && shouldLoadForProfile('stale-tasks', options?.trigger) && shouldLoad('stale-tasks')) {
      const staleWarnings = readStaleTaskWarnings();
      if (staleWarnings.length > 0) {
        const staleLines = staleWarnings.map(w =>
          `- ${w.priority} "${w.title}" — ${w.ageDays}天未推進 (created: ${w.created}, section: ${w.section})`
        );
        sections.push(`<stale-tasks>\n以下任務超齡未推進，考慮：降級、拆解、移到 backlog、或放棄。\n${staleLines.join('\n')}\n</stale-tasks>`);
      }
    }

    // Achievements + Output Gate（skip in light mode, profile + auto-demotion aware）
    if (!isLight && !budgetExhausted() && shouldLoadForProfile('achievements', options?.trigger) && shouldLoad('achievements')) {
      try {
        const { buildAchievementsContext } = await import('./achievements.js');
        const achievementsCtx = buildAchievementsContext();
        if (achievementsCtx) pushCapped('achievements', achievementsCtx);
      } catch { /* ignore */ }
    }

    // Past success patterns — recall what worked before for similar tasks
    if (!isLight && !budgetExhausted() && contextHint) {
      try {
        const { buildSuccessContext } = await import('./success-patterns.js');
        const successCtx = buildSuccessContext(contextHint);
        if (successCtx) pushCapped('past-success', successCtx);
      } catch { /* ignore */ }
    }

    // Unified Pulse System — behavioral signals (replaces coach)
    if (shouldLoad('pulse')) {
      try {
        const { buildPulseContext } = await import('./pulse.js');
        const pulseCtx = buildPulseContext();
        if (pulseCtx) pushCapped('pulse', pulseCtx);
      } catch { /* ignore */ }
    }

    // Myelin crystallized knowledge — decision framework from accumulated patterns
    if (shouldLoad('myelin-framework')) {
      try {
        const { getMyelinPromptBlock } = await import('./myelin-fleet.js');
        const myelinBlock = getMyelinPromptBlock();
        if (myelinBlock.trim()) pushCapped('myelin-framework', myelinBlock);
      } catch { /* ignore — myelin not available */ }
    }

    // Commitment Binding — conditional load (promises/commitments), profile-aware
    if (shouldLoadForProfile('commitments', options?.trigger) && shouldLoad('commitments')) {
      try {
        const { buildCommitmentsContext } = await import('./commitments.js');
        const commitCtx = buildCommitmentsContext(options?.cycleCount ?? 0);
        if (commitCtx) pushCapped('commitments', commitCtx);
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
          pushCapped('situation-report', cachedReport);
        } else {
          const cachedResults = perceptionStreams.getCachedResults();
          if (cachedResults.length > 0) {
            const cycleNum = options?.cycleCount ?? 0;
            // Plugin no-change 壓縮 + R1 low-citation pruning
            const changedResults: typeof cachedResults = [];
            const unchangedNames: string[] = [];
            const prunedNames: string[] = [];
            for (const r of cachedResults) {
              // R1: prune low-citation sections entirely
              if (shouldPruneSection(r.name, cycleNum)) {
                prunedNames.push(r.name);
                continue;
              }
              if (!perceptionStreams.hasChangedSinceLastBuild(r.name)) {
                unchangedNames.push(r.name);
              } else {
                changedResults.push(r);
              }
            }
            // Phase 0 P0b: Replace full perception output with 0.8B summaries when available
            const p0Summaries = options?.phase0Results?.perceptionSummaries;
            const summarizedResults: typeof changedResults = [];
            const summarizedNames: string[] = [];
            for (const r of changedResults) {
              const summary = p0Summaries?.get(r.name);
              if (summary) {
                // Use 0.8B summary instead of full output
                summarizedResults.push({ ...r, output: summary });
                summarizedNames.push(r.name);
              } else {
                summarizedResults.push(r);
              }
            }
            // R1: apply reduced output caps for non-high-citation sections
            const effectiveCaps = { ...capOverrides };
            for (const r of summarizedResults) {
              const defaultCap = capOverrides[r.name] ?? 4000;
              effectiveCaps[r.name] = getEffectiveOutputCap(r.name, defaultCap);
            }
            // 只渲染有變化的 sections（with R1 reduced caps + P0b summaries）
            const customCtx = formatPerceptionResults(summarizedResults, effectiveCaps);
            if (customCtx) sections.push(customCtx);
            if (summarizedNames.length > 0) {
              eventBus.emit('log:info', { tag: 'preprocess', msg: `P0b: ${summarizedNames.length} perception sections compressed: ${summarizedNames.join(', ')}` });
            }
            // 未變化的 sections：一行列表取代多個 XML 區塊
            if (unchangedNames.length > 0) {
              sections.push(`<unchanged-perceptions>\n${unchangedNames.join(', ')}\n</unchanged-perceptions>`);
            }
            // R1: pruned sections listed for transparency
            if (prunedNames.length > 0) {
              sections.push(`<pruned-perceptions reason="low-citation">\n${prunedNames.join(', ')}\n</pruned-perceptions>`);
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
            if (report) pushCapped('situation-report', report);
          } else {
            const customCtx = formatPerceptionResults(results, capOverrides);
            if (customCtx) sections.push(customCtx);
          }
        }
      }
    }

    // ── Action Memory（向內感知：近期成功行動 + 重複偵測）──
    if (!isLight) {
      try {
        const actionMemory = buildActionMemorySection(getInstanceDir(getCurrentInstanceId()));
        if (actionMemory) {
          pushCapped('action-memory', actionMemory);
        }
      } catch { /* fire-and-forget */ }
    }

    // ── Threads（skip in light mode + non-deep profiles）──
    if (!isLight && profileConfig.loadDeepContext) {
      const threadsCtx = buildThreadsContextSection();
      if (threadsCtx) {
        pushCapped('threads', threadsCtx);
      }
    }

    // ── Working Memory（跨 cycle 工作記憶，<kuro:inner> 寫入）──
    const innerNotesPath = path.join(this.memoryDir, 'inner-notes.md');
    try {
      if (existsSync(innerNotesPath)) {
        const innerContent = readFileSync(innerNotesPath, 'utf-8').trim();
        if (innerContent) {
          pushCapped('working-memory', innerContent);
        }
      }
    } catch { /* ignore */ }

    // ── Inner Voice（skip in light mode + non-deep profiles）──
    if (!isLight && profileConfig.loadDeepContext) {
      const unexpressedImpulses = await this.getUnexpressedImpulses();
      const innerVoiceCtx = this.buildInnerVoiceSection(unexpressedImpulses);
      if (innerVoiceCtx) {
        pushCapped('inner-voice', innerVoiceCtx);
      }
    }

    // ── Conversation Threads（skip in light mode + non-deep profiles）──
    if (!isLight && profileConfig.loadDeepContext) {
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
        pushCapped('conversation-threads', `Pending items from recent conversations:\n${threadLines.join('\n')}`);
      }
    }

    // ── Soul（身分認同）──
    if (soul) {
      const soulContent = this.buildSoulContext(soul, contextHint, (isLight ? 'focused' : mode) as 'full' | 'focused' | 'minimal', options?.cycleCount);
      pushCapped('soul', soulContent);
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
            pushCapped('memory-index', manifestCtx);
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
      this.loadedTopics = [];
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
      const TOPIC_MEMORY_BUDGET = tBudget?.topicMemory ?? 10000;
      let topicCharsUsed = 0;

      const keywordMap = await loadTopicKeywordMap(this.memoryDir);

      // P1-4: Semantic ranking — identifies relevant topics that keywords might miss
      // Uses Haiku sideQuery (cached 5min) to find cross-topic semantic connections
      const semanticTopics = await semanticRankTopics(topics, this.memoryDir, contextHint);
      const semanticSet = new Set(semanticTopics ?? []);

      const loadedTopics: string[] = [];
      const topicMenuItems: string[] = [];
      // R6: Removed INDEX_EXTRA_TOPIC_CAP — FTS5-backed index provides scored results,
      // budget control via TOPIC_MEMORY_BUDGET is sufficient to prevent bloat.
      for (const topic of topics) {
        const { keywords, negativeKeywords: negatives } = keywordMap[topic] ?? { keywords: [topic], negativeKeywords: [], related: [] };

        // Match: keyword found AND not a negative-only match
        // Also match if index identifies this topic as relevant (R6: FTS5 + relational matching)
        const isKeywordMatch = keywords.some(k => {
          if (!contextHint.includes(k)) return false;
          // If this keyword is in negatives, require additional keyword match
          if (negatives.includes(k)) return keywords.some(k2 => k2 !== k && contextHint.includes(k2));
          return true;
        });
        // R6: Memory-index boosting — no hard cap, rely on budget control
        const isIndexMatch = !isKeywordMatch && (indexRelevantTopics?.has(topic) ?? false);
        // P1-4: Semantic match — Haiku identified this topic as relevant to the conversation
        const isSemanticMatch = !isKeywordMatch && !isIndexMatch && semanticSet.has(topic);
        const isDirectMatch = isKeywordMatch || isIndexMatch || isSemanticMatch;

        const heat = topicHeat[topic] ?? 0;

        if (mode === 'focused') {
          // focused mode: 只載入匹配的 topics
          if (!isDirectMatch) continue;
          const content = await this.readTopicMemory(topic);
          if (content) {
            const loadCount = this.topicLoadCounts.get(topic) ?? 0;
            // Heat-based truncation: high-heat topics get brief (already familiar), cold get full
            // Per-topic cap: >6000 chars → brief mode (prevents giant topics monopolizing budget)
            const PER_TOPIC_CAP = 6000;
            let topicContent = (loadCount >= 2 || heat >= 5)
              ? truncateTopicMemory(content, 'brief')
              : (content.length > PER_TOPIC_CAP ? truncateTopicMemory(content, 'brief') : content);
            topicContent = addTemporalMarkers(topicContent);
            // Budget check: over budget → add to menu instead
            const section = `<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`;
            if (topicCharsUsed > 0 && topicCharsUsed + section.length > TOPIC_MEMORY_BUDGET) {
              // Collect for menu instead of inline summary
              const title = content.split('\n')[0] || topic;
              const entryCount = content.split('\n').filter(l => l.startsWith('- [')).length;
              topicMenuItems.push(`${topic}: ${title.replace(/^#+ /, '')} (${entryCount} entries)`);
            } else {
              sections.push(section);
              topicCharsUsed += section.length;
            }
            loadedTopics.push(topic);
            this.topicLoadCounts.set(topic, (this.topicLoadCounts.get(topic) ?? 0) + 1);
          }
        } else {
          // full mode: 匹配的完整載入，非匹配的只載 summary
          const content = await this.readTopicMemory(topic);
          if (content) {
            const PER_TOPIC_CAP = 6000;
            let topicContent: string;
            if (isDirectMatch) {
              // Per-topic cap: >6000 chars → brief mode (prevents giant topics monopolizing budget)
              topicContent = content.length > PER_TOPIC_CAP ? truncateTopicMemory(content, 'brief') : content;
            } else {
              // Non-matching topics: always summary (just title + count)
              topicContent = truncateTopicMemory(content, 'summary');
            }
            topicContent = addTemporalMarkers(topicContent);
            // Budget check: over budget → add to menu instead
            const section = `<topic-memory name="${topic}">\n${topicContent}\n</topic-memory>`;
            if (topicCharsUsed > 0 && topicCharsUsed + section.length > TOPIC_MEMORY_BUDGET) {
              if (isDirectMatch) {
                // Direct matches → menu instead of inline summary
                const title = content.split('\n')[0] || topic;
                const entryCount = content.split('\n').filter(l => l.startsWith('- [')).length;
                topicMenuItems.push(`${topic}: ${title.replace(/^#+ /, '')} (${entryCount} entries)`);
              }
              // Non-matching topics: simply skip once over budget
            } else {
              sections.push(section);
              topicCharsUsed += section.length;
            }
            loadedTopics.push(topic);
            this.topicLoadCounts.set(topic, (this.topicLoadCounts.get(topic) ?? 0) + 1);
          }
        }
      }
      // ── 1-hop related loading ──
      // After keyword-matched topics, load up to 3 related topics in summary mode.
      // Strict 1-hop: no recursion into related-of-related. Budget-guarded.
      const loadedSet = new Set(loadedTopics);
      const relatedCandidates: string[] = [];
      for (const topic of loadedTopics) {
        const { related } = keywordMap[topic] ?? { related: [] };
        for (const rel of related) {
          if (!loadedSet.has(rel) && !relatedCandidates.includes(rel)) {
            relatedCandidates.push(rel);
          }
        }
      }
      for (const relTopic of relatedCandidates.slice(0, 3)) {
        if (topicCharsUsed >= TOPIC_MEMORY_BUDGET) break;
        const content = await this.readTopicMemory(relTopic);
        if (content) {
          const summary = addTemporalMarkers(truncateTopicMemory(content, 'summary'));
          const section = `<topic-memory name="${relTopic}" via="related">\n${summary}\n</topic-memory>`;
          sections.push(section);
          topicCharsUsed += section.length;
          loadedTopics.push(relTopic);
        }
      }

      // ── Topic menu (JIT awareness) ──
      // Topics that exceeded budget are listed as a menu for on-demand loading in future cycles.
      if (topicMenuItems.length > 0) {
        sections.push(`<topic-menu>\n${topicMenuItems.join('\n')}\n</topic-menu>`);
      }

      this.loadedTopics = loadedTopics;
      const stimulusFingerprint = buildStimulusFingerprint(options?.trigger ?? null, loadedTopics);
      if (hasRecentStimulusFingerprint(stimulusFingerprint)) {
        sections.push('<stimulus-dedup>\nRecent cycles likely already addressed this same stimulus fingerprint. Avoid repeating the same response unless there is new information.\n</stimulus-dedup>');
      }
    } else {
      this.loadedTopics = [];
    }
    } // end of !isLight topic memory block

    // ── Task index（from memory-index, replaces NEXT.md）──
    const nextSection = await buildNextContextSection(this.memoryDir);
    if (nextSection) {
      sections.push(`<next>\n${nextSection}\n</next>`);
    }

    // ── 記憶和對話（總是載入，light mode 截斷）──
    const tieredMem = this.tieredMemoryContent(memory, contextHint);
    const memContent = isLight ? tieredMem.slice(0, 2000) : tieredMem;
    sections.push(`<memory>\n${memContent}\n</memory>`);
    sections.push(`<recent_conversations>\n${conversations || '(No recent conversations)'}\n</recent_conversations>`);
    // Phase 0 P0c: Use heartbeat diff instead of full content when available
    const hbDiff = options?.phase0Results?.heartbeatDiff;
    let hbContent: string;
    if (isLight) {
      hbContent = heartbeat?.slice(0, 1500) ?? '';
    } else if (hbDiff) {
      // P0c: Compressed heartbeat — diff summary + essential sections (Active Tasks header)
      const activeTasksMatch = heartbeat?.match(/## Active Tasks[\s\S]*?(?=\n## |$)/);
      const activeTasks = activeTasksMatch?.[0]?.slice(0, 1500) ?? '';
      hbContent = `## Changes Since Last Cycle\n${hbDiff}\n\n${activeTasks}`;
      eventBus.emit('log:info', {
        tag: 'preprocess', msg: `P0c: Heartbeat compressed from ${heartbeat?.length ?? 0} to ${hbContent.length} chars`,
      });
    } else {
      // Strip HTML comments and completed tasks — saves ~6K chars (71%) on typical HEARTBEAT.
      // Comments are human-readable notes; completed [x] tasks are historical.
      // Original file is untouched; only the context injection is trimmed.
      let hb = heartbeat ?? '';
      hb = hb.replace(/<!--[\s\S]*?-->\n?/g, '');
      hb = hb.split('\n').filter(l => !l.trim().startsWith('- [x]')).join('\n');
      hb = hb.replace(/\n{3,}/g, '\n\n');
      hbContent = hb;
    }
    sections.push(`<heartbeat>\n${hbContent}\n</heartbeat>`);

    // ── Reorder for prefix caching: stable sections first ──
    // Anthropic API auto-caches identical prompt prefixes (~5min TTL).
    // By placing rarely-changing sections at the start of context,
    // the cacheable prefix extends beyond the system prompt into context.
    // soul (~2K) + memory (~4-8K) + heartbeat (~2-4K) + workspace (~1K) + myelin + threads + memory-index ≈ 15-20K stable prefix.
    // Note: environment section (timestamp) changes every cycle — stays in restSections intentionally.
    const STABLE_FIRST = ['soul', 'memory', 'heartbeat', 'workspace', 'myelin-framework', 'threads', 'memory-index'];
    const stableSet = new Set(STABLE_FIRST);
    const stableBuckets = new Map<string, string>();
    const restSections: string[] = [];
    for (const s of sections) {
      const tag = s.match(/^<([\w-]+)>/)?.[1] ?? '';
      if (stableSet.has(tag)) {
        stableBuckets.set(tag, s);
      } else {
        restSections.push(s);
      }
    }
    const reorderedSections = [
      ...STABLE_FIRST.map(t => stableBuckets.get(t)).filter((s): s is string => s != null),
      ...restSections,
    ];

    bcMark('sectionsAssembled');
    let assembled = reorderedSections.join('\n\n');

    slog('CONTEXT', `mode=${mode} sections=${reorderedSections.length} size=${assembled.length}`);

    // ── Global context budget ──
    // Empirical: prompts <35K chars → 0% EXIT143, >50K → 100% EXIT143.
    // Budget is profile-aware. Caller can override with explicit contextBudget.
    const CONTEXT_BUDGET = options?.contextBudget ?? profileConfig.contextBudget ?? 25_000;
    if (assembled.length > CONTEXT_BUDGET) {
      // Priority-based trimming: remove lowest-value sections first, not brute truncation.
      // Order: topic-memory → pruned/unchanged → deep context → hard truncate as last resort.
      const overBy = assembled.length - CONTEXT_BUDGET;
      slog('CONTEXT', `Budget exceeded: ${assembled.length} > ${CONTEXT_BUDGET} (over by ${overBy}), trimming by priority`);

      // Pass 1: Trim topic-memory sections (largest, least essential)
      const topicPattern = /<topic-memory[^>]*>[\s\S]*?<\/topic-memory>/g;
      assembled = assembled.replace(topicPattern, (match) => {
        const nameMatch = match.match(/name="([^"]*)"/);
        const name = nameMatch?.[1] ?? 'unknown';
        return `<topic-memory name="${name}">\n[trimmed — context budget]\n</topic-memory>`;
      });

      // Pass 2: Remove low-priority sections entirely if still over budget
      if (assembled.length > CONTEXT_BUDGET) {
        const LOW_PRIORITY_TAGS = [
          // Tier 1: Metadata / navigation cruft — zero cognitive value
          'unchanged-perceptions', 'pruned-perceptions', 'topic-menu', 'stimulus-dedup',
          // Tier 2: Historical / activity — useful but not decision-critical
          'trail', 'recent-activity', 'route-efficiency', 'stale-tasks',
          'action-memory', 'context-health',
          // Tier 3: Identity / continuity — trim only if desperate
          'achievements', 'commitments', 'inner-voice',
          // Tier 4: Diagnostic — keep as long as possible (tells agent why it's struggling)
          'structural-health', 'decision-quality-warning', 'problem-alignment',
        ];
        for (const tag of LOW_PRIORITY_TAGS) {
          if (assembled.length <= CONTEXT_BUDGET) break;
          const tagPattern = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>\\n*`, 'g');
          assembled = assembled.replace(tagPattern, '');
        }
      }

      // Pass 3: Hard truncate as absolute last resort (should rarely reach here)
      if (assembled.length > CONTEXT_BUDGET) {
        assembled = assembled.slice(0, CONTEXT_BUDGET) + `\n\n[... context truncated at ${Math.round(CONTEXT_BUDGET / 1000)}K chars]`;
      }
    }

    bcMark('pipelineDone');

    // Emit PROFILE breakdown when buildContext takes meaningful time.
    // Shows which phase ate the budget — readCore / sectionsAssembled / pipelineDone.
    // Diffs: readCore = read SOUL/MEMORY/HEARTBEAT; sections-readCore = assembly
    // (shouldLoad checks, topic reads, perception cache reads, memory-index search);
    // pipeline-sections = priority trimming pass.
    const bcTotal = Date.now() - bcStart;
    if (bcTotal > 500) {
      const breakdown = [
        `total=${bcTotal}ms`,
        `enter=${bcMilestones.enter ?? 0}`,
        `readCore=${bcMilestones.readCore ?? 0}`,
        `sections=${bcMilestones.sectionsAssembled ?? 0}`,
        `pipeline=${bcMilestones.pipelineDone ?? 0}`,
      ].join(' ');
      slog('PROFILE', `buildContext#${options?.cycleCount ?? '?'} ${breakdown} trigger=${(options?.trigger ?? '').slice(0, 30)}`);
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
   * Minimal context — delegation-drain + emergency retry
   * 只載入：環境、核心身份、heartbeat (active tasks)、inbox、delegation results、
   *         task index、working memory、最近 3 則對話
   * 跳過：所有 perception、完整 memory、topic memory、完整 soul、achievements、coach
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
    sections.push(`<environment>\nCurrent time: ${timeStr} (${tz})\nInstance: ${this.instanceId}\n[MINIMAL CONTEXT: delegation-drain / emergency retry — soul + tasks + delegation results + inbox only]\n</environment>`);

    // Soul — 只取核心身份
    if (soul) {
      const soulContent = this.buildSoulContext(soul, '', 'minimal');
      sections.push(`<soul>\n${soulContent}\n</soul>`);
    }

    // Heartbeat — 只取 Active Tasks section（不是完整 HEARTBEAT）
    // 完整 HEARTBEAT 佔 ~8.5K，Active Tasks 只佔 ~2K
    if (heartbeat) {
      const activeTasksHeader = '## Active Tasks';
      const activeIdx = heartbeat.indexOf(activeTasksHeader);
      if (activeIdx !== -1) {
        // Find the next ## header after Active Tasks to extract just that section
        const afterActive = heartbeat.indexOf('\n## ', activeIdx + activeTasksHeader.length);
        const activeTasks = afterActive !== -1
          ? heartbeat.slice(activeIdx, afterActive).trim()
          : heartbeat.slice(activeIdx).trim();
        sections.push(`<heartbeat>\n# HEARTBEAT (minimal)\n\n${activeTasks}\n</heartbeat>`);
      } else {
        // Fallback: truncate to first 2000 chars
        sections.push(`<heartbeat>\n${heartbeat.slice(0, 2000)}\n[... truncated for minimal context ...]\n</heartbeat>`);
      }
    }

    // Unified Inbox（對話回覆需要看到收到的訊息）
    const inboxItems = readPendingInbox();
    const inboxCtx = formatInboxSection(inboxItems);
    if (inboxCtx) {
      sections.push(`<inbox>\n${inboxCtx}\n</inbox>`);
    }

    // Background Completed（delegation results — critical for delegation-drain cycles）
    const bgSection = buildBackgroundCompletedSection(this.instanceId);
    if (bgSection) {
      sections.push(`<background-completed>\n${bgSection}\n</background-completed>`);
    }

    // Task index（current tasks from memory-index）
    const nextSection = await buildNextContextSection(this.memoryDir, { minimal: true, runVerify: false });
    if (nextSection) {
      sections.push(`<next>\n${nextSection}\n</next>`);
    }

    // Working Memory（跨 cycle 工作記憶，<kuro:inner> 寫入）
    const innerNotesPath = path.join(this.memoryDir, 'inner-notes.md');
    try {
      if (existsSync(innerNotesPath)) {
        const innerContent = readFileSync(innerNotesPath, 'utf-8').trim();
        if (innerContent) {
          sections.push(`<working-memory>\n${innerContent}\n</working-memory>`);
        }
      }
    } catch { /* ignore */ }

    // 最近 3 則對話（minimal 只需最小上下文）
    const recentConvos = this.conversationBuffer
      .slice(-3)
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

  // brief: title + count + last 3 entries
  const recent = entries.slice(-3);
  return `${title}\n(${total} entries, latest)\n${recent.join('\n')}`;
}

// =============================================================================
// Background Completed — lane-output 結果讀取+清理
// =============================================================================

const LANE_OUTPUT_CAP = 2000; // chars cap for <background-completed> section

/** Read lane-output/ directory and format results for buildContext injection.
 *  Results persist for up to MAX_SHOW_COUNT cycles (with ⚠️ UNREVIEWED prefix
 *  after first show) so the main cycle has multiple chances to review them. */
const MAX_SHOW_COUNT = 3;

function buildBackgroundCompletedSection(instanceId: string): string | null {
  try {
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!existsSync(laneDir)) return null;

    const files = readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
    if (files.length === 0) return null;

    const results: Array<{ id: string; type?: string; status: string; output: string; confidence?: number; completedAt?: string; _isReminder?: boolean }> = [];
    const toDelete: string[] = [];
    const toUpdate: Array<{ filePath: string; data: Record<string, unknown> }> = [];

    for (const file of files) {
      try {
        const filePath = path.join(laneDir, file);
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const shownCount: number = data._shownCount ?? 0;

        if (shownCount >= MAX_SHOW_COUNT) {
          toDelete.push(filePath);
          continue;
        }

        data._shownCount = shownCount + 1;
        toUpdate.push({ filePath, data });
        results.push({ ...data, _isReminder: shownCount > 0 });
      } catch { continue; }
    }

    // Archive expired files to review backlog before deleting
    if (toDelete.length > 0) {
      const backlogPath = path.join(getInstanceDir(instanceId), 'review-backlog.jsonl');
      for (const f of toDelete) {
        try {
          const raw = readFileSync(f, 'utf-8');
          const data = JSON.parse(raw);
          const entry = {
            id: data.id ?? path.basename(f, '.json'),
            type: data.type,
            summary: extractDelegationSummaryInline(data.output || '', 150),
            archivedAt: new Date().toISOString(),
          };
          appendFileSync(backlogPath, JSON.stringify(entry) + '\n');
        } catch { /* best effort — still delete */ }
        try { unlinkSync(f); } catch { /* best effort */ }
      }
    }

    if (results.length === 0) return null;

    // Sort by completedAt (most recent first)
    results.sort((a, b) => {
      const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return tb - ta;
    });

    // Format with cap — reminders get shorter snippets to save context
    let totalChars = 0;
    const lines: string[] = [];
    for (const r of results) {
      const prefix = r._isReminder ? '⚠️ UNREVIEWED ' : '';
      const typeStr = r.type ? `[${r.type}]` : '';
      const confStr = r.confidence ? ` (confidence: ${r.confidence}/10)` : '';
      const snippetLen = r._isReminder ? 150 : 300;
      const outputSnippet = r.output.replace(/\n/g, ' ').slice(0, snippetLen);
      const line = `- ${prefix}${typeStr} ${r.id} ${r.status}${confStr}: ${outputSnippet}`;
      if (totalChars + line.length > LANE_OUTPUT_CAP && lines.length > 0) {
        lines.push(`(${results.length - lines.length} more results in lane-output/)`);
        break;
      }
      lines.push(line);
      totalChars += line.length;
    }

    // Write back updated shownCount (persist for review, don't delete on first read)
    for (const { filePath, data } of toUpdate) {
      try { writeFileSync(filePath, JSON.stringify(data), 'utf-8'); } catch { /* best effort */ }
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
// Delegation Summary Extraction (inline to avoid circular imports with delegation.ts)
// =============================================================================

/** Extract conclusion from delegation output instead of blindly taking first N chars. */
function extractDelegationSummaryInline(output: string, maxLen: number): string {
  if (!output) return '';
  let text = output
    .replace(/<ktml:thinking>[\s\S]*?<\/ktml:thinking>/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/\[forge\] merge skipped \([^)]*\)\s*$/, '')
    .trim();
  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  const m = text.match(/#{2,3}\s*(?:\d+\.\s*)?(?:FINAL ANSWER|Conclusion|結論|Summary|摘要|Key Findings?|Results?|結果)/i)
    ?? text.match(/(?:^|\n)\s*(?:結論|Conclusion|FINAL ANSWER)[：:]/i);
  if (m && m.index !== undefined) {
    const fromConclusion = text.slice(m.index).replace(/\n/g, ' ').trim();
    if (fromConclusion.length > 30) return fromConclusion.slice(0, maxLen);
  }
  if (/^(?:#{1,3}\s*(?:\d+\.\s*)?THINK|I am verifying|Let me (?:think|analyze|verify))/i.test(text.trim())) {
    return '…' + cleaned.slice(-(maxLen - 1));
  }
  return cleaned.slice(0, maxLen);
}

// =============================================================================
// Review Backlog — persistent tracking of unreviewed delegation results
// =============================================================================

const BACKLOG_TTL_MS = 7 * 24 * 3600_000; // 7 days

/** Remove backlog entries whose IDs appear in the response text. Also prune entries older than 7 days. */
export function clearReviewedDelegations(response: string, instanceId: string): void {
  try {
    const backlogPath = path.join(getInstanceDir(instanceId), 'review-backlog.jsonl');
    if (!existsSync(backlogPath)) return;

    const lines = readFileSync(backlogPath, 'utf-8').split('\n').filter(Boolean);
    if (lines.length === 0) return;

    const now = Date.now();
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Prune expired entries (7-day TTL)
        if (now - new Date(entry.archivedAt).getTime() > BACKLOG_TTL_MS) continue;
        // Prune if response mentions this delegation ID
        if (entry.id && response.includes(entry.id)) continue;
        kept.push(line);
      } catch { continue; }
    }

    if (kept.length === 0) {
      try { unlinkSync(backlogPath); } catch { /* best effort */ }
    } else if (kept.length < lines.length) {
      writeFileSync(backlogPath, kept.join('\n') + '\n');
    }
  } catch { /* best effort */ }
}

/** Read review backlog entries (for prompt injection). Returns entries within TTL. */
export function getReviewBacklog(instanceId: string): Array<{ id: string; type?: string; summary: string; archivedAt: string }> {
  try {
    const backlogPath = path.join(getInstanceDir(instanceId), 'review-backlog.jsonl');
    if (!existsSync(backlogPath)) return [];

    const lines = readFileSync(backlogPath, 'utf-8').split('\n').filter(Boolean);
    const now = Date.now();
    const entries: Array<{ id: string; type?: string; summary: string; archivedAt: string }> = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (now - new Date(entry.archivedAt).getTime() < BACKLOG_TTL_MS) {
          entries.push(entry);
        }
      } catch { continue; }
    }
    return entries;
  } catch { return []; }
}

// =============================================================================
// Trail — 注意力歷史（mushi + kuro 共寫的化學梯度）
// =============================================================================

export interface TrailReadEntry {
  ts: string;
  agent: string;
  type: string;
  decision?: string;
  topics: string[];
  detail: string;
  count?: number;
}

/** TrailEntry is the public alias for TrailReadEntry */
export type TrailEntry = TrailReadEntry;

/** Deduplicate trail entries: merge same pattern >3 times into single entry with count */
export function deduplicateTrailEntries(entries: TrailReadEntry[]): TrailReadEntry[] {
  if (entries.length <= 3) return entries;

  // Group by pattern key: agent + type + decision
  const groups = new Map<string, TrailReadEntry[]>();
  const order: string[] = [];

  for (const e of entries) {
    const key = `${e.agent}|${e.type}|${e.decision ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  const result: TrailReadEntry[] = [];
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
