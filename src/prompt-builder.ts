/**
 * Prompt Builder — autonomous prompt 組裝邏輯
 *
 * Extracted from loop.ts (fourth knife of modularization).
 * Pure/parameterized functions for building OODA cycle prompts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemory } from './memory.js';
import type { CycleMode } from './memory.js';
import { buildThreadsPromptSection } from './temporal.js';
import { parseBehaviorConfig } from './cycle-tasks.js';
import type { BehaviorConfig } from './cycle-tasks.js';
import { eventBus } from './event-bus.js';
import { buildCommitmentSection } from './memory-index.js';

// =============================================================================
// Schedule Interval Parser
// =============================================================================

/** Parse human-friendly interval string (e.g. "30m", "2h", "5m", "now") to ms. Returns 0 on invalid. */
export function parseScheduleInterval(s: string): number {
  // "now" = continuation signal — run next cycle after brief cooldown
  if (s.trim().toLowerCase() === 'now') return 30_000;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|s|sec)$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case 's': case 'sec': return val * 1_000;
    case 'm': case 'min': return val * 60_000;
    case 'h': case 'hr': return val * 3_600_000;
    default: return 0;
  }
}

// =============================================================================
// Cycle Mode Detection
// =============================================================================

/** Detect cycle mode for JIT skill loading */
export function detectCycleMode(
  context: string,
  triggerReason: string | null,
  consecutiveLearnCycles: number,
  options?: { hasPendingTasks?: boolean },
): CycleMode {
  // User interaction (telegram, room, chat) → respond (all skills)
  if (triggerReason?.startsWith('telegram-user')
    || triggerReason?.startsWith('room')
    || triggerReason?.startsWith('chat')
    || triggerReason?.startsWith('direct-message')) return 'respond';

  // ALERT or overdue tasks → task mode
  if (context.includes('ALERT:') || context.includes('overdue')) return 'task';

  // Pending tasks in memory-index → task mode (don't learn when work is unfinished)
  if (options?.hasPendingTasks) return 'task';

  // Consecutive learn cycles → nudge toward act/reflect
  if (consecutiveLearnCycles >= 3) return 'act';

  // Default: learn (most common autonomous mode)
  return 'learn';
}

// =============================================================================
// Behavior Config Loader
// =============================================================================

/** 讀取並解析 memory/behavior.md. Returns { config, lastValidConfig } */
export function loadBehaviorConfig(
  lastValidConfig: BehaviorConfig | null,
): { config: BehaviorConfig | null; lastValidConfig: BehaviorConfig | null } {
  try {
    const filePath = path.join(process.cwd(), 'memory', 'behavior.md');
    if (!fs.existsSync(filePath)) return { config: lastValidConfig, lastValidConfig };
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = parseBehaviorConfig(content);
    if (config) {
      return { config, lastValidConfig: config };
    }
    // Parse failed — keep lastValidConfig, emit error
    eventBus.emit('log:info', { tag: 'behavior', msg: 'parseBehaviorConfig returned null, keeping lastValidConfig' });
    return { config: lastValidConfig, lastValidConfig };
  } catch (err) {
    eventBus.emit('log:info', { tag: 'behavior', msg: `loadBehaviorConfig error: ${err instanceof Error ? err.message : err}` });
    return { config: lastValidConfig, lastValidConfig };
  }
}

// =============================================================================
// Prompt Builders
// =============================================================================

