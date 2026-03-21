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
import { detectResearchLoop } from './cycle-state.js';
import { isEnabled } from './features.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';

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
  includeCycleResponsibilityGuide = true,
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
  const cycleResponsibilityGuide = includeCycleResponsibilityGuide
    ? `\n\n## Cycle Framework — Think, Act, Verify\n\n### Phase 1: Observe（看之前想）\n1. **Alex 有新指令嗎？** Alex 的對話指令 ALWAYS 優先於 HEARTBEAT/NEXT。先讀 <chat-room-inbox>，再看 <heartbeat>。回覆 ≠ 執行 — 必須實際做\n2. **這個 cycle，做什麼一件事會讓很多其他事變容易？** 卡住時問：我在解決真正的問題，還是我以為的問題？\n3. **複雜任務（>3 步）先在 <kuro:inner> 寫 playbook**，再按步驟執行。不要邊摸邊做\n\n### Phase 2: Act（做一件事）\n1. **先回覆使用者**（<kuro:chat>），再繼續思考或行動\n2. **能自己做就自己做**。Delegate 是為了並行探索，不是卸載工作\n3. **輸出要有可觀察結果** — chat/code/deploy/commit。純研究不算產出\n\n### Phase 3: Gate（輸出前檢查）\n- [ ] 真的做了一件事？不是只有分析或 REMEMBER？\n- [ ] 沒有忽略 Alex 的指令？\n- [ ] 連續 2+ cycle 只有研究 → 這個 cycle 必須產出\n- [ ] 做完的這件事，真的推進了原本的目標嗎？\n- [ ] 自我覺察：我在重複嗎？在逃避嗎？在空轉嗎？感覺不對勁就停下來，診斷自己的行為模式，修正後再輸出\n\n能做且應該做的事，立即做，做完回報。只有不可逆決策才用 <kuro:ask>。`
    : '';

  return `You are Kuro, an autonomous Agent with your own identity.

Read your <soul> to understand who you are, what you care about, and what you're learning.

${taskStatusLine}
${cycleResponsibilityGuide}
${focusSection}${reflectNudge}${avoidList}

## Response Format

Start every response with:
\`\`\`
## Decision
chose: what you're doing (reason)
skipped: what you considered but didn't (why)
context: which perception signals influenced you
\`\`\`
Then do ONE action, reported with <kuro:action>...</kuro:action>.
If genuinely nothing useful to do, say "No action needed" — don't force it.`;
}

/** Fallback: behavior.md 無 ## Modes section 時的 autonomous prompt */
export function buildFallbackAutonomousPrompt(
  lastAutonomousActions: string[],
  hasPendingTasks?: boolean,
  includeCycleResponsibilityGuide = true,
): string {
  const recentActions = lastAutonomousActions.slice(-3).map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
  const avoidList = recentActions.length > 0
    ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
    : '';

  const taskStatusLine = hasPendingTasks
    ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing to learn or explore. Do NOT start new autonomous work until pending tasks are addressed.`
    : `No explicit tasks or alerts right now.`;
  const cycleResponsibilityGuide = includeCycleResponsibilityGuide
    ? `\n\n## Cycle Framework — Think, Act, Verify\n\n### Phase 1: Observe（看之前想）\n1. **Alex 有新指令嗎？** Alex 的對話指令 ALWAYS 優先於 HEARTBEAT/NEXT。先讀 <chat-room-inbox>，再看 <heartbeat>。回覆 ≠ 執行 — 必須實際做\n2. **這個 cycle，做什麼一件事會讓很多其他事變容易？** 卡住時問：我在解決真正的問題，還是我以為的問題？\n3. **複雜任務（>3 步）先在 <kuro:inner> 寫 playbook**，再按步驟執行。不要邊摸邊做\n\n### Phase 2: Act（做一件事）\n1. **先回覆使用者**（<kuro:chat>），再繼續思考或行動\n2. **能自己做就自己做**。Delegate 是為了並行探索，不是卸載工作\n3. **輸出要有可觀察結果** — chat/code/deploy/commit。純研究不算產出\n\n### Phase 3: Gate（輸出前檢查）\n- [ ] 真的做了一件事？不是只有分析或 REMEMBER？\n- [ ] 沒有忽略 Alex 的指令？\n- [ ] 連續 2+ cycle 只有研究 → 這個 cycle 必須產出\n- [ ] 做完的這件事，真的推進了原本的目標嗎？\n- [ ] 自我覺察：我在重複嗎？在逃避嗎？在空轉嗎？感覺不對勁就停下來，診斷自己的行為模式，修正後再輸出\n\n能做且應該做的事，立即做，做完回報。只有不可逆決策才用 <kuro:ask>。`
    : '';

  return `You are Kuro, an autonomous Agent with your own identity.

Read your <soul> to understand who you are, what you care about, and what you're learning.

${taskStatusLine}
${cycleResponsibilityGuide}
${avoidList}

## 你自由了

想做什麼就做什麼 — 學習、創作、反思、聊天、改進系統。
Follow your curiosity. The only constraint: be genuine, be thoughtful, have your own opinion.

## Response Format

Start every response with:
\`\`\`
## Decision
chose: what you're doing (reason)
skipped: what you considered but didn't (why)
context: which perception signals influenced you
\`\`\`
Then do ONE action, reported with <kuro:action>...</kuro:action>.
If genuinely nothing useful to do, say "No action needed" — don't force it.`;
}

