/**
 * Dispatcher — Tag Processor + System Prompt (OODA-Only)
 *
 * 保留 parseTags / postProcess / getSystemPrompt / Semaphore / getConversationHint
 * 所有訊息統一由 Loop Lane (OODA cycle) 處理。
 */

import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt, type CycleMode } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import { slog } from './utils.js';
import type { AgentResponse, ParsedTags, ThreadAction } from './types.js';

// =============================================================================
// Semaphore — 通用並發控制
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
// System Prompt（與 agent.ts 共用邏輯）
// =============================================================================

export function getSystemPrompt(relevanceHint?: string, cycleMode?: CycleMode): string {
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
${getSkillsPrompt(relevanceHint, cycleMode)}${(() => {
  const hint = getConversationHint();
  return hint ? `\n\n## 當前對話情境\n${hint}` : '';
})()}`;
}

// =============================================================================
// Conversation Hint — 對話情境提示
// =============================================================================

function getConversationHint(): string {
  const memory = getMemory();
  const recent = memory.getHotConversations().slice(-15);
  if (recent.length === 0) return '';

  const hints: string[] = [];

  // 偵測 Alex 是否在等待回應
  const lastAlexMsg = [...recent].reverse().find(c => c.role === 'user');
  const lastKuroMsg = [...recent].reverse().find(c => c.role === 'assistant');
  if (lastAlexMsg && lastKuroMsg &&
      new Date(lastAlexMsg.timestamp) > new Date(lastKuroMsg.timestamp)) {
    hints.push('Alex 正在等待你的回應');
    // 顯示最後未回覆問題的前 100 字
    hints.push(`最後的訊息: "${lastAlexMsg.content.slice(0, 100)}"`);
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
// parseTags — 從回應中提取所有 Agent 標籤
// =============================================================================

export function parseTags(response: string): ParsedTags {
  // Strip regions where tags are "mentioned" not "used" — prevents pollution
  // Order: ACTION blocks > fenced code > inline code
  const parseSource = response
    .replace(/\[ACTION\].*?\[\/ACTION\]/gs, '')  // ACTION reports describe tags, not invoke them
    .replace(/```[\s\S]*?```/g, '')               // fenced code blocks (```...```)
    .replace(/`[^`\n]+`/g, '');                   // inline code (`...`)

  const remembers: Array<{ content: string; topic?: string; ref?: string }> = [];
  if (parseSource.includes('[REMEMBER')) {
    for (const m of parseSource.matchAll(/\[REMEMBER(?:\s+#(\S+?))?(?:\s+ref:([a-z0-9-]+))?\](.*?)\[\/REMEMBER\]/gs)) {
      remembers.push({ content: m[3].trim(), topic: m[1], ref: m[2] });
    }
  }

  const tasks: Array<{ content: string; schedule?: string }> = [];
  if (parseSource.includes('[TASK')) {
    for (const m of parseSource.matchAll(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/gs)) {
      tasks.push({ content: m[2].trim(), schedule: m[1] });
    }
  }

  let archive: { url: string; title: string; content: string; mode?: 'full' | 'excerpt' | 'metadata-only' } | undefined;
  if (parseSource.includes('[ARCHIVE')) {
    const match = parseSource.match(/\[ARCHIVE\s+url="([^"]*)"(?:\s+title="([^"]*)")?(?:\s+mode="([^"]*)")?\](.*?)\[\/ARCHIVE\]/s);
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
  if (parseSource.includes('[CHAT]')) {
    for (const m of parseSource.matchAll(/\[CHAT\](.*?)\[\/CHAT\]/gs)) {
      chats.push(m[1].trim());
    }
  }

  const asks: string[] = [];
  if (parseSource.includes('[ASK]')) {
    for (const m of parseSource.matchAll(/\[ASK\](.*?)\[\/ASK\]/gs)) {
      asks.push(m[1].trim());
    }
  }

  const shows: Array<{ url: string; desc: string }> = [];
  if (parseSource.includes('[SHOW')) {
    for (const m of parseSource.matchAll(/\[SHOW(?:\s+url="([^"]*)")?\](.*?)\[\/SHOW\]/gs)) {
      shows.push({ url: m[1] ?? '', desc: m[2].trim() });
    }
  }

  const summaries: string[] = [];
  if (parseSource.includes('[SUMMARY]')) {
    for (const m of parseSource.matchAll(/\[SUMMARY\](.*?)\[\/SUMMARY\]/gs)) {
      summaries.push(m[1].trim());
    }
  }

  // [IMPULSE] tags — creative impulse capture
  const impulses: Array<{ what: string; driver: string; materials: string[]; channel: string }> = [];
  if (parseSource.includes('[IMPULSE]')) {
    for (const m of parseSource.matchAll(/\[IMPULSE\](.*?)\[\/IMPULSE\]/gs)) {
      const block = m[1].trim();
      const what = block.match(/(?:我想[寫做說]|what)[：:](.+)/i)?.[1]?.trim() ?? block.split('\n')[0].trim();
      const driver = block.match(/(?:驅動力|driver|why)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materialsRaw = block.match(/(?:素材|materials)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materials = materialsRaw ? materialsRaw.split(/[+,、]/).map(s => s.trim()).filter(Boolean) : [];
      const channel = block.match(/(?:管道|channel)[：:](.+)/i)?.[1]?.trim().replace(/[（(].+[）)]/, '').trim() ?? 'journal';
      impulses.push({ what, driver, materials, channel });
    }
  }

  // [DONE] tags — mark NEXT.md items as completed
  const dones: string[] = [];
  if (parseSource.includes('[DONE]')) {
    for (const m of parseSource.matchAll(/\[DONE\]\s*(.+?)(?:\n|$)/g)) {
      dones.push(m[1].trim());
    }
  }

  // [PROGRESS] tags — task progress tracking
  const progresses: Array<{ task: string; content: string }> = [];
  if (parseSource.includes('[PROGRESS')) {
    for (const m of parseSource.matchAll(/\[PROGRESS\s+task="([^"]+)"\](.*?)\[\/PROGRESS\]/gs)) {
      progresses.push({ task: m[1].trim(), content: m[2].trim() });
    }
  }

  let schedule: { next: string; reason: string } | undefined;
  if (parseSource.includes('[SCHEDULE')) {
    const match = parseSource.match(/\[SCHEDULE\s+next="([^"]+)"(?:\s+reason="([^"]*)")?\]/);
    if (match) schedule = { next: match[1], reason: match[2] ?? '' };
  }

  // [THREAD] tags — manage thought threads
  const threads: ThreadAction[] = [];
  if (parseSource.includes('[THREAD')) {
    for (const m of parseSource.matchAll(/\[THREAD\s+(start|progress|complete|pause)="([^"]+)"(?:\s+title="([^"]*)")?\](.*?)\[\/THREAD\]/gs)) {
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
    .replace(/\[ASK\].*?\[\/ASK\]/gs, '')
    .replace(/\[SUMMARY\].*?\[\/SUMMARY\]/gs, '')
    .replace(/\[IMPULSE\].*?\[\/IMPULSE\]/gs, '')
    .replace(/\[ACTION\].*?\[\/ACTION\]/gs, '')
    .replace(/\[THREAD[^\]]*\].*?\[\/THREAD\]/gs, '')
    .replace(/\[SCHEDULE[^\]]*\]/g, '')
    .replace(/\[DONE\]\s*.+?(?:\n|$)/g, '')
    .replace(/\[PROGRESS[^\]]*\].*?\[\/PROGRESS\]/gs, '')
    .trim();

  // S4: Fuzzy detection — warn on malformed tags (opening bracket without matching close)
  // Reuse same stripping logic as parseSource to avoid false positives from mentioned tags
  const responseForDetection = response
    .replace(/\[ACTION\].*?\[\/ACTION\]/gs, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
  const tagNames = ['REMEMBER', 'TASK', 'CHAT', 'ASK', 'SHOW', 'IMPULSE', 'ARCHIVE', 'SUMMARY', 'THREAD', 'PROGRESS'];
  for (const tag of tagNames) {
    const openCount = (responseForDetection.match(new RegExp(`\\[${tag}[\\]\\s]`, 'g')) || []).length;
    const closeCount = (responseForDetection.match(new RegExp(`\\[/${tag}\\]`, 'g')) || []).length;
    if (openCount > 0 && openCount !== closeCount) {
      slog('TAGS', `⚠ Malformed [${tag}]: ${openCount} open, ${closeCount} close`);
    }
  }

  return { remembers, tasks, archive, impulses, threads, chats, asks, shows, summaries, dones, progresses, schedule, cleanContent };
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
  for (const rem of tags.remembers) {
    if (rem.topic) {
      await memory.appendTopicMemory(rem.topic, rem.content, rem.ref);
    } else {
      await memory.appendMemory(rem.content);
    }
    eventBus.emit('action:memory', { content: rem.content, topic: rem.topic });
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

  for (const t of tags.tasks) {
    await memory.addTask(t.content, t.schedule);
    eventBus.emit('action:task', { content: t.content });
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

  // 4. ConversationThread tracking
  // Promise tracking removed — 「讓我/我會」triggers too broadly (noise > signal).
  //   Real promises go through [TASK] → HEARTBEAT with verification.
  // Dispatcher URL share tracking removed — duplicates autoDetectRoomThread() in api.ts.
  //   Chat Room is now the primary channel; tracking there is sufficient.

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
      shouldRemember: tags.remembers[0]?.content,
      taskAdded: tags.tasks[0]?.content,
    },
    {
      duration: meta.duration,
      success: true,
      mode: meta.lane,
    },
  );

  return {
    content: tags.cleanContent,
    shouldRemember: tags.remembers[0]?.content,
    taskAdded: tags.tasks[0]?.content,
  };
}