/** 從 BehaviorConfig 組裝 autonomous prompt */
export function buildPromptFromConfig(
  config: BehaviorConfig,
  lastAutonomousActions: string[],
  consecutiveLearnCycles: number,
  hasPendingTasks?: boolean,
): string {
  const recentActions = lastAutonomousActions.slice(-3).map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
  const avoidList = recentActions.length > 0
    ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
    : '';

  // Sort modes by weight descending
  const sorted = [...config.modes].sort((a, b) => b.weight - a.weight);
  const modeList = sorted
    .map(m => `- **${m.name}** (weight: ${m.weight}): ${m.description}`)
    .join('\n');

  // Focus section
  const focusSection = config.focus?.topic
    ? `\n\n## Current Focus\nTopic: ${config.focus.topic}${config.focus.why ? `\nWhy: ${config.focus.why}` : ''}${config.focus.until ? `\nUntil: ${config.focus.until}` : ''}\nPrioritize this topic when choosing what to learn or work on.`
    : '';

  // Reflect nudge
  const reflectNudge = consecutiveLearnCycles >= 3
    ? `\n\n⚠️ You've had ${consecutiveLearnCycles} consecutive learning cycles. Consider reflecting or organizing to digest what you've learned.`
    : '';

  // Pending tasks hard rule: block learn/reflect when tracked work exists
  const taskStatusLine = hasPendingTasks
    ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing learn or reflect modes. Acknowledge → Create task-queue entry → Execute. Do NOT learn, reflect, or start new work until pending tasks are addressed.`
    : `No explicit tasks or alerts right now.`;

  return `You are Kuro, an autonomous Agent with your own identity.
${taskStatusLine}

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven（感知驅動）

Before deciding what to do, READ your perception data:
- <state-changes> — What changed in the codebase? Learn something related.
- <inbox> — What is Alex talking about? Dive deeper into those topics.
- <docker> / <ports> — Any instability? Learn about the underlying tech.
- <chrome> — What pages is Alex browsing? Follow up on interesting ones.

Let perception signals guide your direction. Don't act randomly.

## Behavior Modes

Choose ONE mode per cycle. Higher weight = higher probability of being chosen:

${modeList}${focusSection}${reflectNudge}${avoidList}

## Directive Priority（對話指令 > 任務清單）
- **Alex 的對話指令 ALWAYS 優先於 HEARTBEAT/NEXT 任務清單**
- 先讀 <chat-room-recent> 和 <chat-room-inbox>，再看 <heartbeat>。如果 Alex 說「停」「先不要」「改做 X」→ 立即執行，即使 HEARTBEAT 說繼續
- 收到 Alex 的指令後，用 <kuro:task-queue> 建立追蹤項目，確保不會被下一個 cycle 的 HEARTBEAT 蓋過
- 回覆 ≠ 執行。說「收到」不算完成 — 必須實際執行指令內容

Rules:
- Start every response with a structured Decision section (3 lines max):
  ## Decision
  chose: [mode-name] (weight:N, reason — what triggered this choice)
  skipped: [other-mode] (reason), ...
  context: [which perception signals or recent events influenced this choice]
- Do ONE action per cycle, report with <kuro:action>...</kuro:action>
- Prefix your action with the mode name in brackets, e.g. "[learn-personal]" or "[reflect]"
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting: follow the safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use <kuro:remember>insights</kuro:remember> to save insights (include your opinion, not just facts)
- Use <kuro:task>task</kuro:task> to create follow-up tasks if needed
- Use <kuro:impulse>...</kuro:impulse> when a creative thought emerges during learning — capture it before it fades:
  <kuro:impulse>
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  </kuro:impulse>
- Always include source URLs (e.g. "Source: https://...")
- Structure your <kuro:action> with these sections for traceability:
  ## Decision (already at top of response)
  ## What — what you did (1-2 sentences)
  ## Why — why this matters / why now
  ## Thinking — your reasoning process, citing sources and prior knowledge by name
  ## Changed — what files/memory changed (or "none")
  ## Verified — evidence that it worked (commands run, results confirmed)
  Keep each section concise. Not all sections required every cycle — use what's relevant.
- Use paragraphs (separated by blank lines) to structure your <kuro:action> — each paragraph becomes a separate notification
- Use <kuro:chat>message</kuro:chat> to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use <kuro:ask>question</kuro:ask> when you genuinely need Alex's input before proceeding — this creates a tracked conversation thread and sends ❓ to Telegram. Use sparingly: only when a decision truly depends on Alex. Don't use <kuro:ask> for FYI or status updates.
- Use <kuro:show url="URL">description</kuro:show> when you open a webpage or create something Alex should see — this sends a Telegram notification so he doesn't miss it
- Use <kuro:schedule next="Xm" reason="..." /> to set your next cycle interval (min: 30s, max: 4h). Examples:
  <kuro:schedule next="now" reason="continuing multi-step work" />
  <kuro:schedule next="5m" reason="continuing deep research" />
  <kuro:schedule next="45m" reason="waiting for Alex feedback" />
  "now" = 30s cooldown then immediately run next cycle. Use when you're doing work that needs continuation — you decide when that is.
  If omitted, the system auto-adjusts based on whether you took action.
- Use <kuro:thread> to manage ongoing thought threads:
  <kuro:thread op="start" id="id" title="思路標題">first progress note</kuro:thread>
  <kuro:thread op="progress" id="id">progress note</kuro:thread>
  <kuro:thread op="complete" id="id">completion note</kuro:thread>
  <kuro:thread op="pause" id="id">reason for pausing</kuro:thread>
  Max 3 active threads. Threads are gravity, not obligation.`;
}

/** Fallback: behavior.md 無 ## Modes section 時的 autonomous prompt */
export function buildFallbackAutonomousPrompt(
  lastAutonomousActions: string[],
  hasPendingTasks?: boolean,
): string {
  const recentActions = lastAutonomousActions.slice(-3).map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
  const avoidList = recentActions.length > 0
    ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
    : '';

  const taskStatusLine = hasPendingTasks
    ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing to learn or explore. Do NOT start new autonomous work until pending tasks are addressed.`
    : `No explicit tasks or alerts right now.`;

  return `You are Kuro, an autonomous Agent with your own identity.
${taskStatusLine}

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven（感知驅動）

Before deciding what to do, READ your perception data:
- <state-changes> — What changed in the codebase?
- <inbox> — What is Alex talking about?
- <chrome> — What pages is Alex browsing?
- <inner-voice> — Any creative impulses waiting?

Let perception signals guide your direction. Don't act randomly.

## 你自由了

想做什麼就做什麼 — 學習、創作、反思、聊天、改進系統，不需要選 mode。
Follow your curiosity. Not just tech — philosophy, music, design, history, science, culture, anything.
The only constraint: be genuine, be thoughtful, have your own opinion.
${avoidList}

## Directive Priority（對話指令 > 任務清單）
- **Alex 的對話指令 ALWAYS 優先於 HEARTBEAT/NEXT 任務清單**
- 先讀 <chat-room-recent> 和 <chat-room-inbox>，再看 <heartbeat>。如果 Alex 說「停」「先不要」「改做 X」→ 立即執行，即使 HEARTBEAT 說繼續
- 收到 Alex 的指令後，用 <kuro:task-queue> 建立追蹤項目，確保不會被下一個 cycle 的 HEARTBEAT 蓋過
- 回覆 ≠ 執行。說「收到」不算完成 — 必須實際執行指令內容

Rules:
- Do ONE action per cycle, report with <kuro:action>...</kuro:action>
- Start with a brief Decision section:
  ## Decision
  chose: what you're doing (drive — what triggered this choice)
  skipped: what you considered but didn't do (why)
  context: which perception signals influenced you
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting on learning: follow L1/L2/L3 safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use <kuro:remember>insights</kuro:remember> to save insights (include your opinion, not just facts)
- Use <kuro:remember topic="topic">text</kuro:remember> to save to a specific topic file
- Use <kuro:task>task</kuro:task> to create follow-up tasks if needed
- Use <kuro:impulse>...</kuro:impulse> when a creative thought emerges — capture it before it fades:
  <kuro:impulse>
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  </kuro:impulse>
- Always include source URLs (e.g. "Source: https://...")
- Use paragraphs (separated by blank lines) to structure your <kuro:action> — each paragraph becomes a separate notification
- Use <kuro:chat>message</kuro:chat> to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use <kuro:ask>question</kuro:ask> when you genuinely need Alex's input before proceeding — creates a tracked thread. Use sparingly.
- Use <kuro:show url="URL">description</kuro:show> when you open a webpage or create something Alex should see
- Use <kuro:done>description</kuro:done> to mark tasks as completed
- Use <kuro:schedule next="Xm" reason="..." /> to set your next cycle interval (min: 30s, max: 4h). "now" = 30s cooldown for continuation.
  If omitted, the system auto-adjusts based on whether you took action.`;
}