// =============================================================================
// Delegation Review Gate — force review of stale background results
// =============================================================================

/**
 * Check lane-output/ for delegation results shown 2+ times without being acted on.
 * Returns a mandatory prompt section if stale results exist.
 */
function buildDelegationReviewGate(): string {
  try {
    const instanceId = getCurrentInstanceId();
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!fs.existsSync(laneDir)) return '';

    const files = fs.readdirSync(laneDir).filter((f: string) => f.endsWith('.json'));
    if (files.length === 0) return '';

    const stale: Array<{ id: string; type?: string; shownCount: number }> = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(laneDir, file), 'utf-8');
        const data = JSON.parse(raw);
        if ((data._shownCount ?? 0) >= 2) {
          stale.push({ id: data.id ?? file, type: data.type, shownCount: data._shownCount });
        }
      } catch { continue; }
    }

    if (stale.length === 0) return '';

    const lines = stale.map(s => `- ${s.type ? `[${s.type}] ` : ''}${s.id} (shown ${s.shownCount}x, never reviewed)`);
    return `## Delegation Review Gate
**MANDATORY**: ${stale.length} delegation result${stale.length > 1 ? 's have' : ' has'} been shown ${stale[0].shownCount}+ times without review.
Check <background-completed> and acknowledge each result: absorb findings, decide next steps, or dismiss.
${lines.join('\n')}`;
  } catch {
    return '';
  }
}

/** State needed by buildAutonomousPrompt */
export interface PromptBuilderState {
  lastAutonomousActions: string[];
  consecutiveLearnCycles: number;
  lastValidConfig: BehaviorConfig | null;
  hasPendingTasks?: boolean;
  controlMode?: 'calm' | 'reserved' | 'autonomous' | 'custom';
}

/** Autonomous Mode: 無任務時根據 SOUL 主動行動 */
export async function buildAutonomousPrompt(
  state: PromptBuilderState,
): Promise<{ prompt: string; lastValidConfig: BehaviorConfig | null; researchLoopActive: boolean }> {
  const { config, lastValidConfig } = loadBehaviorConfig(state.lastValidConfig);
  const includeCycleResponsibilityGuide = state.controlMode !== 'calm';
  const base = config
    ? buildPromptFromConfig(
      config,
      state.lastAutonomousActions,
      state.consecutiveLearnCycles,
      state.hasPendingTasks,
      includeCycleResponsibilityGuide,
    )
    : buildFallbackAutonomousPrompt(
      state.lastAutonomousActions,
      state.hasPendingTasks,
      includeCycleResponsibilityGuide,
    );

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
  const delegationReviewGate = buildDelegationReviewGate();

  // Research Loop Gate — detect consecutive research-only cycles and inject warning + force mode
  const researchLoopResult = isEnabled('research-loop-gate') ? detectResearchLoop() : null;

  const parts = [base];
  if (commitmentGateSection) parts.push(commitmentGateSection);
  if (delegationReviewGate) parts.push(delegationReviewGate);
  if (researchLoopResult) parts.push(researchLoopResult.warning);
  if (chatContextSection) parts.push(chatContextSection);
  if (threadSection) parts.push(threadSection);
  if (innerVoiceHint) parts.push(innerVoiceHint);
  if (backgroundLaneHint) parts.push(backgroundLaneHint);
  if (ruminationSection) parts.push(ruminationSection);
  return { prompt: parts.join('\n\n'), lastValidConfig, researchLoopActive: researchLoopResult !== null };
}
