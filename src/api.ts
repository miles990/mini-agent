/**
 * HTTP API Entry Point
 *
 * REST API for mini-agent with instance management
 */

// Load .env if present (Node 24+ native, no dotenv dep).
// Plist WorkingDirectory = ~/Workspace/mini-agent, so .env resolves relative to cwd.
// Failures (file missing / malformed) are silent — defaults still work.
try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch { /* no .env present, or unsupported Node — proceed with existing process.env */ }

import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import express, { type Request, type Response, type NextFunction } from 'express';

// Event loop lag monitor (P0 diagnostic — 2026-04-17).
// Resolution 20ms: samples every 20ms, accumulates histogram of scheduling delay.
// Active continuously once enabled; /health reads percentiles, /metrics/loop-lag
// can reset histogram for per-cycle diagnostics.
const loopLagHistogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
loopLagHistogram.enable();

interface LoopLagSnapshot {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
  stddev: number;
  samples: number;
}

function getLoopLagSnapshot(): LoopLagSnapshot {
  // perf_hooks returns nanoseconds; convert to ms for human readability
  const toMs = (ns: number) => Math.round(ns / 1_000_000);
  return {
    p50: toMs(loopLagHistogram.percentile(50)),
    p90: toMs(loopLagHistogram.percentile(90)),
    p99: toMs(loopLagHistogram.percentile(99)),
    max: toMs(loopLagHistogram.max),
    mean: toMs(loopLagHistogram.mean),
    stddev: toMs(loopLagHistogram.stddev),
    samples: loopLagHistogram.count,
  };
}

function resetLoopLagHistogram(): void {
  loopLagHistogram.reset();
}
import { isClaudeBusy, getCurrentTask, getProvider, getFallback, getProviderForSource, getLaneStatus, callClaude, killAllChildProcesses, preemptLoopCycle, abortForeground, startForegroundSweep, stopForegroundSweep } from './agent.js';
import {
  searchMemory,
  readMemory,
  readHeartbeat,
  updateHeartbeat,
  appendMemory,
  buildContext,
  addTask,
  createMemory,
  getMemory,
  getCapabilitiesSnapshot,
  readCatalog,
  readLibraryContent,
  findCitedBy,
} from './memory.js';
import { getConfig, updateConfig, resetConfig, DEFAULT_CONFIG } from './config.js';
import { MUSHI_HEALTH_URL } from './mushi-client.js';
import {
  getInstanceManager,
  loadInstanceConfig,
  updateInstanceConfig,
  listInstances,
  getCurrentInstanceId,
  getInstanceDir,
} from './instance.js';
import { getLogger, type LogType, type BehaviorLogEntry } from './logging.js';
import { getActiveCronTasks, addCronTask, removeCronTask, reloadCronTasks, startCronTasks, getCronTaskCount, getCronQueueSize, stopCronTasks } from './cron.js';
import { AgentLoop } from './loop.js';
import { parseInterval } from './cycle-tasks.js';
import { findComposeFile, readComposeFile } from './compose.js';
import { setSelfStatusProvider, setPerceptionProviders, setCustomExtensions, getMemoryStateDir } from './memory.js';
import { createTelegramPoller, getTelegramPoller, getNotificationStats } from './telegram.js';
import { searchEntities as kgSearchEntities, getEntityCard as kgGetEntityCard, getKgStats } from './kg-entity-search.js';
import { getIngestStats as kgGetIngestStats } from './kg-live-ingest.js';
import { query as kgQuery, formatReport as kgFormatReport } from './kg-query.js';
import {
  getProcessStatus, getLogSummary, getNetworkStatus, getConfigSnapshot,
  getActivitySummary,
  startNetworkStatusCollector, getNetworkStatusCached,
  startLogSummaryCollector, getLogSummaryCached, getLogStatsCached,
} from './workspace.js';
import { loadGlobalConfig, startHeartbeat, stopHeartbeat, updateInstanceHeartbeat } from './instance.js';
import { stopMemoryCache } from './memory-cache.js';
import { initClaudeMdJIT } from './claudemd-jit.js';
import type { CreateInstanceOptions, InstanceConfig, CronTask } from './types.js';
import { initObservability, writeRoomMessage } from './observability.js';
import { preprocessMessage } from './preprocessor.js';
import { initFeatures, isEnabled, setEnabled, toggle, getFeatureReport, getFeature, resetStats, getFeatureNames } from './features.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams, IMPORTANT_PERCEPTION_NAMES } from './perception-stream.js';
import { writeInboxItem } from './inbox.js';
import { getMode, setMode, isValidMode, setLoopController, getModeNames, type ModeName } from './mode.js';
import { postProcess } from './dispatcher.js';
import { initActivityJournal, writeActivity, readRecentActivity } from './activity-journal.js';
import { killAllDelegations } from './delegation.js';
import { forgeStatus } from './forge.js';
import { getNowTaskSummary, getTasksSnapshot, enqueueRoomDirective, createTask, updateTask, queryMemoryIndexSync, deleteMemoryIndexEntry, createGoal } from './memory-index.js';

// =============================================================================
// Server Log Helper (re-exported from utils to avoid circular deps)
// =============================================================================

export { slog, setSlogPrefix } from './utils.js';
import { slog, setSlogPrefix, diagLog } from './utils.js';
import { startEventLoopLagMonitor, slowRequestMiddleware, startStateSampler } from './diagnostics.js';
import { queryTimeline, type TimelineEventType } from './timeline.js';
import { getProvenance, resolveMemoryId } from './memory-provenance-query.js';
import { getSchedulerState, getTopPending, getSchedulerHistory } from './scheduler.js';
import { getHealthSignals } from './pulse.js';
import { getStarvationMetrics } from './reactive-policies.js';
import { getTodayActivity, getActivityByContext } from './activity-stream.js';
import { getProcessTableSnapshot } from './process-table.js';

// =============================================================================
// AgentLoop reference (set by cli.ts or external caller)
// =============================================================================

let loopRef: AgentLoop | null = null;

export function setLoopRef(loop: AgentLoop | null): void {
  loopRef = loop;
  if (loop) {
    setLoopController({ pause: () => loop.pause(), resume: () => loop.resume() });
  }
}

// =============================================================================
// Security Middleware
// =============================================================================

/**
 * API Key authentication middleware
 * Set MINI_AGENT_API_KEY env var to enable
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.MINI_AGENT_API_KEY;

  // Skip auth if no API key configured
  if (!apiKey) {
    next();
    return;
  }

  // Allow health endpoint and media files without auth
  if (req.path === '/health' || req.path.startsWith('/api/media/')) {
    next();
    return;
  }

  const provided = req.headers['x-api-key'] as string
    ?? req.headers['authorization']?.replace('Bearer ', '')
    ?? (req.query.key as string | undefined);  // EventSource can't send headers — accept query param for SSE

  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }

  next();
}

/**
 * Simple rate limiter (in-memory, per IP)
 */
function createRateLimiter(maxRequests = 60, windowMs = 60_000) {
  const requests = new Map<string, { count: number; resetAt: number }>();

  // Paths exempt from rate limiting (polling/streaming endpoints)
  const exempt = new Set(['/health', '/status', '/api/events', '/api/room/stream']);
  // GET-only exemptions (read-only polling used by MCP agent_discuss)
  const exemptGet = new Set(['/api/room', '/context', '/logs']);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (exempt.has(req.path)) { next(); return; }
    if (req.method === 'GET' && exemptGet.has(req.path)) { next(); return; }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    const entry = requests.get(ip);
    if (!entry || now > entry.resetAt) {
      requests.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    next();
  };
}

// =============================================================================
// Journal Entry Parser
// =============================================================================

interface JournalEntry {
  topic: string;
  date: string;
  title: string;
  summary: string;
  opinion: string;
  urls: string[];
  category: 'learning' | 'action' | 'issue' | 'lesson';
}

interface CognitionEntry {
  timestamp: string;
  actor: 'agent' | 'user' | 'system';
  route: 'autonomous' | 'task';
  modeTag: string | null;
  decision: string;
  what: string;
  why: string;
  thinking: string;
  changed: string;
  verified: string;
  next: string;
  sources: string[];
  basis: string[];
  full: string;
  observabilityScore: number;
}

