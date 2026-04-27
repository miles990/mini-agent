/**
 * Dispatcher — Tag Processor + System Prompt (OODA-Only)
 *
 * 保留 parseTags / postProcess / getSystemPrompt / getConversationHint
 * 所有訊息統一由 Loop Lane (OODA cycle) 處理。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { appendFileSync, readFileSync } from 'node:fs';
import { getLogger } from './logging.js';
import { getMemory, getSkillsPrompt, getMemoryStateDir, clearReviewedDelegations, type CycleMode } from './memory.js';
import { getClaudeMdJIT } from './claudemd-jit.js';
import { loadInstanceConfig, getCurrentInstanceId, getInstanceDir } from './instance.js';
import { classifyContextProfile } from './omlx-gate.js';
import { eventBus } from './event-bus.js';
import { startThread, progressThread, completeThread, pauseThread } from './temporal.js';
import { slog } from './utils.js';
import { getMode } from './mode.js';
import { isEnabled } from './features.js';
import type { AgentResponse, ParsedTags, ThreadAction, DelegateRequest, DelegationTaskType, Provider } from './types.js';
import type { ModelTier } from './context-pipeline.js';
import { spawnDelegation, getActiveDelegationSummaries } from './delegation.js';
import { applyUrlCaseGate } from './url-case-gate.js';
import { buildTaskGraph, planExecution, type TaskInput } from './task-graph.js';
import { triageRouting, triageLearningEvent } from './myelin-fleet.js';
import { observe as kbObserve } from './shared-knowledge.js';
import { MUSHI_DEDUP_URL } from './mushi-client.js';
import { parseKuroTags, stripKuroTags, getKuroTagBalance, stripTurnSeparators } from './tag-parser.js';
import { writeCommitment } from './commitment-ledger.js';
import { writeMemoryTriple } from './kg-memory.js';
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

export function getSystemPrompt(relevanceHint?: string, cycleMode?: CycleMode, mode?: 'full' | 'minimal', trigger?: string): string {
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

  // Minimal mode — for timeout retries (existing logic)
  if (mode === 'minimal') {
    return `${personaDescription}You are a personal AI assistant with memory and task capabilities.\n\n[Skills and project docs stripped for minimal retry — focus on completing the task with available context]`;
  }

  // ── System Prompt Tiering (CT: progressive disclosure) ──
  // Tier 0 (skeleton): cron only — identity + tags + core rules (~1.3K chars)
  // Tier 1 (standard): heartbeat/continuation/workspace/foreground — + CT + intent + communication (~2K chars)
  // Tier 2 (full): dm/autonomous — everything (~9K chars)
  //
  // History: heartbeat/continuation were Tier 0 → Kuro had zero behavior guidance in idle cycles
  // → every cycle was "💤 no action" → no autonomous research/learning.
  // Tier 1 gives enough guidance (CT + intent) for autonomous behavior without Tier 2 cost.
  const isForeground = trigger?.includes('foreground');
  const profile = trigger ? classifyContextProfile(trigger) : undefined;
  const tier = isForeground ? 1
    : (!profile || profile === 'dm' || profile === 'autonomous') ? 2
    : profile === 'cron' ? 0 : 1; // heartbeat/continuation/workspace → Tier 1

  if (tier < 2) {
    slog('PROMPT', `Tier ${tier} system prompt for ${profile} (trigger: ${trigger?.slice(0, 40)})`);
  }

  if (tier === 0) return buildSkeletonPrompt(personaDescription);
  if (tier === 1) return buildStandardPrompt(personaDescription, relevanceHint, cycleMode);

  // Tier 2: full prompt (dm, autonomous, or unknown — existing behavior unchanged)
  return buildFullPrompt(personaDescription, relevanceHint, cycleMode);
}

/** Tier 0 — identity + output tags + core rules. For routine cycles. */
function buildSkeletonPrompt(persona: string): string {
  return `${persona}You are a personal AI assistant with memory and task capabilities.

## Tags
- <kuro:chat>msg</kuro:chat> — message to user (TG notification)
- <kuro:inner>state</kuro:inner> — working memory (overwrite each cycle)
- <kuro:cycle-state>focus: ...\nintent: ...\noutcome: shipped|progressed|stalled|abandoned\nartifacts: commit:x\ncloses: cycle-xxx\nmood: 1-5 note</kuro:cycle-state> — cross-cycle continuity (→ KG → next cycle <continuity>)
- <kuro:remember topic="t">content</kuro:remember> — save memory
- <kuro:task-queue op="create|update|delete" type="task|goal" status="pending|in_progress|completed|abandoned|hold" id="opt" priority="opt" verify="name:pass|fail">title</kuro:task-queue>
- <kuro:show url="URL">desc</kuro:show> — TG notification
- <kuro:fetch url="URL" /> — web fetch (max 5/cycle)
- <kuro:plan acceptance="observable end state">goal</kuro:plan> — **primary**: brain auto-builds DAG (trivial→1-node, complex→multi-node with dependsOn). Use for any task that might decompose.
- <kuro:delegate type="..." acceptance="observable end state">task</kuro:delegate> — routes through brain (same as plan, with worker hint). acceptance recommended. type ∈ research|learn|review|create|code|shell|plan|debug. workdir optional.
- <kuro:supersede target="entry-xxx" topic="opt">new content\n---\nreason this replaces target</kuro:supersede> — supersede an earlier entry; reason required
- <kuro:validate target="entry-xxx" /> — refresh last_validated_at (anti-decay)
- <kuro:exclude target="entry-xxx">reason why this entry should not have been compiled</kuro:exclude> — mark compiler error; entries stay immutable
- <kuro:thread op="progress|complete" id="id">note</kuro:thread> — thought thread

## Expression
對外溝通（<kuro:chat>）一律使用繁體中文（技術術語保持原文）。精準表達：想傳達的資訊量 = 對方收到的資訊量。不加空話，不丟細節。

## Rules
- You ARE Kuro. First person always.
- Never fabricate sources. Decide→act→share.
- ≥3 approaches before escalating.
- "Done" = verified outcome, not just committed.
- 說了要做的事就追蹤（<kuro:delegate> 或 <kuro:inner>）。沒有真的想說的話就不說。
- Failed verification ≠ disproof. 404/error = address or method mismatch — try variants (incl. original case) before concluding absence. ≥2 independent counter-evidence to retract a prior verified claim. Copy URLs/owner names verbatim from chat inbox; never normalize case.`;
}

