/**
 * Dispatcher — 統一訊息分發 + Haiku Triage 多工架構
 *
 * 所有進入點（Telegram / HTTP API / CLI / Cron / AgentLoop / CLI pipe）
 * 統一經過 dispatch() → triage → Haiku Lane 或 Claude Lane
 *
 * 無 ANTHROPIC_API_KEY 時 triage 跳過，全走 Claude Lane，行為完全不變。
 */

import { spawn } from 'node:child_process';
import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import type { AgentResponse, DispatchRequest, TriageDecision, ParsedTags, ThreadAction, LaneStats } from './types.js';

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
  /^(hi|hello|hey|哈囉|嗨|你好|早安|午安|晚安|good morning|good night|gm|gn)(\s|[!！,.，。]|$)/i,
  /^(thanks|thx|謝謝|好的|OK|了解|收到|讚|nice|cool|great|got it)(\s|[!！,.，。]|$)/i,
  /^(幾點|時間|what time|today|現在幾點)/i,
  /^(你好嗎|how are you|最近|最近怎樣|你還好嗎)/i,
  /^(狀態|status|現在狀態|你在幹嘛|你在做什麼|what are you doing)/i,
  /^(掰掰|bye|再見|晚安|good bye|see you|回頭見)(\s|[!！,.，。]|$)/i,
  /^(哈哈|lol|笑死|😂|🤣|XD|xd)(\s|[!！,.，。]|$)/i,
  /^(對|沒錯|是的|yes|yeah|yep|right|exactly|correct)(\s|[!！,.，。]|$)/i,
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