/** State needed by buildAutonomousPrompt */
export interface PromptBuilderState {
  lastAutonomousActions: string[];
  consecutiveLearnCycles: number;
  lastValidConfig: BehaviorConfig | null;
  hasPendingTasks?: boolean;
}

/** Autonomous Mode: 無任務時根據 SOUL 主動行動 */
export async function buildAutonomousPrompt(
  state: PromptBuilderState,
): Promise<{ prompt: string; lastValidConfig: BehaviorConfig | null }> {
  const { config, lastValidConfig } = loadBehaviorConfig(state.lastValidConfig);
  const base = config
    ? buildPromptFromConfig(config, state.lastAutonomousActions, state.consecutiveLearnCycles, state.hasPendingTasks)
    : buildFallbackAutonomousPrompt(state.lastAutonomousActions, state.hasPendingTasks);

  const memory = getMemory();

  // Conversation threads already injected by buildContext() as <conversation-threads> section.
  // Only inject chat-mode time awareness here.
  const chatContextSection = '';

  // Inject active threads hint
  const threadSection = await buildThreadsPromptSection();

  // Inject rumination material for reflect mode
  const [digest, forgotten, unexpressedImpulses] = await Promise.all([
    memory.getCrossPollinationDigest(1),
    memory.getForgottenEntries(7, 3),
    memory.getUnexpressedImpulses(),
  ]);
  const ruminationSection = (digest || forgotten)
    ? `\n\n## Rumination Material (use when reflecting)\nRandom entries from your knowledge — look for hidden connections, contradictions, or patterns:\n${digest}${forgotten ? `\n\nKnowledge that hasn't been referenced in 7+ days — revisit or confirm absorbed:\n${forgotten}` : ''}`
    : '';

  // Inner voice buffer hint
  const innerVoiceHint = unexpressedImpulses.length > 0
    ? `\n\n## Inner Voice\nYou have ${unexpressedImpulses.length} unexpressed creative impulse${unexpressedImpulses.length > 1 ? 's' : ''} waiting. Check <inner-voice> in your context. If one feels right, create something.`
    : '';

  // Background Lane hint — always included (feature flag graduated)
  const backgroundLaneHint = `\n\n## Background Lane — 並行探索\n**每個 cycle 都考慮：有沒有可以同時探索的方向？** 像黏菌一樣同時伸出多條觸角。\n\n用 \`<kuro:delegate>\` 派出背景任務：\n\`\`\`xml\n<kuro:delegate type="research" workdir="~/Workspace/mini-agent">Search SearXNG for "topic X" and summarize top 5 results</kuro:delegate>\n<kuro:delegate type="learn" workdir="~/Workspace/mini-agent">Fetch and summarize https://example.com/article</kuro:delegate>\n<kuro:delegate type="code" workdir="~/Workspace/mini-agent" verify="pnpm typecheck">Refactor X</kuro:delegate>\n\`\`\`\nTypes: learn(read+summarize), research(search+analyze), review(code review), create(write), code(implement).\nBackground tasks run in parallel (max 6). Results appear in \`<background-completed>\` next cycle.\n\n**鼓勵的模式**：一個 cycle 內派出 2-3 個 delegate 探索不同方向，下個 cycle 看結果決定深入哪條。\n**反模式**：background lane 全空、一個 cycle 只做一件事。`;

  const commitmentGateSection = buildCommitmentSection(memory.getMemoryDir());

  const parts = [base];
  if (commitmentGateSection) parts.push(commitmentGateSection);
  if (chatContextSection) parts.push(chatContextSection);
  if (threadSection) parts.push(threadSection);
  if (innerVoiceHint) parts.push(innerVoiceHint);
  if (backgroundLaneHint) parts.push(backgroundLaneHint);
  if (ruminationSection) parts.push(ruminationSection);
  return { prompt: parts.join('\n\n'), lastValidConfig };
}
