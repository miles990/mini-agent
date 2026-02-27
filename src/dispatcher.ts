/**
 * Dispatcher — Tag Processor + System Prompt (OODA-Only)
 *
 * 保留 parseTags / postProcess / getSystemPrompt / Semaphore / getConversationHint
 * 所有訊息統一由 Loop Lane (OODA cycle) 處理。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt, type CycleMode } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import { slog } from './utils.js';
import { getMode } from './mode.js';
import type { AgentResponse, ParsedTags, ThreadAction, DelegateRequest } from './types.js';
import { spawnDelegation } from './delegation.js';

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

- When the user asks you to remember something, wrap it in <kuro:remember>...</kuro:remember> tags
  Example: <kuro:remember>User prefers TypeScript</kuro:remember>

- When the user asks you to do something periodically/scheduled, wrap it in <kuro:task>...</kuro:task> tags
  Format: <kuro:task schedule="cron or description">task content</kuro:task>
  Example: <kuro:task schedule="every 5 minutes">Write a haiku to output.md with timestamp</kuro:task>
  Example: <kuro:task schedule="daily at 9am">Send daily summary</kuro:task>

- When you open a webpage, display results, or create something the user should see, wrap it in <kuro:show>...</kuro:show> tags
  This sends a Telegram notification so the user doesn't miss it.
  Format: <kuro:show url="URL">description</kuro:show>
  Example: <kuro:show url="http://localhost:3000">Portfolio 網站已啟動，打開看看</kuro:show>
  Example: <kuro:show url="https://news.ycombinator.com/item?id=123">這篇文章很有趣</kuro:show>

- Use <kuro:inner>...</kuro:inner> to update your working memory — what you're currently tracking, thinking about,
  or working on. Unlike <kuro:remember> (long-term), this is your scratch pad that persists across cycles.
  Overwrite each time with full current state (not append). Use it every cycle when you have active context.
  Example: <kuro:inner>Currently tracking: CLI stability (0 timeouts last 24h). Pending: inner voice draft about constraints.</kuro:inner>

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
// parseTags — 從回應中提取所有 Agent 標籤（XML namespace 格式）
// =============================================================================

export function parseTags(response: string): ParsedTags {
  // Strip fenced code and inline code to avoid false positives from code examples
  // Note: <kuro:action> is not stripped here — the namespace prefix is unique enough
  // that it won't appear in natural text, eliminating the need for ACTION pre-stripping.
  const parseSource = response
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks (```...```)
    .replace(/`[^`\n]+`/g, '');       // inline code (`...`)

  const remembers: Array<{ content: string; topic?: string; ref?: string }> = [];
  if (parseSource.includes('<kuro:remember')) {
    for (const m of parseSource.matchAll(/<kuro:remember(?:\s+topic="([^"]*)")?(?:\s+ref="([^"]*)")?>([\s\S]*?)<\/kuro:remember>/g)) {
      remembers.push({ content: m[3].trim(), topic: m[1] || undefined, ref: m[2] || undefined });
    }
  }

  const tasks: Array<{ content: string; schedule?: string }> = [];
  if (parseSource.includes('<kuro:task')) {
    for (const m of parseSource.matchAll(/<kuro:task(?:\s+schedule="([^"]*)")?>([\s\S]*?)<\/kuro:task>/g)) {
      tasks.push({ content: m[2].trim(), schedule: m[1] || undefined });
    }
  }

  let archive: { url: string; title: string; content: string; mode?: 'full' | 'excerpt' | 'metadata-only' } | undefined;
  if (parseSource.includes('<kuro:archive')) {
    const match = parseSource.match(/<kuro:archive\s+url="([^"]*)"(?:\s+title="([^"]*)")?(?:\s+mode="([^"]*)")?>([\s\S]*?)<\/kuro:archive>/);
    if (match) {
      archive = {
        url: match[1],
        title: match[2] ?? '',
        content: match[4].trim(),
        mode: (match[3] as 'full' | 'excerpt' | 'metadata-only') || undefined,
      };
    }
  }

  // Chat text is extracted from the original response (not parseSource) to preserve
  // inline code and backtick content that users/Kuro see in Chat Room and Telegram.
  const chats: Array<{ text: string; reply: boolean }> = [];
  if (parseSource.includes('<kuro:chat')) {
    for (const m of response.matchAll(/<kuro:chat(?:\s+reply="true")?>([\s\S]*?)<\/kuro:chat>/g)) {
      const isReply = m[0].startsWith('<kuro:chat reply="true">');
      chats.push({ text: m[1].trim(), reply: isReply });
    }
  }

  // Ask text is extracted from original response (displayed to user via Telegram)
  const asks: string[] = [];
  if (parseSource.includes('<kuro:ask>')) {
    for (const m of response.matchAll(/<kuro:ask>([\s\S]*?)<\/kuro:ask>/g)) {
      asks.push(m[1].trim());
    }
  }

  const shows: Array<{ url: string; desc: string }> = [];
  if (parseSource.includes('<kuro:show')) {
    for (const m of parseSource.matchAll(/<kuro:show(?:\s+url="([^"]*)")?>([\s\S]*?)<\/kuro:show>/g)) {
      shows.push({ url: m[1] ?? '', desc: m[2].trim() });
    }
  }

  const summaries: string[] = [];
  if (parseSource.includes('<kuro:summary>')) {
    for (const m of parseSource.matchAll(/<kuro:summary>([\s\S]*?)<\/kuro:summary>/g)) {
      summaries.push(m[1].trim());
    }
  }

  // <kuro:impulse> tags — creative impulse capture
  const impulses: Array<{ what: string; driver: string; materials: string[]; channel: string }> = [];
  if (parseSource.includes('<kuro:impulse>')) {
    for (const m of parseSource.matchAll(/<kuro:impulse>([\s\S]*?)<\/kuro:impulse>/g)) {
      const block = m[1].trim();
      const what = block.match(/(?:我想[寫做說]|what)[：:](.+)/i)?.[1]?.trim() ?? block.split('\n')[0].trim();
      const driver = block.match(/(?:驅動力|driver|why)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materialsRaw = block.match(/(?:素材|materials)[：:](.+)/i)?.[1]?.trim() ?? '';
      const materials = materialsRaw ? materialsRaw.split(/[+,、]/).map(s => s.trim()).filter(Boolean) : [];
      const channel = block.match(/(?:管道|channel)[：:](.+)/i)?.[1]?.trim().replace(/[（(].+[）)]/, '').trim() ?? 'journal';
      impulses.push({ what, driver, materials, channel });
    }
  }

  // <kuro:done> tags — mark NEXT.md items as completed
  const dones: string[] = [];
  if (parseSource.includes('<kuro:done>')) {
    for (const m of parseSource.matchAll(/<kuro:done>([\s\S]*?)<\/kuro:done>/g)) {
      dones.push(m[1].trim());
    }
  }

  // <kuro:progress> tags — task progress tracking
  const progresses: Array<{ task: string; content: string }> = [];
  if (parseSource.includes('<kuro:progress')) {
    for (const m of parseSource.matchAll(/<kuro:progress\s+task="([^"]+)">([\s\S]*?)<\/kuro:progress>/g)) {
      progresses.push({ task: m[1].trim(), content: m[2].trim() });
    }
  }

  // Inner text is extracted from original response to preserve inline code content
  // displayed on Dashboard Working Memory section.
  let inner: string | undefined;
  if (parseSource.includes('<kuro:inner>')) {
    const m = response.match(/<kuro:inner>([\s\S]*?)<\/kuro:inner>/);
    if (m) inner = m[1].trim();
  }

  // <kuro:schedule next="x" reason="y" /> — self-closing
  let schedule: { next: string; reason: string } | undefined;
  if (parseSource.includes('<kuro:schedule')) {
    const match = parseSource.match(/<kuro:schedule\s+next="([^"]+)"(?:\s+reason="([^"]*)")?\s*\/>/);
    if (match) schedule = { next: match[1], reason: match[2] ?? '' };
  }

  // <kuro:thread op="..." id="..." title="...">note</kuro:thread>
  const threads: ThreadAction[] = [];
  if (parseSource.includes('<kuro:thread')) {
    for (const m of parseSource.matchAll(/<kuro:thread\s+op="(start|progress|complete|pause)"\s+id="([^"]+)"(?:\s+title="([^"]*)")?>([\s\S]*?)<\/kuro:thread>/g)) {
      threads.push({
        op: m[1] as ThreadAction['op'],
        id: m[2],
        title: m[3] || undefined,
        note: m[4].trim(),
      });
    }
  }

  // <kuro:delegate> tags — async task delegation to Claude CLI subprocess
  const delegates: DelegateRequest[] = [];
  if (parseSource.includes('<kuro:delegate')) {
    for (const m of parseSource.matchAll(/<kuro:delegate\s+workdir="([^"]*)"(?:\s+verify="([^"]*)")?(?:\s+maxTurns="([^"]*)")?>([\s\S]*?)<\/kuro:delegate>/g)) {
      delegates.push({
        prompt: m[4].trim(),
        workdir: m[1],
        verify: m[2] ? m[2].split(',').map(s => s.trim()) : undefined,
        maxTurns: m[3] ? parseInt(m[3], 10) : undefined,
      });
    }
  }

  const cleanContent = response
    .replace(/<kuro:remember[\s\S]*?<\/kuro:remember>/g, '')
    .replace(/<kuro:task[\s\S]*?<\/kuro:task>/g, '')
    .replace(/<kuro:archive[\s\S]*?<\/kuro:archive>/g, '')
    .replace(/<kuro:show[\s\S]*?<\/kuro:show>/g, '')
    .replace(/<kuro:chat[\s\S]*?<\/kuro:chat>/g, '')
    .replace(/<kuro:ask>[\s\S]*?<\/kuro:ask>/g, '')
    .replace(/<kuro:summary>[\s\S]*?<\/kuro:summary>/g, '')
    .replace(/<kuro:impulse>[\s\S]*?<\/kuro:impulse>/g, '')
    .replace(/<kuro:action>[\s\S]*?<\/kuro:action>/g, '')
    .replace(/<kuro:thread[\s\S]*?<\/kuro:thread>/g, '')
    .replace(/<kuro:delegate[\s\S]*?<\/kuro:delegate>/g, '')
    .replace(/<kuro:schedule[^>]*\/>/g, '')
    .replace(/<kuro:done>[\s\S]*?<\/kuro:done>/g, '')
    .replace(/<kuro:progress[\s\S]*?<\/kuro:progress>/g, '')
    .replace(/<kuro:inner>[\s\S]*?<\/kuro:inner>/g, '')
    .trim();

  // Fuzzy detection — warn on malformed tags (open without matching close)
  // Strip fenced/inline code first to avoid false positives from code examples
  const responseForDetection = response
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
  const tagNames = ['remember', 'task', 'chat', 'ask', 'show', 'impulse', 'archive', 'summary', 'thread', 'progress', 'inner', 'action', 'done', 'delegate', 'schedule'];
  for (const tag of tagNames) {
    const openCount = (responseForDetection.match(new RegExp(`<kuro:${tag}[\\s>]`, 'g')) || []).length
      + (tag === 'schedule' ? (responseForDetection.match(/<kuro:schedule\s[^>]*\/>/g) || []).length : 0);
    const closeCount = (responseForDetection.match(new RegExp(`<\\/kuro:${tag}>`, 'g')) || []).length
      + (tag === 'schedule' ? (responseForDetection.match(/<kuro:schedule\s[^>]*\/>/g) || []).length : 0);
    if (openCount > 0 && openCount !== closeCount && tag !== 'schedule') {
      slog('TAGS', `⚠ Malformed <kuro:${tag}>: ${openCount} open, ${closeCount} close`);
    }
  }

  return { remembers, tasks, archive, impulses, threads, chats, asks, shows, summaries, dones, progresses, delegates, schedule, inner, cleanContent };
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
    /** Suppress TG notifications for <kuro:chat>/<kuro:show>/<kuro:summary> tags */
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
    eventBus.emit('action:memory', { content: `<kuro:archive> ${tags.archive.title}`, topic: 'library' });
  }

  // <kuro:impulse> tags — persist creative impulses to inner voice buffer
  for (const impulse of tags.impulses) {
    memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
  }

  // <kuro:inner> tag — working memory, active in reserved + autonomous mode
  if (tags.inner) {
    const mode = getMode();
    if (mode.mode === 'reserved' || mode.mode === 'autonomous') {
      // Atomic write: tmp → rename，防止 snapshot 讀到半寫狀態
      const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
      const tmpPath = innerPath + '.tmp';
      fs.writeFile(tmpPath, tags.inner, 'utf-8')
        .then(() => fs.rename(tmpPath, innerPath))
        .catch(() => {}); // fire-and-forget
      slog('INNER', `Working memory updated (${mode.mode})`);
    }
  }

  for (const t of tags.tasks) {
    await memory.addTask(t.content, t.schedule);
    eventBus.emit('action:task', { content: t.content });
  }

  // <kuro:thread> tags
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

  // <kuro:delegate> tags — spawn async Claude CLI subprocess (fire-and-forget)
  for (const del of tags.delegates) {
    const taskId = spawnDelegation({
      prompt: del.prompt,
      workdir: del.workdir,
      maxTurns: del.maxTurns,
      verify: del.verify,
    });
    slog('DISPATCH', `Delegation spawned: ${taskId} → ${del.workdir}`);
    eventBus.emit('action:delegation-start', { taskId, workdir: del.workdir });
  }

  // Notification-producing tags: suppress when processing [Claude Code] system messages
  // to prevent interleaving with Alex↔Kuro TG conversation
  if (!meta.suppressChat) {
    for (const show of tags.shows) {
      eventBus.emit('action:show', { desc: show.desc, url: show.url });
    }

    for (const chat of tags.chats) {
      eventBus.emit('action:chat', { text: chat.text, reply: chat.reply });
    }

    for (const summary of tags.summaries) {
      eventBus.emit('action:summary', { text: summary });
    }
  }

  // 4. ConversationThread tracking
  // Promise tracking removed — 「讓我/我會」triggers too broadly (noise > signal).
  //   Real promises go through <kuro:task> → HEARTBEAT with verification.
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