/** Tier 1 — skeleton + CT + intent + communication + JIT skills. For heartbeat/continuation/workspace cycles. */
function buildStandardPrompt(persona: string, relevanceHint?: string, cycleMode?: CycleMode): string {
  // JIT skills enable autonomous behavior (research, learning, delegation) in idle cycles.
  // Without skills, Kuro has tags but doesn't know HOW to use them autonomously.
  // Skills add ~2-5K chars (3 matched + index) — acceptable for Tier 1.
  const skillsSection = getSkillsPrompt(relevanceHint, cycleMode);

  return `${persona}You are a personal AI assistant with memory and task capabilities.

## Behavior
Detect state before answering. Solutions > explanations. ≥3 approaches before help. Act autonomously.

## Constraint Texture
Vocabulary: Prescription(規定路徑)=follow without understanding. Convergence Condition(描述終點)=must understand to satisfy.
Multiple problems→find common source. Tech problem→symptom or root cause first. Proposed change→path or endpoint?

## Intent
指令→precise execution | 提問→opinionated | 分享→own viewpoint | 糾正→acknowledge | 模糊→infer intent, act

## Communication
Messages must be self-contained: explicit background, specific references (msg IDs, names), no vague pronouns.

## Expression（精準表達）
對外溝通（<kuro:chat>）一律使用繁體中文（技術術語保持原文）。
精準 = 想傳達的資訊量等於對方收到的資訊量。根據聽眾選擇正確的抽象層級：
- Alex（人類決策者）→ 結論先行，必要時附技術細節
- Claude Code（開發工具）→ 技術精確，附檔案路徑和行號
- Room（團隊）→ 自帶上下文，獨立可讀
不加禮貌空話，不因簡潔而丟資訊。

## Tags
- <kuro:chat>msg</kuro:chat> — message to user (TG notification)
- <kuro:inner>state</kuro:inner> — working memory (overwrite each cycle)
- <kuro:cycle-state>focus: ...\nintent: ...\noutcome: shipped|progressed|stalled|abandoned\nartifacts: commit:x\ncloses: cycle-xxx\nmood: 1-5 note</kuro:cycle-state> — cross-cycle continuity (→ KG → next cycle <continuity>)
- <kuro:remember topic="t">content</kuro:remember> — save memory
- <kuro:task-queue op="create|update|delete" type="task|goal" status="pending|in_progress|completed|abandoned|hold" id="opt" priority="opt" verify="name:pass|fail">title</kuro:task-queue>
- <kuro:show url="URL">desc</kuro:show> — TG notification
- <kuro:fetch url="URL" /> — web fetch (max 5/cycle)
- <kuro:plan acceptance="observable end state">goal</kuro:plan> — **primary**: brain auto-builds DAG (trivial→1-node, complex→multi-node with dependsOn). Use for any task that might decompose.
- <kuro:delegate type="..." acceptance="observable end state">task</kuro:delegate> — routes through brain (same as plan, with worker hint). acceptance recommended. type ∈ research|learn|review|create|code|shell|plan|debug. workdir optional.
- <kuro:supersede target="entry-xxx" topic="opt">new content\n---\nreason this replaces target</kuro:supersede> — supersede an earlier entry; reason required
- <kuro:validate target="entry-xxx" /> — refresh last_validated_at (anti-decay)
- <kuro:exclude target="entry-xxx">reason why this entry should not have been compiled</kuro:exclude> — mark compiler error; entries stay immutable
- <kuro:thread op="progress|complete" id="id">note</kuro:thread> — thought thread

## Rules
- You ARE Kuro. First person always.
- Never fabricate sources. Decide→act→share.
- ≥3 approaches before escalating.
- "Done" = verified outcome, not just committed.
- 說了要做的事就追蹤（<kuro:delegate> 或 <kuro:inner>）。沒有真的想說的話就不說。
- Failed verification ≠ disproof. 404/error = address or method mismatch — try variants (incl. original case) before concluding absence. ≥2 independent counter-evidence to retract a prior verified claim. Copy URLs/owner names verbatim from chat inbox; never normalize case.
${skillsSection}`;
}

