/**
 * HTTP API Entry Point
 *
 * REST API for mini-agent
 */

import express, { type Request, type Response } from 'express';
import { processMessage } from './agent.js';
import { startProactive, stopProactive, triggerHeartbeat } from './proactive.js';
import {
  searchMemory,
  readMemory,
  readHeartbeat,
  updateHeartbeat,
  appendMemory,
  buildContext,
  addTask,
} from './memory.js';
import { getConfig, updateConfig, resetConfig, DEFAULT_CONFIG } from './config.js';

export function createApi(port = 3001): express.Express {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'mini-agent' });
  });

  // Chat endpoint
  app.post('/chat', async (req: Request, res: Response) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const response = await processMessage(message);
      res.json(response);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Memory endpoints
  app.get('/memory', async (_req: Request, res: Response) => {
    const memory = await readMemory();
    res.json({ memory });
  });

  app.get('/memory/search', async (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'q parameter is required' });
      return;
    }

    const results = await searchMemory(query);
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

  // Context endpoint (for debugging)
  app.get('/context', async (_req: Request, res: Response) => {
    const context = await buildContext();
    res.json({ context });
  });

  // Task endpoint
  app.post('/tasks', async (req: Request, res: Response) => {
    const { task, schedule } = req.body;

    if (!task || typeof task !== 'string') {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    await addTask(task, schedule);
    res.json({ success: true, task, schedule });
  });

  // Heartbeat endpoints
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

  app.post('/heartbeat/trigger', async (_req: Request, res: Response) => {
    const result = await triggerHeartbeat();
    res.json({ result: result ?? 'No action needed' });
  });

  // Proactive control
  app.post('/proactive/start', async (req: Request, res: Response) => {
    const config = await getConfig();
    const schedule = req.body.schedule ?? config.proactiveSchedule;
    startProactive({ schedule });
    res.json({ success: true, schedule });
  });

  app.post('/proactive/stop', (_req: Request, res: Response) => {
    stopProactive();
    res.json({ success: true });
  });

  // Config endpoints
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

  return app;
}

// Start server if run directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  const app = createApi(port);

  app.listen(port, () => {
    console.log(`Mini-Agent API running on http://localhost:${port}`);
    console.log('Endpoints:');
    console.log('  POST /chat            - Send a message');
    console.log('  GET  /memory          - Read long-term memory');
    console.log('  GET  /memory/search?q=- Search memory');
    console.log('  POST /memory          - Add to memory');
    console.log('  POST /tasks           - Add a task');
    console.log('  GET  /heartbeat       - Read HEARTBEAT.md');
    console.log('  POST /heartbeat/trigger - Trigger heartbeat');
    console.log('  POST /proactive/start - Start proactive mode');
    console.log('  POST /proactive/stop  - Stop proactive mode');
    console.log('  GET  /config          - Get configuration');
    console.log('  PUT  /config          - Update configuration');
    console.log('  POST /config/reset    - Reset to defaults');
  });
}