function parseEntry(raw: string, topic: string, filterDate: string, entries: JournalEntry[]): void {
  // Extract date: "- [YYYY-MM-DD] Title — content"
  const dateMatch = raw.match(/^- \[(\d{4}-\d{2}-\d{2})\]\s*/);
  if (!dateMatch) return;

  const entryDate = dateMatch[1];
  if (entryDate !== filterDate) return;

  const body = raw.slice(dateMatch[0].length);

  // Extract title (before first —, or first sentence)
  const dashIdx = body.indexOf('—');
  const parenIdx = body.indexOf('（');
  let title: string;
  let rest: string;

  if (dashIdx > 0 && dashIdx < 120) {
    title = body.slice(0, dashIdx).trim();
    rest = body.slice(dashIdx + 1).trim();
  } else if (parenIdx > 0 && parenIdx < 120) {
    title = body.slice(0, parenIdx).trim();
    rest = body.slice(parenIdx).trim();
  } else {
    const firstPeriod = body.indexOf('。');
    if (firstPeriod > 0 && firstPeriod < 150) {
      title = body.slice(0, firstPeriod + 1).trim();
      rest = body.slice(firstPeriod + 1).trim();
    } else {
      title = body.slice(0, 100).trim();
      rest = body.slice(100).trim();
    }
  }

  // Extract URLs (來源：... pattern or inline https://)
  const urls: string[] = [];
  const sourceMatch = rest.match(/來源[：:]\s*(.+?)$/m);
  if (sourceMatch) {
    const sourceStr = sourceMatch[1];
    // URLs can be comma-separated or space-separated
    const urlMatches = sourceStr.match(/(?:https?:\/\/)?[\w.-]+\.(?:com|org|net|io|dev|ai|space|html?|md|pdf)[\w/.-]*/g);
    if (urlMatches) {
      for (const u of urlMatches) {
        urls.push(u.startsWith('http') ? u : `https://${u}`);
      }
    }
  }
  // Also extract inline URLs
  for (const m of rest.matchAll(/https?:\/\/[^\s)>\],]+/g)) {
    if (!urls.includes(m[0])) urls.push(m[0]);
  }

  // Extract opinion (我的觀點：/ 我的看法：/ 核心洞見：/ 最深洞見：)
  const opinionMatch = rest.match(/(?:我的觀點|我的看法|核心洞見|最深洞見|核心發現|跟\s*mini-agent)[：:]\s*(.+?)(?=\n|來源|詳見|$)/s);
  const opinion = opinionMatch?.[1]?.trim().slice(0, 500) || '';

  // Classify entry
  let category: JournalEntry['category'] = 'learning';
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes('修正') || lowerBody.includes('教訓') || lowerBody.includes('錯誤') || lowerBody.includes('驗證紀律')) {
    category = 'lesson';
  } else if (lowerBody.includes('問題') || lowerBody.includes('缺陷') || lowerBody.includes('風險') || lowerBody.includes('bug')) {
    category = 'issue';
  } else if (lowerBody.includes('部署') || lowerBody.includes('實作') || lowerBody.includes('完成') || lowerBody.includes('改動')) {
    category = 'action';
  }

  // Build summary — clean up markdown formatting for readability
  let summary = rest
    .replace(/來源[：:].+$/m, '')
    .replace(/詳見\s*research\/.+$/m, '')
    .trim();
  if (summary.length > 800) summary = summary.slice(0, 800) + '...';

  entries.push({ topic, date: entryDate, title, summary, opinion, urls, category });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickSection(detail: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = escapeRegex(label);

    // Markdown style: **What**: ...
    const md = new RegExp(`\\*\\*${escaped}\\*\\*:\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z][A-Za-z\\s-]{1,24}\\*\\*:|$)`, 'i');
    const mdMatch = detail.match(md);
    if (mdMatch?.[1]?.trim()) return mdMatch[1].trim();

    // Plain style: What: ...
    const plain = new RegExp(`(?:^|\\n)\\s*${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Za-z][A-Za-z\\s-]{1,24}:|$)`, 'i');
    const plainMatch = detail.match(plain);
    if (plainMatch?.[1]?.trim()) return plainMatch[1].trim();

    // Heading style: ## What\n...
    const heading = new RegExp(`(?:^|\\n)##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const headingMatch = detail.match(heading);
    if (headingMatch?.[1]?.trim()) return headingMatch[1].trim();
  }
  return '';
}

function parseSources(detail: string): string[] {
  const found = new Set<string>();
  for (const m of detail.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    found.add(m[0]);
  }
  const sourceLine = pickSection(detail, ['Source', 'Sources', '來源']);
  for (const m of sourceLine.matchAll(/https?:\/\/[^\s)>\],]+/g)) {
    found.add(m[0]);
  }
  return Array.from(found);
}

/**
 * Extract prior knowledge references from action text.
 * Matches patterns like:
 *   - "跟 X 同構" / "跟 X 呼應" / "跟 X 一致"
 *   - "之前讀的 X" / "之前學的 X"
 *   - "X（YYYY-MM-DD）" or "X (YYYY-MM-DD Study)"
 *   - "來自 X 研究" / "基於 X"
 *   - Explicit topic references like "agent-architecture:CodeRLM"
 */
function parseBasis(detail: string): string[] {
  const found = new Set<string>();

  // Cross-reference patterns: "跟 X 同構/呼應/一致/平行/互補/連結/吻合"
  for (const m of detail.matchAll(/跟(?:\s*(?:我)?之前(?:讀|學)(?:過)?(?:的)?)?[「「]?\s*(.+?)\s*[」」]?\s*(?:同構|呼應|一致|平行|互補|連結|吻合|有關|相關)/g)) {
    const ref = m[1].trim().slice(0, 80);
    if (ref.length >= 3) found.add(ref);
  }

  // "之前讀/學的 X" pattern
  for (const m of detail.matchAll(/之前(?:讀|學)(?:過)?(?:的)?\s*(?:\*\*)?(.+?)(?:\*\*)?(?:\s*(?:比較|分析|觀點|觀察|高度|完全))/g)) {
    const ref = m[1].trim().slice(0, 80);
    if (ref.length >= 3) found.add(ref);
  }

  // Topic entry references: "topic:entry" format
  for (const m of detail.matchAll(/([a-z-]+):([A-Z][A-Za-z0-9\s-]+)/g)) {
    found.add(`${m[1]}:${m[2].trim()}`);
  }

  // Dated study references: "Title（YYYY-MM-DD Study）" or "Title (YYYY-MM-DD)"
  for (const m of detail.matchAll(/(?:\*\*)?([^*\n]+?)(?:\*\*)?\s*[（(]\s*(\d{4}-\d{2}-\d{2})(?:\s*Study)?\s*[）)]/g)) {
    const title = m[1].trim();
    if (title.length >= 3 && title.length <= 80) {
      found.add(`${title} (${m[2]})`);
    }
  }

  return Array.from(found);
}

function parseCognitionEntry(entry: BehaviorLogEntry): CognitionEntry | null {
  const action = entry.data.action;
  if (action !== 'action.autonomous' && action !== 'action.task') return null;

  const full = entry.data.detail || '';
  const modeTagMatch = full.match(/^\s*\[([a-z0-9-]+)\]/i);
  const modeTag = modeTagMatch?.[1]?.toLowerCase() ?? null;
  const route: 'autonomous' | 'task' = action === 'action.autonomous' ? 'autonomous' : 'task';

  // Parse decision — supports both [DECISION]...[/DECISION] tag and ## Decision heading
  const decisionTagMatch = full.match(/\[DECISION\]([\s\S]*?)\[\/DECISION\]/i);
  const decisionHeadingMatch = full.match(/##\s*Decision\s*\n([\s\S]*?)(?=\n##\s|\n\*\*[A-Z]|$)/i);
  const decision = (decisionTagMatch?.[1] ?? decisionHeadingMatch?.[1] ?? '').trim();

  const what = pickSection(full, ['What']);
  const why = pickSection(full, ['Why']);
  const thinking = pickSection(full, ['Thinking']);
  const changed = pickSection(full, ['Changed']);
  const verified = pickSection(full, ['Verified']);
  const next = pickSection(full, ['Next']);
  const sources = parseSources(full);
  const basis = parseBasis(full);

  const observabilityScore = [decision, what, why, thinking, changed, verified].filter(Boolean).length;

  return {
    timestamp: entry.timestamp,
    actor: entry.data.actor,
    route,
    modeTag,
    decision,
    what,
    why,
    thinking,
    changed,
    verified,
    next,
    sources,
    basis,
    full,
    observabilityScore,
  };
}

// =============================================================================
// Auto-detect ConversationThread from DM messages (all sources, conservative)
// =============================================================================

export async function autoDetectThread(text: string, source: string, msgId?: string): Promise<void> {
  const memory = getMemory();
  const hasQuestion = /[?？]/.test(text);
  const hasUrl = /https?:\/\/[^\s]+/.test(text);

  if (!hasQuestion && !hasUrl) return;

  const type = hasQuestion ? 'question' : 'share';
  await memory.addConversationThread({
    type,
    content: text.slice(0, 200),
    source,
    ...(msgId ? { roomMsgId: msgId } : {}),
  });
}

export function createApi(port = 3001): express.Express {
  const app = express();

  // Diagnostics: log any HTTP handler exceeding 500ms with concurrent event-loop lag.
  // Installed before routes so it covers every request, including /health and /status.
  app.use(slowRequestMiddleware);

  app.use(express.json({ limit: '1mb' }));

  // JSON parse error handler — body-parser 解析失敗時返回 400 而非噴 stack trace
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      slog('API', `JSON parse error: ${err.message} (${req.method} ${req.path})`);
      res.status(400).json({ error: `Invalid JSON: ${err.message}` });
      return;
    }
    next(err);
  });

  // =============================================================================
  // Claude Code HTTP Hooks — before authMiddleware for graceful degradation
  // =============================================================================

  // Helper: build compact agent status line
  function buildAgentStatusLine(): string {
    const mode = getMode();
    const loopStatus = loopRef ? loopRef.getStatus() : null;
    return `${mode.mode} | running=${loopStatus?.running ?? false} | cycles=${loopStatus?.cycleCount ?? 0} | busy=${isClaudeBusy()}`;
  }

  // Helper: get cached perception output by plugin name (≤ maxLen chars)
  function getCachedPerception(name: string, maxLen = 200): string | null {
    const results = perceptionStreams.getCachedResults();
    const found = results.find(r => r.name === name);
    if (!found?.output) return null;
    const out = found.output.trim();
    return out.length > maxLen ? out.slice(0, maxLen) + '...' : out;
  }

  /**
   * Room diff for Claude Code — messages addressed to CC that CC hasn't seen yet.
   *
   * Constraint Texture: deterministic side does JSONL IO, filtering, cursor
   * persistence. The LLM side (CC) decides what to do with the diff. This mirrors
   * Kuro's perception-first model: Kuro reads session JSONL to see CC's drafts;
   * this lets CC read the room to see Kuro's replies — symmetric awareness
   * without blocking RPC.
   *
   * Filter: from != 'claude-code' AND (from === agentNameLower OR text mentions
   * @cc / @claude-code). Cap per-message to avoid context bloat.
   */
  function getRoomDiffForCC(agentNameLower: string, maxPerMsg = 800, maxMsgs = 5): string {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const convPath = path.join(process.cwd(), 'memory', 'conversations', `${today}.jsonl`);
      if (!fs.existsSync(convPath)) return '';

      const cursorPath = path.join(getInstanceDir(getCurrentInstanceId()), 'cc-room-cursor.txt');
      let lastSeenId = '';
      try {
        if (fs.existsSync(cursorPath)) lastSeenId = fs.readFileSync(cursorPath, 'utf-8').trim();
      } catch { /* first run — empty cursor */ }

      const raw = fs.readFileSync(convPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);

      const diffs: Array<{ id: string; from: string; text: string; replyTo?: string }> = [];
      let latestId = lastSeenId;
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (!msg.id) continue;
          if (lastSeenId && msg.id <= lastSeenId) continue;
          if (msg.from === 'claude-code') continue;  // CC's own messages don't need echoing
          const text = String(msg.text || '');
          const addressedToCC = msg.from === agentNameLower
            || /@cc\b|@claude-code\b/i.test(text);
          if (!addressedToCC) continue;
          diffs.push({ id: msg.id, from: msg.from, text, replyTo: msg.replyTo });
          if (msg.id > latestId) latestId = msg.id;
        } catch { /* malformed line */ }
      }

      // Always advance cursor past all processed rows (even non-matching) so
      // we don't re-scan from scratch next call. Use the raw latest row.
      try {
        const lastRaw = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
        const tip = lastRaw?.id ?? latestId;
        if (tip && tip !== lastSeenId) {
          fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
          fs.writeFileSync(cursorPath, String(tip));
        }
      } catch { /* cursor write is best-effort */ }

      if (diffs.length === 0) return '';

      const trimmed = diffs.slice(-maxMsgs);
      const formatted = trimmed.map((m) => {
        const body = m.text.length > maxPerMsg ? m.text.slice(0, maxPerMsg) + '…' : m.text;
        const thread = m.replyTo ? ` ↩${m.replyTo}` : '';
        return `  [${m.id} ${m.from}${thread}] ${body}`;
      }).join('\n');
      const elided = diffs.length > maxMsgs ? ` (+${diffs.length - maxMsgs} earlier)` : '';
      return `New room messages for you since last prompt${elided}:\n${formatted}`;
    } catch { return ''; }
  }

  // Helper: get recent agent reply from today's Chat Room JSONL
  function getRecentAgentReply(agentNameLower: string, maxLen = 200): string {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const convPath = path.join(process.cwd(), 'memory', 'conversations', `${today}.jsonl`);
      if (!fs.existsSync(convPath)) return '';
      const raw = fs.readFileSync(convPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const msg = JSON.parse(lines[i]);
          if (msg.from === agentNameLower) {
            const text = msg.text || '';
            return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* non-critical */ }
    return '';
  }

  // Helper: get task summary from memory-index
  function getNextNowSummary(maxLen = 150): string {
    try {
      const memDir = path.join(process.cwd(), 'memory');
      return getNowTaskSummary(memDir, maxLen);
    } catch { return ''; }
  }

  // Helper: count pending inbox items
  function getPendingInboxSummary(): string {
    const dataDir = path.join(os.homedir(), '.mini-agent');
    const inboxes = [
      { path: path.join(dataDir, 'chat-room-inbox.md'), source: 'room' },
      { path: path.join(dataDir, 'claude-code-inbox.md'), source: 'claude-code' },
    ];
    const counts: string[] = [];
    for (const inbox of inboxes) {
      try {
        if (!fs.existsSync(inbox.path)) continue;
        const content = fs.readFileSync(inbox.path, 'utf-8').trim();
        if (!content) continue;
        const lines = content.split('\n').filter(l => l.trim()).length;
        counts.push(`${inbox.source}:${lines}`);
      } catch { /* skip */ }
    }
    return counts.length > 0 ? counts.join(', ') : '';
  }

  app.post('/api/hooks/claude-code', (_req: Request, res: Response) => {
    try {
      // Self-managed auth — graceful degradation (200 empty on failure, not 401)
      const apiKey = process.env.MINI_AGENT_API_KEY;
      if (apiKey) {
        const provided = _req.headers['x-api-key'] as string
          ?? _req.headers['authorization']?.replace('Bearer ', '');
        if (!provided || provided !== apiKey) {
          res.status(200).json({});
          return;
        }
      }

      const body = _req.body as Record<string, unknown>;
      const hookEvent = (body.hook_event_name as string) || 'unknown';

      // Get agent identity
      const instanceId = getCurrentInstanceId();
      const config = loadInstanceConfig(instanceId);
      const name = config?.name || 'Agent';
      const nameLower = name.toLowerCase();

      // ── Event dispatch ──
      switch (hookEvent) {

        // ── SessionStart: fullest context ──
        case 'SessionStart': {
          const laneStatus = getLaneStatus();
          const parts: string[] = [
            `[${name} 即時狀態]`,
            `Agent: ${buildAgentStatusLine()}`,
          ];

          if (laneStatus.foreground.busy) {
            const fgCount = laneStatus.foreground.activeCount;
            const fgTask = laneStatus.foreground.task?.prompt?.slice(0, 60) || 'unknown';
            parts.push(`Foreground: ${fgCount} active (${fgTask})`);
          }

          const recentReply = getRecentAgentReply(nameLower);
          if (recentReply) parts.push(`${name} 最近回覆: ${recentReply}`);

          const inboxSummary = getPendingInboxSummary();
          if (inboxSummary) parts.push(`Pending inbox: ${inboxSummary}`);

          const nowSummary = getNextNowSummary();
          if (nowSummary) parts.push(`Current task: ${nowSummary}`);

          const stateChanges = getCachedPerception('state-changes');
          if (stateChanges) parts.push(`Workspace: ${stateChanges}`);

          const gitDetail = getCachedPerception('git-detail');
          if (gitDetail) parts.push(`Git: ${gitDetail}`);

          parts.push(`MCP 工具: agent_discuss, agent_chat, agent_ask, agent_status, agent_context, agent_logs`);

          const context = parts.join('\n');
          res.json({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });

          // Notify Kuro that a Claude Code session started
          eventBus.emit('trigger:workspace', { source: 'claude-code-session-start' });
          slog('HOOK', `Claude Code SessionStart → ${context.length} chars`);
          break;
        }

        // ── UserPromptSubmit: prompt-aware injection ──
        case 'UserPromptSubmit': {
          const prompt = (body.prompt as string) || '';
          const parts: string[] = [`[${name}] ${buildAgentStatusLine()}`];

          // Perception-symmetric diff: let CC see room messages Kuro has sent
          // since last prompt — no blocking RPC needed. Cognitive side (CC
          // LLM) decides how to react.
          const roomDiff = getRoomDiffForCC(nameLower);
          if (roomDiff) parts.push(`[Room]\n${roomDiff}`);

          // Keyword matching for targeted context
          if (/deploy|部署|ci|push/i.test(prompt)) {
            const git = getCachedPerception('git-detail', 300);
            if (git) parts.push(`[Git] ${git}`);
          }
          if (/kuro|agent|loop|cycle|mode/i.test(prompt)) {
            const loopStatus = loopRef ? loopRef.getStatus() : null;
            if (loopStatus) {
              parts.push(`[Loop] interval=${loopStatus.currentInterval ?? '?'}ms, lastAction=${loopStatus.lastAction ?? '?'}`);
            }
          }
          if (/memory|記憶|topic|remember/i.test(prompt)) {
            const inboxSummary = getPendingInboxSummary();
            if (inboxSummary) parts.push(`[Inbox] ${inboxSummary}`);
          }
          if (/handoff|task|pr|issue|github/i.test(prompt)) {
            const gh = getCachedPerception('github-issues', 300);
            if (gh) parts.push(`[GitHub] ${gh}`);
          }
          if (/status|狀態|health/i.test(prompt)) {
            const laneStatus = getLaneStatus();
            parts.push(`[Lanes] loop=${laneStatus.loop.busy ? 'busy' : 'idle'}, fg=${laneStatus.foreground.activeCount}/${laneStatus.foreground.maxConcurrent}`);
          }

          const context = parts.join('\n');
          res.json({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } });
          break;
        }

        // ── PreToolUse: sensitive path protection + busy warning ──
        case 'PreToolUse': {
          const toolName = (body.tool_name as string) || '';
          const toolInput = (body.tool_input as Record<string, unknown>) || {};

          // File protection for Edit/Write
          if (/^(Edit|Write)$/.test(toolName)) {
            const filePath = (toolInput.file_path as string) || '';
            if (/SOUL\.md|\.env|auth-backup|credentials/i.test(filePath)) {
              res.json({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  decision: 'ask',
                  reason: `⚠️ 敏感檔案: ${path.basename(filePath)} — 確認是否要修改？`,
                },
              });
              slog('HOOK', `PreToolUse PROTECT: ${toolName} → ${filePath}`);
              break;
            }
          }

          // Bash command protection
          if (toolName === 'Bash') {
            const cmd = (toolInput.command as string) || '';
            if (/kill.*mini-agent|launchctl.*(remove|stop).*mini-agent|rm\s+(-rf?\s+)?.*memory\//i.test(cmd)) {
              res.json({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  decision: 'ask',
                  reason: `⚠️ 危險操作偵測 — 確認是否要執行？`,
                },
              });
              slog('HOOK', `PreToolUse PROTECT: Bash → ${cmd.slice(0, 80)}`);
              break;
            }
          }

          // Pass-through with optional busy warning
          if (isClaudeBusy() && /^(Edit|Write|Bash)$/.test(toolName)) {
            res.json({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                additionalContext: `⚡ ${name} cycle 進行中 — file changes 會觸發 workspace trigger`,
              },
            });
          } else {
            res.status(200).json({});
          }
          break;
        }

        // ── PostToolUse: typecheck reminder for .ts files ──
        case 'PostToolUse': {
          const toolName = (body.tool_name as string) || '';
          const toolInput = (body.tool_input as Record<string, unknown>) || {};
          const filePath = (toolInput.file_path as string) || '';

          if (/^(Edit|Write)$/.test(toolName) && filePath.endsWith('.ts')) {
            res.json({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: 'TypeScript file modified — run pnpm typecheck before committing',
              },
            });
          } else {
            res.status(200).json({});
          }
          break;
        }

        // ── Stop: notify Kuro session ended ──
        case 'Stop': {
          eventBus.emit('trigger:workspace', { source: 'claude-code-session-stop' });
          slog('HOOK', 'Claude Code session stopped');
          res.status(200).json({});
          break;
        }

        // ── Unknown event: graceful pass-through ──
        default: {
          res.status(200).json({});
          break;
        }
      }
    } catch (error) {
      // Graceful degradation — never block Claude Code
      slog('ERROR', `Hook failed: ${error instanceof Error ? error.message : error}`);
      res.status(200).json({});
    }
  });

  app.use(authMiddleware);
  app.use(createRateLimiter());

  // Request logging middleware (skip noisy polling endpoints)
  const SILENT_PATHS = new Set(['/health', '/status', '/api/dashboard/behaviors', '/api/dashboard/learning', '/api/dashboard/journal', '/api/dashboard/cognition', '/api/dashboard/capabilities', '/api/dashboard/context', '/api/dashboard/inner-state', '/api/events', '/api/room/stream', '/api/memory/structured', '/api/memory/history', '/api/memory/files']);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (SILENT_PATHS.has(req.path)) { next(); return; }
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      slog('API', `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // =============================================================================
  // Health & Info
  // =============================================================================

  app.get('/health', (_req: Request, res: Response) => {
    // D22 probe: log handler entry. If external curl times out but this
    // log appears, request reached handler → response stream / write failure.
    // If log never appears → request stuck before handler (middleware chain
    // or TCP accept queue).
    const t0 = performance.now();
    const lag = getLoopLagSnapshot();
    const payload = {
      status: 'ok',
      service: 'mini-agent',
      instance: getCurrentInstanceId(),
      loop_lag_ms: lag,
    };
    res.json(payload);
    const elapsed = Math.round(performance.now() - t0);
    if (elapsed > 50 || lag.p99 > 500) {
      slog('PROFILE', `/health handler ${elapsed}ms lag p99=${lag.p99}ms max=${lag.max}ms samples=${lag.samples}`);
    }
  });

  // /metrics/loop-lag — same metrics, dedicated endpoint for monitoring tools.
  // Pass ?reset=true to reset histogram after read (useful for per-cycle probe).
  app.get('/metrics/loop-lag', (req: Request, res: Response) => {
    const reset = req.query?.reset === 'true' || req.query?.reset === '1';
    const lag = getLoopLagSnapshot();
    if (reset) resetLoopLagHistogram();
    res.json({ loop_lag_ms: lag, reset_after_read: reset });
  });

  // /api/timeline — merged time-series event feed (F1 of Context Engine).
  // Query params: from, to (ISO 8601), types (comma-separated), limit.
  // Default window is last 24h, limit 500.
  app.get('/api/timeline', async (req: Request, res: Response) => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const typesParam = typeof req.query.types === 'string' ? req.query.types : '';
      const limitParam = typeof req.query.limit === 'string' ? req.query.limit : '';
      const types = typesParam
        ? (typesParam.split(',').map((t) => t.trim()).filter(Boolean) as TimelineEventType[])
        : undefined;
      const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
      const result = await queryTimeline({ from, to, types, limit: Number.isFinite(limit as number) ? limit : undefined });
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  });

  // /api/provenance — given memoryId or raw content, return provenance chain (B4).
  app.get('/api/provenance', async (req: Request, res: Response) => {
    try {
      const key = typeof req.query.key === 'string' ? req.query.key : '';
      if (!key) { res.status(400).json({ error: 'key query param required' }); return; }
      const chain = await getProvenance(key);
      res.json(chain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/provenance/resolve', (req: Request, res: Response) => {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!key) { res.status(400).json({ error: 'key query param required' }); return; }
    res.json({ memoryId: resolveMemoryId(key) });
  });

  // Unified status — 聚合所有子系統狀態 (OODA-Only)
  // --- Mushi health cache (refresh every 15s in background, /status reads cache) ---
  // Convergence condition: /status must always respond <100ms regardless of subsystem health.
  // Previous: await fetch(mushi) on every /status call → 2s timeout blocked event loop → kuro-live.sh timed out.
  let mushiCache: Record<string, unknown> | null = null;
  let mushiCacheAge = 0;
  const MUSHI_CACHE_TTL = 15_000;
  const refreshMushiCache = async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const mushiRes = await fetch(MUSHI_HEALTH_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      if (mushiRes.ok) mushiCache = await mushiRes.json() as Record<string, unknown>;
    } catch { mushiCache = null; }
    mushiCacheAge = Date.now();
  };
  // Initial fetch + periodic refresh
  refreshMushiCache();
  const mushiRefreshInterval = setInterval(refreshMushiCache, MUSHI_CACHE_TTL);
  mushiRefreshInterval.unref(); // Don't block process exit

  app.get('/status', (_req: Request, res: Response) => {
    const laneStatus = getLaneStatus();

    // Knowledge status — sync getter, no await
    let knowledge: Record<string, unknown> | null = null;
    try {
      // Dynamic import is cached by Node after first load — negligible cost
      const mod = require('./shared-knowledge.js') as { getKBStatus?: () => Record<string, unknown> };
      if (mod.getKBStatus) knowledge = mod.getKBStatus();
    } catch { /* not available */ }

    res.json({
      instance: getCurrentInstanceId(),
      uptime: Math.floor(process.uptime()),
      claude: {
        busy: isClaudeBusy(),
        loop: (() => {
          const l = laneStatus.loop;
          const startedAt = l?.task?.startedAt;
          return startedAt
            ? { ...l, cycleElapsedMs: Date.now() - new Date(startedAt).getTime() }
            : l;
        })(),
        foreground: laneStatus.foreground,
      },
      loop: loopRef ? { enabled: true, ...loopRef.getStatus() } : { enabled: false },
      cron: { active: getCronTaskCount(), queued: getCronQueueSize() },
      telegram: {
        connected: !!getTelegramPoller(),
        notifications: getNotificationStats(),
      },
      mushi: mushiCache,
      knowledge,
      forge: forgeStatus(process.cwd()),
      provider: {
        primary: getProvider(),
        fallback: getFallback(),
        codexModel: process.env.CODEX_MODEL || null,
        perSource: {
          loop: getProviderForSource('loop'),
          foreground: getProviderForSource('foreground'),
          ask: getProviderForSource('ask'),
        },
      },
      features: (() => {
        const report = getFeatureReport();
        const disabled = report.filter(f => !f.enabled).map(f => f.name);
        const topByTime = report
          .filter(f => f.stats.totalRuns > 0)
          .sort((a, b) => b.stats.totalMs - a.stats.totalMs)
          .slice(0, 5)
          .map(f => ({ name: f.name, totalMs: f.stats.totalMs, runs: f.stats.totalRuns, errors: f.stats.errors }));
        return { disabled, topByTime };
      })(),
    });
  });

  // =============================================================================
  // Route Efficiency — slime mold nutrient path metrics
  app.get('/api/routes', (_req: Request, res: Response) => {
    try {
      const { getRouteEfficiency } = require('./route-tracker.js');
      res.json(getRouteEfficiency());
    } catch (err) {
      res.status(500).json({ error: 'Route stats unavailable' });
    }
  });

  // Instance Management
  // =============================================================================

  // 取得當前實例信息
  app.get('/api/instance', (_req: Request, res: Response) => {
    const instanceId = getCurrentInstanceId();
    const config = loadInstanceConfig(instanceId);

    if (!config) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    res.json(config);
  });

  // 更新當前實例
  app.put('/api/instance', (req: Request, res: Response) => {
    const instanceId = getCurrentInstanceId();
    const updates = req.body as Partial<InstanceConfig>;

    // 不允許更改 ID
    delete updates.id;
    delete updates.createdAt;

    const updated = updateInstanceConfig(instanceId, updates);
    if (!updated) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    res.json({ success: true, instance: updated });
  });

  // 列表所有實例
  app.get('/api/instances', (_req: Request, res: Response) => {
    const manager = getInstanceManager();
    const instances = manager.listStatus();
    res.json(instances);
  });

  // 創建新實例
  app.post('/api/instances', async (req: Request, res: Response) => {
    const options = req.body as CreateInstanceOptions;
    const manager = getInstanceManager();

    try {
      const instance = await manager.create(options);
      res.json(instance);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create instance',
      });
    }
  });

  // 取得特定實例
  app.get('/api/instances/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const manager = getInstanceManager();
    const status = manager.getStatus(id);

    if (!status) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    res.json(status);
  });

  // 刪除實例
  app.delete('/api/instances/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const manager = getInstanceManager();

    try {
      const deleted = manager.delete(id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Instance not found' });
      }
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to delete instance',
      });
    }
  });

  // 啟動實例
  app.post('/api/instances/:id/start', async (req: Request, res: Response) => {
    const { id } = req.params;
    const manager = getInstanceManager();

    try {
      await manager.start(id);
      const status = manager.getStatus(id);
      res.json({ success: true, status });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to start instance',
      });
    }
  });

  // 停止實例
  app.post('/api/instances/:id/stop', (req: Request, res: Response) => {
    const { id } = req.params;
    const manager = getInstanceManager();

    manager.stop(id);
    res.json({ success: true });
  });

  // =============================================================================
  // Chat
  // =============================================================================

  // OODA-Only: /chat writes to inbox and triggers OODA cycle
  // Response will be delivered via Telegram (not HTTP)
  app.post('/chat', async (req: Request, res: Response) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    slog('CHAT', `← "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);

    try {
      // Write to claude-code-inbox (pending/processed format)
      const inboxPath = path.join(os.homedir(), '.mini-agent', 'claude-code-inbox.md');
      // Use local time so LLM perception context matches prompt's local time
      const now = new Date();
      const timestamp = now.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16);
      const entry = `- [${timestamp}] ${message}`;

      // Auto-init file with correct sections if needed
      let content = '';
      try {
        content = await fsPromises.readFile(inboxPath, 'utf-8');
      } catch { /* file doesn't exist yet */ }

      if (!content.includes('## Pending')) {
        content = `## Pending\n\n## Processed\n`;
      }

      // Insert entry after ## Pending line
      content = content.replace('## Pending\n', `## Pending\n${entry}\n`);
      await fsPromises.writeFile(inboxPath, content, 'utf-8');

      // Dual-write to unified inbox
      writeInboxItem({ source: 'claude-code', from: 'claude-code', content: message });

      // Auto-detect conversation threads from Claude Code questions/URLs (fire-and-forget)
      autoDetectThread(message, 'chat:claude-code').catch(() => {});

      // Emit trigger:chat to wake idle AgentLoop immediately
      emitChatTrigger({ source: 'chat-api', messageCount: 1 });

      slog('CHAT', `→ [inbox] message queued for OODA cycle`);
      res.status(202).json({
        content: '訊息已收到，將在下一個 OODA cycle 中處理。',
      });
    } catch (error) {
      slog('ERROR', `Chat failed: ${error instanceof Error ? error.message : error}`);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // =============================================================================
  // Memory
  // =============================================================================

  app.get('/memory', async (_req: Request, res: Response) => {
    const memory = await readMemory();
    res.json({ memory });
  });

  app.get('/memory/search', async (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'q parameter is required' });
      return;
    }

    // Limit query length to prevent abuse
    if (query.length > 200) {
      res.status(400).json({ error: 'Query too long (max 200 chars)' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string || '5', 10), 50);
    const results = await searchMemory(query, limit);
    res.json({ results });
  });

  app.post('/memory', async (req: Request, res: Response) => {
    const { content, section } = req.body;

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    await appendMemory(content, section);
    res.json({ success: true });
  });

  // =============================================================================
  // Memory Lab — 記憶視覺化 API
  // =============================================================================

  // Structured Memory — 解析 MEMORY.md 為結構化 sections
  app.get('/api/memory/structured', async (_req: Request, res: Response) => {
    try {
      const raw = await readMemory();
      const sections: Record<string, string> = {};
      let currentSection = '';
      const lines = raw.split('\n');

      for (const line of lines) {
        const heading = line.match(/^##\s+(.+)/);
        if (heading) {
          currentSection = heading[1].trim();
          sections[currentSection] = '';
        } else if (currentSection) {
          sections[currentSection] += line + '\n';
        }
      }

      // Trim trailing whitespace from each section
      for (const key of Object.keys(sections)) {
        sections[key] = sections[key].trimEnd();
      }

      res.json({ sections });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Memory History — git log for memory/ directory
  app.get('/api/memory/history', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string || '30', 10), 100);
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const cwd = process.cwd();
      const { stdout: raw } = await execAsync(
        `git log --pretty=format:'%H|||%ai|||%an|||%s' --name-only -n ${limit} -- memory/`,
        { cwd, encoding: 'utf-8', timeout: 5000 },
      );

      const history: Array<{ hash: string; date: string; author: string; subject: string; filesChanged: string[] }> = [];
      let current: { hash: string; date: string; author: string; subject: string; filesChanged: string[] } | null = null;

      for (const line of raw.split('\n')) {
        if (line.includes('|||')) {
          if (current) history.push(current);
          const [hash, date, author, subject] = line.split('|||');
          current = { hash, date, author, subject, filesChanged: [] };
        } else if (line.trim() && current) {
          current.filesChanged.push(line.trim());
        }
      }
      if (current) history.push(current);

      res.json({ history });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Memory Search — search through all memory files
  app.get('/api/memory/search', async (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'q parameter is required' });
      return;
    }
    if (query.length > 200) {
      res.status(400).json({ error: 'Query too long (max 200 chars)' });
      return;
    }

    try {
      const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const cwd = process.cwd();
      let grepOutput = '';
      try {
        const { stdout } = await execFileAsync(
          'grep', ['-rni', '--include=*.md', query, 'memory/'],
          { cwd, encoding: 'utf-8', timeout: 5000 },
        );
        grepOutput = stdout;
      } catch (err) {
        // grep exit 1 = no match, not an error
        const e = err as { code?: number; stdout?: string };
        if (e.code !== 1) throw err;
        grepOutput = e.stdout ?? '';
      }
      const raw = grepOutput.split('\n').slice(0, limit).join('\n').trim();

      const results: Array<{ file: string; line: number; content: string }> = [];
      if (raw) {
        for (const match of raw.split('\n')) {
          const m = match.match(/^(.+?):(\d+):(.+)$/);
          if (m) {
            results.push({ file: m[1], line: parseInt(m[2], 10), content: m[3].trim() });
          }
        }
      }

      res.json({ results, count: results.length, query });
    } catch (err) {
      // grep exit code 1 = no match (normal)
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 1) {
        res.json({ results: [], count: 0, query });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Memory Files — list all files in memory/
  app.get('/api/memory/files', async (_req: Request, res: Response) => {
    try {
      const memoryDir = path.join(process.cwd(), 'memory');
      const files: Array<{ name: string; path: string; size: number; modified: string }> = [];

      async function scanDir(dir: string, prefix: string): Promise<void> {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await scanDir(fullPath, relPath);
          } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) {
            const stat = await fsPromises.stat(fullPath);
            files.push({
              name: entry.name,
              path: relPath,
              size: stat.size,
              modified: stat.mtime.toISOString(),
            });
          }
        }
      }

      await scanDir(memoryDir, '');
      files.sort((a, b) => b.modified.localeCompare(a.modified));

      res.json({ files, count: files.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Memory File Content — read a specific memory file
  app.get('/api/memory/file/:path(*)', async (req: Request, res: Response) => {
    try {
      const filePath = req.params.path;

      // Security: prevent path traversal (resolve and verify prefix)
      const memoryRoot = path.resolve(process.cwd(), 'memory');
      const fullPath = path.resolve(memoryRoot, filePath);
      if (!fullPath.startsWith(memoryRoot + path.sep) && fullPath !== memoryRoot) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const content = await fsPromises.readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content, size: content.length });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // =============================================================================
  // Feature Toggles — 通用功能開關 + 計時
  // =============================================================================

  // GET /api/features — 全部功能狀態 + 計時統計
  app.get('/api/features', (_req: Request, res: Response) => {
    const report = getFeatureReport();
    const byGroup: Record<string, typeof report> = {};
    for (const f of report) {
      (byGroup[f.group] ??= []).push(f);
    }
    res.json({ features: report, byGroup });
  });

  // GET /api/features/:name — 單一功能詳情
  app.get('/api/features/:name', (req: Request, res: Response) => {
    const f = getFeature(req.params.name);
    if (!f) { res.status(404).json({ error: 'Unknown feature' }); return; }
    res.json(f);
  });

  // POST /api/features/:name — toggle 或明確設定
  // Body: {} (toggle) 或 { enabled: true/false }
  app.post('/api/features/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    if (!getFeature(name)) { res.status(404).json({ error: 'Unknown feature' }); return; }
    let newState: boolean;
    if (typeof req.body?.enabled === 'boolean') {
      newState = setEnabled(name, req.body.enabled);
    } else {
      newState = toggle(name);
    }

    // Live stop/start for pollers
    if (name === 'telegram-poller') {
      const poller = getTelegramPoller();
      if (poller) { newState ? poller.start() : poller.stop(); }
    }

    res.json({ name, enabled: newState });
  });

  // POST /api/features/:name/reset — 重設統計
  app.post('/api/features/:name/reset', (req: Request, res: Response) => {
    const name = req.params.name;
    if (!getFeature(name)) { res.status(404).json({ error: 'Unknown feature' }); return; }
    resetStats(name);
    res.json({ ok: true, name });
  });

  // POST /api/features/reset-all — 重設全部統計
  app.post('/api/features/reset-all', (_req: Request, res: Response) => {
    resetStats();
    res.json({ ok: true });
  });

  // =============================================================================
  // Mode — 冷靜/內斂/自主模式切換 (bundled feature toggles)
  // =============================================================================

  // GET /api/mode — 取得當前模式
  // =============================================================================
  // Mode persistence helpers
  // =============================================================================

  function getModeStatePath(): string {
    return path.join(os.homedir(), '.mini-agent', 'instances', getCurrentInstanceId(), 'mode.json');
  }

  function saveModeState(mode: ModeName): void {
    fsPromises.writeFile(getModeStatePath(), JSON.stringify({ mode }), 'utf-8').catch(() => {});
  }

  // GET /api/priority — 取得當前 priority focus
  app.get('/api/priority', (_req: Request, res: Response) => {
    const focusPath = path.join(getMemoryStateDir(), 'priority-focus.txt');
    try {
      if (fs.existsSync(focusPath)) {
        res.json({ focus: fs.readFileSync(focusPath, 'utf-8').trim() });
      } else {
        res.json({ focus: null });
      }
    } catch { res.json({ focus: null }); }
  });

  // POST /api/priority — 設定 priority focus
  // Body: { focus: string } or { focus: null } to clear
  app.post('/api/priority', (req: Request, res: Response) => {
    const { focus } = req.body ?? {};
    const focusPath = path.join(getMemoryStateDir(), 'priority-focus.txt');
    if (!focus) {
      try { fs.unlinkSync(focusPath); } catch { /* ok */ }
      slog('PRIORITY', 'Focus cleared');
      res.json({ ok: true, focus: null });
    } else {
      fs.writeFileSync(focusPath, String(focus).slice(0, 500), 'utf-8');
      slog('PRIORITY', `Focus set: ${String(focus).slice(0, 80)}`);
      res.json({ ok: true, focus: String(focus).slice(0, 500) });
    }
  });

  app.get('/api/mode', (_req: Request, res: Response) => {
    res.json(getMode());
  });

  // POST /api/mode — 切換模式
  // Body: { mode: 'calm' | 'reserved' | 'autonomous' }
  app.post('/api/mode', async (req: Request, res: Response) => {
    const { mode } = req.body ?? {};
    if (!mode || !isValidMode(mode)) {
      res.status(400).json({ error: `Invalid mode. Valid: ${getModeNames().join(', ')}` });
      return;
    }

    const previousMode = getMode().mode;
    const report = setMode(mode);

    const memory = getMemory();
    const memoryDir = memory.getMemoryDir();

    // autonomous → reserved: 自動寫入 tracking-notes.md（快照當前追蹤狀態）
    if (previousMode === 'autonomous' && mode === 'reserved') {
      void (async () => {
        try {
          // 擷取 in-progress 任務（from memory-index）
          const inProgressLines = getTasksSnapshot(path.join(process.cwd(), 'memory'));

          const snapshot = [
            '# Tracking Snapshot',
            '',
            `Captured: ${new Date().toISOString()}`,
            `Previous mode: ${previousMode}`,
            '',
            '## In-progress Tasks',
            inProgressLines || '（無）',
          ].join('\n');

          const trackingPath = path.join(memoryDir, 'tracking-notes.md');
          await fsPromises.writeFile(trackingPath, snapshot, 'utf-8');
          slog('MODE', 'tracking-notes.md snapshot written');
        } catch (e) {
          slog('ERROR', `tracking-notes snapshot failed: ${e instanceof Error ? e.message : e}`);
        }
      })();
    }

    // reserved → autonomous: inner-notes commit → 清空
    if (previousMode === 'reserved' && mode === 'autonomous') {
      void (async () => {
        try {
          const innerPath = path.join(memoryDir, 'inner-notes.md');
          let hasContent = false;
          try {
            const content = await fsPromises.readFile(innerPath, 'utf-8');
            hasContent = content.trim().length > 0;
          } catch { /* file may not exist */ }

          if (hasContent) {
            const { exec } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execAsync = promisify(exec);
            try {
              await execAsync(`git -C "${process.cwd()}" add "${innerPath}"`);
              await execAsync(
                `git -C "${process.cwd()}" commit -m "chore(inner): snapshot reserved working memory ${new Date().toISOString().slice(0, 10)}"`,
                { env: { ...process.env, GIT_AUTHOR_NAME: 'Kuro', GIT_AUTHOR_EMAIL: 'kuro@mini-agent', GIT_COMMITTER_NAME: 'Kuro', GIT_COMMITTER_EMAIL: 'kuro@mini-agent' } },
              );
              slog('MODE', 'inner-notes.md committed');
            } catch { /* no staged changes is ok */ }
            await fsPromises.writeFile(innerPath, '', 'utf-8');
            slog('MODE', 'inner-notes.md cleared');
          }
        } catch (e) {
          slog('ERROR', `inner-notes lifecycle failed: ${e instanceof Error ? e.message : e}`);
        }
      })();
    }

    // 持久化模式到磁碟（fire-and-forget）
    saveModeState(mode);

    res.json(report);
  });

  // =============================================================================
  // Library — 可調閱式來源藏書室
  // =============================================================================

  app.get('/api/library', async (req: Request, res: Response) => {
    const catalog = await readCatalog();
    const tag = req.query.tag as string | undefined;
    const filtered = tag ? catalog.filter(e => e.tags.includes(tag)) : catalog;
    res.json({ entries: filtered, count: filtered.length });
  });

  app.get('/api/library/stats', async (_req: Request, res: Response) => {
    const catalog = await readCatalog();
    const tagCounts: Record<string, number> = {};
    for (const entry of catalog) {
      for (const tag of entry.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const modeCounts: Record<string, number> = {};
    for (const entry of catalog) {
      modeCounts[entry.archiveMode] = (modeCounts[entry.archiveMode] || 0) + 1;
    }
    // Top cited: grep count for each entry
    const citedCounts: Array<{ id: string; title: string; count: number }> = [];
    for (const entry of catalog) {
      const refs = await findCitedBy(entry.id);
      if (refs.length > 0) citedCounts.push({ id: entry.id, title: entry.title, count: refs.length });
    }
    citedCounts.sort((a, b) => b.count - a.count);
    res.json({
      total: catalog.length,
      tags: tagCounts,
      modes: modeCounts,
      topCited: citedCounts.slice(0, 10),
    });
  });

  app.get('/api/library/:id/cited-by', async (req: Request, res: Response) => {
    const refs = await findCitedBy(req.params.id);
    res.json({ id: req.params.id, citedBy: refs, count: refs.length });
  });

  app.get('/api/library/:id', async (req: Request, res: Response) => {
    const { entry, content } = await readLibraryContent(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ entry, content });
  });

  // =============================================================================
  // Context
  // =============================================================================

  app.get('/context', async (_req: Request, res: Response) => {
    const context = await buildContext();
    res.json({ context });
  });

  // =============================================================================
  // Tasks
  // =============================================================================

  app.get('/tasks', async (_req: Request, res: Response) => {
    const heartbeat = await readHeartbeat();

    const tasks: Array<{ task: string; schedule?: string; completed: boolean }> = [];
    const lines = heartbeat.split('\n');

    for (const line of lines) {
      const unchecked = line.match(/^- \[ \] (.+?)(?:\s*\(([^)]+)\))?(?:\s*<!--.*-->)?$/);
      const checked = line.match(/^- \[x\] (.+?)(?:\s*\(([^)]+)\))?(?:\s*<!--.*-->)?$/);

      if (unchecked) {
        tasks.push({ task: unchecked[1].trim(), schedule: unchecked[2], completed: false });
      } else if (checked) {
        tasks.push({ task: checked[1].trim(), schedule: checked[2], completed: true });
      }
    }

    res.json({ tasks });
  });

  app.post('/tasks', async (req: Request, res: Response) => {
    const { task, schedule } = req.body;

    if (!task || typeof task !== 'string') {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    await addTask(task, schedule);
    res.json({ success: true, task, schedule });
  });

  // =============================================================================
  // Task Queue (memory-index based)
  // =============================================================================

  app.get('/api/task-queue', (_req: Request, res: Response) => {
    try {
      const memDir = path.join(process.cwd(), 'memory');
      const tasks = queryMemoryIndexSync(memDir, {
        type: ['task', 'goal'],
        status: ['pending', 'in_progress', 'completed', 'abandoned'],
      });
      res.json({ tasks });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/task-queue', async (req: Request, res: Response) => {
    try {
      const { title, type, status, priority, origin, assignee, blockedBy, verify_command, acceptance_criteria, goal_id } = req.body;
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      const memDir = path.join(process.cwd(), 'memory');
      const entry = await createTask(memDir, {
        type: type ?? 'task',
        title,
        status: status ?? 'pending',
        priority: priority !== undefined ? Number(priority) : undefined,
        origin: origin ?? 'task-board',
        assignee: assignee ?? undefined,
        blockedBy: Array.isArray(blockedBy) ? blockedBy : undefined,
        verify_command: verify_command ?? undefined,
        acceptance_criteria: acceptance_criteria ?? undefined,
        goal_id: goal_id ?? undefined,
      });
      eventBus.emit('action:task', { content: title, entry });
      res.json({ success: true, entry });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.patch('/api/task-queue/:id', async (req: Request, res: Response) => {
    try {
      const { title, status, priority, type, assignee, blockedBy, pinned, pinContext } = req.body;
      const memDir = path.join(process.cwd(), 'memory');
      const updated = await updateTask(memDir, req.params.id, {
        title,
        status,
        priority: priority !== undefined ? Number(priority) : undefined,
        type,
        assignee,
        blockedBy: Array.isArray(blockedBy) ? blockedBy : undefined,
        pinned: pinned !== undefined ? Boolean(pinned) : undefined,
        pinContext: pinContext !== undefined ? String(pinContext) : undefined,
      });
      if (!updated) {
        res.status(404).json({ error: 'task not found' });
        return;
      }
      eventBus.emit('action:task', { content: updated.summary, entry: updated });
      res.json({ success: true, entry: updated });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/task-queue/:id', async (req: Request, res: Response) => {
    try {
      const memDir = path.join(process.cwd(), 'memory');
      const ok = await deleteMemoryIndexEntry(memDir, req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'task not found' });
        return;
      }
      eventBus.emit('action:task', { content: `deleted:${req.params.id}` });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/goal', async (req: Request, res: Response) => {
    try {
      const { title, acceptance_criteria, verify_command, tasks } = req.body;
      if (!title || !acceptance_criteria || !Array.isArray(tasks)) {
        res.status(400).json({ error: 'title, acceptance_criteria, and tasks[] required' });
        return;
      }
      const memDir = path.join(process.cwd(), 'memory');
      const result = await createGoal(memDir, { title, acceptance_criteria, verify_command }, tasks);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/goals', (_req: Request, res: Response) => {
    try {
      const memDir = path.join(process.cwd(), 'memory');
      const allEntries = queryMemoryIndexSync(memDir, { type: ['goal', 'task'] });
      const goals = allEntries.filter(e => e.type === 'goal' && (e.payload as Record<string, unknown>)?.origin === 'pipeline');
      const result = goals.map(g => {
        const tasks = allEntries.filter(t => t.type === 'task' && (t.payload as Record<string, unknown>)?.goal_id === g.id);
        const done = tasks.filter(t => ['completed', 'done'].includes(t.status)).length;
        const blocked = tasks.filter(t => t.status === 'blocked').length;
        const pending = tasks.filter(t => t.status === 'pending').length;
        const inProgress = tasks.filter(t => t.status === 'in_progress').length;
        return {
          id: g.id, title: g.summary, status: g.status,
          acceptance_criteria: (g.payload as Record<string, unknown>)?.acceptance_criteria,
          progress: { total: tasks.length, done, blocked, pending, in_progress: inProgress },
          tasks: tasks.map(t => ({
            id: t.id, title: t.summary, status: t.status,
            verify_command: (t.payload as Record<string, unknown>)?.verify_command,
            blockedBy: (t.payload as Record<string, unknown>)?.blockedBy ?? [],
            ticksSinceLastProgress: (t.payload as Record<string, unknown>)?.ticksSinceLastProgress ?? 0,
          })),
        };
      });
      res.json({ goals: result });
    } catch {
      res.json({ goals: [] });
    }
  });

  // =============================================================================
  // Heartbeat
  // =============================================================================

  app.get('/heartbeat', async (_req: Request, res: Response) => {
    const heartbeat = await readHeartbeat();
    res.json({ heartbeat });
  });

  app.put('/heartbeat', async (req: Request, res: Response) => {
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    await updateHeartbeat(content);
    res.json({ success: true });
  });

  // =============================================================================
  // Cron
  // =============================================================================

  // 列出所有 cron 任務
  app.get('/cron', (_req: Request, res: Response) => {
    const tasks = getActiveCronTasks();
    res.json({ tasks, count: tasks.length });
  });

  // 新增 cron 任務
  app.post('/cron', (req: Request, res: Response) => {
    const { schedule, task, enabled } = req.body as CronTask;

    if (!schedule || !task) {
      res.status(400).json({ error: 'schedule and task are required' });
      return;
    }

    const result = addCronTask({ schedule, task, enabled });
    if (result.success) {
      res.json({ success: true, task: { schedule, task, enabled } });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  // 移除 cron 任務
  app.delete('/cron/:index', (req: Request, res: Response) => {
    const index = parseInt(req.params.index, 10);

    if (isNaN(index)) {
      res.status(400).json({ error: 'Invalid index' });
      return;
    }

    const result = removeCronTask(index);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: result.error });
    }
  });

  // 重新載入 cron 任務
  app.post('/cron/reload', (req: Request, res: Response) => {
    const { tasks } = req.body as { tasks: CronTask[] };

    if (!tasks || !Array.isArray(tasks)) {
      res.status(400).json({ error: 'tasks array is required' });
      return;
    }

    const result = reloadCronTasks(tasks);
    res.json({ success: true, ...result });
  });

  // =============================================================================
  // Config
  // =============================================================================

  app.get('/config', async (_req: Request, res: Response) => {
    const config = await getConfig();
    res.json({ config, defaults: DEFAULT_CONFIG });
  });

  app.put('/config', async (req: Request, res: Response) => {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'Invalid config object' });
      return;
    }

    const config = await updateConfig(updates);
    res.json({ success: true, config });
  });

  app.post('/config/reset', async (_req: Request, res: Response) => {
    const config = await resetConfig();
    res.json({ success: true, config });
  });

  // =============================================================================
  // Logs
  // =============================================================================

  // 取得日誌統計
  app.get('/logs', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const stats = await logger.getStats(date);
    const dates = await logger.getAvailableDates();
    res.json({ stats, availableDates: dates });
  });

  // 查詢所有類型日誌
  app.get('/logs/all', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.query({ date, limit });
    res.json({ entries, count: entries.length });
  });

  // 查詢 Claude 操作日誌
  app.get('/logs/claude', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.queryClaudeLogs(date, limit);
    res.json({ entries, count: entries.length });
  });

  // 查詢特定日期的 Claude 日誌
  app.get('/logs/claude/:date', async (req: Request, res: Response) => {
    const logger = getLogger();
    const { date } = req.params;
    const limit = parseInt(req.query.limit as string || '50', 10);

    // 驗證日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }

    const entries = logger.queryClaudeLogs(date, limit);
    res.json({ entries, count: entries.length, date });
  });

  // 查詢錯誤日誌
  app.get('/logs/errors', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.queryErrorLogs(date, limit);
    res.json({ entries, count: entries.length });
  });

  // 查詢 AgentLoop 日誌
  app.get('/logs/loop', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.queryLoopLogs(date, limit);
    res.json({ entries, count: entries.length });
  });

  // 查詢 Cron 任務日誌
  app.get('/logs/cron', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.queryCronLogs(date, limit);
    res.json({ entries, count: entries.length });
  });

  // 查詢 API 請求日誌
  app.get('/logs/api', async (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = logger.queryApiLogs(date, limit);
    res.json({ entries, count: entries.length });
  });

  // 取得可用的日誌日期
  app.get('/logs/dates', async (req: Request, res: Response) => {
    const logger = getLogger();
    const type = req.query.type as LogType | undefined;
    const dates = await logger.getAvailableDates(type);
    res.json({ dates });
  });

  // =============================================================================
  // AgentLoop Control
  // =============================================================================

  app.get('/loop/status', (_req: Request, res: Response) => {
    if (!loopRef) {
      res.json({ enabled: false });
      return;
    }
    res.json({ enabled: true, ...loopRef.getStatus() });
  });

  app.post('/loop/pause', (_req: Request, res: Response) => {
    if (!loopRef) {
      res.status(404).json({ error: 'AgentLoop not enabled' });
      return;
    }
    loopRef.pause();
    res.json({ success: true, status: loopRef.getStatus() });
  });

  app.post('/loop/resume', (_req: Request, res: Response) => {
    if (!loopRef) {
      res.status(404).json({ error: 'AgentLoop not enabled' });
      return;
    }
    loopRef.resume();
    res.json({ success: true, status: loopRef.getStatus() });
  });

  app.post('/loop/trigger', async (_req: Request, res: Response) => {
    if (!loopRef) {
      res.status(404).json({ error: 'AgentLoop not enabled' });
      return;
    }
    const action = await loopRef.trigger();
    res.json({ success: true, action, status: loopRef.getStatus() });
  });

  // Break: kill current running cycle immediately
  app.post('/loop/break', (_req: Request, res: Response) => {
    const loopResult = preemptLoopCycle();
    res.json({ success: true, loop: loopResult });
  });

  // Break foreground: kill a specific or oldest FG slot
  app.post('/fg/break', (_req: Request, res: Response) => {
    const slotId = (_req.query.slot as string) || undefined;
    const aborted = abortForeground(slotId);
    res.json({ success: true, aborted });
  });

  // Break all: kill loop + all FG slots
  app.post('/break', (_req: Request, res: Response) => {
    const loopResult = preemptLoopCycle();
    const lanes = getLaneStatus();
    let fgAborted = 0;
    for (const slot of lanes.foreground.slots) {
      if (abortForeground(slot.id)) fgAborted++;
    }
    res.json({ success: true, loop: loopResult, fgAborted });
  });

  // =============================================================================
  // Dashboard
  // =============================================================================

  // Activity Journal API — 跨 lane 活動時間線
  app.get('/api/activity', (_req: Request, res: Response) => {
    const limit = Math.min(parseInt(_req.query.limit as string || '20', 10), 50);
    const entries = readRecentActivity(limit);
    res.json({ entries, count: entries.length });
  });

  // Learning digest API — 從 behavior log 提取每日學習心得
  app.get('/api/dashboard/learning', (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string || undefined;
    const entries = logger.queryBehaviorLogs(date, 500);

    const digest = entries
      .map(parseCognitionEntry)
      .filter((e): e is CognitionEntry => e !== null)
      .map(e => {
        // Fallback: extract "chose:" line from full text when what is empty
        let what = e.what || e.changed || '';
        if (!what && e.full) {
          const choseMatch = e.full.match(/chose:\s*(.+?)(?:\n|$)/);
          if (choseMatch) what = choseMatch[1].trim();
        }
        return {
          timestamp: e.timestamp,
          what,
          why: e.why,
          changed: e.changed,
          verified: e.verified,
          urls: e.sources,
          full: e.full,
        };
      })
      .filter(e => !!e.what || !!e.why || !!e.changed || !!e.verified);

    res.json({ entries: digest, count: digest.length, date: date ?? new Date().toISOString().split('T')[0] });
  });

  // Journal API — 從 topic memory 提取結構化學習紀錄
  app.get('/api/dashboard/journal', async (req: Request, res: Response) => {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];
    const memory = getMemory();
    const entries: JournalEntry[] = [];
    const topics = await memory.listTopics();

    for (const topic of topics) {
      const content = await memory.readTopicMemory(topic);
      // Each entry starts with "- " and may contain [YYYY-MM-DD] date tags
      const lines = content.split('\n');
      let currentEntry = '';

      for (const line of lines) {
        if (line.startsWith('- [2')) {
          // New dated entry — flush previous and start new
          if (currentEntry) parseEntry(currentEntry, topic, date, entries);
          currentEntry = line;
        } else if (line.startsWith('- ')) {
          // Undated entry — flush previous and skip (old format)
          if (currentEntry) parseEntry(currentEntry, topic, date, entries);
          currentEntry = '';
        } else if (currentEntry && (line.startsWith('  ') || line === '')) {
          currentEntry += '\n' + line;
        }
      }
      if (currentEntry) parseEntry(currentEntry, topic, date, entries);
    }

    // Sort by date descending
    entries.sort((a, b) => b.date.localeCompare(a.date));

    res.json({ entries, count: entries.length, date });
  });

  // Behavior timeline API — dashboard 主要資料源
  app.get('/api/dashboard/behaviors', (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string || undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '200', 10), 500);
    const actor = req.query.actor as string || undefined;

    let entries = logger.queryBehaviorLogs(date, limit);

    if (actor) {
      entries = entries.filter(e => e.data.actor === actor);
    }

    res.json({ entries, count: entries.length, date: date ?? new Date().toISOString().split('T')[0] });
  });

  // Cognition API — 解析 agent 的動機/思考/行動/驗證鏈路
  app.get('/api/dashboard/cognition', (req: Request, res: Response) => {
    const logger = getLogger();
    const date = req.query.date as string || undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '200', 10), 500);
    const route = req.query.route as string || 'all';
    const mode = (req.query.mode as string || 'all').toLowerCase();

    const rawEntries = logger.queryBehaviorLogs(date, limit);
    let entries = rawEntries
      .map(parseCognitionEntry)
      .filter((e): e is CognitionEntry => e !== null);

    if (route === 'autonomous' || route === 'task') {
      entries = entries.filter(e => e.route === route);
    }
    if (mode !== 'all') {
      entries = entries.filter(e => e.modeTag === mode);
    }

    const stats = {
      total: entries.length,
      autonomous: entries.filter(e => e.route === 'autonomous').length,
      task: entries.filter(e => e.route === 'task').length,
      withDecision: entries.filter(e => !!e.decision).length,
      withWhy: entries.filter(e => !!e.why).length,
      withThinking: entries.filter(e => !!e.thinking).length,
      withVerified: entries.filter(e => !!e.verified).length,
      withBasis: entries.filter(e => e.basis.length > 0).length,
      avgObservabilityScore: entries.length > 0
        ? Number((entries.reduce((sum, e) => sum + e.observabilityScore, 0) / entries.length).toFixed(2))
        : 0,
    };

    res.json({
      entries,
      stats,
      count: entries.length,
      date: date ?? new Date().toISOString().split('T')[0],
      filters: { route, mode, limit },
    });
  });

  // Capability snapshot API — skills/plugins/provider/tool readiness + tool-use stats
  app.get('/api/dashboard/capabilities', async (_req: Request, res: Response) => {
    const snapshot = await getCapabilitiesSnapshot();
    res.json(snapshot);
  });

  // Forge slots — worktree allocation health for dashboard tile (W7 F-d)
  app.get('/api/dashboard/forge-slots', (_req: Request, res: Response) => {
    const status = forgeStatus(process.cwd());
    if (!status) {
      res.json({
        available: false,
        health: 'unavailable',
        status: null,
        saturationPct: 0,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const saturationPct = status.total > 0 ? Math.round((status.busy / status.total) * 100) : 0;
    const health = status.total === 0 ? 'unavailable'
      : status.free === 0 ? 'saturated'
      : saturationPct >= 75 ? 'pressured'
      : 'healthy';
    res.json({
      available: true,
      health,
      status,
      saturationPct,
      timestamp: new Date().toISOString(),
    });
  });

  // kuro-sense Environment Detection API
  app.get('/api/sense', async (_req: Request, res: Response) => {
    try {
      const senseBin = path.join(__dirname, '..', 'tools', 'kuro-sense', 'kuro-sense');
      if (!fs.existsSync(senseBin)) {
        res.status(503).json({ error: 'kuro-sense binary not found' });
        return;
      }
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(senseBin, ['detect', '--json'], { timeout: 15000 });
      res.json(JSON.parse(stdout));
    } catch {
      res.status(503).json({ error: 'kuro-sense not available' });
    }
  });

  // Perception Streams status — for dashboard observability
  app.get('/api/perception-streams', (_req: Request, res: Response) => {
    res.json(perceptionStreams.getStatus());
  });

  // Context Budget API — checkpoint 分析
  app.get('/api/dashboard/context', async (req: Request, res: Response) => {
    try {
      const memory = getMemory();
      const checkpointDir = path.join(memory.getMemoryDir(), 'context-checkpoints');

      if (!fs.existsSync(checkpointDir)) {
        res.json({ entries: [], summary: null });
        return;
      }

      // Read today's JSONL (or specified date)
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const filePath = path.join(checkpointDir, `${date}.jsonl`);

      if (!fs.existsSync(filePath)) {
        res.json({ entries: [], summary: null });
        return;
      }

      const content = await fsPromises.readFile(filePath, 'utf-8');
      const entries = content.trim().split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      // Aggregate section sizes across all entries
      const sectionTotals = new Map<string, { totalChars: number; count: number }>();
      for (const entry of entries) {
        if (!Array.isArray(entry.sections)) continue;
        for (const s of entry.sections) {
          const existing = sectionTotals.get(s.name) ?? { totalChars: 0, count: 0 };
          existing.totalChars += s.chars;
          existing.count += 1;
          sectionTotals.set(s.name, existing);
        }
      }

      const summary = {
        date,
        checkpointCount: entries.length,
        avgContextLength: entries.length > 0
          ? Math.round(entries.reduce((sum: number, e: { contextLength?: number }) => sum + (e.contextLength ?? 0), 0) / entries.length)
          : 0,
        sections: Object.fromEntries(
          [...sectionTotals.entries()].map(([name, { totalChars, count }]) => [
            name,
            { avgChars: Math.round(totalChars / count), appearances: count },
          ]),
        ),
        topicUtility: memory.getTopicUtility(),
      };

      res.json({ entries: entries.slice(-20), summary }); // Last 20 entries + summary
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Inner State API — Kuro 的內在狀態（興趣、思想、心情、內心獨白）
  app.get('/api/dashboard/inner-state', async (_req: Request, res: Response) => {
    try {
      const memory = getMemory();
      const soul = await memory.readSoul();
      const logger = getLogger();

      // --- Parse interests from SOUL.md (handles ### subsections) ---
      const interestsRaw: { name: string; detail: string; category?: string }[] = [];
      const interestsSection = soul.match(/## Learning Interests\n([\s\S]*?)(?=\n## )/);
      if (interestsSection) {
        const lines = interestsSection[1].split('\n');
        let currentCategory = '';
        for (const line of lines) {
          const catMatch = line.match(/^###\s*(.+)/);
          if (catMatch) {
            currentCategory = catMatch[1].trim();
            continue;
          }
          const m = line.match(/^- (.+?):\s*(.+)/);
          if (m) interestsRaw.push({ name: m[1].trim(), detail: m[2].trim(), category: currentCategory || undefined });
        }
      }

      // --- Parse My Thoughts from SOUL.md ---
      // Supports two formats:
      //   - [YYYY-MM-DD] topic: summary   (dated)
      //   - text                           (simple bullet)
      const thoughts: { date: string; topic: string; summary: string }[] = [];
      const thoughtsSection = soul.match(/## My Thoughts\n([\s\S]*?)(?=\n## )/);
      if (thoughtsSection) {
        const lines = thoughtsSection[1].split('\n');
        for (const line of lines) {
          // Dated format: - [2026-02-25] topic: summary
          const dated = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]\s*(.+?):\s*([\s\S]+)/);
          if (dated) {
            thoughts.push({ date: dated[1], topic: dated[2].trim(), summary: dated[3].trim() });
            continue;
          }
          // Simple format: - text (with optional — separator for topic hint)
          const simple = line.match(/^- (.+)/);
          if (simple) {
            const text = simple[1].trim();
            const dashSplit = text.split('—');
            if (dashSplit.length >= 2) {
              thoughts.push({ date: '', topic: dashSplit[0].trim(), summary: dashSplit.slice(1).join('—').trim() });
            } else {
              thoughts.push({ date: '', topic: '', summary: text });
            }
          }
        }
      }

      // --- Parse traits from SOUL.md ---
      const traits: { name: string; detail: string }[] = [];
      const traitsSection = soul.match(/## My Traits\n([\s\S]*?)(?=\n## )/);
      if (traitsSection) {
        const lines = traitsSection[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^\s*-\s*\*\*(.+?)\*\*:\s*(.*)/);
          if (m) traits.push({ name: m[1], detail: m[2].trim() });
        }
      }

      // --- Inner Voice (personal monologue) ---
      let innerVoice: { timestamp: string; content: string }[] = [];
      const voicePath = path.join(memory.getMemoryDir(), 'inner-voice.md');
      const voiceFallback = path.join(process.cwd(), 'memory', 'inner-voice.md');
      try {
        let voiceContent: string;
        try {
          voiceContent = await fsPromises.readFile(voicePath, 'utf-8');
        } catch {
          voiceContent = await fsPromises.readFile(voiceFallback, 'utf-8');
        }
        const entries = voiceContent.split(/^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/m);
        // entries: ['preamble', 'timestamp1', 'content1', 'timestamp2', 'content2', ...]
        for (let i = 1; i < entries.length; i += 2) {
          const timestamp = entries[i].trim();
          const content = entries[i + 1]?.trim() || '';
          if (content) innerVoice.push({ timestamp, content });
        }
        innerVoice = innerVoice.slice(-5).reverse(); // Most recent first
      } catch {
        // No inner-voice.md yet — that's fine
      }

      // --- Current focus (what I'm doing/thinking right now) ---
      const loopStatus = loopRef?.getStatus() ?? null;
      const currentFocus = {
        mode: loopStatus?.mode ?? 'idle',
        lastAction: loopStatus?.lastAction?.slice(0, 200) ?? null,
        cycleCount: loopStatus?.cycleCount ?? 0,
        nextCycleAt: loopStatus?.nextCycleAt ?? null,
      };

      // --- Mood derivation from recent activity ---
      const todayStr = new Date().toISOString().split('T')[0];
      const recentBehaviors = logger.queryBehaviorLogs(todayStr, 200);
      const recentActions = recentBehaviors.filter(
        e => e.data.actor === 'agent' && e.data.action?.includes('claude.call')
      );
      const errorCount = recentBehaviors.filter(
        e => e.data.action?.includes('error') || e.data.action?.includes('diag')
      ).length;
      const totalCycles = recentBehaviors.filter(e => e.data.action === 'loop.cycle.end').length;

      // Derive a mood signal from activity patterns
      let mood: string;
      let moodDetail: string;
      if (errorCount > 5) {
        mood = 'troubled';
        moodDetail = `${errorCount} errors today — something isn't right`;
      } else if (recentActions.length > 15) {
        mood = 'productive';
        moodDetail = `${recentActions.length} actions taken — active and engaged`;
      } else if (recentActions.length > 5) {
        mood = 'focused';
        moodDetail = `Steady rhythm — ${recentActions.length} actions, ${totalCycles} cycles`;
      } else if (totalCycles > 0) {
        mood = 'contemplative';
        moodDetail = `Mostly observing — ${totalCycles} cycles, few actions`;
      } else {
        mood = 'waking';
        moodDetail = 'Just started — warming up';
      }

      // --- Recent thinking (from last cognition entries) ---
      const cognitionEntries = recentBehaviors
        .map(parseCognitionEntry)
        .filter((e): e is CognitionEntry => e !== null && (!!e.thinking || !!e.decision))
        .slice(-3)
        .reverse();

      const recentThinking = cognitionEntries.map(e => ({
        timestamp: e.timestamp,
        decision: e.decision?.slice(0, 150) ?? null,
        thinking: e.thinking?.slice(0, 300) ?? null,
        mode: e.modeTag,
      }));

      // --- Topic pulse (what topics I've been exploring) ---
      const topicUtility = memory.getTopicUtility();

      // --- Inner Notes + Tracking Notes (all modes read; reserved+autonomous write) ---
      let innerNotes: string | null = null;
      let trackingNotes: string | null = null;
      const currentModeReport = getMode();
      // Always read — calm shows previous content read-only
      const innerNotesPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
      try {
        const c = await fsPromises.readFile(innerNotesPath, 'utf-8');
        if (c.trim()) innerNotes = c.trim();
      } catch { /* ok */ }
      const trackingPath = path.join(memory.getMemoryDir(), 'tracking-notes.md');
      try {
        const c = await fsPromises.readFile(trackingPath, 'utf-8');
        if (c.trim()) trackingNotes = c.trim();
      } catch { /* ok */ }

      res.json({
        traits,
        interests: interestsRaw.slice(0, 20),
        thoughts: thoughts.slice(0, 11),
        innerVoice,
        currentFocus,
        mood: { state: mood, detail: moodDetail },
        recentThinking,
        topicPulse: topicUtility,
        innerNotes,
        trackingNotes,
        innerNotesWritable: currentModeReport.mode === 'reserved' || currentModeReport.mode === 'autonomous',
        agentMode: currentModeReport.mode,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── Agent OS Activity Monitor APIs ──

  app.get('/api/dashboard/scheduler', (_req: Request, res: Response) => {
    try {
      const memDir = path.join(process.cwd(), 'memory');
      const state = getSchedulerState();
      const { tasks: topTasks, totalCount } = getTopPending(memDir, 5);
      const ATTENTION_BUDGET = 15;
      res.json({
        currentTask: state.currentTaskId ? topTasks.find((t: any) => t.id === state.currentTaskId) ?? { id: state.currentTaskId } : null,
        ticksOnCurrent: state.ticksOnCurrent,
        totalTicks: state.totalTicks,
        lastDiscoveryTick: state.lastDiscoveryTick,
        attentionBudget: {
          limit: ATTENTION_BUDGET,
          used: state.ticksOnCurrent,
          ratio: state.ticksOnCurrent / ATTENTION_BUDGET,
        },
        queueDepth: totalCount,
        topPending: topTasks,
      });
    } catch (e) {
      res.json({ currentTask: null, ticksOnCurrent: 0, totalTicks: 0, attentionBudget: { limit: 15, used: 0, ratio: 0 }, queueDepth: 0, topPending: [] });
    }
  });

  app.get('/api/dashboard/scheduler/history', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string || '50', 10);
      res.json({ history: getSchedulerHistory(Math.min(limit, 200)) });
    } catch {
      res.json({ history: [] });
    }
  });

  app.get('/api/dashboard/processes', (_req: Request, res: Response) => {
    try {
      const entries = getProcessTableSnapshot();
      const stats: Record<string, number> = {};
      for (const e of entries) {
        stats[e.state] = (stats[e.state] ?? 0) + 1;
      }
      // Today's completed/abandoned from memory index
      const mDir = path.join(process.cwd(), 'memory');
      const todayStart = new Date().toISOString().slice(0, 10);
      const completedTasks = queryMemoryIndexSync(mDir, { type: ['task', 'goal'], status: ['completed', 'done'] }).filter(t => t.ts >= todayStart);
      const abandonedTasks = queryMemoryIndexSync(mDir, { type: ['task', 'goal'], status: ['abandoned'] }).filter(t => t.ts >= todayStart);
      res.json({
        processes: entries,
        stats: {
          running: stats.running ?? 0,
          scheduled: stats.scheduled ?? 0,
          pending: stats.pending ?? 0,
          blocked: stats.blocked ?? 0,
          suspended: stats.suspended ?? 0,
          completed: (stats.completed ?? 0) + completedTasks.length,
          abandoned: (stats.abandoned ?? 0) + abandonedTasks.length,
          total: entries.length,
        },
      });
    } catch {
      res.json({ processes: [], stats: { running: 0, scheduled: 0, pending: 0, blocked: 0, suspended: 0, completed: 0, abandoned: 0, total: 0 } });
    }
  });

  app.get('/api/dashboard/budget', (_req: Request, res: Response) => {
    // Context budget is stateless — returns last known state or defaults
    res.json({
      pressure: { level: 'normal', usage: 0, budget: 180000, ratio: 0, action: 'none' },
      sections: [],
      trimmedSections: [],
      note: 'Context budget integration pending Phase 1.5',
    });
  });

  app.get('/api/dashboard/health', (_req: Request, res: Response) => {
    try {
      const signals = getHealthSignals();
      const memDir = path.join(process.cwd(), 'memory');
      const allTasks = queryMemoryIndexSync(memDir, { type: 'task' });
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      // 1. Pledge Fulfillment (40%) — pledges completed / pledges created (7-day window)
      const recentTasks = allTasks.filter(t => (t.ts ?? '') >= sevenDaysAgo);
      const pledgeTasks = recentTasks.filter(t => (t.payload as Record<string, unknown>)?.origin === 'pledge');
      const pledgesDone = pledgeTasks.filter(t => ['completed', 'done'].includes(t.status)).length;
      const pledgesTotal = Math.max(1, pledgeTasks.length);
      const fulfillment = pledgeTasks.length === 0 ? 0.7 : pledgesDone / pledgesTotal;

      // 2. Responsiveness (35%) — inverse of avg staleness across active tasks
      const activeTasks = allTasks.filter(t => ['pending', 'in_progress'].includes(t.status));
      const avgStaleness = activeTasks.length === 0 ? 0 :
        activeTasks.reduce((sum, t) => sum + ((t.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0), 0) / activeTasks.length;
      const responsiveness = Math.max(0, 1 - avgStaleness / 10);

      // 3. Output Quality (25%) — weighted visible output (commit=3, report=2, internal=1)
      const outputRate = signals.visibleOutputRate;
      const quality = Math.min(outputRate * 1.5, 1);

      const score = Math.round(fulfillment * 40 + responsiveness * 35 + quality * 25);

      // Self-correction guidance
      const guidance: string[] = [];
      if (fulfillment < 0.5) {
        const unfinished = pledgeTasks.filter(t => !['completed', 'done'].includes(t.status));
        const oldest = unfinished[0];
        guidance.push(`承諾兌現率低 (${Math.round(fulfillment * 100)}%) — ${unfinished.length} 個 pledge 未完成${oldest ? `，最老: ${oldest.summary?.slice(0, 50)}` : ''}。現在做。`);
      }
      if (responsiveness < 0.5) {
        const stalest = activeTasks.sort((a, b) => ((b.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0) - ((a.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0))[0];
        guidance.push(`響應力低 (${Math.round(responsiveness * 100)}%) — 平均 ${avgStaleness.toFixed(1)} cycles 沒進展${stalest ? `，最停滯: ${stalest.summary?.slice(0, 50)}` : ''}。推進它。`);
      }
      if (quality < 0.4) {
        guidance.push(`產出品質低 (${Math.round(quality * 100)}%) — 多數 cycle 無 visible output。交付成品，不要只思考。`);
      }

      res.json({
        score: Math.min(score, 100),
        breakdown: {
          fulfillment: { value: fulfillment, weight: 40, contribution: Math.round(fulfillment * 40 * 10) / 10, detail: `${pledgesDone}/${pledgesTotal} pledges` },
          responsiveness: { value: responsiveness, weight: 35, contribution: Math.round(responsiveness * 35 * 10) / 10, detail: `avg staleness ${avgStaleness.toFixed(1)}` },
          quality: { value: quality, weight: 25, contribution: Math.round(quality * 25 * 10) / 10, detail: `output rate ${Math.round(outputRate * 100)}%` },
        },
        guidance,
        anomalies: guidance.length > 0 ? ['needs-correction'] : [],
      });
    } catch {
      res.json({ score: 50, breakdown: null, guidance: [], anomalies: [] });
    }
  });

  app.get('/api/dashboard/failures', (_req: Request, res: Response) => {
    try {
      const { getTopFailures, getFailureCount } = require('./failure-registry.js');
      res.json({ failures: getTopFailures(20), total: getFailureCount() });
    } catch {
      res.json({ failures: [], total: 0 });
    }
  });

  app.get('/api/dashboard/activity', (req: Request, res: Response) => {
    try {
      const context = req.query.context as string | undefined;
      const activities = context ? getActivityByContext(context, 100) : getTodayActivity();
      const contextCounts: Record<string, number> = {};
      for (const a of activities) {
        contextCounts[a.context] = (contextCounts[a.context] ?? 0) + 1;
      }
      res.json({ activities: activities.slice(-100), contexts: contextCounts, total: activities.length });
    } catch {
      res.json({ activities: [], contexts: {}, total: 0 });
    }
  });

  // Activity Monitor HTML — standalone page
  app.get('/monitor', (_req: Request, res: Response) => {
    const monitorPath = path.join(import.meta.dirname, '..', 'activity-monitor.html');
    if (fs.existsSync(monitorPath)) {
      res.sendFile(monitorPath);
    } else {
      res.status(404).send('Activity Monitor not found');
    }
  });

  // Dashboard HTML — 靜態頁面
  app.get('/dashboard', (_req: Request, res: Response) => {
    const dashboardPath = path.join(import.meta.dirname, '..', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath);
    } else {
      res.status(404).send('Dashboard not found');
    }
  });

  app.get('/task-board', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'task-board.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('task-board.html not found');
    }
  });

  // Knowledge Graph viz — self-contained HTML rebuilt by kg-viz.ts
  app.get('/kg-graph', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'memory/index/kg-graph.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).type('text/plain').send(
        'kg-graph.html not built yet.\nRun: pnpm tsx scripts/kg-viz.ts',
      );
    }
  });

  // Timeline UI — F2 of Context Engine.
  app.get('/timeline', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'timeline.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('timeline.html not found');
    }
  });

  // Goal/Discussion view — G1 of Context Engine.
  app.get('/discussions/:goal_id', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'discussion-view.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('discussion-view.html not found');
    }
  });
  app.get('/discussions', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'discussion-view.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('discussion-view.html not found');
    }
  });

  // Memory Inspector — A3 of Context Engine. Shows recent buildContext snapshots
  // with section breakdown. Forward-compatible with A2 (section metadata expansion)
  // and A4 (utilizationRate) — missing fields render as "n/a".
  app.get('/memory-inspector', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'memory-inspector.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('memory-inspector.html not found');
    }
  });

  app.get('/api/memory-inspector', async (req: Request, res: Response) => {
    try {
      const memory = getMemory();
      const checkpointDir = path.join(memory.getMemoryDir(), 'context-checkpoints');
      const limit = Math.min(Number(req.query.limit ?? 10) || 10, 100);
      const modeFilter = (req.query.mode as string) || '';

      if (!fs.existsSync(checkpointDir)) {
        res.json({ entries: [], total: 0 });
        return;
      }

      const files = (await fsPromises.readdir(checkpointDir))
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse(); // newest day first

      const collected: Record<string, unknown>[] = [];
      for (const f of files) {
        if (collected.length >= limit) break;
        const content = await fsPromises.readFile(path.join(checkpointDir, f), 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        for (let i = lines.length - 1; i >= 0 && collected.length < limit; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (modeFilter && entry.mode !== modeFilter) continue;
            collected.push(entry);
          } catch { /* skip malformed */ }
        }
      }

      res.json({ entries: collected, total: collected.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // KG entity search — dashboard Memory Lab lookup (Proposal p7)
  app.get('/api/kg/entities/search', (req: Request, res: Response) => {
    try {
      const q = String(req.query.q ?? '').trim();
      const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
      if (!q) {
        res.json({ query: q, hits: [] });
        return;
      }
      res.json({ query: q, hits: kgSearchEntities(q, limit) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/kg/entities/:id', (req: Request, res: Response) => {
    try {
      const card = kgGetEntityCard(req.params.id);
      if (!card) {
        res.status(404).json({ error: 'entity not found', id: req.params.id });
        return;
      }
      res.json(card);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/kg/stats', (_req: Request, res: Response) => {
    try {
      res.json(getKgStats());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/kg/ingest-stats', (_req: Request, res: Response) => {
    try {
      res.json(kgGetIngestStats());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // KG PPR query — full graph context retrieval
  app.get('/api/kg/query', (req: Request, res: Response) => {
    try {
      const probes = String(req.query.q ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const topK = Math.min(Number(req.query.top ?? 20) || 20, 50);
      const format = String(req.query.format ?? 'json');
      if (probes.length === 0) {
        res.status(400).json({ error: 'q parameter required (comma-separated probes)' });
        return;
      }
      const report = kgQuery(probes, { topK });
      if (format === 'text') {
        res.type('text/plain').send(kgFormatReport(report));
      } else {
        res.json(report);
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/board', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'board.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('board.html not found');
    }
  });

  // =============================================================================
  // Mobile Perception (Phase 1)
  // =============================================================================

  // Serve mobile.html — same-origin avoids CORS issues
  app.get('/mobile', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'mobile.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('mobile.html not found');
    }
  });

  app.post('/api/mobile/sensor', async (req: Request, res: Response) => {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'JSON body required' });
      return;
    }

    try {
      const stateDir = path.join(os.homedir(), '.mini-agent');
      const statePath = path.join(stateDir, 'mobile-state.json');
      const historyPath = path.join(stateDir, 'mobile-history.jsonl');
      if (!fs.existsSync(stateDir)) {
        await fsPromises.mkdir(stateDir, { recursive: true });
      }

      const state = { ...data, updatedAt: new Date().toISOString() };

      // Write latest snapshot (existing behavior)
      await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2));

      // Append to ring buffer (Phase 1.5: keep last 120 entries = ~10 min at 5s interval)
      const MAX_HISTORY = 120;
      const historyEntry = JSON.stringify({
        ts: state.updatedAt,
        accelX: data.accelX ?? data.data?.accelX,
        accelY: data.accelY ?? data.data?.accelY,
        accelZ: data.accelZ ?? data.data?.accelZ,
        alpha: data.alpha ?? data.data?.alpha,
        beta: data.beta ?? data.data?.beta,
        gamma: data.gamma ?? data.data?.gamma,
        latitude: data.latitude ?? data.data?.latitude,
        longitude: data.longitude ?? data.data?.longitude,
        speed: data.speed ?? data.data?.speed,
        accuracy: data.accuracy ?? data.data?.accuracy,
      });
      try {
        let lines: string[] = [];
        if (fs.existsSync(historyPath)) {
          const raw = await fsPromises.readFile(historyPath, 'utf-8');
          lines = raw.split('\n').filter(Boolean);
        }
        // Keep last (MAX_HISTORY - 1) + new entry = MAX_HISTORY
        if (lines.length >= MAX_HISTORY) {
          lines = lines.slice(lines.length - MAX_HISTORY + 1);
        }
        lines.push(historyEntry);
        await fsPromises.writeFile(historyPath, lines.join('\n') + '\n');
      } catch {
        // History write is best-effort, don't block the main flow
      }

      eventBus.emit('trigger:mobile', { data: state });

      res.json({ ok: true });
    } catch (error) {
      slog('MOBILE', `Sensor write failed: ${error instanceof Error ? error.message : error}`);
      res.status(500).json({ error: 'Failed to write sensor data' });
    }
  });

  // Mobile sensor history — Phase 1.5: query ring buffer
  app.get('/api/mobile/history', async (_req: Request, res: Response) => {
    try {
      const historyPath = path.join(os.homedir(), '.mini-agent', 'mobile-history.jsonl');
      if (!fs.existsSync(historyPath)) {
        res.json({ entries: [], count: 0 });
        return;
      }
      const raw = await fsPromises.readFile(historyPath, 'utf-8');
      const entries = raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      res.json({ entries, count: entries.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read history' });
    }
  });

  // =============================================================================
  // Instant Digest — API-first content digestion
  // =============================================================================

  // =============================================================================
  // Team Chat Room
  // =============================================================================

  // Room/chat triggers — best-effort emit so API path never fails on event layer issues
  const emitRoomTrigger = (data: Record<string, unknown>): void => {
    try {
      if (eventBus && typeof eventBus.emit === 'function') {
        eventBus.emit('trigger:room', data);
      }
    } catch (error) {
      slog('EVENT', `trigger:room emit failed: ${error instanceof Error ? error.message : error}`);
    }
  };

  const emitChatTrigger = (data: Record<string, unknown>): void => {
    try {
      if (eventBus && typeof eventBus.emit === 'function') {
        eventBus.emit('trigger:chat', data);
      }
    } catch (error) {
      slog('EVENT', `trigger:chat emit failed: ${error instanceof Error ? error.message : error}`);
    }
  };

  // Serve chat-room.html
  app.get('/chat-ui', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'chat-room.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('chat-room.html not found');
    }
  });

  // GET /api/media/:filename — serve media files (images etc.)
  app.get('/api/media/:filename', (_req: Request, res: Response) => {
    const filename = _req.params.filename;
    // Security: only allow alphanumeric + _ + - + .  to prevent path traversal
    if (!/^[\w\-]+\.\w+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const filePath = path.join(process.cwd(), 'memory', 'media', filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(filePath);
  });

  // POST /api/room — send a message to chat room
  app.post('/api/room', async (req: Request, res: Response) => {
    const { from, text, replyTo } = req.body;

    if (!from || !text || typeof from !== 'string' || typeof text !== 'string') {
      res.status(400).json({ error: 'from and text are required' });
      return;
    }

    const validFrom = ['alex', 'kuro', 'claude-code', 'mushi'];
    if (!validFrom.includes(from)) {
      res.status(400).json({ error: `from must be one of: ${validFrom.join(', ')}` });
      return;
    }

    try {
      const now = new Date();

      // Preprocess: topic detection, intent classification, cluster assignment (zero LLM)
      // Generate a temporary ID for task extraction (will be replaced by actual ID)
      const tempId = `${now.toISOString().slice(0, 10)}-000`;
      const msgContext = from !== 'kuro' ? preprocessMessage(text, from, tempId, now) : undefined;

      // Write message via writeRoomMessage (generates ID, writes JSONL, emits action:room)
      const id = await writeRoomMessage(from, text, replyTo as string | undefined, msgContext);
      const timestamp = now.toISOString();

      // Parse mentions for inbox logic
      const mentions: string[] = [];
      if (text.includes('@kuro')) mentions.push('kuro');
      if (text.includes('@claude')) mentions.push('claude-code');
      if (text.includes('@alex')) mentions.push('alex');

      // Skip mushi system events from inbox (status changes, heartbeats — pure noise)
      const isMushiSystemEvent = from === 'mushi' && /^\[mushi\]\s/.test(text);

      // If not from kuro and mentions kuro (or no mention) → write to inbox
      if (!isMushiSystemEvent && from !== 'kuro' && (mentions.includes('kuro') || mentions.length === 0)) {
        const inboxPath = path.join(os.homedir(), '.mini-agent', 'chat-room-inbox.md');
        const localTime = now.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16);
        const replyHint = replyTo ? ` ↩${replyTo}` : '';
        const flatText = text.replace(/\n+/g, ' ').slice(0, 800);
        const inboxEntry = `- [${localTime}] (${from}) [${id}]${replyHint} ${flatText}`;

        let content = '';
        try { content = await fsPromises.readFile(inboxPath, 'utf-8'); } catch { /* file doesn't exist */ }

        if (!content.includes('## Pending')) {
          content = `## Pending\n\n## Processed\n`;
        }
        content = content.replace('## Pending\n', `## Pending\n${inboxEntry}\n`);
        await fsPromises.writeFile(inboxPath, content, 'utf-8');

      }

      // Dual-write to unified inbox
      if (from !== 'kuro') {
        writeInboxItem({
          source: 'room',
          from,
          content: text,
          meta: {
            roomMsgId: id,
            ...(replyTo ? { replyTo: replyTo as string } : {}),
            ...(mentions.length > 0 ? { mentions: mentions.join(',') } : {}),
          },
        });

        // Wake idle loop immediately after room message persistence
        emitRoomTrigger({ source: 'room-api', from, text, roomMsgId: id });
      }

      // Auto-detect conversation threads (Alex + Claude Code messages) — fire-and-forget
      if (from === 'alex' || from === 'claude-code') {
        autoDetectThread(text, `room:${from}`, id).catch(() => {});
      }

      // Auto-enqueue Alex's Chat Room messages as tracked tasks (same as Telegram auto-enqueue)
      // This ensures conversation directives don't get lost after reply
      if (from === 'alex') {
        const memDir = path.join(process.cwd(), 'memory');
        enqueueRoomDirective(memDir, text, id, from).catch(() => {});
      }

      slog('ROOM', `[${id}] ${from}: ${text.slice(0, 80)}`);
      res.status(201).json({ ok: true, id, ts: timestamp });
    } catch (error) {
      slog('ERROR', `Room post failed: ${error instanceof Error ? error.message : error}`);
      res.status(500).json({ error: 'Failed to post message' });
    }
  });

  // GET /api/room — read today's conversation (or ?date=YYYY-MM-DD)
  app.get('/api/room', (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const convPath = path.join(process.cwd(), 'memory', 'conversations', `${date}.jsonl`);

      if (!fs.existsSync(convPath)) {
        res.json({ date, messages: [] });
        return;
      }

      const raw = fs.readFileSync(convPath, 'utf-8');
      const messages = raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      res.json({ date, messages });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read messages' });
    }
  });

  // GET /api/room/stream — SSE for chat room
  app.get('/api/room/stream', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;

    const safeSend = (data: string): void => {
      if (closed) return;
      try { res.write(data); } catch { /* connection already closed */ }
    };

    const handler = (event: AgentEvent): void => {
      const payload = JSON.stringify({ type: event.type, data: event.data, ts: event.timestamp });
      safeSend(`data: ${payload}\n\n`);
    };

    const subscribedEvents: AgentEvent['type'][] = [
      'action:room',
      'trigger:room',
      'trigger:chat',
    ];
    for (const eventType of subscribedEvents) {
      eventBus.on(eventType, handler);
    }

    const keepalive = setInterval(() => safeSend(':ping\n\n'), 30_000);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      for (const eventType of subscribedEvents) {
        eventBus.off(eventType, handler);
      }
      clearInterval(keepalive);
    };

    _req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  // Claude Code HTTP Hooks moved before authMiddleware (see above)

  // POST /api/ask — 同步問答端點（always-on，不受 OODA mode 影響）
  app.post('/api/ask', async (req: Request, res: Response) => {
    const { question } = req.body as { question?: unknown };
    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    try {
      const memory = getMemory();

      // 建立 minimal context（soul + heartbeat + NEXT Now + recent convos）
      let context = await memory.buildContext({ mode: 'minimal' });

      // Topic memory — keyword-matched topic loading
      const topicContext = await memory.loadTopicsForQuery(question as string);
      if (topicContext) {
        context += `\n\n${topicContext}`;
      }

      // FTS5 搜尋相關記憶（根據問題內容動態注入，取代固定截斷）
      const ftsResults = await memory.searchMemory(question as string, 8);
      if (ftsResults.length > 0) {
        const relevantEntries = ftsResults.map(r => `[${r.source}] ${r.content}`).join('\n');
        context += `\n\n<relevant_memory>\n${relevantEntries}\n</relevant_memory>`;
      }

      // 補充 MEMORY.md 頭 2000 chars（兜底：FTS5 可能沒索引到所有內容）
      const memContent = await readMemory();
      if (memContent) {
        const memExcerpt = memContent.slice(0, 2000);
        context += `\n\n<memory>\n${memExcerpt}\n</memory>`;
      }

      // Chat Room context: already included in buildContext() as <chat-room-recent>

      // reserved mode 下：附加 inner-notes（工作記憶）+ tracking-notes（追蹤快照）
      const currentModeReport = getMode();
      if (currentModeReport.mode === 'reserved') {
        const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
        try {
          const innerContent = await fsPromises.readFile(innerPath, 'utf-8');
          if (innerContent.trim()) {
            context += `\n\n<inner_notes>\n${innerContent.trim()}\n</inner_notes>`;
          }
        } catch { /* inner-notes 不存在 */ }

        const trackingPath = path.join(memory.getMemoryDir(), 'tracking-notes.md');
        try {
          const trackingContent = await fsPromises.readFile(trackingPath, 'utf-8');
          if (trackingContent.trim()) {
            context += `\n\n<tracking_notes>\n${trackingContent.trim()}\n</tracking_notes>`;
          }
        } catch { /* tracking-notes 不存在 */ }
      }

      // 注入快取的 perception 關鍵 sections（免費，已有數據）
      try {
        const cached = perceptionStreams.getCachedResults();
        const relevant = cached.filter(r => IMPORTANT_PERCEPTION_NAMES.includes(r.name as typeof IMPORTANT_PERCEPTION_NAMES[number]));
        if (relevant.length > 0) {
          const perceptionLines = relevant.map(r => `<${r.name}>\n${r.output!.slice(0, 1000)}\n</${r.name}>`).join('\n');
          context += `\n\n<cached_perception>\n${perceptionLines}\n</cached_perception>`;
        }
      } catch { /* perception not available */ }

      // Knowledge Bus summary — cross-component patterns
      try {
        const { getKnowledgeSummary } = await import('./shared-knowledge.js');
        const kbSummary = getKnowledgeSummary();
        if (kbSummary) context += `\n\n<knowledge-bus>\n${kbSummary}\n</knowledge-bus>`;
      } catch { /* best effort */ }

      const contextAge = new Date().toISOString();
      context += `\n\n<ask_mode>\n這是 /api/ask 直接問答模式。感知資料為快取 + FTS5 動態記憶搜尋（${contextAge}）。\n</ask_mode>`;

      const { response } = await callClaude(question, context, 1, { source: 'ask' });

      // Process all tags via unified postProcess (remember, delegate, inner, etc.)
      const result = await postProcess(question as string, response, {
        lane: 'ask',
        duration: 0,
        source: 'ask',
        systemPrompt: '',
        context: '',
        skipHistory: true,
        suppressChat: true,
      });

      res.json({ ok: true, answer: result.content, contextAge });
      writeActivity({
        lane: 'ask',
        summary: `Q: ${(question as string).slice(0, 80)} → A: ${(result.content ?? '').slice(0, 80)}`,
        tags: result.tagsProcessed,
      });
    } catch (error) {
      slog('ERROR', `Ask failed: ${error instanceof Error ? error.message : error}`);
      res.status(500).json({ error: 'Ask failed' });
    }
  });

  // SSE — Dashboard 即時事件流（Phase 3b）
  app.get('/api/events', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;

    const safeSend = (data: string): void => {
      if (closed) return;
      try { res.write(data); } catch { /* connection already closed */ }
    };

    const handler = (event: AgentEvent): void => {
      const payload = JSON.stringify({ type: event.type, data: event.data, ts: event.timestamp });
      safeSend(`data: ${payload}\n\n`);
    };

    eventBus.on('action:*', handler);
    eventBus.on('trigger:*', handler);

    const keepalive = setInterval(() => safeSend(':ping\n\n'), 30_000);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      eventBus.off('action:*', handler);
      eventBus.off('trigger:*', handler);
      clearInterval(keepalive);
    };

    _req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  return app;
}

// =============================================================================
// Standalone Server
// =============================================================================

// =============================================================================
// Global Safety Net
// =============================================================================

process.on('uncaughtException', (err) => {
  // EPIPE is a normal side-effect of preempting child processes — never crash for it
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
    diagLog('WARN.epipe', err);
    return;
  }
  // Print full error to stderr first so it survives even if diagLog/logger fails
  // (previous handler stringified the wrapper object as `[object Object]`).
  try {
    const e = err as Error & NodeJS.ErrnoException;
    console.error(`[FATAL.uncaught] ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`);
    if (e?.code) console.error(`  code=${e.code}`);
    if (e?.stack) console.error(e.stack);
  } catch { /* never let logging crash exit path */ }
  const mem = process.memoryUsage();
  diagLog('FATAL.uncaught', err, { heapUsedMB: String(Math.round(mem.heapUsed / 1048576)), heapTotalMB: String(Math.round(mem.heapTotal / 1048576)), rssMB: String(Math.round(mem.rss / 1048576)), externalMB: String(Math.round(mem.external / 1048576)) });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const mem = process.memoryUsage();
  diagLog('WARN.unhandledRejection', { reason, heapUsedMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) });
});

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  const app = createApi(port);
  const instanceId = getCurrentInstanceId();
  const instanceConfig = loadInstanceConfig(instanceId);

  // ── 設定 slog 前綴（讓日誌能區分實例） ──
  setSlogPrefix(instanceId, instanceConfig?.name);

  // ── Diagnostics: event-loop lag monitor ──
  // Logs to server.log when main thread stalls >100ms, rolls up max lag every 5s.
  // Together with [SLOW-HTTP] and [TIMING] logs, lets us see when/why the loop freezes.
  startEventLoopLagMonitor();
  startStateSampler();

  // ── Load .env (lightweight, no dependency) ──
  const composeFile = findComposeFile();
  const projectDir = composeFile ? path.dirname(composeFile) : process.cwd();
  const envFile = path.join(projectDir, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    slog('ENV', `Loaded from ${envFile}`);
  }

  // ── Cron: 從 compose 讀取並啟動 ──
  let currentAgent: import('./types.js').ComposeAgent | undefined;

  if (composeFile) {
    const compose = readComposeFile(composeFile);
    const agents = Object.values(compose.agents);
    currentAgent = agents.find(a => a.name === instanceConfig?.name) || agents[0];

    if (currentAgent?.cron && currentAgent.cron.length > 0) {
      startCronTasks(currentAgent.cron);
    }
  }

  // ── AgentLoop: 從 compose 讀取並啟動 ──
  const loopConfig = currentAgent?.loop;
  const loopEnabled = loopConfig?.enabled !== false;
  if (loopEnabled) {
    const intervalMs = loopConfig?.interval ? parseInterval(loopConfig.interval) : undefined;
    const activeHours = loopConfig?.activeHours
      ? { start: loopConfig.activeHours.start ?? 8, end: loopConfig.activeHours.end ?? 23 }
      : undefined;
    const loop = new AgentLoop({ enabled: true, ...(intervalMs ? { intervalMs } : {}), ...(activeHours ? { activeHours } : {}) });
    setLoopRef(loop);
  }

  // ── Foreground Slot TTL Sweep (absorbed from agent-broker session pool pattern) ──
  startForegroundSweep();

  startHeartbeat({
    instanceId,
    port,
    role: instanceConfig?.role || 'standalone',
  });

  // Wire heartbeat updates from loop cycle events
  eventBus.on('action:loop', (event) => {
    if (event.data.event === 'cycle.start') {
      updateInstanceHeartbeat({ status: 'busy', cycleCount: (event.data.cycleCount as number) || 0 });
    } else if (event.data.event === 'cycle.end') {
      updateInstanceHeartbeat({ status: 'idle' });
    }
  });

  // ── Self-awareness ──
  const startedAt = new Date().toISOString();

  setSelfStatusProvider(() => ({
    name: instanceConfig?.name || instanceId,
    role: instanceConfig?.role || 'standalone',
    port,
    persona: instanceConfig?.persona?.description,
    startedAt,
    loop: loopRef ? {
      running: loopRef.getStatus().running,
      paused: loopRef.getStatus().paused,
      cycleCount: loopRef.getStatus().cycleCount,
      lastAction: loopRef.getStatus().lastAction,
      nextCycleAt: loopRef.getStatus().nextCycleAt,
    } : null,
    cronTasks: getActiveCronTasks().map(t => ({ schedule: t.schedule, task: t.task })),
  }));

  // ── Background Collectors (mechanism-level fix: HTTP handlers never do sync I/O) ──
  const logger = getLogger();

  // Network status: background polling every 30s, /status reads from cache
  startNetworkStatusCollector(port);

  // Log summary: background polling every 30s, /status reads from cache
  startLogSummaryCollector(() => {
    const today = new Date().toISOString().split('T')[0];
    const summary = getLogSummary(
      () => logger.queryErrorLogs(undefined, 5).map(e => ({
        time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
        message: e.data.context ? `[${e.data.context}] ${e.data.error}` : e.data.error,
      })),
      () => logger.query({ limit: 10 }).map(e => ({
        time: e.timestamp.split('T')[1]?.split('.')[0] ?? '',
        type: e.type,
        summary: e.type === 'error'
          ? ((e.data as { context?: string; error: string }).context
              ? `[${(e.data as { context?: string }).context}] ${(e.data as { error: string }).error}`
              : (e.data as { error: string }).error)
          : e.type === 'claude-call'
            ? `chat: ${((e.data as { input: { userMessage: string } }).input?.userMessage ?? '').slice(0, 60)}`
            : e.type === 'cron'
              ? (e.data as { action: string }).action
              : `${(e.data as { request?: { method?: string; path?: string } }).request?.method ?? ''} ${(e.data as { request?: { method?: string; path?: string } }).request?.path ?? ''}`,
      })),
    );
    const stats = {
      claude: logger.queryClaudeLogs(today, 0).length,
      api: logger.queryApiLogs(today, 0).length,
      cron: logger.queryCronLogs(today, 0).length,
      error: logger.queryErrorLogs(today, 0).length,
    };
    return { summary, stats };
  });

  // ── Perception Providers (use cached data — zero sync I/O in handlers) ──
  const manager = getInstanceManager();

  setPerceptionProviders({
    process: () => getProcessStatus(
      () => manager.listStatus()
        .filter(s => s.id !== instanceId)
        .map(s => ({ id: s.id, name: s.name, port: s.port, running: s.running })),
      () => getLogStatsCached(), // non-blocking: reads from background collector cache
    ),
    logs: () => getLogSummaryCached() ?? { recentErrors: [], recentEvents: [] }, // non-blocking
    network: () => getNetworkStatusCached() ?? { selfPortOpen: true, reachableServices: [] }, // non-blocking
    config: () => getConfigSnapshot(
      () => {
        if (!composeFile) return null;
        const compose = readComposeFile(composeFile);
        return {
          agents: Object.entries(compose.agents).map(([id, a]) => ({
            id,
            name: a.name || id,
            port: a.port || 3001,
            persona: a.persona,
            loop: a.loop ? { enabled: a.loop.enabled !== false, interval: a.loop.interval } : undefined,
            cronCount: a.cron?.length ?? 0,
          })),
        };
      },
      () => {
        try { return loadGlobalConfig().defaults as unknown as Record<string, unknown>; } catch { return null; }
      },
      () => instanceConfig as unknown as Record<string, unknown> | null,
    ),
    activity: () => getActivitySummary(logger),
  });

  // Custom Perception & Skills（從 compose 配置）
  const cwd = composeFile ? path.dirname(path.resolve(composeFile)) : process.cwd();
  const enabledPerceptions = currentAgent?.perception?.custom?.filter(p => p.enabled !== false);
  setCustomExtensions({
    perceptions: enabledPerceptions,
    skills: currentAgent?.skills,
    cwd,
  });

  // Phase 4: 啟動 perception streams（獨立 interval + distinctUntilChanged）
  // Diagnostic isolation (2026-04-17): PERCEPTION_DISABLED=true skips the entire
  // perception subsystem. 30+ plugins each spawn child_process every 30–120s; many
  // time out at 10s and auto-restart. The spawn/kill churn keeps main thread busy
  // managing subprocess stdio/exit codes. Disabling isolates whether that churn is
  // the real source of HTTP unresponsiveness (vs SDK vs cycle post-process).
  const perceptionDisabled = process.env.PERCEPTION_DISABLED === 'true';
  if (perceptionDisabled) {
    slog('API', 'PERCEPTION_DISABLED=true — skipping perception streams (diagnostic mode)');
  } else if (enabledPerceptions && enabledPerceptions.length > 0) {
    perceptionStreams.start(enabledPerceptions, cwd);
  }

  // ── Startup Auto-Detect (kuro-sense) ──
  // Fire-and-forget: detect hardware/network → write cache → slog summary
  (async () => {
    try {
      const senseBin = path.join(__dirname, '..', 'tools', 'kuro-sense', 'kuro-sense');
      if (!fs.existsSync(senseBin)) return;
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(senseBin, ['detect', '--json'], { timeout: 15000 });
      const result = JSON.parse(stdout);
      const cacheDir = path.join(os.homedir(), '.mini-agent');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'sense-cache.json'), JSON.stringify(result, null, 2));
      const caps = result.Capabilities?.length ?? 0;
      const avail = result.Capabilities?.filter((c: { Available: boolean }) => c.Available)?.length ?? 0;
      const net = result.Network?.internet?.connected ? 'online' : 'offline';
      slog('SENSE', `Startup detect: ${avail}/${caps} capabilities, network ${net}`);
    } catch { /* silent — binary missing or detect failed */ }
  })();

  const memoryDir = path.resolve(composeFile ? path.dirname(composeFile) : '.', 'memory');
  const telegramPoller = createTelegramPoller(memoryDir);

  // ── Feature Toggles ──
  initFeatures();

  initObservability();
  createMemory(); // ensure migrateStateFiles() runs before journal init
  initClaudeMdJIT(); // parse CLAUDE.md sections for JIT loading
  initActivityJournal();

  const server = app.listen(port, '0.0.0.0', () => {
    slog('SERVER', `Started on :${port} (instance: ${instanceId})`);
    const cronCount = getCronTaskCount();
    if (cronCount > 0) slog('CRON', `${cronCount} task(s) active`);
    if (loopRef) {
      loopRef.start();

      // 恢復持久化 mode；找不到持久化狀態才預設 autonomous（personal agent 預設自主）
      let startupMode: ModeName = 'autonomous';
      const modeStatePath = path.join(os.homedir(), '.mini-agent', 'instances', instanceId, 'mode.json');
      try {
        const saved = JSON.parse(fs.readFileSync(modeStatePath, 'utf-8')) as { mode?: string };
        if (saved.mode && isValidMode(saved.mode)) {
          startupMode = saved.mode;
        }
      } catch { /* no persisted mode, use autonomous */ }

      setMode(startupMode);
      slog('MODE', `Startup mode: ${startupMode}${startupMode === 'autonomous' ? ' (default)' : ' (restored)'}`);
    }
    if (telegramPoller && isEnabled('telegram-poller')) {
      telegramPoller.start();
    }

    // Spawn external watchdog (immune to Node.js event-loop blocking)
    const watchdogScript = path.join(import.meta.dirname, '..', 'scripts', 'watchdog.ts');
    const watchdog = spawnChild('bun', [watchdogScript], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port) },
    });
    watchdog.on('exit', (code) => slog('WATCHDOG', `exited with code ${code}`));
    process.on('exit', () => { try { watchdog.kill(); } catch { /* already dead */ } });

    // Startup memory size check — log only, daily prune handles cleanup
    setTimeout(() => void (async () => {
      try {
        const memDir = path.join(process.cwd(), 'memory');
        const [memoryLines, topicsCount, soulSize, claudeSize] = await Promise.all([
          fsPromises.readFile(path.join(memDir, 'MEMORY.md'), 'utf-8')
            .then(c => c.split('\n').length).catch(() => 0),
          fsPromises.readdir(path.join(memDir, 'topics'))
            .then(f => f.filter(n => n.endsWith('.md') && !n.startsWith('.')).length).catch(() => 0),
          fsPromises.stat(path.join(memDir, 'SOUL.md')).then(s => s.size).catch(() => 0),
          fsPromises.stat(path.join(process.cwd(), 'CLAUDE.md')).then(s => s.size).catch(() => 0),
        ]);
        const identityKb = Math.round((soulSize + claudeSize) / 1024);
        const breaches: string[] = [];
        if (memoryLines > 120) breaches.push(`MEMORY.md ${memoryLines} lines (threshold 120)`);
        if (topicsCount > 55) breaches.push(`topics ${topicsCount} files (threshold 55)`);
        if (identityKb > 12) breaches.push(`identity ${identityKb}kB (threshold 12kB)`);
        if (breaches.length > 0) {
          slog('PRUNE-THRESHOLD', `⚠ exceeded: ${breaches.join(', ')} — daily prune will handle`);
        }
      } catch { /* fire-and-forget */ }
    })(), 3000);

    // OODA-Only: no queue to restore
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      slog('SERVER', `Port ${port} is already in use. Try: mini-agent kill --all, or use --port <port>`);
      process.exit(1);
    }
    throw err;
  });

  // ── HTTPS Server (optional, for mobile sensor permissions) ──
  let httpsServer: https.Server | null = null;
  if (process.env.HTTPS_ENABLED === 'true') {
    const certPath = process.env.HTTPS_CERT
      || path.join(os.homedir(), '.mini-agent', 'tls', 'cert.pem');
    const keyPath = process.env.HTTPS_KEY
      || path.join(os.homedir(), '.mini-agent', 'tls', 'key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const httpsPort = parseInt(process.env.HTTPS_PORT || String(port + 442), 10);
      httpsServer = https.createServer({
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      }, app);

      httpsServer.listen(httpsPort, () => {
        slog('SERVER', `HTTPS started on :${httpsPort}`);
      });

      httpsServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          slog('WARN', `HTTPS port ${httpsPort} already in use, skipping HTTPS`);
        } else {
          slog('WARN', `HTTPS server error: ${err.message}`);
        }
        httpsServer = null;
      });
    } else {
      slog('WARN', `HTTPS enabled but certs not found at ${certPath}`);
    }
  }

  // ── Graceful Shutdown ──
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const mem = process.memoryUsage();
    slog('SERVER', `Shutting down... (heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB, rss=${Math.round(mem.rss / 1048576)}MB)`);

    // Stop accepting new work (loop, cron, telegram)
    if (loopRef) loopRef.stop();
    stopCronTasks();
    if (telegramPoller) telegramPoller.stop();
    stopHeartbeat();
    stopMemoryCache();
    stopForegroundSweep();

    // Kill all child processes (loop, foreground, delegations) to prevent orphans
    const killedChildren = killAllChildProcesses();
    const killedDelegations = killAllDelegations();
    if (killedChildren + killedDelegations > 0) {
      slog('SERVER', `Killed ${killedChildren} child + ${killedDelegations} delegation process(es)`);
    }

    // Graceful HTTP + HTTPS server close
    if (httpsServer) httpsServer.close();
    server.close(() => {
      slog('SERVER', 'Stopped');
      process.exit(0);
    });

    // Force exit after 10s if server.close hangs (Claude call already done)
    setTimeout(() => {
      slog('SERVER', 'Force exit after timeout');
      process.exit(1);
    }, 10_000);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // ── SIGUSR1: Graceful Recycle (OpenClaw pattern) ──
  // Unlike SIGTERM (final stop), SIGUSR1 is a proactive recycle: drain active
  // work, exit(0), then launchd KeepAlive relaunches with a fresh V8 heap.
  // Used to escape accumulated memory pressure without dropping messages.
  // Evidence: OpenClaw run-loop.ts:47-116 uses the same idiom under launchd.
  // 240s covers p99=180s cycle + 60s margin (Kuro 2026-04-18 measured distribution:
  // p50=39s, p75=70s, p90=150s, p99=180s). 60s would cut >50% of cycles mid-flight.
  const DRAIN_TIMEOUT_MS = 240_000;
  let draining = false;
  const drainAndExit = async (reason: string): Promise<void> => {
    if (draining || shuttingDown) return;
    draining = true;
    slog('SERVER', `Drain started (reason=${reason}) — pausing loop, waiting for active cycle`);

    // Pause loop so no new cycle starts; current cycle keeps running
    if (loopRef) loopRef.pause();

    // Poll for loop idle up to DRAIN_TIMEOUT_MS
    const start = Date.now();
    while (Date.now() - start < DRAIN_TIMEOUT_MS) {
      const status = loopRef?.getStatus();
      if (!status || !status.running) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const waited = Date.now() - start;
    slog('SERVER', `Drain complete after ${waited}ms — invoking shutdown`);
    await shutdown();
  };
  process.on('SIGUSR1', () => void drainAndExit('SIGUSR1'));
}
