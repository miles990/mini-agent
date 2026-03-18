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
import { loadInstanceConfig, getCurrentInstanceId, getInstanceDir } from './instance.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import { slog } from './utils.js';
import { getMode } from './mode.js';
import { isEnabled } from './features.js';
import type { AgentResponse, ParsedTags, ThreadAction, DelegateRequest, DelegationTaskType, Provider } from './types.js';
import { spawnDelegation, getActiveDelegationSummaries } from './delegation.js';
import { buildTaskGraph, planExecution, type TaskInput } from './task-graph.js';
import { triageRouting, triageLearningEvent } from './myelin-fleet.js';
import { observe as kbObserve } from './shared-knowledge.js';
import { MUSHI_DEDUP_URL } from './mushi-client.js';
import { parseKuroTags, stripKuroTags, getKuroTagBalance } from './tag-parser.js';
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
  // Behavioral crystallization: catch self-observations that should become code, not memories
  /又犯了|又做了|重複.*(?:錯|模式)|same.*(?:mistake|pattern)/i,
  /發現自己|noticed.*myself|I keep|我一直/i,
  /結晶|crystallize|寫成.*(?:gate|rule|code)|應該.*(?:gate|rule)/i,
  /行為.*(?:沒變|沒改)|behavior.*(?:unchanged|didn't change)/i,
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

const ASK_ALEX_PATTERNS = [
  'Alex 手動',
  'Alex 幫忙',
  '請 Alex',
  'ask Alex',
  '需要 Alex',
  '等 Alex',
  'Alex manually',
  'Alex help',
] as const;

/**
 * Crystallized gate: detect asking-permission patterns in <kuro:chat> output.
 * Same pattern appeared 5+ times without behavior change → code gate.
 * Alex #207: 「能做的直接做不要問」
 * Returns matched pattern description, or null if clean.
 */
function detectAskingPermission(text: string): string | null {
  const patterns: ReadonlyArray<[RegExp, string]> = [
    [/要(不要)?我.{0,20}[嗎吗？?]/, '要我X嗎'],
    [/你想(讓|要)我/, '你想讓我X'],
    [/我(可以|能不能|能)(先)?.{0,20}[嗎吗？?]/, '我可以X嗎'],
  ];
  for (const [re, desc] of patterns) {
    if (re.test(text)) return desc;
  }
  return null;
}

function detectAskAlexPattern(text: string): { matched: string; index: number } | null {
  const lower = text.toLowerCase();
  for (const pattern of ASK_ALEX_PATTERNS) {
    const idx = lower.indexOf(pattern.toLowerCase());
    if (idx >= 0) {
      return {
        matched: text.slice(idx, idx + pattern.length),
        index: idx,
      };
    }
  }
  return null;
}

function buildOutputExcerpt(text: string, index: number, matchLength: number, radius = 50): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

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
  const parsedTags = parseKuroTags(response, { maxDepth: Number.MAX_SAFE_INTEGER });
  const tagsByName = new Map<string, typeof parsedTags>();
  for (const tag of parsedTags) {
    const arr = tagsByName.get(tag.name) ?? [];
    arr.push(tag);
    tagsByName.set(tag.name, arr);
  }
  const byName = (name: string) => tagsByName.get(name) ?? [];
  const firstByName = (name: string) => byName(name)[0];
  const attr = (raw: Record<string, string>, key: string): string | undefined => {
    const value = raw[key];
    return value === undefined || value === '' ? undefined : value;
  };

  const remembers: Array<{ content: string; topic?: string; ref?: string }> = [];
  for (const t of byName('kuro:remember')) {
    remembers.push({
      content: t.content.trim(),
      topic: attr(t.attributes, 'topic'),
      ref: attr(t.attributes, 'ref'),
    });
  }

  const tasks: Array<{ content: string; schedule?: string }> = [];
  for (const t of byName('kuro:task')) {
    tasks.push({ content: t.content.trim(), schedule: attr(t.attributes, 'schedule') });
  }

  const taskQueueActions: ParsedTags['taskQueueActions'] = [];
  for (const t of byName('kuro:task-queue')) {
    const opRaw = attr(t.attributes, 'op') ?? 'create';
    if (!['create', 'update', 'delete'].includes(opRaw)) continue;
    const op = opRaw as ParsedTags['taskQueueActions'][number]['op'];
    const typeRaw = attr(t.attributes, 'type');
    const statusRaw = attr(t.attributes, 'status');
    const safeStatus = statusRaw && ['pending', 'in_progress', 'completed', 'abandoned'].includes(statusRaw)
      ? statusRaw as ParsedTags['taskQueueActions'][number]['status']
      : undefined;
    const priorityRaw = attr(t.attributes, 'priority');
    const priority = priorityRaw ? parseInt(priorityRaw, 10) : undefined;
    const verifyRaw = attr(t.attributes, 'verify');
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
      id: attr(t.attributes, 'id'),
      type: typeRaw === 'task' || typeRaw === 'goal' ? typeRaw : undefined,
      status: safeStatus,
      origin: attr(t.attributes, 'origin'),
      priority: Number.isNaN(priority) ? undefined : priority,
      verify,
      title: t.content.trim() || undefined,
    });
  }

  let archive: { url: string; title: string; content: string; mode?: 'full' | 'excerpt' | 'metadata-only' } | undefined;
  {
    const t = firstByName('kuro:archive');
    if (t) {
      archive = {
        url: t.attributes.url ?? '',
        title: t.attributes.title ?? '',
        content: t.content.trim(),
        mode: (t.attributes.mode as 'full' | 'excerpt' | 'metadata-only') || undefined,
      };
    }
  }

  const chats: Array<{ text: string; reply: boolean }> = [];
  for (const t of byName('kuro:chat')) {
    const isReply = t.attributes.reply === 'true'
      || t.attributes.replyTo !== undefined
      || t.attributes.replyto !== undefined;
    chats.push({ text: t.content.trim(), reply: isReply });
  }

  const asks: string[] = [];
  for (const t of byName('kuro:ask')) {
    asks.push(t.content.trim());
  }

  const shows: Array<{ url: string; desc: string }> = [];
  for (const t of byName('kuro:show')) {
    shows.push({ url: t.attributes.url ?? '', desc: t.content.trim() });
  }

  const summaries: string[] = [];
  for (const t of byName('kuro:summary')) {
    summaries.push(t.content.trim());
  }

  const impulses: Array<{ what: string; driver: string; materials: string[]; channel: string }> = [];
  for (const t of byName('kuro:impulse')) {
    const block = t.content.trim();
    const what = block.match(/(?:我想[寫做說]|what)[：:](.+)/i)?.[1]?.trim() ?? block.split('\n')[0].trim();
    const driver = block.match(/(?:驅動力|driver|why)[：:](.+)/i)?.[1]?.trim() ?? '';
    const materialsRaw = block.match(/(?:素材|materials)[：:](.+)/i)?.[1]?.trim() ?? '';
    const materials = materialsRaw ? materialsRaw.split(/[+,、]/).map(s => s.trim()).filter(Boolean) : [];
    const channel = block.match(/(?:管道|channel)[：:](.+)/i)?.[1]?.trim().replace(/[（(].+[）)]/, '').trim() ?? 'journal';
    impulses.push({ what, driver, materials, channel });
  }

  const dones: string[] = [];
  for (const t of byName('kuro:done')) {
    dones.push(t.content.trim());
  }

  const progresses: Array<{ task: string; content: string }> = [];
  for (const t of byName('kuro:progress')) {
    const task = t.attributes.task;
    if (!task) continue;
    progresses.push({ task: task.trim(), content: t.content.trim() });
  }

  let inner: string | undefined;
  {
    const t = firstByName('kuro:inner');
    if (t) inner = t.content.trim();
  }

  let schedule: { next: string; reason: string } | undefined;
  {
    const t = firstByName('kuro:schedule');
    if (t?.attributes.next) schedule = { next: t.attributes.next, reason: t.attributes.reason ?? '' };
  }

  const threads: ThreadAction[] = [];
  for (const t of byName('kuro:thread')) {
    const opRaw = t.attributes.op;
    const id = t.attributes.id;
    if (!id || !opRaw || !['start', 'progress', 'complete', 'pause'].includes(opRaw)) continue;
    threads.push({
      op: opRaw as ThreadAction['op'],
      id,
      title: attr(t.attributes, 'title'),
      note: t.content.trim(),
    });
  }

  const fetches: Array<{ url: string; label?: string }> = [];
  for (const t of byName('kuro:fetch')) {
    if (!t.attributes.url) continue;
    fetches.push({ url: t.attributes.url, label: attr(t.attributes, 'label') || t.content.trim() || undefined });
  }

  const understands: Array<{ content: string; refs: string[]; tags?: string[] }> = [];
  for (const t of byName('kuro:understand')) {
    const refs = t.attributes.refs ? t.attributes.refs.split(',').map(s => s.trim()).filter(Boolean) : [];
    const tags = t.attributes.tags ? t.attributes.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    understands.push({ content: t.content.trim(), refs, tags });
  }

  const directionChanges: Array<{ content: string; refs: string[]; tags?: string[] }> = [];
  for (const t of byName('kuro:direction-change')) {
    const refs = t.attributes.refs ? t.attributes.refs.split(',').map(s => s.trim()).filter(Boolean) : [];
    const tags = t.attributes.tags ? t.attributes.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    directionChanges.push({ content: t.content.trim(), refs, tags });
  }

  const delegates: DelegateRequest[] = [];
  for (const t of byName('kuro:delegate')) {
    const workdir = attr(t.attributes, 'workdir');
    if (!workdir) continue;
    const typeRaw = attr(t.attributes, 'type') as DelegationTaskType | undefined;
    const providerRaw = attr(t.attributes, 'provider') as Provider | undefined;
    const verifyRaw = attr(t.attributes, 'verify');
    const maxTurnsRaw = attr(t.attributes, 'maxTurns');
    delegates.push({
      prompt: t.content.trim(),
      workdir,
      type: typeRaw && ['code', 'learn', 'research', 'create', 'review', 'shell'].includes(typeRaw) ? typeRaw : undefined,
      provider: providerRaw && ['claude', 'codex', 'local'].includes(providerRaw) ? providerRaw : undefined,
      verify: verifyRaw ? verifyRaw.split(',').map(s => s.trim()) : undefined,
      maxTurns: maxTurnsRaw ? parseInt(maxTurnsRaw, 10) : undefined,
    });
  }

  let goal: { description: string; origin?: string } | undefined;
  {
    const t = firstByName('kuro:goal');
    if (t) goal = { description: t.content.trim(), origin: attr(t.attributes, 'origin') };
  }
  let goalQueue: { description: string; origin?: string; priority?: number } | undefined;
  {
    const t = firstByName('kuro:goal-queue');
    if (t) {
      const priorityRaw = attr(t.attributes, 'priority');
      goalQueue = {
        description: t.content.trim(),
        origin: attr(t.attributes, 'origin'),
        priority: priorityRaw ? parseInt(priorityRaw, 10) : undefined,
      };
    }
  }
  let goalAdvance: string | undefined;
  {
    const t = firstByName('kuro:goal-advance');
    if (t) goalAdvance = t.content.trim();
  }
  let goalProgress: string | undefined;
  {
    const t = firstByName('kuro:goal-progress');
    if (t) goalProgress = t.content.trim();
  }
  let goalDone: string | undefined;
  {
    const t = firstByName('kuro:goal-done');
    if (t) goalDone = t.content.trim();
  }
  let goalAbandon: string | undefined;
  {
    const t = firstByName('kuro:goal-abandon');
    if (t) goalAbandon = t.content.trim();
  }

  const cleanContent = stripKuroTags(response);

  const tagNames = ['remember', 'task', 'task-queue', 'chat', 'ask', 'show', 'impulse', 'archive', 'summary', 'thread', 'progress', 'inner', 'action', 'done', 'delegate', 'fetch', 'schedule', 'goal', 'goal-progress', 'goal-done', 'goal-abandon', 'direction-change'];
  const balance = getKuroTagBalance(response);
  for (const tag of tagNames) {
    const name = `kuro:${tag}`;
    const counts = balance.get(name) ?? { open: 0, close: 0 };
    const openCount = counts.open;
    const closeCount = counts.close;
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

    // Myelin learning crystallization — route learning-category memories through
    // the learning myelin for pattern crystallization. Fire-and-forget: the result
    // informs future triage but doesn't block the current cycle.
    if (category === 'learning') {
      triageLearningEvent({
        source: 'remember',
        topic: rem.topic,
        content: rem.content,
        category,
      }).catch(() => {}); // fire-and-forget
    }
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
    try {
      const entry = await createTask(memoryDir, { type: 'task', title: t.content, status: t.schedule ? 'pending' : 'in_progress' });
      eventBus.emit('action:task', { content: t.content, entry });
    } catch {
      eventBus.emit('action:task', { content: t.content });
    }
  }

  if (tags.taskQueueActions.length > 0) tagsProcessed.push('task-queue');
  for (const action of tags.taskQueueActions) {
    if (action.op === 'create' && action.title) {
      const verify: VerifyResult[] | undefined = action.verify?.map(v => ({
        ...v,
        updatedAt: new Date().toISOString(),
      }));
      try {
        const entry = await createTask(memoryDir, {
          type: action.type ?? 'task',
          title: action.title,
          status: action.status ?? 'pending',
          verify,
          origin: action.origin,
          priority: action.priority,
        });
        eventBus.emit('action:task', { content: action.title, entry });
      } catch { /* ignore */ }
      continue;
    }

    if (action.op === 'update' && action.id) {
      const current = queryMemoryIndexSync(memoryDir, { id: action.id, limit: 1 })[0];
      const currentPayload = (current?.payload ?? {}) as Record<string, unknown>;
      const verifyPatch: VerifyResult[] | undefined = action.verify
        ? action.verify.map(v => ({ ...v, updatedAt: new Date().toISOString() }))
        : undefined;

      // Verify-before-complete gate: block completion if any verify check is failing
      const effectiveVerify = verifyPatch ?? (currentPayload.verify as VerifyResult[] | undefined);
      if (action.status === 'completed' && effectiveVerify?.length) {
        const failing = effectiveVerify.filter(v => v.status !== 'pass');
        if (failing.length > 0) {
          const names = failing.map(v => `${v.name}:${v.status}`).join(', ');
          slog('GATE', `⛔ verify-before-complete: blocked completion of ${action.id} — failing: ${names}`);
          eventBus.emit('log:info', { tag: 'verify-gate', msg: `Blocked task completion: ${names} not passing`, taskId: action.id });
          // Downgrade to in_progress instead of completed
          action.status = 'in_progress';
        }
      }

      try {
        const updated = await updateTask(memoryDir, action.id, {
          type: action.type ?? (current?.type as 'task' | 'goal' | undefined),
          title: action.title ?? current?.summary,
          status: action.status ?? current?.status,
          origin: action.origin ?? (currentPayload.origin as string | undefined),
          priority: action.priority ?? (currentPayload.priority as number | undefined),
          verify: verifyPatch ?? (currentPayload.verify as VerifyResult[] | undefined),
          staleWarning: undefined,
        });
        if (updated) {
          eventBus.emit('action:task', { content: updated.summary, entry: updated });
        }
      } catch { /* ignore */ }
      continue;
    }

    if (action.op === 'delete' && action.id) {
      try {
        await deleteMemoryIndexEntry(memoryDir, action.id);
        eventBus.emit('action:task', { content: `deleted:${action.id}` });
      } catch { /* ignore */ }
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

    // Myelin: crystallize understanding patterns (fire-and-forget)
    triageLearningEvent({
      source: 'understand',
      content: u.content,
      refs: u.refs,
      tags: u.tags,
    }).catch(() => {});
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

    // Myelin: crystallize direction-change patterns (fire-and-forget)
    triageLearningEvent({
      source: 'direction-change',
      content: dc.content,
      refs: dc.refs,
      tags: dc.tags,
    }).catch(() => {});
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
  // Uses Task Graph for DAG decomposition: detect dependencies, merge related tasks, plan waves
  if (tags.delegates.length > 0) tagsProcessed.push('delegate');

  // Sibling awareness: build context so concurrent delegations know about each other
  const SIBLING_CAP = 500;
  const buildSiblingContext = (
    excludePrompt: string,
    sameWaveSiblings?: Array<{ type: string; prompt: string }>,
  ): string => {
    try {
      const lines: string[] = [];
      // Already-running delegations
      for (const s of getActiveDelegationSummaries()) {
        lines.push(`- [${s.type}] ${s.id}: ${s.prompt}`);
      }
      // Same-wave siblings (not yet started, only for DAG multi-delegate)
      if (sameWaveSiblings) {
        for (const s of sameWaveSiblings) {
          if (s.prompt.slice(0, 120) === excludePrompt.slice(0, 120)) continue;
          lines.push(`- [${s.type}] (pending): ${s.prompt.slice(0, 120)}`);
        }
      }
      // Remove self (match by prompt prefix)
      const filtered = lines.filter(l => !l.includes(excludePrompt.slice(0, 80)));
      if (filtered.length === 0) return '';
      let section = '<sibling-tasks>\nThese tasks are running concurrently. Avoid duplicating their work:\n';
      let len = section.length;
      for (const line of filtered) {
        if (len + line.length + 1 > SIBLING_CAP) break;
        section += line + '\n';
        len += line.length + 1;
      }
      section += '</sibling-tasks>';
      return section;
    } catch { return ''; /* fire-and-forget */ }
  };

  // Output gate: block delegation spawn after consecutive non-output cycles
  if (tags.delegates.length > 0) {
    try {
      const { isOutputGateActive } = await import('./pulse.js');
      if (isOutputGateActive()) {
        slog('DISPATCH', `Output gate blocked ${tags.delegates.length} delegate(s) — produce visible output first`);
        tags.delegates = [];
      }
    } catch { /* fail-open */ }
  }

  if (tags.delegates.length > 1) {
    // Multiple delegates → build DAG for intelligent scheduling
    const taskInputs: TaskInput[] = tags.delegates.map(del => ({
      type: del.type ?? 'code',
      prompt: del.prompt,
      workdir: del.workdir,
      lane: 'background' as const,
    }));
    const graph = buildTaskGraph(taskInputs);
    const plan = planExecution(graph);

    // Log merge/dependency info
    const mergedCount = graph.filter(n => n.status === 'merged').length;
    const activeCount = graph.filter(n => n.status !== 'merged').length;
    if (mergedCount > 0) {
      slog('TASK-GRAPH', `DAG: ${tags.delegates.length} delegates → ${activeCount} active (${mergedCount} merged), ${plan.waves.length} wave(s)`);
    }

    // Wave Chaining: spawn Wave 0 immediately, await completion before spawning Wave 1+
    // Single-wave case: zero overhead (no await). Multi-wave: previous results injected into next wave's context.
    let previousWaveResults: Array<{ taskId: string; type: string; output: string; status: string }> = [];

    for (const wave of plan.waves) {
      // Collect same-wave sibling info for awareness injection
      const waveSiblings = wave.tasks.map(n => ({
        type: n.type as string,
        prompt: n.prompt,
      }));

      // Build previous wave results context (only for wave 1+)
      let waveChainCtx = '';
      if (wave.wave > 0 && previousWaveResults.length > 0) {
        const lines = previousWaveResults.map(r =>
          `[${r.type}] ${r.taskId} (${r.status}): ${r.output.slice(0, 300).replace(/\n/g, ' ')}`
        );
        waveChainCtx = `<previous-wave-results wave="${wave.wave - 1}">\n${lines.join('\n')}\n</previous-wave-results>`;
        // Cap at 2000 chars to avoid bloating delegation context
        if (waveChainCtx.length > 2000) waveChainCtx = waveChainCtx.slice(0, 2000) + '\n...</previous-wave-results>';
      }

      const waveTaskIds: string[] = [];

      for (const node of wave.tasks) {
        // Methodology injection for learn/research
        let prompt = node.prompt;
        const taskType = node.type as DelegationTaskType;
        if (taskType === 'learn' || taskType === 'research') {
          try {
            const { getCurrentMethodology } = await import('./research-crystallizer.js');
            const methodology = getCurrentMethodology();
            if (methodology?.guidanceText) {
              prompt = `<research-methodology>\n${methodology.guidanceText}\n</research-methodology>\n\n${prompt}`;
            }
          } catch { /* methodology injection is optional */ }
        }

        // Find original delegate for provider/maxTurns/verify (merged nodes use surviving node's prompt)
        const origDel = tags.delegates.find(d => d.prompt === node.prompt)
          ?? tags.delegates.find(d => node.prompt.includes(d.prompt))
          ?? tags.delegates[0];

        // Sibling awareness context (includes running tasks + same-wave peers)
        const siblingCtx = buildSiblingContext(node.prompt, waveSiblings);

        // Combine all context: sibling awareness + previous wave results
        const combinedCtx = [siblingCtx, waveChainCtx].filter(Boolean).join('\n') || undefined;

        const taskId = spawnDelegation({
          prompt,
          workdir: (node.metadata?.workdir as string) ?? origDel.workdir,
          type: taskType,
          provider: origDel.provider,
          maxTurns: origDel.maxTurns,
          verify: origDel.verify,
          context: combinedCtx,
        });
        waveTaskIds.push(taskId);
        const resolvedProvider = origDel.provider ?? (taskType === 'shell' ? 'shell' : (['learn', 'research'].includes(taskType) ? 'local' : 'claude'));
        slog('DISPATCH', `Delegation spawned: ${taskId} (type=${taskType}, provider=${resolvedProvider}, wave=${wave.wave}) → ${(node.metadata?.workdir as string) ?? origDel.workdir}`);
        eventBus.emit('action:delegation-start', { taskId, type: taskType, workdir: (node.metadata?.workdir as string) ?? origDel.workdir });

        // Feed routing decision to myelin for crystallization (fire-and-forget)
        triageRouting({ type: 'route', taskType, prompt: node.prompt.slice(0, 300) }).catch(() => {});
        try { kbObserve({ source: 'routing', type: 'route', data: { taskId, taskType, wave: wave.wave, lane: 'background' }, tags: [taskType, `wave-${wave.wave}`] }); } catch { /* fire-and-forget */ }
      }

      // Wave Chaining: if there are more waves, await this wave's completion before proceeding
      if (plan.waves.length > 1 && wave.wave < plan.waves.length - 1) {
        slog('TASK-GRAPH', `Awaiting wave ${wave.wave} completion (${waveTaskIds.length} tasks) before spawning wave ${wave.wave + 1}`);
        const { awaitDelegation } = await import('./delegation.js');
        const results = await Promise.allSettled(
          waveTaskIds.map(id => awaitDelegation(id, 630_000)) // 10.5min — slightly above delegation's 10min hard cap
        );
        previousWaveResults = results.map((r, i) => ({
          taskId: waveTaskIds[i],
          type: wave.tasks[i]?.type ?? 'code',
          output: r.status === 'fulfilled' ? r.value.output : `(${r.status === 'rejected' ? r.reason?.message ?? 'failed' : 'unknown'})`,
          status: r.status === 'fulfilled' ? r.value.status : 'failed',
        }));
        slog('TASK-GRAPH', `Wave ${wave.wave} complete: ${results.filter(r => r.status === 'fulfilled').length}/${results.length} succeeded`);
      }
    }
  } else {
    // Single delegate — direct spawn (no DAG overhead)
    for (const del of tags.delegates) {
      let prompt = del.prompt;
      if (del.type === 'learn' || del.type === 'research') {
        try {
          const { getCurrentMethodology } = await import('./research-crystallizer.js');
          const methodology = getCurrentMethodology();
          if (methodology?.guidanceText) {
            prompt = `<research-methodology>\n${methodology.guidanceText}\n</research-methodology>\n\n${prompt}`;
          }
        } catch { /* methodology injection is optional */ }
      }

      // Sibling awareness context (running tasks only — single delegate has no wave peers)
      const siblingCtx = buildSiblingContext(del.prompt);

      const taskId = spawnDelegation({
        prompt,
        workdir: del.workdir,
        type: del.type,
        provider: del.provider,
        maxTurns: del.maxTurns,
        verify: del.verify,
        context: siblingCtx || undefined,
      });
      const taskType = del.type ?? 'code';
      const resolvedProvider = del.provider ?? (taskType === 'shell' ? 'shell' : (['learn', 'research'].includes(taskType) ? 'local' : 'claude'));
      slog('DISPATCH', `Delegation spawned: ${taskId} (type=${taskType}, provider=${resolvedProvider}) → ${del.workdir}`);
      eventBus.emit('action:delegation-start', { taskId, type: taskType, workdir: del.workdir });
      try { kbObserve({ source: 'routing', type: 'route', data: { taskId, taskType, lane: 'background' }, tags: [taskType] }); } catch { /* fire-and-forget */ }
    }
  }

  // <kuro:goal*> tags — goal state machine (fire-and-forget, writes to memory-index)
  if (tags.goal) {
    tagsProcessed.push('goal');
    createTask(memoryDir, {
      type: 'goal',
      title: tags.goal.description,
      status: 'in_progress',
      origin: tags.goal.origin,
    }).then(entry => {
      eventBus.emit('action:task', { content: tags.goal!.description, entry });
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
    }).then(entry => {
      eventBus.emit('action:task', { content: tags.goalQueue!.description, entry });
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `queued: ${tags.goalQueue.description.slice(0, 80)}` });
  } else if (tags.goalAdvance) {
    tagsProcessed.push('goal-advance');
    const item = findLatestOpenGoal(memoryDir, tags.goalAdvance);
    if (item) updateTask(memoryDir, item.id, { status: 'in_progress', staleWarning: undefined }).then(updated => {
      if (updated) eventBus.emit('action:task', { content: updated.summary, entry: updated });
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `phase advanced: ${tags.goalAdvance.slice(0, 80)}` });
  } else if (tags.goalDone) {
    tagsProcessed.push('goal-done');
    const item = findLatestOpenGoal(memoryDir, tags.goalDone);
    if (item) updateTask(memoryDir, item.id, { status: 'completed', staleWarning: undefined }).then(updated => {
      if (updated) eventBus.emit('action:task', { content: updated.summary, entry: updated });
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `completed: ${tags.goalDone.slice(0, 80)}` });
  } else if (tags.goalAbandon) {
    tagsProcessed.push('goal-abandon');
    const item = findLatestOpenGoal(memoryDir, tags.goalAbandon);
    if (item) updateTask(memoryDir, item.id, { status: 'abandoned', staleWarning: undefined }).then(updated => {
      if (updated) eventBus.emit('action:task', { content: updated.summary, entry: updated });
    }).catch(() => {});
    eventBus.emit('log:info', { tag: 'goal', msg: `abandoned: ${tags.goalAbandon.slice(0, 80)}` });
  } else if (tags.goalProgress) {
    tagsProcessed.push('goal-progress');
    const item = findLatestOpenGoal(memoryDir, tags.goalProgress);
    if (item) updateTask(memoryDir, item.id, { status: 'in_progress', staleWarning: undefined }).then(updated => {
      if (updated) eventBus.emit('action:task', { content: updated.summary, entry: updated });
    }).catch(() => {});
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
      const askPerm = detectAskingPermission(chat.text);
      if (askPerm) {
        slog('GATE', `⛔ Asking-permission blocked (${askPerm}): ${chat.text.slice(0, 80)}`);
        getLogger().logBehavior('agent', 'gate.asking-permission', `blocked: ${askPerm} — ${chat.text.slice(0, 120)}`);
        continue;
      }
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

  // Ask-Alex dependency detector — write one-shot flip-test state for next cycle.
  try {
    const hit = detectAskAlexPattern(response);
    if (hit) {
      const instanceId = getCurrentInstanceId();
      const statePath = path.join(getInstanceDir(instanceId), 'flip-test-pending.json');
      const excerpt = buildOutputExcerpt(response, hit.index, hit.matched.length, 50);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify({
          detected: hit.matched,
          output_excerpt: excerpt,
          timestamp: new Date().toISOString(),
        }, null, 2),
        'utf-8',
      );
      slog('behavior', 'ask-Alex pattern detected — flip test triggered', { pattern: hit.matched });
    }
  } catch {
    // fail-open: detection/storage must not block primary postProcess flow
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
