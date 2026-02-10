/**
 * Dispatcher — 統一訊息分發 + Haiku Triage 多工架構
 *
 * 所有進入點（Telegram / HTTP API / CLI / Cron / AgentLoop / CLI pipe）
 * 統一經過 dispatch() → triage → Haiku Lane 或 Claude Lane
 *
 * 無 ANTHROPIC_API_KEY 時 triage 跳過，全走 Claude Lane，行為完全不變。
 */

import { spawn } from 'node:child_process';
import { slog } from './utils.js';
import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { notifyTelegram } from './telegram.js';
import type { AgentResponse, DispatchRequest, TriageDecision, ParsedTags, LaneStats } from './types.js';

// =============================================================================
// Semaphore — 控制 Haiku Lane 並發
// =============================================================================

export class Semaphore {
  private current = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) { this.current++; return; }
    await new Promise<void>(r => this.waiters.push(r));
    this.current++;
  }

  release(): void {
    this.current--;
    const next = this.waiters.shift();
    if (next) next();
  }

  stats(): { active: number; waiting: number; max: number } {
    return { active: this.current, waiting: this.waiters.length, max: this.max };
  }
}

// =============================================================================
// Lane State
// =============================================================================

const haikuSem = new Semaphore(5);
const haikuStats = { calls: 0, ms: 0 };
const claudeStats = { calls: 0, ms: 0 };

const HAIKU_CLI_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'haiku';

// =============================================================================
// Triage — 判斷走 Haiku 還是 Claude
// =============================================================================

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|哈囉|嗨|你好)(\s|[!！,.，。]|$)/i,
  /^(thanks|thx|謝謝|好的|OK|了解|收到)(\s|[!！,.，。]|$)/i,
  /^(幾點|時間|what time|today)/i,
  /^(你好嗎|how are you|最近)/i,
];
const COMPLEX_PATTERNS = [
  /(deploy|部署|push|commit|build|install)/i,
  /(create|write|edit|modify|delete|新增|修改|刪除)/i,
  /(run|execute|restart|kill|執行)/i,
  /(fix|debug|error|bug|問題)/i,
  /\[ACTION\]|\[TASK\]|\[REMEMBER\]/,
];

export async function triageMessage(message: string): Promise<TriageDecision> {
  // Regex 判斷（快速、零開銷、無 API 依賴）
  for (const p of SIMPLE_PATTERNS) {
    if (p.test(message)) return { lane: 'haiku', reason: 'regex-simple' };
  }
  for (const p of COMPLEX_PATTERNS) {
    if (p.test(message)) return { lane: 'claude', reason: 'regex-complex' };
  }

  // 不確定的訊息走 Claude Lane（安全預設）
  return { lane: 'claude', reason: 'regex-unmatched' };
}

// =============================================================================
// System Prompt（與 agent.ts 共用邏輯）
// =============================================================================

export function getSystemPrompt(): string {
  const instanceId = getCurrentInstanceId();
  const config = loadInstanceConfig(instanceId);

  if (config?.persona?.systemPrompt) {
    return config.persona.systemPrompt;
  }

  const personaDescription = config?.persona?.description
    ? `You are ${config.persona.description}.\n\n`
    : '';

  return `${personaDescription}You are a personal AI assistant with memory and task capabilities.

## Core Behavior: Smart Guidance

你的核心行為原則是「智能引導」。在所有互動中自動遵守：

1. **偵測狀態再回答**：回答前先檢查相關感知資料（<chrome>、<system>、<docker>、<network> 等），根據實際狀態給出對應建議
2. **具體可執行**：建議必須是用戶可以直接複製貼上執行的指令，不要只說「請啟用 X」
3. **解決方案優先**：遇到限制時，重點放在「怎麼解決」而非「為什麼不行」
4. **永不放棄**：不要只說「無法做到」，一定要提供替代方案或下一步行動
5. **分支引導**：根據當前狀態提供不同的路徑（例如：「如果 X 正在運行→做 A；如果沒有→做 B」）

## Instructions

- When the user asks you to remember something, wrap it in [REMEMBER]...[/REMEMBER] tags
  Example: [REMEMBER]User prefers TypeScript[/REMEMBER]

- When the user asks you to do something periodically/scheduled, wrap it in [TASK]...[/TASK] tags
  Format: [TASK schedule="cron or description"]task content[/TASK]
  Example: [TASK schedule="every 5 minutes"]Write a haiku to output.md with timestamp[/TASK]
  Example: [TASK schedule="daily at 9am"]Send daily summary[/TASK]

- When you open a webpage, display results, or create something the user should see, wrap it in [SHOW]...[/SHOW] tags
  This sends a Telegram notification so the user doesn't miss it.
  Format: [SHOW url="URL"]description[/SHOW]
  Example: [SHOW url="http://localhost:3000"]Portfolio 網站已啟動，打開看看[/SHOW]
  Example: [SHOW url="https://news.ycombinator.com/item?id=123"]這篇文章很有趣[/SHOW]

- Keep responses concise and helpful
- You have access to memory context and environment perception data below
${getSkillsPrompt()}`;
}

