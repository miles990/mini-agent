/**
 * HTTP API Entry Point
 *
 * REST API for mini-agent with instance management
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { isClaudeBusy, getCurrentTask, getQueueStatus, hasQueuedMessages, restoreQueue, getProvider, getFallback } from './agent.js';
import { dispatch, getLaneStats } from './dispatcher.js';
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
import { getActiveCronTasks, addCronTask, removeCronTask, reloadCronTasks, startCronTasks, getCronTaskCount, stopCronTasks } from './cron.js';
import { AgentLoop, parseInterval } from './loop.js';
import { findComposeFile, readComposeFile } from './compose.js';
import { setSelfStatusProvider, setPerceptionProviders, setCustomExtensions } from './memory.js';
import { createTelegramPoller, getTelegramPoller, getNotificationStats } from './telegram.js';
import {
  getProcessStatus, getLogSummary, getNetworkStatus, getConfigSnapshot,
  getActivitySummary,
} from './workspace.js';
import { loadGlobalConfig } from './instance.js';
import type { CreateInstanceOptions, InstanceConfig, CronTask } from './types.js';
import { initObservability } from './observability.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';

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

  return (req: Request, res: Response, next: NextFunction): void => {
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
  const SILENT_PATHS = new Set(['/health', '/status', '/api/dashboard/behaviors', '/api/dashboard/learning', '/api/dashboard/journal', '/api/dashboard/cognition', '/api/dashboard/capabilities', '/api/dashboard/context', '/api/dashboard/inner-state', '/api/events']);
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

  // Unified status — 聚合所有子系統狀態
  app.get('/status', (_req: Request, res: Response) => {
    res.json({
      instance: getCurrentInstanceId(),
      uptime: Math.floor(process.uptime()),
      claude: {
        busy: isClaudeBusy(),
        currentTask: getCurrentTask(),
        queue: getQueueStatus(),
      },
      lanes: getLaneStats(),
      loop: loopRef ? { enabled: true, ...loopRef.getStatus() } : { enabled: false },
      cron: { active: getCronTaskCount() },
      telegram: {
        connected: !!getTelegramPoller(),
        notifications: getNotificationStats(),
      },
      provider: {
        primary: getProvider(),
        fallback: getFallback(),
        codexModel: process.env.CODEX_MODEL || null,
      },
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

  app.post('/chat', async (req: Request, res: Response) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    slog('CHAT', `← "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);
    const chatStart = Date.now();

    try {
      // 排隊訊息處理完成時，透過 TG 發送回覆（因為 HTTP 連線已斷）
      const onQueueComplete = async (result: { content: string }) => {
        const poller = getTelegramPoller();
        if (!poller || !result.content) return;
        await poller.sendMessage(result.content);
        slog('CHAT', `→ [queued-reply] ${result.content.slice(0, 80)}${result.content.length > 80 ? '...' : ''}`);
      };

      const response = await dispatch({ message, source: 'api', onQueueComplete });
      const elapsed = ((Date.now() - chatStart) / 1000).toFixed(1);

      if (response.queued) {
        slog('CHAT', `→ [queued] position ${response.position} (${elapsed}s)`);
        res.status(202).json(response);
      } else {
        slog('CHAT', `→ "${response.content.slice(0, 80)}${response.content.length > 80 ? '...' : ''}" (${elapsed}s)`);
        res.json(response);
      }
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
      .map(e => ({
        timestamp: e.timestamp,
        what: e.what || e.changed || '',
        why: e.why,
        changed: e.changed,
        verified: e.verified,
        urls: e.sources,
        full: e.full,
      }))
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
      const thoughts: { date: string; topic: string; summary: string }[] = [];
      const thoughtsSection = soul.match(/## My Thoughts\n([\s\S]*?)(?=\n## )/);
      if (thoughtsSection) {
        const lines = thoughtsSection[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]\s*(.+?):\s*([\s\S]+)/);
          if (m) {
            thoughts.push({
              date: m[1],
              topic: m[2].trim(),
              summary: m[3].trim(),
            });
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

      res.json({
        traits,
        interests: interestsRaw.slice(0, 20),
        thoughts: thoughts.slice(0, 11),
        innerVoice,
        currentFocus,
        mood: { state: mood, detail: moodDetail },
        recentThinking,
        topicPulse: topicUtility,
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
      const statePath = path.join(os.homedir(), '.mini-agent', 'mobile-state.json');
      const stateDir = path.dirname(statePath);
      if (!fs.existsSync(stateDir)) {
        await fsPromises.mkdir(stateDir, { recursive: true });
      }

      const state = { ...data, updatedAt: new Date().toISOString() };
      await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2));
      eventBus.emit('trigger:mobile', { data: state });

      res.json({ ok: true });
    } catch (error) {
      slog('MOBILE', `Sensor write failed: ${error instanceof Error ? error.message : error}`);
      res.status(500).json({ error: 'Failed to write sensor data' });
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

  // ── Telegram Poller ──
  const memoryDir = path.resolve(composeFile ? path.dirname(composeFile) : '.', 'memory');
  const telegramPoller = createTelegramPoller(memoryDir);

  initObservability();

  const server = app.listen(port, () => {
    slog('SERVER', `Started on :${port} (instance: ${instanceId})`);
    const cronCount = getCronTaskCount();
    if (cronCount > 0) slog('CRON', `${cronCount} task(s) active`);
    if (loopRef) {
      loopRef.start();
    }
    if (telegramPoller) {
      telegramPoller.start();
    }

    // 恢復上次中斷的 queue（Telegram poller 須先初始化）
    restoreQueue();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      slog('SERVER', `Port ${port} is already in use. Try: mini-agent kill --all, or use --port <port>`);
      process.exit(1);
    }
    throw err;
  });

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

    // Wait for in-flight Claude CLI call + queued messages to finish
    if (isClaudeBusy() || hasQueuedMessages()) {
      const reason = isClaudeBusy() ? 'Claude CLI call' : 'queued messages';
      slog('SERVER', `Waiting for ${reason} to finish...`);
      const maxWait = 600_000; // 10 minutes (> 8 min timeout)
      const start = Date.now();
      while ((isClaudeBusy() || hasQueuedMessages()) && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 2000));
      }
      if (isClaudeBusy() || hasQueuedMessages()) {
        slog('SERVER', `Still busy/queued after ${maxWait / 1000}s, forcing exit`);
      } else {
        slog('SERVER', `All tasks finished after ${((Date.now() - start) / 1000).toFixed(0)}s`);
      }
    }

    // Graceful HTTP server close
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