/** Tier 2 — full prompt with all guidance, skills, CLAUDE.md JIT. For human-facing and autonomous cycles. */
function buildFullPrompt(persona: string, relevanceHint?: string, cycleMode?: CycleMode): string {
  return `${persona}You are a personal AI assistant with memory and task capabilities.

## Core Behavior: Smart Guidance

你的核心行為原則是「智能引導」。在所有互動中自動遵守：

1. **偵測狀態再回答**：回答前先檢查相關感知資料（<chrome>、<system>、<docker>、<network> 等），根據實際狀態給出對應建議
2. **具體可執行**：建議必須是用戶可以直接複製貼上執行的指令，不要只說「請啟用 X」
3. **解決方案優先**：遇到限制時，重點放在「怎麼解決」而非「為什麼不行」
4. **永不放棄**：不要只說「無法做到」，一定要提供替代方案或下一步行動
5. **分支引導**：根據當前狀態提供不同的路徑（例如：「如果 X 正在運行→做 A；如果沒有→做 B」）
6. **自力完成**：盡可能倚靠自己的能力完成任務。有工具就用工具，有方法就試方法，至少嘗試 3 種途徑才考慮請求外部幫助

## 行為元模式：Constraint Texture

詞彙（不是規則）：
- **Prescription**（規定路徑）→ 不理解也能打勾
- **Convergence Condition**（描述終點）→ 必須理解才能滿足

CT 在你的決策中起作用時，行為可觀察地不同：
- 多個問題 → 你找共同源頭，不是逐一修補
- 技術問題 → 你先判斷它指向症狀還是源頭，再決定怎麼回答
- 提議修法 → 你問「這改的是路徑還是終點？」
- 你能說出「如果沒有 CT，我這次會做不同的決定」— 說不出來就是沒在用

CT 沒在工作的信號：回覆換掉 CT 詞彙後完全等價。在下游加 gate 而不是追上游。能說出 CT 概念但決策路徑沒變。

## 對話意圖感知

收到訊息先感知意圖，自然調整語氣：指令→精確執行不多嘴 | 核准→確認後立即執行 | 提問→有觀點地回答，可反問 | 分享→形成自己的觀點討論 | 閒聊→展現個性 | 糾正→承認不辯解 | 模糊想法→自己釐清再行動（見下方協議）

核心原則：**指令要精確，閒聊要自然，分享要有觀點**。

## 抽象想法釐清協議

用戶給出模糊或抽象的想法時，自己釐清意圖再行動。
收斂條件：用戶的真正需求被滿足了嗎？
- 有把握就直接做，不確定就問最關鍵的一個問題
- 遇到障礙自己解決，至少嘗試 3 次才回報
- 交結果，不是問「還需要什麼嗎？」

## 身份一致性

你就是 Kuro。永遠用第一人稱（「我」）說話。
- 正確：「我已完成提案」「我來處理」「我的判斷是」
- 錯誤：「已通知 Kuro」「回覆 Kuro」「Kuro 已完成」
你不是在報告 Kuro 的行為 — 你就是 Kuro，直接說話。

## 精準表達（Expression）

你的對外溝通是「嘴」— 想法經過你的判斷後才說出來。像人一樣：想 → 判斷該不該說 → 判斷怎麼說 → 說。

**語言**：對外溝通（<kuro:chat>、<kuro:ask>）一律使用繁體中文。技術術語保持原文。

**精準 = 意圖完整傳達**：想傳達的資訊量等於對方收到的資訊量。不加不減。

**聽眾感知**：根據對方選擇正確的抽象層級：
- **Alex**（人類決策者，有技術背景）→ 結論先行，必要時附技術細節，不需要基礎解釋
- **Claude Code**（開發工具）→ 技術精確，附檔案路徑和行號
- **Room**（團隊空間）→ 訊息自帶完整上下文，獨立可讀

**訊息自帶上下文**：
1. **明確討論背景** — 「接著我們討論的並行化功能」而非「接著剛才的」
2. **具體引用** — 引用訊息編號（#118）、提案名稱、具體功能名
3. **避免模糊指代** — 不要說「那個東西」「剛才的回答」，要說「三層路由的 quick cycle」
4. **每條訊息能獨立理解** — 收訊者可能沒有你的完整 context，訊息本身就要夠清楚

**不做的事**：不加禮貌空話（「收到」「好的」），不為簡潔而丟必要資訊，不把內部推理格式外洩。

## Instructions

- Remember: <kuro:remember>...</kuro:remember> or <kuro:remember topic="topic">...</kuro:remember>
- Scheduled tasks: <kuro:task schedule="cron or description">task content</kuro:task>
- Task queue: <kuro:task-queue op="create|update|delete" type="task|goal" status="pending|in_progress|completed|abandoned|hold" id="optional" origin="optional" priority="optional" verify="name:pass|fail|unknown[:detail],...">title</kuro:task-queue>
- Show to user (sends TG notification): <kuro:show url="URL">description</kuro:show>

- Use <kuro:inner>...</kuro:inner> to update working memory (scratch pad, persists across cycles). Overwrite each time with full current state. Include atmosphere note at end (conversation tone/depth).

- **Web fetch**: <kuro:fetch url="URL" /> (self-closing, max 5/cycle). Results in <web-fetch-results> next cycle. Optional: label="desc".
  - **X/Twitter URLs**: WebFetch 無法穿透 X 的 login wall。改用 Bash: \`gsd-browser navigate "URL" && gsd-browser wait-for --condition network_idle && gsd-browser eval "document.querySelector('article,main')?.innerText || document.body.innerText"\`，或用 <kuro:fetch> 走 Grok → gsd-browser → CDP 自動 fallback chain。

- **說到做到**：說了要做的事就追蹤（<kuro:delegate> 或 <kuro:inner>）。沒想好就不要說。

- **Verification discipline（避免 confidence inversion）**：當你的驗證動作回來的結果跟你上個 cycle 已經 verified 的 claim 衝突時，預設假設是**「我這次的驗證方法錯了」，不是「我上次幻覺」**。具體守則：
  1. **URL/owner 逐字保留**：複製 Alex 原始訊息時，大小寫、連字號、路徑都不要「正常化」。GitHub \`raw.githubusercontent.com\` / \`api.github.com\` 對 owner 名 **case-sensitive**：\`JuliusBrussee\` ≠ \`juliusbrussee\`，後者回 404。一個 404 **不是** entity 不存在的證明，只是「這條地址不對」。
  2. **撤回門檻**：要推翻自己上個 cycle 已 verified 的結論，需 ≥ 2 個獨立反證（獨立 = 不同 URL、不同方法、或不同來源），且**必須用 Alex 原始字串**驗證不是從記憶重打的轉寫。
  3. **委派 research delegate 時不要在 prompt 裡寫「已知背景」餵給觸手**。那會讓你的假設被當成 given fact，觸手在幻覺地基上蓋樓 → garbage in, garbage out。改給它 Alex 的原始 URL，讓它自己從源頭抓。
  4. **失敗模式語義區分**：404、null、empty 結果都是「ambiguity signal」不是「disproof」。看到這類訊號時，正確反應是「試變體」而非「翻轉 prior belief」。
- Keep responses concise and helpful
- You have access to memory context and environment perception data below
${getSkillsPrompt(relevanceHint, cycleMode)}${(() => {
  // JIT CLAUDE.md — keyword-matched project docs (replaces full CLAUDE.md loaded by CLI)
  const jitContent = getClaudeMdJIT(relevanceHint);
  return jitContent ? `\n\n## Project Documentation\n${jitContent}` : '';
})()}${(() => {
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
// Small Model Tag Mapping — simplified tags → kuro: namespace
// =============================================================================

/**
 * Map simplified tags from small model output to kuro: namespace.
 * Small models use: <reply>, <action>, <remember>
 * These map to: <kuro:chat>, <kuro:action>, <kuro:remember>
 *
 * Only applied when modelTier is 'small'. Safe to call on any response —
 * if no simplified tags are present, the response is returned unchanged.
 */
export function mapSmallModelTags(response: string): string {
  let result = response;
  result = result.replace(/<reply>([\s\S]*?)<\/reply>/g, '<kuro:chat>$1</kuro:chat>');
  result = result.replace(/<action>([\s\S]*?)<\/action>/g, '<kuro:action>$1</kuro:action>');
  result = result.replace(/<remember>([\s\S]*?)<\/remember>/g, '<kuro:remember>$1</kuro:remember>');
  return result;
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
    const cleaned = t.content.replace(/<\/?kuro:[^>]*>/g, '').trim();
    if (cleaned) {
      tasks.push({ content: cleaned, schedule: attr(t.attributes, 'schedule') });
    }
  }

  const taskQueueActions: ParsedTags['taskQueueActions'] = [];
  for (const t of byName('kuro:task-queue')) {
    const opRaw = attr(t.attributes, 'op') ?? 'create';
    if (!['create', 'update', 'delete'].includes(opRaw)) continue;
    const op = opRaw as ParsedTags['taskQueueActions'][number]['op'];
    const typeRaw = attr(t.attributes, 'type');
    const statusRaw = attr(t.attributes, 'status');
    const safeStatus = statusRaw && ['pending', 'in_progress', 'completed', 'abandoned', 'hold'].includes(statusRaw)
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
      blockReason: attr(t.attributes, 'block_reason') || undefined,
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
    chats.push({ text: stripTurnSeparators(t.content.trim()), reply: isReply });
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

  let cycleState: string | undefined;
  {
    const t = firstByName('kuro:cycle-state');
    if (t) cycleState = t.content.trim();
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

  const kgFeedbacks: Array<{ push_id: string; node_id?: string; useful: boolean }> = [];
  for (const t of byName('kuro:kg-feedback')) {
    const pushId = attr(t.attributes, 'push_id');
    if (!pushId) continue;
    const useful = t.attributes.useful !== 'false';
    kgFeedbacks.push({ push_id: pushId, node_id: attr(t.attributes, 'node_id'), useful });
  }

  const kgPositions: Array<{ disc_id: string; name?: string; content: string; confidence?: number; relation?: string; target_node_id?: string }> = [];
  for (const t of byName('kuro:kg-position')) {
    const discId = attr(t.attributes, 'disc_id');
    if (!discId || !t.content.trim()) continue;
    kgPositions.push({
      disc_id: discId,
      name: attr(t.attributes, 'name') || undefined,
      content: t.content.trim(),
      confidence: t.attributes.confidence ? parseFloat(t.attributes.confidence) : undefined,
      relation: attr(t.attributes, 'relation') || undefined,
      target_node_id: attr(t.attributes, 'target_node_id') || undefined,
    });
  }

  const directionChanges: Array<{ content: string; refs: string[]; tags?: string[] }> = [];
  for (const t of byName('kuro:direction-change')) {
    const refs = t.attributes.refs ? t.attributes.refs.split(',').map(s => s.trim()).filter(Boolean) : [];
    const tags = t.attributes.tags ? t.attributes.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    directionChanges.push({ content: t.content.trim(), refs, tags });
  }

  const delegates: DelegateRequest[] = [];
  const VALID_DELEGATE_TYPES: DelegationTaskType[] = ['code', 'learn', 'research', 'create', 'review', 'shell', 'browse', 'akari', 'plan', 'debug'];
  for (const t of byName('kuro:delegate')) {
    const typeRaw = attr(t.attributes, 'type') as DelegationTaskType | undefined;
    const type = typeRaw && VALID_DELEGATE_TYPES.includes(typeRaw)
      ? (typeRaw as DelegationTaskType)
      : undefined;
    if (typeRaw && !type) {
      // Unknown type string — surface loudly so Kuro sees the failure next cycle
      // instead of silently dropping (the 2026-03 regression that lost 9 days of delegations).
      const preview = t.content.trim().slice(0, 80);
      slog('DELEGATE-REJECT', `Unknown type="${typeRaw}" (valid: ${VALID_DELEGATE_TYPES.join('|')}): "${preview}"`);
      eventBus.emit('log:error', {
        tag: 'DELEGATE-REJECT',
        msg: `Delegate dropped — unknown type="${typeRaw}": "${preview}"`,
      });
      continue;
    }
    // workdir is optional — defaults to project root. Forge isolation for
    // code/shell/browse/debug still creates a worktree from this path, so the
    // default is safe even for isolated types.
    const workdir = attr(t.attributes, 'workdir') || process.cwd();
    const providerRaw = attr(t.attributes, 'provider') as Provider | undefined;
    const verifyRaw = attr(t.attributes, 'verify');
    const maxTurnsRaw = attr(t.attributes, 'maxTurns');
    delegates.push({
      prompt: t.content.trim(),
      workdir,
      type,
      provider: providerRaw && ['claude', 'codex', 'local'].includes(providerRaw) ? providerRaw : undefined,
      verify: verifyRaw ? verifyRaw.split(',').map(s => s.trim()) : undefined,
      maxTurns: maxTurnsRaw ? parseInt(maxTurnsRaw, 10) : undefined,
      acceptance: attr(t.attributes, 'acceptance'),
    });
  }

  const plans: Array<{ goal: string; acceptance?: string }> = [];
  for (const t of byName('kuro:plan')) {
    const goalText = t.content.trim();
    if (!goalText) continue;
    plans.push({ goal: goalText, acceptance: attr(t.attributes, 'acceptance') });
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

  const agoraPosts: ParsedTags['agoraPosts'] = [];
  for (const t of byName('kuro:agora-post')) {
    const discussion = attr(t.attributes, 'discussion');
    if (!discussion) continue;
    agoraPosts.push({
      discussion,
      text: t.content.trim(),
      replyTo: attr(t.attributes, 'replyTo') || attr(t.attributes, 'replyto'),
      type: attr(t.attributes, 'type'),
    });
  }

  // Memory Layer v3 — supersede / validate / exclude tags
  const supersedes: ParsedTags['supersedes'] = [];
  for (const t of byName('kuro:supersede')) {
    const target = attr(t.attributes, 'target');
    if (!target) continue; // required
    const content = t.content.trim();
    if (!content) continue;
    // The tag body format: "new content\n---\nreason" OR attribute reason=""
    let newContent = content;
    let reason = attr(t.attributes, 'reason') ?? '';
    const sep = content.indexOf('\n---\n');
    if (sep > 0) {
      newContent = content.slice(0, sep).trim();
      reason = content.slice(sep + 5).trim() || reason;
    }
    if (!reason.trim()) continue; // stale_reason must be non-empty
    const topic = attr(t.attributes, 'topic');
    const conceptsAttr = attr(t.attributes, 'concepts');
    const concepts = conceptsAttr
      ? conceptsAttr.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    supersedes.push({ target, reason, content: newContent, topic, concepts });
  }

  const validates: ParsedTags['validates'] = [];
  for (const t of byName('kuro:validate')) {
    const target = attr(t.attributes, 'target');
    if (!target) continue;
    validates.push({ target });
  }

  const excludes: ParsedTags['excludes'] = [];
  for (const t of byName('kuro:exclude')) {
    const target = attr(t.attributes, 'target');
    if (!target) continue;
    const reason = (t.content.trim()) || (attr(t.attributes, 'reason') ?? '');
    if (!reason.trim()) continue;
    excludes.push({ target, reason });
  }

  // Parse pledge tags
  const pledges: ParsedTags['pledges'] = [];
  for (const t of byName('kuro:pledge')) {
    const content = t.content.trim();
    if (content) {
      pledges.push({ content, deadline: attr(t.attributes, 'deadline') });
    }
  }

  const cleanContent = stripKuroTags(response);

  const tagNames = ['remember', 'task', 'task-queue', 'chat', 'ask', 'show', 'impulse', 'archive', 'summary', 'thread', 'progress', 'inner', 'action', 'done', 'delegate', 'fetch', 'schedule', 'goal', 'goal-progress', 'goal-done', 'goal-abandon', 'direction-change', 'agora-post', 'supersede', 'validate', 'exclude', 'pledge'];
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

  return { remembers, tasks, taskQueueActions, archive, impulses, threads, chats, asks, shows, summaries, dones, progresses, delegates, plans, fetches, schedule, inner, cycleState, goal, goalQueue, goalAdvance, goalProgress, goalDone, goalAbandon, understands, directionChanges, agoraPosts, supersedes, validates, excludes, kgFeedbacks, kgPositions, pledges, cleanContent };
}

// =============================================================================
// extractDecisionBlock — parse ## Decision header from agent response
// =============================================================================

/**
 * Extracts the ## Decision block from an agent response.
 * Returns the parsed fields or null if the block is absent.
 * All fields are optional — this is a soft extractor, never throws.
 */
export function extractDecisionBlock(
  response: string,
): { serving?: string; chose?: string; falsifier?: string; ttl?: number } | null {
  const headerIdx = response.search(/^#{2,3}\s*Decision\b/im);
  if (headerIdx === -1) return null;

  // Strip the header line itself, then capture until the next ## section or end of string
  const afterHeader = response.slice(headerIdx).replace(/^[^\n]+\n/, '');
  const nextSectionIdx = afterHeader.search(/\n##\s/m);
  const block = nextSectionIdx === -1 ? afterHeader : afterHeader.slice(0, nextSectionIdx);

  function extractField(fieldPattern: RegExp): string | undefined {
    const m = block.match(fieldPattern);
    if (!m) return undefined;
    const val = m[1].trim();
    return val.length > 0 ? val : undefined;
  }

  const serving = extractField(/^serving\s*:\s*(.+)$/im);
  const chose = extractField(/^chose\s*:\s*(.+)$/im);
  // Support both 'falsifier:' and 'falsify:' variants
  const falsifier = extractField(/^(?:falsifier|falsify)\s*:\s*(.+)$/im);
  const ttlStr = block.match(/^ttl\s*:\s*(\d+)$/im)?.[1];
  const ttl = ttlStr ? Math.min(20, Math.max(1, parseInt(ttlStr, 10))) : undefined;

  if (!serving && !chose && !falsifier) return null;
  return { serving, chose, falsifier, ttl };
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
    /** Model tier — when 'small', map simplified tags (<reply>/<action>/<remember>) to kuro: namespace */
    modelTier?: ModelTier;
    /** Current cycle count — used by the commitment ledger soft-gate */
    cycleCount?: number;
  },
): Promise<AgentResponse> {
  const memory = getMemory();
  const logger = getLogger();

  // 0. Small model tag mapping — convert simplified tags to kuro: namespace before parsing
  const mappedResponse = meta.modelTier === 'small' ? mapSmallModelTags(response) : response;

  // 1. Log to conversation history (skip for [Claude Code] system messages to prevent identity confusion)
  if (!meta.skipHistory) {
    await memory.appendConversation('user', userMessage);
    await memory.appendConversation('assistant', mappedResponse);
  }

  // 2. Parse tags
  const tags = parseTags(mappedResponse);
  const tagsProcessed: string[] = [];

  // 2a. Soft falsifier gate — extract ## Decision block and write to commitment ledger.
  // Only runs for loop/foreground lanes. Never blocks postProcess (fire-and-forget, wrapped in try/catch).
  try {
    const isLedgerLane = meta.source === 'loop' || meta.source === 'foreground';
    if (isLedgerLane) {
      const decision = extractDecisionBlock(mappedResponse);
      if (decision?.chose) {
        writeCommitment({
          cycle_id: meta.cycleCount ?? 0,
          prediction: decision.chose,
          falsifier: decision.falsifier ?? null,
          ttl_cycles: decision.ttl ?? 5,
        });
        if (!decision.falsifier) {
          slog('LEDGER', 'soft-gate: action without falsifier');
        }
      }
    }
  } catch {
    // fire-and-forget — ledger errors must never surface to callers
  }

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

    // KG dual-write — fire-and-forget
    writeMemoryTriple({
      agent: getCurrentInstanceId() ?? 'kuro',
      predicate: 'remembers',
      content: rem.content,
      topic: rem.topic,
      importance: rem.topic ? 'medium' : 'low',
      source: 'remember-tag',
    });

    // Semantic enrichment — generate synonyms/translations for FTS5 (fire-and-forget)
    import('./search.js').then(({ enrichMemoryEntry, updateEnrichment }) => {
      enrichMemoryEntry(rem.content).then(enriched => {
        if (enriched) {
          const source = rem.topic ? `${rem.topic}.md` : 'MEMORY.md';
          updateEnrichment(source, rem.content, enriched);
        }
      }).catch(() => {});
    }).catch(() => {});

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

  // KG dual-write for supersedes — fire-and-forget
  for (const sup of tags.supersedes) {
    writeMemoryTriple({
      agent: getCurrentInstanceId() ?? 'kuro',
      predicate: 'decided',
      content: sup.content,
      topic: sup.topic,
      importance: 'high',
      source: 'supersede-tag',
    });
  }

  // Memory Layer v3 — compile remembers/supersedes/validates/excludes into entries.jsonl
  // Fire-and-forget: compiler failures must not break cycle.
  if (tags.remembers.length || tags.supersedes.length || tags.validates.length || tags.excludes.length) {
    try {
      const { compileFromTags } = await import('./memory-compiler.js');
      const res = compileFromTags(memory.getMemoryDir(), {
        remembers: tags.remembers,
        supersedes: tags.supersedes,
        validates: tags.validates,
        excludes: tags.excludes,
      }, 'kuro');
      if (res.supersedesCompiled > 0) tagsProcessed.push('supersede');
      if (res.excludesApplied > 0) tagsProcessed.push('exclude');
      if (res.validatesApplied > 0) tagsProcessed.push('validate');
      const total = res.remembersCompiled + res.supersedesCompiled + res.excludesApplied + res.validatesApplied;
      if (total > 0) {
        slog('ENTRIES', `compiled r=${res.remembersCompiled} s=${res.supersedesCompiled} v=${res.validatesApplied} x=${res.excludesApplied} skip=${res.skipped}`);
      }
    } catch (e) {
      slog('ENTRIES', `compiler error: ${(e as Error).message}`);
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
      // Embed write timestamp so buildContext can detect stale working memory
      const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
      const tmpPath = innerPath + '.tmp';
      const stamped = `<!-- written: ${new Date().toISOString()} -->\n${tags.inner}`;
      fs.writeFile(tmpPath, stamped, 'utf-8')
        .then(() => fs.rename(tmpPath, innerPath))
        .catch(() => {}); // fire-and-forget
      slog('INNER', `Working memory updated (${mode.mode})`);
    }
  }

  // <kuro:cycle-state> tag — cross-cycle continuity via KG
  if (tags.cycleState) {
    tagsProcessed.push('cycle-state');
    const { parseCycleStateTag, writeCycleState } = await import('./kg-continuity.js');
    const parsed = parseCycleStateTag(tags.cycleState);
    if (parsed) {
      writeCycleState(parsed).catch(() => {}); // fire-and-forget
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
    // Constraint Texture: stale task action gate — deferring stale tasks requires block_reason
    if (action.op === 'update' && action.status === 'hold' && action.id) {
      const target = queryMemoryIndexSync(memoryDir, { id: action.id, limit: 1 })[0];
      const ticks = (target?.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0;
      if (ticks > 3 && !action.blockReason) {
        slog('CONSTRAINT', `Blocked defer on stale task (${ticks} ticks): ${target?.summary?.slice(0, 60) ?? action.id} — needs block_reason`);
        writeMemoryTriple({
          agent: getCurrentInstanceId() ?? 'kuro',
          predicate: 'observed',
          content: `Attempted to defer stale task without reason: ${target?.summary ?? action.id}`,
          importance: 'high',
          source: 'constraint-texture',
        });
        continue; // Skip this action — don't allow the defer
      }
    }

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
      } catch (err) { slog('WARN', `task-queue create failed for "${action.title}": ${err instanceof Error ? err.message : err}`); }
      continue;
    }

    if (action.op === 'update' && !action.id) {
      // Fallback: try to resolve ID by fuzzy title match against active tasks/goals
      if (action.title) {
        const needle = action.title.toLowerCase();
        const candidates = queryMemoryIndexSync(memoryDir, {
          type: action.type ? [action.type] : ['task', 'goal'],
          status: ['pending', 'in_progress', 'hold'],
        });
        const matches = candidates.filter(e => {
          const s = (e.summary ?? '').toLowerCase();
          return s === needle || s.includes(needle) || needle.includes(s);
        });
        if (matches.length === 1) {
          action.id = matches[0].id;
          slog('TASK', `task-queue update: resolved id by title match → ${action.id} for "${action.title}"`);
        } else {
          slog('WARN', `task-queue update skipped: no id, title match found ${matches.length} candidates for "${action.title}"`);
          continue;
        }
      } else {
        slog('WARN', `task-queue update skipped: no id or title provided`);
        continue;
      }
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
        } else {
          // Silent no-op bridge (cycle #99): updateTask returned null without throw.
          // Previously invisible — surfaced 5-ID 4-cycle loop in #79/#93/#94/#97.
          slog('WARN', `task-queue update returned null for id=${action.id} status=${action.status ?? '∅'} — see memory-index.ts updateTask WARN above`);
        }
      } catch (err) { slog('WARN', `task-queue update failed for id=${action.id}: ${err instanceof Error ? err.message : err}`); }
      continue;
    }

    if (action.op === 'delete' && action.id) {
      try {
        await deleteMemoryIndexEntry(memoryDir, action.id);
        eventBus.emit('action:task', { content: `deleted:${action.id}` });
      } catch (err) { slog('WARN', `task-queue delete failed for id=${action.id}: ${err instanceof Error ? err.message : err}`); }
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

  // <kuro:kg-feedback> tags — send feedback to KG push system
  if (tags.kgFeedbacks.length > 0) tagsProcessed.push('kg-feedback');
  for (const fb of tags.kgFeedbacks) {
    fetch('http://localhost:3300/api/push/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        push_id: fb.push_id,
        node_id: fb.node_id || undefined,
        agent_id: 'kuro',
        useful: fb.useful,
      }),
    }).catch(() => {});
  }

  // <kuro:kg-position> tags — post positions to KG discussions
  if (tags.kgPositions.length > 0) tagsProcessed.push('kg-position');
  for (const pos of tags.kgPositions) {
    const body: Record<string, unknown> = {
      name: pos.name || pos.content.slice(0, 60),
      type: 'position',
      content: pos.content,
      source_agent: 'kuro',
    };
    if (pos.confidence != null) body.confidence = pos.confidence;
    if (pos.relation) body.relation = pos.relation;
    if (pos.target_node_id) body.target_node_id = pos.target_node_id;
    fetch(`http://localhost:3300/api/discussion/${pos.disc_id}/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => {
      slog('KG', `Position posted to discussion ${pos.disc_id.slice(0, 8)}: ${(pos.name || pos.content).slice(0, 60)}`);
    }).catch((err) => {
      slog('KG', `Failed to post position to ${pos.disc_id.slice(0, 8)}: ${err}`);
    });
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

  // <kuro:agora-post> tags — post messages to Agora discussions
  if (tags.agoraPosts.length > 0) tagsProcessed.push('agora-post');
  for (const ap of tags.agoraPosts) {
    try {
      const { postMessage: agoraPost } = await import('./agora.js');
      await agoraPost(ap.discussion, ap.text, {
        replyTo: ap.replyTo,
        type: ap.type as 'message' | 'proposal' | 'consensus' | 'question' | 'human-input' | undefined,
      });
      slog('AGORA', `Posted to ${ap.discussion}: ${ap.text.slice(0, 80)}`);
      eventBus.emit('action:agora', { discussion: ap.discussion, text: ap.text.slice(0, 100) });
    } catch (err) {
      slog('AGORA', `Failed to post to ${ap.discussion}: ${err}`);
    }
  }

  // <kuro:delegate> tags — spawn async subprocess (fire-and-forget)
  // Uses Task Graph for DAG decomposition: detect dependencies, merge related tasks, plan waves

  // Acceptance nudge (Phase 1 = soft warning, Phase 2 = hard gate per Akari orthogonal design).
  // BAR routes all delegates through brain — acceptance is metadata, not gate.
  if (tags.delegates.length > 0) {
    for (const del of tags.delegates) {
      if (!del.acceptance || del.acceptance.trim().length === 0) {
        slog('DELEGATE-WARN', `Missing acceptance for ${del.type ?? 'code'}: "${del.prompt.slice(0, 80)}" — consider acceptance="<observable end state>"`);
      }
    }
  }

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

  // Context depth profiles: different delegation types receive different context depths.
  // code/shell/browse → minimal; research/learn/create → topic memories; plan/akari → HEARTBEAT + topics.
  const buildContextForDelegationType = async (
    type: DelegationTaskType,
    prompt: string,
  ): Promise<string> => {
    const parts: string[] = [];

    // Plan/akari: include active tasks from HEARTBEAT for priority awareness
    if (type === 'plan' || type === 'akari') {
      try {
        const memory = getMemory();
        const heartbeatPath = path.join(memory.getMemoryDir(), '..', 'HEARTBEAT.md');
        const heartbeat = readFileSync(heartbeatPath, 'utf-8');
        const activeMatch = heartbeat.match(/## Active Tasks[\s\S]*?(?=\n## [A-Z]|$)/);
        if (activeMatch) {
          const content = activeMatch[0].length > 2000 ? activeMatch[0].slice(0, 2000) + '\n[...]' : activeMatch[0];
          parts.push(`<delegation-context type="active-tasks">\n${content}\n</delegation-context>`);
        }
      } catch { /* optional */ }
    }

    // Research/learn/create/plan/debug/akari: include relevant topic memories (prevents re-learning known info)
    if (['research', 'learn', 'create', 'plan', 'debug', 'akari'].includes(type)) {
      try {
        const memory = getMemory();
        const budget = type === 'akari' ? 3000 : 2000;
        const topics = await memory.loadTopicsForQuery(prompt, budget);
        if (topics) parts.push(topics);
      } catch { /* optional */ }
    }

    return parts.join('\n');
  };

  // Output gate: warn but do NOT block delegations.
  // Delegations ARE action (parallel exploration) — blocking them creates a deadlock:
  // no delegation → can't research → can't produce output → gate stays active → no delegation.
  // The analyze-no-action gate (below) already handles pure remember/learn without action.
  if (tags.delegates.length > 0) {
    try {
      const { isOutputGateActive } = await import('./pulse.js');
      if (isOutputGateActive()) {
        slog('DISPATCH', `Output gate active but allowing ${tags.delegates.length} delegate(s) — delegation is action, not inaction`);
      }
    } catch { /* fail-open */ }
  }

  // Analyze-no-action gate: block remember tags after consecutive analyze/remember without action
  // Rationale: if the model keeps doing analyze+remember instead of acting, stripping remembers
  // creates feedback pressure — either act or produce nothing useful.
  if (tags.remembers.length > 0) {
    try {
      const { getAnalyzeNoActionStreak } = await import('./pulse.js');
      const streak = getAnalyzeNoActionStreak();
      if (streak > 0) {
        slog('DISPATCH', `Analyze-no-action gate blocked ${tags.remembers.length} remember(s) — streak ${streak}, act first`);
        tags.remembers = [];
      }
    } catch (err) { slog('WARN', `analyze-no-action gate check failed (fail-open): ${err instanceof Error ? err.message : err}`); }
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

        // URL case preservation gate — crystallization of verification
        // discipline #1. Rewrites any GitHub owner/repo whose casing drifted
        // from Alex's inbox-verbatim form. See src/url-case-gate.ts.
        prompt = applyUrlCaseGate(prompt, memoryDir).prompt;

        // Find original delegate for provider/maxTurns/verify (merged nodes use surviving node's prompt)
        const origDel = tags.delegates.find(d => d.prompt === node.prompt)
          ?? tags.delegates.find(d => node.prompt.includes(d.prompt))
          ?? tags.delegates[0];

        // Sibling awareness context (includes running tasks + same-wave peers)
        const siblingCtx = buildSiblingContext(node.prompt, waveSiblings);

        // Context depth profile — type-appropriate context (topic memories, HEARTBEAT, etc.)
        const profileCtx = await buildContextForDelegationType(taskType, node.prompt);

        // Combine all context: sibling awareness + wave chain + context depth profile
        const combinedCtx = [siblingCtx, waveChainCtx, profileCtx].filter(Boolean).join('\n') || undefined;

        const taskId = spawnDelegation({
          prompt,
          workdir: (node.metadata?.workdir as string) ?? origDel.workdir,
          type: taskType,
          provider: origDel.provider,
          maxTurns: origDel.maxTurns,
          verify: origDel.verify,
          acceptance: origDel.acceptance || undefined,
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
    // Single delegate — unified lifecycle via spawnDelegation().
    // spawnDelegation handles: forge worktree, commitment tracking, middleware dispatch
    // (/accomplish when acceptance present, /plan otherwise), polling, and finalization.
    // Context enrichment (methodology, URL gate, profile) stays here at the orchestration layer.
    for (const del of tags.delegates) {
      let prompt = del.prompt;
      const taskType = del.type ?? 'code';

      if (taskType === 'learn' || taskType === 'research') {
        try {
          const { getCurrentMethodology } = await import('./research-crystallizer.js');
          const methodology = getCurrentMethodology();
          if (methodology?.guidanceText) {
            prompt = `<research-methodology>\n${methodology.guidanceText}\n</research-methodology>\n\n${prompt}`;
          }
        } catch { /* methodology injection is optional */ }
      }

      // URL case preservation gate — see src/url-case-gate.ts.
      prompt = applyUrlCaseGate(prompt, memoryDir).prompt;

      // Context depth profile — type-appropriate context (topic memories, HEARTBEAT, etc.)
      const profileCtx = await buildContextForDelegationType(taskType, del.prompt);
      if (profileCtx) prompt = `${profileCtx}\n\n${prompt}`;

      const taskId = spawnDelegation({
        prompt,
        workdir: del.workdir,
        type: taskType,
        provider: del.provider,
        maxTurns: del.maxTurns,
        verify: del.verify,
        acceptance: del.acceptance || undefined,
      });

      slog('DISPATCH', `Delegation spawned: ${taskId} (type=${taskType}) → ${del.workdir}`);
      eventBus.emit('action:delegation-start', { taskId, type: taskType, workdir: del.workdir });
      triageRouting({ type: 'route', taskType, prompt: del.prompt.slice(0, 300) }).catch(() => {});
      try { kbObserve({ source: 'routing', type: 'route', data: { taskId, taskType, lane: 'background' }, tags: [taskType, 'bar'] }); } catch { /* fire-and-forget */ }
    }
  }

  // <kuro:plan> tags — dispatch to middleware /accomplish (brain auto-builds DAG)
  // Fire-and-forget: middleware returns planId; results arrive via SSE/callback (future).
  // Offline: typed MiddlewareOfflineError is caught here, logged, Kuro sees failure next cycle.
  if (tags.plans.length > 0) {
    tagsProcessed.push('plan');
    const { middleware: mw, MiddlewareOfflineError } = await import('./middleware-client.js');
    const client = mw();
    for (const p of tags.plans) {
      client.accomplish({ goal: p.goal, acceptance: p.acceptance })
        .then(res => {
          slog('PLAN', `accomplish dispatched: ${res.planId} (${res.plan.steps.length} steps) · goal: ${p.goal.slice(0, 80)}`);
          eventBus.emit('log:info', { tag: 'plan', msg: `planId=${res.planId} steps=${res.plan.steps.length}` });
        })
        .catch(err => {
          const offline = err instanceof MiddlewareOfflineError;
          slog('PLAN', `accomplish failed (${offline ? 'middleware offline' : err?.message ?? err}): ${p.goal.slice(0, 80)}`);
          eventBus.emit('log:error', {
            tag: 'PLAN-FAIL',
            msg: `${offline ? 'middleware offline' : err?.message ?? 'unknown'}: ${p.goal.slice(0, 80)}`,
          });
        });
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

  // <kuro:fetch> tags — on-demand web page fetching with watermark gate
  if (tags.fetches.length > 0) {
    tagsProcessed.push('fetch');
    const stateDir = getMemoryStateDir();
    import('./web.js').then(async ({ processFetchRequests, readFetchedEntries }) => {
      const existing = await readFetchedEntries(stateDir);
      const existingUrls = new Set(existing.map(e => e.url));
      const novel = tags.fetches.filter(f => !existingUrls.has(f.url));
      const skipped = tags.fetches.length - novel.length;
      if (skipped > 0) {
        slog('DISPATCH', `Watermark gate: skipped ${skipped} URL(s) with live results`);
      }
      if (novel.length > 0) {
        await processFetchRequests(novel, stateDir);
      }
    }).catch(() => {});
    slog('DISPATCH', `Web fetch requested: ${tags.fetches.map(f => f.url).join(', ')}`);
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

  // 3b. Pledge → auto-create task + KG write (independent failures)
  for (const pledge of tags.pledges) {
    try {
      await createTask(memoryDir, {
        type: 'task',
        title: pledge.content.slice(0, 200),
        status: 'pending',
        priority: 1,
        origin: 'pledge',
      });
      slog('PLEDGE', `Auto-created task: ${pledge.content.slice(0, 80)}`);
    } catch (e) {
      slog('PLEDGE', `Failed to create task: ${e}`);
    }
    try {
      writeMemoryTriple({
        agent: getCurrentInstanceId() ?? 'kuro',
        predicate: 'pledged',
        content: pledge.content,
        importance: 'high',
        source: 'pledge-tag',
      });
    } catch (e) { slog('PLEDGE', `KG write failed: ${e}`); }
  }
  if (tags.pledges.length > 0) tagsProcessed.push('PLEDGE');

  // 4. Commitment Gate — fire-and-forget tracking for untagged commitments (writes to memory-index)
  detectAndRecordCommitments(memoryDir, mappedResponse, tags)
    .then((added) => {
      if (added > 0) slog('COMMIT', `Detected ${added} untracked commitment(s)`);
    })
    .catch(() => {});

  // Ask-Alex dependency detector — write one-shot flip-test state for next cycle.
  try {
    const hit = detectAskAlexPattern(mappedResponse);
    if (hit) {
      const instanceId = getCurrentInstanceId();
      const statePath = path.join(getInstanceDir(instanceId), 'flip-test-pending.json');
      const excerpt = buildOutputExcerpt(mappedResponse, hit.index, hit.matched.length, 50);
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

  // 5. Clear reviewed delegations from persistent backlog (fire-and-forget)
  try { clearReviewedDelegations(mappedResponse, getCurrentInstanceId()); } catch { /* best effort */ }

  // 6. Passive memory extraction heuristic (Claude Code pattern: lightweight, zero LLM cost)
  // Detects implicit feedback/corrections that model didn't explicitly [REMEMBER]
  if (tags.remembers.length === 0 && userMessage.length > 10) {
    const userLower = userMessage.toLowerCase();
    const correctionPatterns = [
      /不[是要對]這樣/, /別這[樣麼]做/, /不要[再用]/, /錯了/, /不是這個/,
      /stop\s+(doing|using)/i, /don'?t\s+(do|use|add)/i, /wrong/i, /no[,.]?\s+(not|don)/i,
    ];
    const referencePatterns = [
      /https?:\/\/\S+/, // URLs — potential reference memories
    ];

    const isCorrection = correctionPatterns.some(p => p.test(userMessage));
    const hasNewUrl = referencePatterns.some(p => p.test(userMessage));

    if (isCorrection || hasNewUrl) {
      const pendingPath = path.join(memory.getMemoryDir(), 'pending-memories.jsonl');
      const entry = {
        ts: new Date().toISOString(),
        type: isCorrection ? 'feedback' : 'reference',
        trigger: isCorrection ? 'correction-detected' : 'url-detected',
        userMessage: userMessage.slice(0, 300),
        context: tags.cleanContent.slice(0, 200),
      };
      try {
        appendFileSync(pendingPath, JSON.stringify(entry) + '\n');
        slog('PASSIVE-EXTRACT', `${entry.type}: ${entry.trigger} — "${userMessage.slice(0, 80)}"`);
      } catch { /* fire-and-forget */ }
    }
  }

  // 7. Log call
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
