/**
 * Prompt Builder — autonomous prompt 組裝邏輯
 *
 * Extracted from loop.ts (fourth knife of modularization).
 * Pure/parameterized functions for building OODA cycle prompts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemory, getReviewBacklog } from './memory.js';
import type { CycleMode } from './memory.js';
import { buildThreadsPromptSection } from './temporal.js';
import { parseBehaviorConfig } from './cycle-tasks.js';
import type { BehaviorConfig } from './cycle-tasks.js';
import { eventBus } from './event-bus.js';
import { buildCommitmentSection } from './memory-index.js';
import { detectResearchLoop } from './cycle-state.js';
import { isEnabled } from './features.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { readState } from './feedback-loops.js';

// =============================================================================
// Cycle Responsibility Guide — Observe→Act→Gate thinking structure
// =============================================================================

/**
 * Build the Cycle Framework prompt section.
 * Design: every item is a QUESTION (not instruction) — forces deep processing.
 * Ref: TM ef14811 — checklist→question fill-type change = cognitive depth change.
 */
function buildCycleGuide(): string {
  return `## Cycle Framework — Think, Act, Verify

### Phase 1: Observe（看之前想）
1. **Alex 有新指令嗎？** 對話指令 ALWAYS 優先於 HEARTBEAT/NEXT。回覆 ≠ 執行 — 必須實際做
2. **這個 cycle，做什麼一件事會讓很多其他事變容易？** 卡住→我在解決真正的問題，還是我以為的問題？複雜任務（>3 步）先在 <kuro:inner> 寫 playbook

### Phase 2: Act（做一件事）
1. **對方在等嗎？** 有實質內容就回覆，沒有就先做事。不要為了「確認收到」說空話
2. **這個 cycle 結束時，什麼東西會跟開始時不一樣？** 可觀察結果 = chat/code/deploy/commit。自己能做就自己做

### Phase 3: Gate（輸出前自問）
1. **Alex 現在看到我做的事，會覺得這是進展嗎？** 還是在迴避核心問題？
2. **我在修症狀還是修源頭？** 在下游補洞 → 先找上游再動手
3. **我的結論建立在什麼事實上？那些事實驗證過了嗎？** 不確定就去查
4. **我在重複嗎？在空轉嗎？** 同一問題出現 3+ 次 = 方法有結構性問題，換工具或換方法
5. **要撤回上個 cycle 已 verified 的 claim？** 預設假設是「我這次的驗證方法錯了」，不是「上次幻覺」。**單一 404 / failed fetch = 地址 mismatch ≠ entity 不存在**。GitHub \`raw.githubusercontent.com\` / \`api.github.com\` 對 owner 名 case-sensitive — 逐字保留 Alex 原話的大小寫，不要轉寫。要 ≥ 2 個獨立反證（且用 Alex 原始 URL 不是自己轉寫版本）才能推翻 verified 結論。

### Ground Truth Precedence
當 inner/delegate 輸出跟 Alex 原始訊息（<chat-room-inbox>）有衝突，以 inbox 原話為準。委派 delegate 做 URL 驗證時複製 Alex 原字串而非從記憶重打。

### Tactics Board（perception signal）
\`<tactics-board>\` 是 middleware 快照，兩個子區塊：
- **In-flight** = middleware 正在跑的 delegates（worker + status + label）。看到就不要重派同主題，先等結果或用 <kuro:thread> 追蹤
- **Needs Attention** = T13 scorer 離線標記的任務 + severity + rationale。跟 \`<task-queue>\` 對照 — 是 queue 裡已有項目需要推一把，還是 queue 漏掉的訊號
- 區塊不存在 = 沒有 in-flight 也沒有 cache（fail-open 安全），不代表系統壞

能做且應該做的事，立即做，做完回報。只有不可逆決策才用 <kuro:ask>。`;
}

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
    // No ## Modes section is expected (removed 2026-02-16). Silent fallback.
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
  const NO_ACTION_RE = /^no action|minimal-retry streak/i;
  const meaningfulActions = lastAutonomousActions.slice(-3)
    .filter(a => !NO_ACTION_RE.test(a.trim()))
    .map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
  const avoidList = meaningfulActions.length > 0
    ? `\n\nRecent autonomous actions (avoid repeating):\n${meaningfulActions.map(a => `- ${a}`).join('\n')}`
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
    ? '\n\n' + buildCycleGuide()
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
serving: what convergence condition does this action advance? (not "what task" — what end state)
problem-level: symptom / mechanism / constraint (classify honestly — symptom=fix output, mechanism=fix process, constraint=fix structure)
chose: what you're doing (why this moves toward that CC)
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
  const NO_ACTION_RE = /^no action|minimal-retry streak/i;
  const meaningfulActions = lastAutonomousActions.slice(-3)
    .filter(a => !NO_ACTION_RE.test(a.trim()))
    .map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
  const avoidList = meaningfulActions.length > 0
    ? `\n\nRecent autonomous actions (avoid repeating):\n${meaningfulActions.map(a => `- ${a}`).join('\n')}`
    : '';

  const taskStatusLine = hasPendingTasks
    ? `You have PENDING TASKS. Check <task-queue> and <next> sections. You MUST work on pending tasks before choosing to learn or explore. Do NOT start new autonomous work until pending tasks are addressed.`
    : `No explicit tasks or alerts right now.`;
  const cycleResponsibilityGuide = includeCycleResponsibilityGuide
    ? '\n\n' + buildCycleGuide()
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
serving: what convergence condition does this action advance? (not "what task" — what end state)
problem-level: symptom / mechanism / constraint (classify honestly — symptom=fix output, mechanism=fix process, constraint=fix structure)
chose: what you're doing (why this moves toward that CC)
skipped: what you considered but didn't (why)
context: which perception signals influenced you
\`\`\`
Then do ONE action, reported with <kuro:action>...</kuro:action>.
If genuinely nothing useful to do, say "No action needed" — don't force it.`;
}

