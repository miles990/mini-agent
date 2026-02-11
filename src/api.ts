/**
 * HTTP API Entry Point
 *
 * REST API for mini-agent with instance management
 */

import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { isClaudeBusy, getCurrentTask, getQueueStatus, hasQueuedMessages, restoreQueue } from './agent.js';
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
} from './memory.js';
import { getConfig, updateConfig, resetConfig, DEFAULT_CONFIG } from './config.js';
import {
  getInstanceManager,
  loadInstanceConfig,
  updateInstanceConfig,
  listInstances,
  getCurrentInstanceId,
} from './instance.js';
import { getLogger, type LogType } from './logging.js';
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

export function createApi(port = 3001): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(authMiddleware);
  app.use(createRateLimiter());

  // Request logging middleware (skip /health to reduce noise)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') { next(); return; }
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

    // 過濾出學習/行動相關的 behavior（action.task / action.autonomous / loop.cycle.end）
    const learningEntries = entries.filter(e => {
      const action = e.data.action;
      const detail = e.data.detail || '';
      return (action === 'action.task' || action === 'action.autonomous') && detail.includes('**What**:');
    });

    // 解析結構化內容
    const digest = learningEntries.map(e => {
      const detail = e.data.detail || '';
      const what = detail.match(/\*\*What\*\*:\s*(.+?)(?:\n|$)/)?.[1]?.trim() || '';
      const why = detail.match(/\*\*Why\*\*:\s*(.+?)(?:\n|$)/)?.[1]?.trim() || '';
      const changed = detail.match(/\*\*Changed\*\*:\s*\n([\s\S]*?)(?:\*\*Verified|$)/)?.[1]?.trim() || '';
      const verified = detail.match(/\*\*Verified\*\*:\s*(.+?)(?:\n|$)/)?.[1]?.trim() || '';
      // 提取所有 URL
      const urls = [...detail.matchAll(/https?:\/\/[^\s)>\]]+/g)].map(m => m[0]);
      return { timestamp: e.timestamp, what, why, changed, verified, urls, full: detail };
    });

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
        if (line.startsWith('- ') && !line.startsWith('- [2') && currentEntry) {
          // Undated entry — skip (old format)
          currentEntry = '';
        }
        if (line.startsWith('- [2')) {
          // Flush previous
          if (currentEntry) parseEntry(currentEntry, topic, date, entries);
          currentEntry = line;
        } else if (currentEntry && (line.startsWith('  ') || line === '')) {
          currentEntry += '\n' + line;
        } else if (line.startsWith('- ') && !line.startsWith('- [2')) {
          if (currentEntry) parseEntry(currentEntry, topic, date, entries);
          currentEntry = '';
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

  // Dashboard HTML — 靜態頁面
  app.get('/dashboard', (_req: Request, res: Response) => {
    const dashboardPath = path.join(import.meta.dirname, '..', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath);
    } else {
      res.status(404).send('Dashboard not found');
    }
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
  setCustomExtensions({
    perceptions: currentAgent?.perception?.custom,
    skills: currentAgent?.skills,
  });

  // ── Telegram Poller ──
  const memoryDir = path.resolve(composeFile ? path.dirname(composeFile) : '.', 'memory');
  const telegramPoller = createTelegramPoller(memoryDir);

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
