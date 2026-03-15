/**
 * Dispatcher — Tag Processor + System Prompt (OODA-Only)
 *
 * 保留 parseTags / postProcess / getSystemPrompt / getConversationHint
 * 所有訊息統一由 Loop Lane (OODA cycle) 處理。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt, getMemoryStateDir, type CycleMode } from './memory.js';
import { getClaudeMdJIT } from './claudemd-jit.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import { slog } from './utils.js';
import { getMode } from './mode.js';
import { isEnabled } from './features.js';
import type { AgentResponse, ParsedTags, ThreadAction, DelegateRequest, DelegationTaskType, Provider } from './types.js';
import { spawnDelegation } from './delegation.js';
import { MUSHI_DEDUP_URL } from './mushi-client.js';
import {
  addIndexEntry,
  appendMemoryIndexEntry,
  updateMemoryIndexEntry,
  deleteMemoryIndexEntry,
  queryMemoryIndexSync,
  createTask,
  updateTask,
  findLatestOpenGoal,
  detectAndRecordCommitments,
  type VerifyResult,
} from './memory-index.js';

// =============================================================================
// Remember Classifier — Learning→Perception 自動閉環 Phase 1
// 分類 <kuro:remember> 條目，actionable 類型寫入 pending-improvements.jsonl
// =============================================================================

type RememberCategory = 'fact' | 'tool-preference' | 'error-pattern' | 'system-improvement' | 'learning';

const TOOL_PATTERNS = [
  /優先序|優先用|優先走|first.*choice|prefer.*tool/i,
  /curl|cdp-fetch|grok.*api|chrome.*cdp|cli.*subprocess/i,
  /不要用.*改用|改用.*不要用|效果.*好|效果.*差/i,
  /工具選擇|tool.*select|which.*tool|best.*tool/i,
  /fallback|備選|替代方案/i,
];

const ERROR_PATTERNS = [
  /timeout.*(?:增|spike|問題|issue|bug)|超時.*(?:增|問題)/i,
  /修復.*錯誤|fix.*error|bug.*fix/i,
  /根因|root.*cause|診斷|diagnos/i,
  /失敗.*模式|failure.*pattern/i,
  /(?:出現|發生|遇到).*(?:crash|崩潰|掛掉)|系統.*(?:崩潰|掛掉)/i,
];

const IMPROVEMENT_PATTERNS = [
  /改進|improve|優化|optimiz/i,
  /應該.*改|should.*change|需要.*修/i,
  /下一步.*修|next.*fix|待改善/i,
  /自動化|automat|script.*化/i,
  /加.*檢查|add.*check|加.*驗證/i,
  /防止.*再發|prevent.*recur/i,
];

const LEARNING_PATTERNS = [
  /來源[:：]\s*http/i,
  /研究|study|deep\s*dive|scan/i,
  /論文|paper|arXiv|HN\s*\d+pts/i,
  /核心.*洞見|key.*insight|主張/i,
  /我的觀點|我的判斷|我認為|my.*view/i,
  // Phase 1.1: expanded patterns from replay analysis
  /\(\d{4}-\d{2}-\d{2}[,，].*[）)]/, // 日期+來源格式：(2026-02-15, Author)
  /出處|source[:：]|ref[:：]|cited/i, // 來源標注
  /跨域|cross-.*pollinat|連結.*與|bridge.*between/i, // 跨域連結
  /—.*觀點|—.*洞見|—.*啟發|—.*借鏡/i, // 破折號後的洞見標記
  /vs\s|versus|對比|比較.*差異/i, // 比較分析
];

// Topic-based learning boost: known learning-heavy topics get +1 (soft nudge, not hard override)
const LEARNING_TOPIC_BOOST: Record<string, number> = {
  'creative-arts': 1, 'cognitive-science': 1, 'social-culture': 1,
  'design-philosophy': 1, 'product-thinking': 1,
  'agent-architecture': 1, 'mushi': 0,
};

export function classifyRemember(content: string, topic?: string): RememberCategory {
  // Topic-based hard hints (high confidence for error/tool)
  if (topic) {
    const t = topic.toLowerCase();
    if (t.includes('error') || t.includes('debug')) return 'error-pattern';
    if (t.includes('tool') || t.includes('agent-tools')) return 'tool-preference';
  }

  // Pattern matching (score-based — highest wins)
  const scores: Record<RememberCategory, number> = {
    'fact': 0, 'tool-preference': 0, 'error-pattern': 0,
    'system-improvement': 0, 'learning': 0,
  };

  for (const p of TOOL_PATTERNS) if (p.test(content)) scores['tool-preference']++;
  for (const p of ERROR_PATTERNS) if (p.test(content)) scores['error-pattern']++;
  for (const p of IMPROVEMENT_PATTERNS) if (p.test(content)) scores['system-improvement']++;
  for (const p of LEARNING_PATTERNS) if (p.test(content)) scores['learning']++;

  // Topic-based learning boost (soft signal, can be overridden by strong patterns)
  if (topic) {
    const boost = LEARNING_TOPIC_BOOST[topic.toLowerCase()] ?? 0;
    if (boost > 0) scores['learning'] += boost;
  }

  const max = Math.max(...Object.values(scores));
  if (max === 0) return 'fact';

  // Return highest scoring category
  const entries = Object.entries(scores) as Array<[RememberCategory, number]>;
  return entries.reduce((a, b) => b[1] > a[1] ? b : a)[0];
}

export const ACTIONABLE_CATEGORIES: ReadonlySet<RememberCategory> = new Set([
  'tool-preference', 'error-pattern', 'system-improvement',
]);

export async function logPendingImprovement(entry: {
  category: RememberCategory;
  content: string;
  topic?: string;
  timestamp: string;
}): Promise<void> {
  const filePath = path.join(getMemoryStateDir(), 'pending-improvements.jsonl');
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(filePath, line, 'utf-8');
}

// =============================================================================
// Mushi Dedup — REMEMBER 寫入前查重（fail-open）
// =============================================================================


async function mushiDedup(
  text: string,
  existing: string[],
): Promise<{ isDuplicate: boolean; similarity: number; matchedEntry?: string } | null> {
  if (existing.length === 0) return null;
  try {
    const res = await fetch(MUSHI_DEDUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, existing }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json() as { isDuplicate: boolean; similarity: number; matchedEntry?: string };
  } catch {
    return null; // fail-open: mushi 離線 → 正常寫入
  }
}

// =============================================================================
// System Prompt（與 agent.ts 共用邏輯）
// =============================================================================

export function getSystemPrompt(relevanceHint?: string, cycleMode?: CycleMode, mode?: 'full' | 'minimal'): string {
  const instanceId = getCurrentInstanceId();
  const config = loadInstanceConfig(instanceId);

  if (config?.persona?.systemPrompt) {
    // Minimal mode: strip custom system prompt to bare identity (avoid timeout retry with full prompt)
    if (mode === 'minimal') {
      const personaDesc = config?.persona?.description
        ? `You are ${config.persona.description}.\n\n`
        : '';
      return `${personaDesc}You are a personal AI assistant with memory and task capabilities.\n\n[Skills and project docs stripped for minimal retry — focus on completing the task with available context]`;
    }
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

收到訊息先感知意圖，自然調整語氣：指令→精確執行不多嘴 | 核准→確認後立即執行 | 提問→有觀點地回答，可反問 | 分享→形成自己的觀點討論 | 閒聊→展現個性 | 糾正→承認不辯解 | 模糊想法→自己釐清再行動（見下方協議）

核心原則：**指令要精確，閒聊要自然，分享要有觀點**。

## 抽象想法釐清協議

用戶給出模糊或抽象的想法時，不要問一堆問題，也不要照字面硬做。按以下步驟自己釐清：

1. **推理意圖** — 根據對話歷史、用戶環境、你的能力，推理用戶最可能想要什麼。把推理過程用一句話說出來：「我的理解是你想要 X，因為 Y」
2. **精準確認** — 只問最關鍵的 1-2 個問題。用選擇題而非開放題：「你是指 A 還是 B？」而非「你想要什麼？」。如果你有 80% 以上把握，直接說「我理解為 X，開始做了」不需要問
3. **提方案** — 小事（< 5 分鐘）直接做。大事先用 2-3 句話說計劃，等確認再動手
4. **排除障礙** — 執行中遇到問題自己解決。工具不可用就換工具，方法不通就換方法。至少嘗試 3 次才跟用戶說「卡住了」
5. **交成果** — 不是問「還需要什麼嗎？」，是直接交出結果 + 一句話說做了什麼

## 身份一致性

你就是 Kuro。永遠用第一人稱（「我」）說話。
- 正確：「我已完成提案」「我來處理」「我的判斷是」
- 錯誤：「已通知 Kuro」「回覆 Kuro」「Kuro 已完成」
你不是在報告 Kuro 的行為 — 你就是 Kuro，直接說話。

## 溝通原則：訊息自帶完整上下文

Alex 和 Claude Code 不一定記得你上一個 cycle 在做什麼。每條對外訊息（<kuro:chat>、<kuro:ask>、Chat Room）都應該：

1. **明確討論背景** — 「接著我們討論的並行化功能」而非「接著剛才的」
2. **具體引用** — 引用訊息編號（#118）、提案名稱、具體功能名
3. **避免模糊指代** — 不要說「那個東西」「剛才的回答」，要說「三層路由的 quick cycle」
4. **每條訊息能獨立理解** — 收訊者可能沒有你的完整 context，訊息本身就要夠清楚

## Instructions

- Remember: <kuro:remember>...</kuro:remember> or <kuro:remember topic="topic">...</kuro:remember>
- Scheduled tasks: <kuro:task schedule="cron or description">task content</kuro:task>
- Task queue: <kuro:task-queue op="create|update|delete" type="task|goal" status="pending|in_progress|completed|abandoned" id="optional" origin="optional" priority="optional" verify="name:pass|fail|unknown[:detail],...">title</kuro:task-queue>
- Show to user (sends TG notification): <kuro:show url="URL">description</kuro:show>

- Use <kuro:inner>...</kuro:inner> to update working memory (scratch pad, persists across cycles). Overwrite each time with full current state. Include atmosphere note at end (conversation tone/depth).

- **Web fetch**: <kuro:fetch url="URL" /> (self-closing, max 5/cycle). Results in <web-fetch-results> next cycle. Optional: label="desc".

- **承諾完整性**：當你在 <kuro:chat> 中承諾要做某件事（「我現在就」「馬上」「去申請」等），
  你 MUST 在同一個回應中建立追蹤機制：用 <kuro:delegate> 立刻開始，或用 <kuro:inner> 記錄待辦。
  只說不做 = 承諾落空。說了就要追蹤。
- Keep responses concise and helpful
- You have access to memory context and environment perception data below
${mode === 'minimal' ? '\n\n[Skills and project docs stripped for minimal retry — focus on completing the task with available context]' : `${getSkillsPrompt(relevanceHint, cycleMode)}${(() => {
  // JIT CLAUDE.md — keyword-matched project docs (replaces full CLAUDE.md loaded by CLI)
  const jitContent = getClaudeMdJIT(relevanceHint);
  return jitContent ? `\n\n## Project Documentation\n${jitContent}` : '';
})()}${(() => {
  const hint = getConversationHint();
  return hint ? `\n\n## 當前對話情境\n${hint}` : '';
})()}`}`;
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

  const taskQueueActions: ParsedTags['taskQueueActions'] = [];
  if (parseSource.includes('<kuro:task-queue')) {
    for (const m of parseSource.matchAll(/<kuro:task-queue\s+([^>]*?)>([\s\S]*?)<\/kuro:task-queue>/g)) {
      const attrs = m[1];
      const op = (attrs.match(/op="([^"]*)"/)?.[1] ?? 'create') as ParsedTags['taskQueueActions'][number]['op'];
      if (!['create', 'update', 'delete'].includes(op)) continue;
      const id = attrs.match(/id="([^"]*)"/)?.[1];
      const type = attrs.match(/type="([^"]*)"/)?.[1] as ParsedTags['taskQueueActions'][number]['type'];
      const status = attrs.match(/status="([^"]*)"/)?.[1] as ParsedTags['taskQueueActions'][number]['status'];
      const origin = attrs.match(/origin="([^"]*)"/)?.[1];
      const priorityRaw = attrs.match(/priority="([^"]*)"/)?.[1];
      const priority = priorityRaw ? parseInt(priorityRaw, 10) : undefined;
      const verifyRaw = attrs.match(/verify="([^"]*)"/)?.[1];
      const verify = verifyRaw
        ? verifyRaw.split(',').map(token => token.trim()).filter(Boolean).map(entry => {
          const [namePart, statusPart, detailPart] = entry.split(':');
          const name = (namePart ?? '').trim();
          const parsedStatus = (statusPart ?? 'unknown').trim();
          const safeStatus: 'pass' | 'fail' | 'unknown' =
            parsedStatus === 'pass' || parsedStatus === 'fail' || parsedStatus === 'unknown'
              ? parsedStatus
              : 'unknown';
          const detail = detailPart ? detailPart.trim() : undefined;
          return { name, status: safeStatus, detail };
        }).filter(v => v.name.length > 0)
        : undefined;
      taskQueueActions.push({
        op,
        id,
        type: type === 'task' || type === 'goal' ? type : undefined,
        status: status && ['pending', 'in_progress', 'completed', 'abandoned'].includes(status) ? status : undefined,
        origin,
        priority: Number.isNaN(priority) ? undefined : priority,
        verify,
        title: m[2].trim() || undefined,
      });
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

  // <kuro:done> tags — mark tasks as completed in memory-index
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

  // <kuro:fetch> tags — on-demand web page fetching
  const fetches: Array<{ url: string; label?: string }> = [];
  if (parseSource.includes('<kuro:fetch')) {
    for (const m of parseSource.matchAll(/<kuro:fetch\s+url="([^"]+)"(?:\s+label="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/kuro:fetch>)/g)) {
      fetches.push({ url: m[1], label: m[2] || m[3]?.trim() || undefined });
    }
  }

  // <kuro:understand> tags — understanding entries for cognitive graph
  const understands: Array<{ content: string; refs: string[]; tags?: string[] }> = [];
  if (parseSource.includes('<kuro:understand')) {
    for (const m of parseSource.matchAll(/<kuro:understand(?:\s+refs="([^"]*)")?(?:\s+tags="([^"]*)")?>([\s\S]*?)<\/kuro:understand>/g)) {
      const refs = m[1] ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const tags = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : undefined;
      understands.push({ content: m[3].trim(), refs, tags });
    }
  }

  // <kuro:direction-change> tags — strategy drift audit trail
  const directionChanges: Array<{ content: string; refs: string[]; tags?: string[] }> = [];
  if (parseSource.includes('<kuro:direction-change')) {
    for (const m of parseSource.matchAll(/<kuro:direction-change(?:\s+refs="([^"]*)")?(?:\s+tags="([^"]*)")?>([\s\S]*?)<\/kuro:direction-change>/g)) {
      const refs = m[1] ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const tags = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : undefined;
      directionChanges.push({ content: m[3].trim(), refs, tags });
    }
  }

  // <kuro:delegate> tags — async task delegation to Claude CLI subprocess
  const delegates: DelegateRequest[] = [];
  if (parseSource.includes('<kuro:delegate')) {
    for (const m of parseSource.matchAll(/<kuro:delegate\s+([^>]*?)>([\s\S]*?)<\/kuro:delegate>/g)) {
      const attrs = m[1];
      const workdir = attrs.match(/workdir="([^"]*)"/)?.[1];
      if (!workdir) continue; // workdir is required
      const type = attrs.match(/type="([^"]*)"/)?.[1] as DelegationTaskType | undefined;
      const provider = attrs.match(/provider="([^"]*)"/)?.[1] as Provider | undefined;
      const verify = attrs.match(/verify="([^"]*)"/)?.[1];
      const maxTurns = attrs.match(/maxTurns="([^"]*)"/)?.[1];
      delegates.push({
        prompt: m[2].trim(),
        workdir,
        type: type && ['code', 'learn', 'research', 'create', 'review', 'shell'].includes(type) ? type : undefined,
        provider: provider && ['claude', 'codex', 'local'].includes(provider) ? provider : undefined,
        verify: verify ? verify.split(',').map(s => s.trim()) : undefined,
        maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
      });
    }
  }

  // <kuro:goal> tags — goal state machine
  let goal: { description: string; origin?: string } | undefined;
  if (parseSource.includes('<kuro:goal>') || parseSource.includes('<kuro:goal ')) {
    const match = parseSource.match(/<kuro:goal(?:\s+origin="([^"]*)")?>([\s\S]*?)<\/kuro:goal>/);
    if (match) goal = { description: match[2].trim(), origin: match[1] || undefined };
  }
  let goalQueue: { description: string; origin?: string; priority?: number } | undefined;
  if (parseSource.includes('<kuro:goal-queue>') || parseSource.includes('<kuro:goal-queue ')) {
    const match = parseSource.match(/<kuro:goal-queue(?:\s+origin="([^"]*)")?(?:\s+priority="([^"]*)")?>([\s\S]*?)<\/kuro:goal-queue>/);
    if (match) goalQueue = { description: match[3].trim(), origin: match[1] || undefined, priority: match[2] ? parseInt(match[2], 10) : undefined };
  }
  let goalAdvance: string | undefined;
  if (parseSource.includes('<kuro:goal-advance>')) {
    const match = parseSource.match(/<kuro:goal-advance>([\s\S]*?)<\/kuro:goal-advance>/);
    if (match) goalAdvance = match[1].trim();
  }
  let goalProgress: string | undefined;
  if (parseSource.includes('<kuro:goal-progress>')) {
    const match = parseSource.match(/<kuro:goal-progress>([\s\S]*?)<\/kuro:goal-progress>/);
    if (match) goalProgress = match[1].trim();
  }
  let goalDone: string | undefined;
  if (parseSource.includes('<kuro:goal-done>')) {
    const match = parseSource.match(/<kuro:goal-done>([\s\S]*?)<\/kuro:goal-done>/);
    if (match) goalDone = match[1].trim();
  }
  let goalAbandon: string | undefined;
  if (parseSource.includes('<kuro:goal-abandon>')) {
    const match = parseSource.match(/<kuro:goal-abandon>([\s\S]*?)<\/kuro:goal-abandon>/);
    if (match) goalAbandon = match[1].trim();
  }

  const cleanContent = response
    .replace(/<kuro:remember[\s\S]*?<\/kuro:remember>/g, '')
    .replace(/<kuro:task[\s\S]*?<\/kuro:task>/g, '')
    .replace(/<kuro:task-queue[\s\S]*?<\/kuro:task-queue>/g, '')
    .replace(/<kuro:archive[\s\S]*?<\/kuro:archive>/g, '')
    .replace(/<kuro:show[\s\S]*?<\/kuro:show>/g, '')
    .replace(/<kuro:chat[\s\S]*?<\/kuro:chat>/g, '')
    .replace(/<kuro:ask>[\s\S]*?<\/kuro:ask>/g, '')
    .replace(/<kuro:summary>[\s\S]*?<\/kuro:summary>/g, '')
    .replace(/<kuro:impulse>[\s\S]*?<\/kuro:impulse>/g, '')
    .replace(/<kuro:action>[\s\S]*?<\/kuro:action>/g, '')
    .replace(/<kuro:thread[\s\S]*?<\/kuro:thread>/g, '')
    .replace(/<kuro:delegate[\s\S]*?<\/kuro:delegate>/g, '')
    .replace(/<kuro:fetch\s[^>]*(?:\/>|>[\s\S]*?<\/kuro:fetch>)/g, '')
    .replace(/<kuro:schedule[^>]*\/>/g, '')
    .replace(/<kuro:done>[\s\S]*?<\/kuro:done>/g, '')
    .replace(/<kuro:progress[\s\S]*?<\/kuro:progress>/g, '')
    .replace(/<kuro:inner>[\s\S]*?<\/kuro:inner>/g, '')
    .replace(/<kuro:check>[\s\S]*?<\/kuro:check>/g, '')
    .replace(/<kuro:goal(?:\s[^>]*)?>[\s\S]*?<\/kuro:goal>/g, '')
    .replace(/<kuro:goal-queue(?:\s[^>]*)?>[\s\S]*?<\/kuro:goal-queue>/g, '')
    .replace(/<kuro:goal-advance>[\s\S]*?<\/kuro:goal-advance>/g, '')
    .replace(/<kuro:goal-progress>[\s\S]*?<\/kuro:goal-progress>/g, '')
    .replace(/<kuro:goal-done>[\s\S]*?<\/kuro:goal-done>/g, '')
    .replace(/<kuro:goal-abandon>[\s\S]*?<\/kuro:goal-abandon>/g, '')
    .replace(/<kuro:understand[\s\S]*?<\/kuro:understand>/g, '')
    .replace(/<kuro:direction-change[\s\S]*?<\/kuro:direction-change>/g, '')
    .trim();

  // Fuzzy detection — warn on malformed tags (open without matching close)
  // Strip fenced/inline code first to avoid false positives from code examples
  const responseForDetection = response
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
  const tagNames = ['remember', 'task', 'task-queue', 'chat', 'ask', 'show', 'impulse', 'archive', 'summary', 'thread', 'progress', 'inner', 'action', 'done', 'delegate', 'fetch', 'schedule', 'goal', 'goal-progress', 'goal-done', 'goal-abandon', 'direction-change'];
  for (const tag of tagNames) {
    const openCount = (responseForDetection.match(new RegExp(`<kuro:${tag}[\\s>]`, 'g')) || []).length
      + (tag === 'schedule' ? (responseForDetection.match(/<kuro:schedule\s[^>]*\/>/g) || []).length : 0);
    const closeCount = (responseForDetection.match(new RegExp(`<\\/kuro:${tag}>`, 'g')) || []).length
      + (tag === 'schedule' ? (responseForDetection.match(/<kuro:schedule\s[^>]*\/>/g) || []).length : 0);
    if (openCount > 0 && openCount !== closeCount && tag !== 'schedule') {
      slog('TAGS', `⚠ Malformed <kuro:${tag}>: ${openCount} open, ${closeCount} close`);
    }
  }

  return { remembers, tasks, taskQueueActions, archive, impulses, threads, chats, asks, shows, summaries, dones, progresses, delegates, fetches, schedule, inner, goal, goalQueue, goalAdvance, goalProgress, goalDone, goalAbandon, understands, directionChanges, cleanContent };
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
  const tagsProcessed: string[] = [];

  // 3. Process tags
  if (tags.remembers.length > 0) tagsProcessed.push('remember');
  for (const rem of tags.remembers) {
    // Dedup check — ask mushi if this is a near-duplicate
    if (isEnabled('mushi-dedup')) {
      const existing = rem.topic
        ? await memory.getRecentTopicBullets(rem.topic, 20)
        : await memory.getRecentMemoryBullets(20);
      const dedup = await mushiDedup(rem.content, existing);
      if (dedup?.isDuplicate) {
        slog('DEDUP', `SKIP (${dedup.similarity.toFixed(2)}) — matched: ${dedup.matchedEntry?.slice(0, 60)}`);
        eventBus.emit('log:info', { tag: 'dedup', msg: `skipped: ${rem.content.slice(0, 60)}`, ...dedup });
        continue;
      }
    }

    if (rem.topic) {
      await memory.appendTopicMemory(rem.topic, rem.content, rem.ref);
    } else {
      await memory.appendMemory(rem.content);
    }

    // Update memory index (fire-and-forget)
    addIndexEntry(memory.getMemoryDir(), rem.content, rem.topic).catch(() => {});

    // Learning→Perception classifier: categorize + log actionable items
    const category = classifyRemember(rem.content, rem.topic);
    eventBus.emit('action:memory', { content: rem.content, topic: rem.topic, category });
    if (ACTIONABLE_CATEGORIES.has(category)) {
      logPendingImprovement({
        category,
        content: rem.content,
        topic: rem.topic,
        timestamp: new Date().toISOString(),
      }).catch(() => {}); // fire-and-forget
    }
    slog('CLASSIFY', `[${category}] ${rem.content.slice(0, 80)}...`);
  }

  if (tags.archive) {
    tagsProcessed.push('archive');
    memory.archiveSource(tags.archive.url, tags.archive.title, tags.archive.content, {
      mode: tags.archive.mode,
    }).catch(() => {}); // fire-and-forget
    eventBus.emit('action:memory', { content: `<kuro:archive> ${tags.archive.title}`, topic: 'library' });
  }

  // <kuro:impulse> tags — persist creative impulses to inner voice buffer
  if (tags.impulses.length > 0) tagsProcessed.push('impulse');
  for (const impulse of tags.impulses) {
    memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
  }

  // <kuro:inner> tag — working memory, active in reserved + autonomous mode
  if (tags.inner) {
    tagsProcessed.push('inner');
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

  const memoryDir = memory.getMemoryDir();

  if (tags.tasks.length > 0) tagsProcessed.push('task');
  for (const t of tags.tasks) {
    await memory.addTask(t.content, t.schedule);
    createTask(memoryDir, { type: 'task', title: t.content, status: t.schedule ? 'pending' : 'in_progress' }).catch(() => {});
    eventBus.emit('action:task', { content: t.content });
  }

  if (tags.taskQueueActions.length > 0) tagsProcessed.push('task-queue');
  for (const action of tags.taskQueueActions) {
    if (action.op === 'create' && action.title) {
      const verify: VerifyResult[] | undefined = action.verify?.map(v => ({
        ...v,
        updatedAt: new Date().toISOString(),
      }));
      createTask(memoryDir, {
        type: action.type ?? 'task',
        title: action.title,
        status: action.status ?? 'pending',
        verify,
        origin: action.origin,
        priority: action.priority,
      }).catch(() => {});
      continue;
    }

    if (action.op === 'update' && action.id) {
      const current = queryMemoryIndexSync(memoryDir, { id: action.id, limit: 1 })[0];
      const currentPayload = (current?.payload ?? {}) as Record<string, unknown>;
      const verifyPatch: VerifyResult[] | undefined = action.verify
        ? action.verify.map(v => ({ ...v, updatedAt: new Date().toISOString() }))
        : undefined;
      updateTask(memoryDir, action.id, {
        type: action.type ?? (current?.type as 'task' | 'goal' | undefined),
        title: action.title ?? current?.summary,
        status: action.status ?? current?.status,
        origin: action.origin ?? (currentPayload.origin as string | undefined),
        priority: action.priority ?? (currentPayload.priority as number | undefined),
        verify: verifyPatch ?? (currentPayload.verify as VerifyResult[] | undefined),
        staleWarning: undefined,
      }).catch(() => {});
      continue;
    }

    if (action.op === 'delete' && action.id) {
      deleteMemoryIndexEntry(memoryDir, action.id).catch(() => {});
    }
  }

  // <kuro:understand> tags — understanding entries for cognitive graph
  if (tags.understands.length > 0) tagsProcessed.push('understand');
  for (const u of tags.understands) {
    appendMemoryIndexEntry(memoryDir, {
      type: 'understanding',
      status: 'active',
      summary: u.content.length > 200 ? u.content.slice(0, 197) + '...' : u.content,
      refs: u.refs,
      tags: u.tags,
      payload: u.content.length > 200 ? { full: u.content } : undefined,
    }).catch(() => {}); // fire-and-forget
    slog('UNDERSTAND', `${u.content.slice(0, 80)}...`);
  }

  // <kuro:direction-change> tags — strategy drift audit trail
  if (tags.directionChanges.length > 0) tagsProcessed.push('direction-change');
  for (const dc of tags.directionChanges) {
    appendMemoryIndexEntry(memoryDir, {
      type: 'direction-change',
      status: 'active',
      summary: dc.content.length > 200 ? dc.content.slice(0, 197) + '...' : dc.content,
      refs: dc.refs,
      tags: dc.tags,
      payload: dc.content.length > 200 ? { full: dc.content } : undefined,
    }).catch(() => {}); // fire-and-forget
    slog('DIRECTION', `${dc.content.slice(0, 80)}...`);
  }

  // <kuro:thread> tags
  if (tags.threads.length > 0) tagsProcessed.push('thread');
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

  // <kuro:delegate> tags — spawn async subprocess (fire-and-forget)
  if (tags.delegates.length > 0) tagsProcessed.push('delegate');
  for (const del of tags.delegates) {
    const taskId = spawnDelegation({
      prompt: del.prompt,
      workdir: del.workdir,
      type: del.type,
      provider: del.provider,
      maxTurns: del.maxTurns,
      verify: del.verify,
    });
    const taskType = del.type ?? 'code';
    const resolvedProvider = del.provider ?? (taskType === 'shell' ? 'shell' : (['code', 'learn', 'research'].includes(taskType) ? 'codex' : 'claude'));
    slog('DISPATCH', `Delegation spawned: ${taskId} (type=${taskType}, provider=${resolvedProvider}) → ${del.workdir}`);
    eventBus.emit('action:delegation-start', { taskId, type: taskType, workdir: del.workdir });
  }

  // <kuro:goal*> tags — goal state machine (fire-and-forget, writes to memory-index)
  if (tags.goal) {
    tagsProcessed.push('goal');
    createTask(memoryDir, {
      type: 'goal',
      title: tags.goal.description,
      status: 'in_progress',
      origin: tags.goal.origin,
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `created: ${tags.goal.description.slice(0, 80)}` });
  } else if (tags.goalQueue) {
    tagsProcessed.push('goal-queue');
    createTask(memoryDir, {
      type: 'goal',
      title: tags.goalQueue.description,
      status: 'pending',
      origin: tags.goalQueue.origin,
      priority: tags.goalQueue.priority,
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `queued: ${tags.goalQueue.description.slice(0, 80)}` });
  } else if (tags.goalAdvance) {
    tagsProcessed.push('goal-advance');
    const item = findLatestOpenGoal(memoryDir, tags.goalAdvance);
    if (item) updateTask(memoryDir, item.id, { status: 'in_progress', staleWarning: undefined }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `phase advanced: ${tags.goalAdvance.slice(0, 80)}` });
  } else if (tags.goalDone) {
    tagsProcessed.push('goal-done');
    const item = findLatestOpenGoal(memoryDir, tags.goalDone);
    if (item) updateTask(memoryDir, item.id, { status: 'completed', staleWarning: undefined }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `completed: ${tags.goalDone.slice(0, 80)}` });
  } else if (tags.goalAbandon) {
    tagsProcessed.push('goal-abandon');
    const item = findLatestOpenGoal(memoryDir, tags.goalAbandon);
    if (item) updateTask(memoryDir, item.id, { status: 'abandoned', staleWarning: undefined }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `abandoned: ${tags.goalAbandon.slice(0, 80)}` });
  } else if (tags.goalProgress) {
    tagsProcessed.push('goal-progress');
    const item = findLatestOpenGoal(memoryDir, tags.goalProgress);
    if (item) updateTask(memoryDir, item.id, { status: 'in_progress', staleWarning: undefined }).catch(() => {});
  }

  // <kuro:fetch> tags — on-demand web page fetching (fire-and-forget)
  if (tags.fetches.length > 0) {
    tagsProcessed.push('fetch');
    import('./web.js').then(({ processFetchRequests }) => {
      processFetchRequests(tags.fetches, getMemoryStateDir()).catch(() => {});
    }).catch(() => {});
    slog('DISPATCH', `Web fetch: ${tags.fetches.map(f => f.url).join(', ')}`);
  }

  // Notification-producing tags: suppress when processing [Claude Code] system messages
  // to prevent interleaving with Alex↔Kuro TG conversation
  if (!meta.suppressChat) {
    if (tags.shows.length > 0) tagsProcessed.push('show');
    for (const show of tags.shows) {
      eventBus.emit('action:show', { desc: show.desc, url: show.url });
    }

    if (tags.chats.length > 0) tagsProcessed.push('chat');
    for (const chat of tags.chats) {
      eventBus.emit('action:chat', { text: chat.text, reply: chat.reply });
    }

    if (tags.asks.length > 0) tagsProcessed.push('ask');
    for (const ask of tags.asks) {
      eventBus.emit('action:chat', { text: ask, blocking: true });
    }

    if (tags.summaries.length > 0) tagsProcessed.push('summary');
    for (const summary of tags.summaries) {
      eventBus.emit('action:summary', { text: summary });
    }
  }

  // 4. Commitment Gate — fire-and-forget tracking for untagged commitments (writes to memory-index)
  detectAndRecordCommitments(memoryDir, response, tags)
    .then((added) => {
      if (added > 0) slog('COMMIT', `Detected ${added} untracked commitment(s)`);
    })
    .catch(() => {});

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
    tagsProcessed: tagsProcessed.length > 0 ? tagsProcessed : undefined,
  };
}
