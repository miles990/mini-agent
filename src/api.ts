/**
 * HTTP API Entry Point
 *
 * REST API for mini-agent with instance management
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { isClaudeBusy, getCurrentTask, getProvider, getFallback, getLaneStatus, callClaude } from './agent.js';
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
import {
  getInstanceManager,
  loadInstanceConfig,
  updateInstanceConfig,
  listInstances,
  getCurrentInstanceId,
} from './instance.js';
import { getLogger, type LogType, type BehaviorLogEntry } from './logging.js';
import { getActiveCronTasks, addCronTask, removeCronTask, reloadCronTasks, startCronTasks, getCronTaskCount, getCronQueueSize, stopCronTasks } from './cron.js';
import { AgentLoop, parseInterval } from './loop.js';
import { findComposeFile, readComposeFile } from './compose.js';
import { setSelfStatusProvider, setPerceptionProviders, setCustomExtensions } from './memory.js';
import { createTelegramPoller, getTelegramPoller, getNotificationStats } from './telegram.js';
import { createDigestBot, getDigestBot } from './digest-bot.js';
import { digestContent, getDigestEntries, generateInstantDailyDigest } from './digest-pipeline.js';
import {
  getProcessStatus, getLogSummary, getNetworkStatus, getConfigSnapshot,
  getActivitySummary,
} from './workspace.js';
import { loadGlobalConfig } from './instance.js';
import type { CreateInstanceOptions, InstanceConfig, CronTask } from './types.js';
import { initObservability, writeRoomMessage } from './observability.js';
import { initFeatures, isEnabled, setEnabled, toggle, getFeatureReport, getFeature, resetStats, getFeatureNames } from './features.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';
import { writeInboxItem } from './inbox.js';
import { getMode, setMode, isValidMode, setLoopController, getModeNames, type ModeName } from './mode.js';
import { parseTags } from './dispatcher.js';

// =============================================================================
// Server Log Helper (re-exported from utils to avoid circular deps)
// =============================================================================

export { slog, setSlogPrefix } from './utils.js';
import { slog, setSlogPrefix, diagLog } from './utils.js';

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

  // Allow health endpoint without auth
  if (req.path === '/health') {
    next();
    return;
  }

  const provided = req.headers['x-api-key'] as string
    ?? req.headers['authorization']?.replace('Bearer ', '');

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
// Auto-detect ConversationThread from Room messages (Alex only, conservative)
// =============================================================================

async function autoDetectRoomThread(msgId: string, text: string): Promise<void> {
  const memory = getMemory();
  const hasQuestion = /[?？]/.test(text);
  const hasUrl = /https?:\/\/[^\s]+/.test(text);

  if (!hasQuestion && !hasUrl) return;

  const type = hasQuestion ? 'question' : 'share';
  await memory.addConversationThread({
    type,
    content: text.slice(0, 200),
    source: 'room:alex',
    roomMsgId: msgId,
  });
}

export function createApi(port = 3001): express.Express {
  const app = express();
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
    res.json({
      status: 'ok',
      service: 'mini-agent',
      instance: getCurrentInstanceId(),
    });
  });

  // Unified status — 聚合所有子系統狀態 (OODA-Only)
  app.get('/status', (_req: Request, res: Response) => {
    const laneStatus = getLaneStatus();
    res.json({
      instance: getCurrentInstanceId(),
      uptime: Math.floor(process.uptime()),
      claude: {
        busy: isClaudeBusy(),
        loop: laneStatus.loop,
      },
      loop: loopRef ? { enabled: true, ...loopRef.getStatus() } : { enabled: false },
      cron: { active: getCronTaskCount(), queued: getCronQueueSize() },
      telegram: {
        connected: !!getTelegramPoller(),
        notifications: getNotificationStats(),
      },
      digestBot: {
        enabled: !!getDigestBot(),
        running: getDigestBot()?.isRunning() ?? false,
        subscribers: getDigestBot()?.getSubscriberCount() ?? 0,
      },
      provider: {
        primary: getProvider(),
        fallback: getFallback(),
        codexModel: process.env.CODEX_MODEL || null,
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

      // Emit trigger:chat to wake idle AgentLoop immediately
      eventBus.emit('trigger:chat', { source: 'chat-api', messageCount: 1 });

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
      const { execSync } = await import('node:child_process');
      const cwd = process.cwd();
      const raw = execSync(
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
      const { execFileSync } = await import('node:child_process');
      const cwd = process.cwd();
      const raw = execFileSync(
        'grep', ['-rni', '--include=*.md', query, 'memory/'],
        { cwd, encoding: 'utf-8', timeout: 5000 },
      ).split('\n').slice(0, limit).join('\n').trim();

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
    } else if (name === 'digest-bot') {
      const bot = getDigestBot();
      if (bot) { newState ? bot.start() : bot.stop(); }
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
          const nextPath = path.join(process.cwd(), 'memory', 'NEXT.md');
          let nextContent = '';
          try { nextContent = await fsPromises.readFile(nextPath, 'utf-8'); } catch { /* ok */ }
          // 擷取 in-progress 任務（含 Now + Next sections）
          const inProgressLines = nextContent
            .split('\n')
            .filter(l => /- \[.\]/.test(l))
            .slice(0, 20)
            .join('\n');

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

  // =============================================================================
  // Dashboard
  // =============================================================================

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

  // Dashboard HTML — 靜態頁面
  app.get('/dashboard', (_req: Request, res: Response) => {
    const dashboardPath = path.join(import.meta.dirname, '..', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath);
    } else {
      res.status(404).send('Dashboard not found');
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

  // POST /api/digest — digest content (channel-agnostic entry point)
  app.post('/api/digest', async (req: Request, res: Response) => {
    const { content, url, type, channel, metadata } = req.body ?? {};

    if (!content && !url) {
      res.status(400).json({ error: 'content or url is required' });
      return;
    }

    try {
      const entry = await digestContent({
        content: content ?? url ?? '',
        url,
        type,
        channel: channel ?? 'api',
        metadata,
      });
      res.json({
        ok: true,
        id: entry.id,
        category: entry.category,
        summary: entry.summary,
        tags: entry.tags,
        ts: entry.ts,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Digest failed' });
    }
  });

  // GET /api/digest — list entries for a date
  app.get('/api/digest', (req: Request, res: Response) => {
    const date = req.query.date as string | undefined;
    const entries = getDigestEntries(date);
    res.json({ date: date ?? new Date().toISOString().slice(0, 10), count: entries.length, entries });
  });

  // GET /api/digest/daily — formatted daily summary
  app.get('/api/digest/daily', async (req: Request, res: Response) => {
    const date = req.query.date as string | undefined;
    try {
      const summary = await generateInstantDailyDigest(date);
      res.json({ date: date ?? new Date().toISOString().slice(0, 10), summary });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate daily digest' });
    }
  });

  // =============================================================================
  // Team Chat Room
  // =============================================================================

  // Serve chat-room.html
  app.get('/chat-ui', (_req: Request, res: Response) => {
    const htmlPath = path.join(process.cwd(), 'chat-room.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('chat-room.html not found');
    }
  });

  // POST /api/room — send a message to chat room
  app.post('/api/room', async (req: Request, res: Response) => {
    const { from, text, replyTo } = req.body;

    if (!from || !text || typeof from !== 'string' || typeof text !== 'string') {
      res.status(400).json({ error: 'from and text are required' });
      return;
    }

    const validFrom = ['alex', 'kuro', 'claude-code'];
    if (!validFrom.includes(from)) {
      res.status(400).json({ error: `from must be one of: ${validFrom.join(', ')}` });
      return;
    }

    try {
      // Write message via writeRoomMessage (generates ID, writes JSONL, emits action:room)
      const id = await writeRoomMessage(from, text, replyTo as string | undefined);
      const now = new Date();
      const timestamp = now.toISOString();

      // Parse mentions for inbox logic
      const mentions: string[] = [];
      if (text.includes('@kuro')) mentions.push('kuro');
      if (text.includes('@claude')) mentions.push('claude-code');
      if (text.includes('@alex')) mentions.push('alex');

      // If not from kuro and mentions kuro (or no mention) → write to inbox
      if (from !== 'kuro' && (mentions.includes('kuro') || mentions.length === 0)) {
        const inboxPath = path.join(os.homedir(), '.mini-agent', 'chat-room-inbox.md');
        const localTime = now.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16);
        const replyHint = replyTo ? ` ↩${replyTo}` : '';
        const inboxEntry = `- [${localTime}] (${from}) [${id}]${replyHint} ${text}`;

        let content = '';
        try { content = await fsPromises.readFile(inboxPath, 'utf-8'); } catch { /* file doesn't exist */ }

        if (!content.includes('## Pending')) {
          content = `## Pending\n\n## Processed\n`;
        }
        content = content.replace('## Pending\n', `## Pending\n${inboxEntry}\n`);
        await fsPromises.writeFile(inboxPath, content, 'utf-8');

        eventBus.emit('trigger:room', { source: 'room-api', from, text, roomMsgId: id });
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
          },
        });
      }

      // Auto-detect conversation threads (only for Alex's messages) — fire-and-forget
      if (from === 'alex') {
        autoDetectRoomThread(id, text).catch(() => {});
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
    res.flushHeaders();

    const handler = (event: AgentEvent): void => {
      const payload = JSON.stringify({ type: event.type, data: event.data, ts: event.timestamp });
      res.write(`data: ${payload}\n\n`);
    };

    eventBus.on('action:room', handler);
    eventBus.on('trigger:room', handler);

    const keepalive = setInterval(() => res.write(':ping\n\n'), 30_000);

    _req.on('close', () => {
      eventBus.off('action:room', handler);
      eventBus.off('trigger:room', handler);
      clearInterval(keepalive);
    });
  });

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

      // 補充 MEMORY.md 頭 2000 chars
      const memContent = await readMemory();
      if (memContent) {
        const memExcerpt = memContent.slice(0, 2000);
        context += `\n\n<memory>\n${memExcerpt}\n</memory>`;
      }

      // 補充今日 Chat Room 最近 15 條
      const today = new Date().toISOString().slice(0, 10);
      const convPath = path.join(process.cwd(), 'memory', 'conversations', `${today}.jsonl`);
      try {
        const raw = await fsPromises.readFile(convPath, 'utf-8');
        const msgs = raw.split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line) as { from: string; text: string; ts?: string }; } catch { return null; }
        }).filter(Boolean).slice(-15);
        if (msgs.length > 0) {
          const chatLines = msgs.map(m => `[${m!.ts ?? ''}] (${m!.from}) ${m!.text}`).join('\n');
          context += `\n\n<chat_room_today>\n${chatLines}\n</chat_room_today>`;
        }
      } catch { /* no conversations today */ }

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

      const contextAge = new Date().toISOString();
      context += `\n\n<ask_mode>\n這是 /api/ask 直接問答模式，不跑感知 plugins。感知資料為快取（${contextAge}）。\n</ask_mode>`;

      const { response } = await callClaude(question, context, 1, { source: 'ask' });

      // 處理 <kuro:remember> tags（fire-and-forget）
      const tags = parseTags(response);
      for (const rem of tags.remembers) {
        if (rem.topic) {
          memory.appendTopicMemory(rem.topic, rem.content, rem.ref).catch(() => {});
        } else {
          memory.appendMemory(rem.content).catch(() => {});
        }
      }

      res.json({ ok: true, answer: tags.cleanContent, contextAge });
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
    res.flushHeaders();

    const handler = (event: AgentEvent): void => {
      const payload = JSON.stringify({ type: event.type, data: event.data, ts: event.timestamp });
      res.write(`data: ${payload}\n\n`);
    };

    eventBus.on('action:*', handler);
    eventBus.on('trigger:*', handler);

    const keepalive = setInterval(() => res.write(':ping\n\n'), 30_000);

    _req.on('close', () => {
      eventBus.off('action:*', handler);
      eventBus.off('trigger:*', handler);
      clearInterval(keepalive);
    });
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
  diagLog('FATAL.uncaught', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  diagLog('WARN.unhandledRejection', reason);
});

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  const app = createApi(port);
  const instanceId = getCurrentInstanceId();
  const instanceConfig = loadInstanceConfig(instanceId);

  // ── 設定 slog 前綴（讓日誌能區分實例） ──
  setSlogPrefix(instanceId, instanceConfig?.name);

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

  // ── Perception Providers ──
  const logger = getLogger();
  const manager = getInstanceManager();

  setPerceptionProviders({
    process: () => getProcessStatus(
      () => manager.listStatus()
        .filter(s => s.id !== instanceId)
        .map(s => ({ id: s.id, name: s.name, port: s.port, running: s.running })),
      () => {
        const stats = logger.query({ limit: 0 }); // just to get counts
        const today = new Date().toISOString().split('T')[0];
        const cLogs = logger.queryClaudeLogs(today, 0).length;
        const aLogs = logger.queryApiLogs(today, 0).length;
        const crLogs = logger.queryCronLogs(today, 0).length;
        const eLogs = logger.queryErrorLogs(today, 0).length;
        return { claude: cLogs, api: aLogs, cron: crLogs, error: eLogs };
      },
    ),
    logs: () => getLogSummary(
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
    ),
    network: () => getNetworkStatus(port),
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
  const enabledPerceptions = currentAgent?.perception?.custom?.filter(p => p.enabled !== false);
  setCustomExtensions({
    perceptions: enabledPerceptions,
    skills: currentAgent?.skills,
  });

  // Phase 4: 啟動 perception streams（獨立 interval + distinctUntilChanged）
  if (enabledPerceptions && enabledPerceptions.length > 0) {
    const cwd = composeFile ? path.dirname(path.resolve(composeFile)) : process.cwd();
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

  // ── Telegram Poller ──
  const memoryDir = path.resolve(composeFile ? path.dirname(composeFile) : '.', 'memory');
  const telegramPoller = createTelegramPoller(memoryDir);

  // ── Feature Toggles ──
  initFeatures();

  // ── Digest Bot (separate TG bot for AI paper digests) ──
  const digestBot = createDigestBot();

  initObservability();

  const server = app.listen(port, () => {
    slog('SERVER', `Started on :${port} (instance: ${instanceId})`);
    const cronCount = getCronTaskCount();
    if (cronCount > 0) slog('CRON', `${cronCount} task(s) active`);
    if (loopRef) {
      loopRef.start();

      // 恢復持久化 mode；找不到持久化狀態才預設 calm
      let startupMode: ModeName = 'calm';
      const modeStatePath = path.join(os.homedir(), '.mini-agent', 'instances', instanceId, 'mode.json');
      try {
        const saved = JSON.parse(fs.readFileSync(modeStatePath, 'utf-8')) as { mode?: string };
        if (saved.mode && isValidMode(saved.mode)) {
          startupMode = saved.mode;
        }
      } catch { /* no persisted mode, use calm */ }

      setMode(startupMode);
      slog('MODE', `Startup mode: ${startupMode}${startupMode === 'calm' ? ' (default)' : ' (restored)'}`);
    }
    if (telegramPoller && isEnabled('telegram-poller')) {
      telegramPoller.start();
    }
    if (digestBot && isEnabled('digest-bot')) {
      digestBot.start();
    }

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
    slog('SERVER', 'Shutting down...');

    // Stop accepting new work (loop, cron, telegram)
    if (loopRef) loopRef.stop();
    stopCronTasks();
    if (telegramPoller) telegramPoller.stop();
    if (digestBot) digestBot.stop();

    // Wait for in-flight Claude CLI call to finish
    if (isClaudeBusy()) {
      slog('SERVER', 'Waiting for Claude CLI call to finish...');
      const maxWait = 600_000; // 10 minutes (> 8 min timeout)
      const start = Date.now();
      while (isClaudeBusy() && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 2000));
      }
      if (isClaudeBusy()) {
        slog('SERVER', `Still busy after ${maxWait / 1000}s, forcing exit`);
      } else {
        slog('SERVER', `All tasks finished after ${((Date.now() - start) / 1000).toFixed(0)}s`);
      }
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
}