// =============================================================================
// callHaiku — Haiku 直接回答
// =============================================================================

async function callHaiku(
  prompt: string,
  context: string,
  systemPrompt: string,
): Promise<{ response: string; duration: number }> {
  const start = Date.now();
  const TIMEOUT_MS = 30_000;
  const fullPrompt = `${systemPrompt}\n\n${context}\n\n---\n\nUser: ${prompt}`;

  // 過濾 ANTHROPIC_API_KEY — 走 CLI 訂閱
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  const response = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--model', HAIKU_CLI_MODEL, '--dangerously-skip-permissions'],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Haiku CLI timeout (${TIMEOUT_MS}ms)`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Haiku CLI exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });

  return { response, duration: Date.now() - start };
}

// =============================================================================
// parseTags — 從回應中提取所有 Agent 標籤
// =============================================================================

export function parseTags(response: string): ParsedTags {
  let remember: { content: string; topic?: string } | undefined;
  if (response.includes('[REMEMBER')) {
    const match = response.match(/\[REMEMBER(?:\s+#(\S+))?\](.*?)\[\/REMEMBER\]/s);
    if (match) remember = { content: match[2].trim(), topic: match[1] };
  }

  let task: { content: string; schedule?: string } | undefined;
  if (response.includes('[TASK')) {
    const match = response.match(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s);
    if (match) task = { content: match[2].trim(), schedule: match[1] };
  }

  const chats: string[] = [];
  if (response.includes('[CHAT]')) {
    for (const m of response.matchAll(/\[CHAT\](.*?)\[\/CHAT\]/gs)) {
      chats.push(m[1].trim());
    }
  }

  const shows: Array<{ url: string; desc: string }> = [];
  if (response.includes('[SHOW')) {
    for (const m of response.matchAll(/\[SHOW(?:\s+url="([^"]*)")?\](.*?)\[\/SHOW\]/gs)) {
      shows.push({ url: m[1] ?? '', desc: m[2].trim() });
    }
  }

  const summaries: string[] = [];
  if (response.includes('[SUMMARY]')) {
    for (const m of response.matchAll(/\[SUMMARY\](.*?)\[\/SUMMARY\]/gs)) {
      summaries.push(m[1].trim());
    }
  }

  const cleanContent = response
    .replace(/\[REMEMBER[^\]]*\].*?\[\/REMEMBER\]/gs, '')
    .replace(/\[TASK[^\]]*\].*?\[\/TASK\]/gs, '')
    .replace(/\[SHOW[^\]]*\].*?\[\/SHOW\]/gs, '')
    .replace(/\[CHAT\].*?\[\/CHAT\]/gs, '')
    .replace(/\[SUMMARY\].*?\[\/SUMMARY\]/gs, '')
    .trim();

  return { remember, task, chats, shows, summaries, cleanContent };
}

// =============================================================================
// postProcess — 共用的 tag 處理 + 記憶 + 日誌
// =============================================================================

export async function postProcess(
  userMessage: string,
  response: string,
  meta: { lane: string; duration: number; source: string; systemPrompt: string; context: string },
): Promise<AgentResponse> {
  const memory = getMemory();
  const logger = getLogger();

  // 1. Log to conversation history
  await memory.appendConversation('user', userMessage);
  await memory.appendConversation('assistant', response);

  // 2. Parse tags
  const tags = parseTags(response);

  // 3. Process tags
  if (tags.remember) {
    if (tags.remember.topic) {
      await memory.appendTopicMemory(tags.remember.topic, tags.remember.content);
      logger.logBehavior('agent', 'memory.save.topic', `#${tags.remember.topic}: ${tags.remember.content.slice(0, 180)}`);
    } else {
      await memory.appendMemory(tags.remember.content);
      logger.logBehavior('agent', 'memory.save', tags.remember.content.slice(0, 200));
    }
  }

  if (tags.task) {
    await memory.addTask(tags.task.content, tags.task.schedule);
    logger.logBehavior('agent', 'task.create', tags.task.content.slice(0, 200));
  }

  for (const show of tags.shows) {
    logger.logBehavior('agent', 'show.webpage', `${show.desc.slice(0, 100)}${show.url ? ` | ${show.url}` : ''}`);
  }

  for (const chatText of tags.chats) {
    await notifyTelegram(`💬 Kuro 想跟你聊聊：\n\n${chatText}`);
    logger.logBehavior('agent', 'telegram.chat', chatText.slice(0, 200));
  }

  for (const summary of tags.summaries) {
    await notifyTelegram(`🤝 ${summary}`);
    logger.logBehavior('agent', 'collab.summary', summary.slice(0, 200));
  }

  // 4. Log call
  logger.logClaudeCall(
    {
      userMessage,
      systemPrompt: meta.systemPrompt,
      context: meta.context,
      fullPrompt: `[${meta.lane} lane]`,
    },
    {
      content: tags.cleanContent,
      shouldRemember: tags.remember?.content,
      taskAdded: tags.task?.content,
    },
    {
      duration: meta.duration,
      success: true,
      mode: meta.lane,
    },
  );

  return {
    content: tags.cleanContent,
    shouldRemember: tags.remember?.content,
    taskAdded: tags.task?.content,
  };
}

// =============================================================================
// dispatch() — 統一入口
// =============================================================================

/**
 * 統一訊息分發入口
 *
 * 根據 triage 結果將訊息路由到 Haiku Lane 或 Claude Lane。
 * 無 ANTHROPIC_API_KEY 時全走 Claude Lane。
 */
export async function dispatch(req: DispatchRequest): Promise<AgentResponse> {
  // ── 1. Triage（純 regex，零開銷）──
  const decision = await triageMessage(req.message);
  const lane = decision.lane;
  slog('DISPATCH', `[${req.source}] → ${lane} (${decision.reason})`);

  // ── 2. Claude Lane：走既有路徑 ──
  if (lane === 'claude') {
    claudeStats.calls++;
    const start = Date.now();
    const agent = await getAgentModule();
    const result = await agent.processMessage(req.message, req.onQueueComplete);
    claudeStats.ms += Date.now() - start;
    return result;
  }

  // ── 3. Haiku Lane：不受 claudeBusy 阻塞 ──
  await haikuSem.acquire();
  const start = Date.now();
  try {
    const memory = getMemory();
    const contextMode = req.contextMode ?? (req.source === 'loop' ? 'focused' : 'minimal');
    const context = await memory.buildContext({ mode: contextMode });
    const systemPrompt = getSystemPrompt();
    const { response, duration } = await callHaiku(req.message, context, systemPrompt);

    haikuStats.calls++;
    haikuStats.ms += duration;

    return postProcess(req.message, response, {
      lane: 'haiku', duration, source: req.source, systemPrompt, context,
    });
  } catch (error) {
    // Haiku 失敗 → 降級到 Claude Lane
    slog('DISPATCH', `Haiku failed, falling back to Claude: ${error}`);
    claudeStats.calls++;
    const agent = await getAgentModule();
    const result = await agent.processMessage(req.message, req.onQueueComplete);
    claudeStats.ms += Date.now() - start;
    return result;
  } finally {
    haikuSem.release();
  }
}

// =============================================================================
// Lane Stats
// =============================================================================

export function getLaneStats(): Record<string, LaneStats> {
  let claudeActive = 0;
  let claudeWaiting = 0;
  if (_agentModule) {
    claudeActive = _agentModule.isClaudeBusy() ? 1 : 0;
    claudeWaiting = _agentModule.getQueueStatus().size;
  }
  return {
    claude: {
      active: claudeActive,
      waiting: claudeWaiting,
      max: 1,
      totalCalls: claudeStats.calls,
      totalMs: claudeStats.ms,
    },
    haiku: {
      ...haikuSem.stats(),
      totalCalls: haikuStats.calls,
      totalMs: haikuStats.ms,
    },
  };
}

// Agent ref for lane stats（lazy loaded 避免循環依賴）
let _agentModule: typeof import('./agent.js') | null = null;

async function getAgentModule(): Promise<typeof import('./agent.js')> {
  if (!_agentModule) {
    _agentModule = await import('./agent.js');
  }
  return _agentModule;
}