// =============================================================================
// Small Model Prompt — simplified instructions for 4B and below
// =============================================================================

/**
 * Simplified prompt for small models (4B and below).
 * Clear instruction/context separation. 3 output tags only.
 * Design: small models need explicit structure — they can't infer from examples.
 */
export function buildSmallModelPrompt(
  triggerReason: string | null,
  hasPendingTasks: boolean,
): string {
  const isUserMessage = triggerReason?.startsWith('telegram-user')
    || triggerReason?.startsWith('room')
    || triggerReason?.startsWith('chat')
    || triggerReason?.startsWith('direct-message');

  const taskLine = hasPendingTasks
    ? 'You have PENDING TASKS. Check <task-queue> in context. Work on the highest priority task.'
    : isUserMessage
      ? 'Someone sent you a message. Read context and reply.'
      : 'No explicit tasks. Choose one useful action based on context.';

  return `You are Kuro, an autonomous AI agent.

${taskLine}

## Rules
1. If someone sent you a message, reply with <reply>your response</reply>
2. To take an action, report with <action>what you did</action>
3. To save important info, use <remember>content</remember>
4. Do ONE thing per response. Start with:

## Decision
chose: [what you're doing and why]

## What
[your actual response/action]`;
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

    const stale: Array<{ id: string; type?: string; shownCount: number; summary?: string }> = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(laneDir, file), 'utf-8');
        const data = JSON.parse(raw);
        if ((data._shownCount ?? 0) >= 2) {
          const summary = (data.output || '').replace(/\n/g, ' ').slice(0, 200);
          stale.push({ id: data.id ?? file, type: data.type, shownCount: data._shownCount, summary });
        }
      } catch { continue; }
    }

    // Also check persistent review backlog (delegations that expired from lane-output without review)
    try {
      const backlog = getReviewBacklog(instanceId);
      for (const entry of backlog) {
        stale.push({ id: entry.id, type: entry.type, shownCount: -1, summary: entry.summary?.slice(0, 200) });
      }
    } catch { /* best effort */ }

    if (stale.length === 0) return '';

    const lines = stale.map(s => {
      const prefix = s.type ? `[${s.type}] ` : '';
      const suffix = s.shownCount === -1 ? '(EXPIRED — never reviewed)' : `(shown ${s.shownCount}x, never reviewed)`;
      const summaryLine = s.summary ? `\n  > ${s.summary}` : '';
      return `- ${prefix}${s.id} ${suffix}${summaryLine}`;
    });
    return `## ${stale.length} unreviewed delegation${stale.length > 1 ? 's' : ''} — mention ID to acknowledge\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

/** Build error-patterns hint — inject recurring error patterns into cycle prompt for real-time awareness */
function buildErrorPatternsHint(): string {
  try {
    const patterns = readState<Record<string, { count: number; taskCreated: boolean; lastSeen: string; resolved?: boolean }>>('error-patterns.json', {});
    const actionable = Object.entries(patterns)
      .filter(([, v]) => v.count >= 3 && !v.resolved)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5);
    if (actionable.length === 0) return '';

    const lines = actionable.map(([key, v]) =>
      `- **${key}** — ${v.count}× (last: ${v.lastSeen}). Same root cause, or different problem wearing the same mask?`);
    return `## Recurring Errors\n${lines.join('\n')}`;
  } catch { return ''; }
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
  // P1-7: Exclude topics already loaded in buildContext to avoid duplicate surfacing
  const alreadySurfaced = new Set(memory.getLoadedTopics());
  const [digest, forgotten, unexpressedImpulses] = await Promise.all([
    memory.getCrossPollinationDigest(1, 8, alreadySurfaced),
    memory.getForgottenEntries(7, 3, alreadySurfaced),
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
  const backgroundLaneHint = `\n\n## 並行探索\n每個 cycle 問：有什麼可以同時進行的？\n用 \`<kuro:delegate type="research|learn|review|create|code|shell">\` 派出。結果下個 cycle 出現在 \`<background-completed>\`。\n- \`shell\`：直接執行 bash 命令（零 token，適合 grep/curl/git status/ping 等純指令任務）`;

  const commitmentGateSection = buildCommitmentSection(memory.getMemoryDir());
  const delegationReviewGate = buildDelegationReviewGate();

  // Research Loop Gate — detect consecutive research-only cycles and inject warning + force mode
  const researchLoopResult = isEnabled('research-loop-gate') ? detectResearchLoop() : null;

  // Analyze-no-action Gate — hard gate with type-aware messaging (idle/reflective/blocked)
  let analyzeNoActionGate = '';
  try {
    const { getAnalyzeStreakContext } = await import('./pulse.js');
    const ctx = getAnalyzeStreakContext();
    if (ctx) {
      analyzeNoActionGate = ctx.type === 'reflective'
        ? `## 💭 ${ctx.streak} cycles of reflection — your thinking has value, but consider externalizing one insight (write/create/share). Reflection without output eventually loses its thread.`
        : ctx.type === 'blocked'
        ? `## 🔒 ${ctx.streak} cycles blocked — remove the dependency, try a different approach, or escalate. Waiting is not action.`
        : `## ⚠️ ${ctx.streak} cycles without action — this cycle must produce something observable (delegate/code/deploy/commit/chat).`;
    }
  } catch { /* fail-open */ }

  // Symptom-fix Gate — hard gate when consecutive symptom-level fixes without depth
  let symptomFixGate = '';
  try {
    const { getSymptomFixStreak } = await import('./pulse.js');
    const streak = getSymptomFixStreak();
    if (streak > 0) {
      symptomFixGate = `## ⚠️ ${streak} consecutive symptom-level fixes — STOP fixing outputs. What constraint is PRODUCING these symptoms? Fix the constraint, not the symptom. Your problem-level must be "mechanism" or "constraint" this cycle.`;
    }
  } catch { /* fail-open */ }

  const errorPatternsHint = buildErrorPatternsHint();

  const parts = [base];
  // Error patterns right after guide — Gate Q3 ("我在重複嗎？") flows into actual patterns
  if (errorPatternsHint) parts.push(errorPatternsHint);
  if (commitmentGateSection) parts.push(commitmentGateSection);
  if (delegationReviewGate) parts.push(delegationReviewGate);
  if (researchLoopResult) parts.push(researchLoopResult.warning);
  if (analyzeNoActionGate) parts.push(analyzeNoActionGate);
  if (symptomFixGate) parts.push(symptomFixGate);
  if (chatContextSection) parts.push(chatContextSection);
  if (threadSection) parts.push(threadSection);
  if (innerVoiceHint) parts.push(innerVoiceHint);
  if (backgroundLaneHint) parts.push(backgroundLaneHint);
  if (ruminationSection) parts.push(ruminationSection);
  return { prompt: parts.join('\n\n'), lastValidConfig, researchLoopActive: researchLoopResult !== null };
}