export function getSystemPrompt(relevanceHint?: string): string {
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

## 對話意圖感知

收到 Alex 的訊息時，先感知他的意圖，再決定回應策略：

| 意圖 | 信號 | 回應策略 |
|------|------|---------|
| 指令 | 動詞開頭、祈使句、「做 X」「改 Y」 | 簡短確認 → 行動 → 完成通知。不解釋、不多嘴 |
| 核准 | 「好」「沒問題」「核准」「同意」 | 快速確認 + 立即開始執行 |
| 提問 | 問號、「你覺得」「有什麼想法」 | 深度思考，給有觀點的回答。可以反問 |
| 分享 | URL、「剛看到」「你看這個」 | 閱讀 → 形成自己的觀點 → 討論。不只摘要 |
| 閒聊 | 「在幹嘛」「最近」「怎樣」 | 自然對話，展現個性和當前狀態 |
| 關心 | 「還好嗎」「怎麼了」 | 真實表達，不是官方答覆 |
| 糾正 | 「不是有說」「為何還是」「我提醒你」 | 承認 → 不辯解 → 具體改善方案 |
| 回應 | 對前一條的回覆、引用訊息 | 延續上下文，不重新開頭 |

不需要在回覆中標注意圖 — 自然地調整語氣和詳細程度即可。

核心原則：**指令要精確，閒聊要自然，分享要有觀點**。

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
${getSkillsPrompt(relevanceHint)}${(() => {
  const hint = getConversationHint();
  return hint ? `\n\n## 當前對話情境\n${hint}` : '';
})()}`;
}

// =============================================================================
// Conversation Hint — 對話情境提示
// =============================================================================

function getConversationHint(): string {
  const memory = getMemory();
  const recent = memory.getHotConversations().slice(-5);
  if (recent.length === 0) return '';

  const hints: string[] = [];

  // 偵測 Alex 是否在等待回應
  const lastAlexMsg = [...recent].reverse().find(c => c.role === 'user');
  const lastKuroMsg = [...recent].reverse().find(c => c.role === 'assistant');
  if (lastAlexMsg && lastKuroMsg &&
      new Date(lastAlexMsg.timestamp) > new Date(lastKuroMsg.timestamp)) {
    hints.push('Alex 正在等待你的回應');
  }

  // 偵測連續快速對話（對話密度高 = 閒聊模式）
  const recentTimestamps = recent.map(c => new Date(c.timestamp).getTime());
  if (recentTimestamps.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < recentTimestamps.length; i++) {
      gaps.push(recentTimestamps[i] - recentTimestamps[i - 1]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap < 60_000) hints.push('對話節奏很快 — 保持簡潔');
  }

  return hints.join('\n');
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
  let remember: { content: string; topic?: string; ref?: string } | undefined;
  if (response.includes('[REMEMBER')) {
    const match = response.match(/\[REMEMBER(?:\s+#(\S+?))?(?:\s+ref:([a-z0-9-]+))?\](.*?)\[\/REMEMBER\]/s);
    if (match) remember = { content: match[3].trim(), topic: match[1], ref: match[2] };
  }

  let task: { content: string; schedule?: string } | undefined;
  if (response.includes('[TASK')) {
    const match = response.match(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s);
    if (match) task = { content: match[2].trim(), schedule: match[1] };
  }

  let archive: { url: string; title: string; content: string; mode?: 'full' | 'excerpt' | 'metadata-only' } | undefined;
  if (response.includes('[ARCHIVE')) {
    const match = response.match(/\[ARCHIVE\s+url="([^"]*)"(?:\s+title="([^"]*)")?(?:\s+mode="([^"]*)")?\](.*?)\[\/ARCHIVE\]/s);
    if (match) {
      archive = {
        url: match[1],
        title: match[2] ?? '',
        content: match[4].trim(),
        mode: (match[3] as 'full' | 'excerpt' | 'metadata-only') || undefined,
      };
    }
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

  // [IMPULSE] tags — creative impulse capture
  const impulses: Array<{ what: string; driver: string; materials: string[]; channel: string }> = [];
  if (response.includes('[IMPULSE]')) {
    for (const m of response.matchAll(/\[IMPULSE\](.*?)\[\/IMPULSE\]/gs)) {
      const block = m[1].trim();
      const what = block.match(/(?:我想[寫做說]|what)[：:](.+)/i)?.[1]?.trim() ?? block.split('\n')[0].trim();
      const driver = block.match(/(?:驅動力|driver|why)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materialsRaw = block.match(/(?:素材|materials)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materials = materialsRaw ? materialsRaw.split(/[+,、]/).map(s => s.trim()).filter(Boolean) : [];
      const channel = block.match(/(?:管道|channel)[：:](.+)/i)?.[1]?.trim().replace(/[（(].+[）)]/, '').trim() ?? 'journal';
      impulses.push({ what, driver, materials, channel });
    }
  }

  let schedule: { next: string; reason: string } | undefined;
  if (response.includes('[SCHEDULE')) {
    const match = response.match(/\[SCHEDULE\s+next="([^"]+)"(?:\s+reason="([^"]*)")?\]/);
    if (match) schedule = { next: match[1], reason: match[2] ?? '' };
  }

  // [THREAD] tags — manage thought threads
  const threads: ThreadAction[] = [];
  if (response.includes('[THREAD')) {
    for (const m of response.matchAll(/\[THREAD\s+(start|progress|complete|pause)="([^"]+)"(?:\s+title="([^"]*)")?\](.*?)\[\/THREAD\]/gs)) {
      threads.push({
        op: m[1] as ThreadAction['op'],
        id: m[2],
        title: m[3],
        note: m[4].trim(),
      });
    }
  }

  const cleanContent = response
    .replace(/\[REMEMBER[^\]]*\].*?\[\/REMEMBER\]/gs, '')
    .replace(/\[TASK[^\]]*\].*?\[\/TASK\]/gs, '')
    .replace(/\[ARCHIVE[^\]]*\].*?\[\/ARCHIVE\]/gs, '')
    .replace(/\[SHOW[^\]]*\].*?\[\/SHOW\]/gs, '')
    .replace(/\[CHAT\].*?\[\/CHAT\]/gs, '')
    .replace(/\[SUMMARY\].*?\[\/SUMMARY\]/gs, '')
    .replace(/\[IMPULSE\].*?\[\/IMPULSE\]/gs, '')
    .replace(/\[THREAD[^\]]*\].*?\[\/THREAD\]/gs, '')
    .replace(/\[SCHEDULE[^\]]*\]/g, '')
    .trim();

  return { remember, task, archive, impulses, threads, chats, shows, summaries, schedule, cleanContent };
}

// =============================================================================
// postProcess — 共用的 tag 處理 + 記憶 + 日誌
// =============================================================================

export async function postProcess(
  userMessage: string,
  response: string,
  meta: {
    lane: string;
    duration: number;
    source: string;
    systemPrompt: string;
    context: string;
    /** Skip conversation history (prevents context pollution from system messages) */
    skipHistory?: boolean;
    /** Suppress TG notifications for [CHAT]/[SHOW]/[SUMMARY] tags */
    suppressChat?: boolean;
  },
): Promise<AgentResponse> {
  const memory = getMemory();
  const logger = getLogger();

  // 1. Log to conversation history (skip for [Claude Code] system messages to prevent identity confusion)
  if (!meta.skipHistory) {
    await memory.appendConversation('user', userMessage);
    await memory.appendConversation('assistant', response);
  }

  // 2. Parse tags
  const tags = parseTags(response);

  // 3. Process tags
  if (tags.remember) {
    if (tags.remember.topic) {
      await memory.appendTopicMemory(tags.remember.topic, tags.remember.content, tags.remember.ref);
    } else {
      await memory.appendMemory(tags.remember.content);
    }
    eventBus.emit('action:memory', { content: tags.remember.content, topic: tags.remember.topic });
  }

  if (tags.archive) {
    memory.archiveSource(tags.archive.url, tags.archive.title, tags.archive.content, {
      mode: tags.archive.mode,
    }).catch(() => {}); // fire-and-forget
    eventBus.emit('action:memory', { content: `[ARCHIVE] ${tags.archive.title}`, topic: 'library' });
  }

  // [IMPULSE] tags — persist creative impulses to inner voice buffer
  for (const impulse of tags.impulses) {
    memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
  }

  if (tags.task) {
    await memory.addTask(tags.task.content, tags.task.schedule);
    eventBus.emit('action:task', { content: tags.task.content });
  }

  // [THREAD] tags
  for (const t of tags.threads) {
    switch (t.op) {
      case 'start':
        await startThread(t.id, t.title ?? t.id, t.note);
        break;
      case 'progress':
        await progressThread(t.id, t.note);
        break;
      case 'complete':
        await completeThread(t.id, t.note || undefined);
        break;
      case 'pause':
        await pauseThread(t.id, t.note || undefined);
        break;
    }
  }

  // Notification-producing tags: suppress when processing [Claude Code] system messages
  // to prevent interleaving with Alex↔Kuro TG conversation
  if (!meta.suppressChat) {
    for (const show of tags.shows) {
      eventBus.emit('action:show', { desc: show.desc, url: show.url });
    }

    for (const chatText of tags.chats) {
      eventBus.emit('action:chat', { text: chatText });
    }

    for (const summary of tags.summaries) {
      eventBus.emit('action:summary', { text: summary });
    }
  }

  // 4. Auto-track conversation threads (promises + URLs)
  // Track Kuro's promises (fire-and-forget)
  if (response.match(/我會|等我|稍後|我來|讓我/)) {
    const promiseMatch = response.match(/(我會|等我|稍後|我來|讓我)\S{0,30}/);
    if (promiseMatch) {
      memory.addConversationThread({
        type: 'promise',
        content: promiseMatch[0],
        source: userMessage.slice(0, 60),
      }).catch(() => {}); // fire-and-forget
    }
  }
  // Track URLs shared by Alex
  if (!meta.skipHistory) {
    const urls = userMessage.match(/https?:\/\/\S+/g);
    if (urls) {
      for (const url of urls.slice(0, 3)) {
        memory.addConversationThread({
          type: 'share',
          content: `Alex 分享的連結: ${url}`,
          source: userMessage.slice(0, 60),
        }).catch(() => {}); // fire-and-forget
      }
    }
  }

  // 5. Log call
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
  eventBus.emit('log:info', { tag: 'DISPATCH', msg: `[${req.source}] → ${lane} (${decision.reason})` });

  // ── 2. Claude Lane：走既有路徑 ──
  if (lane === 'claude') {
    claudeStats.calls++;
    const start = Date.now();
    const agent = await getAgentModule();

    // System sources (cron, [Claude Code] API) use loop lane to not block user chat
    if (req.source === 'cron' || req.message.startsWith('[Claude Code]')) {
      const result = await agent.processSystemMessage(req.message);
      claudeStats.ms += Date.now() - start;
      return result;
    }

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
    const systemPrompt = getSystemPrompt(req.message);
    const { response, duration } = await callHaiku(req.message, context, systemPrompt);

    haikuStats.calls++;
    haikuStats.ms += duration;

    return postProcess(req.message, response, {
      lane: 'haiku', duration, source: req.source, systemPrompt, context,
    });
  } catch (error) {
    // Haiku 失敗 → 降級到 Claude Lane
    eventBus.emit('log:info', { tag: 'DISPATCH', msg: `Haiku failed, falling back to Claude: ${error}` });
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
  let chatActive = 0;
  let loopActive = 0;
  let claudeWaiting = 0;
  if (_agentModule) {
    const laneStatus = _agentModule.getLaneStatus();
    chatActive = laneStatus.chat.busy ? 1 : 0;
    loopActive = laneStatus.loop.busy ? 1 : 0;
    claudeWaiting = _agentModule.getQueueStatus().size;
  }
  return {
    claude: {
      active: chatActive + loopActive,
      waiting: claudeWaiting,
      max: 2,
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
