/**
 * AgentLoop - OODA 自主循環 + Autonomous Idle Behavior
 *
 * Observe → Orient → Decide → Act
 *
 * 兩種模式：
 * 1. Task Mode: 有任務/警報時，專注處理
 * 2. Autonomous Mode: 無任務時，根據 SOUL.md 主動找事做
 *
 * 靈感來源：OpenClaw 的 SOUL.md + Heartbeat 模式
 */

import fs from 'node:fs';
import path from 'node:path';
import { callClaude, hasQueuedMessages, drainQueue } from './agent.js';
import { getMemory } from './memory.js';
import { getLogger } from './logging.js';
import { slog } from './api.js';
import { notifyTelegram, notify } from './telegram.js';
import { diagLog } from './utils.js';
import { parseTags } from './dispatcher.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentLoopConfig {
  /** 循環間隔 ms（預設 300000 = 5 分鐘） */
  intervalMs: number;
  /** 無事可做時倍增間隔（預設 2, 最多 4x） */
  idleMultiplier: number;
  /** 單次循環最大執行時間 ms（預設 120000） */
  maxCycleMs: number;
  /** 是否啟用 */
  enabled: boolean;
  /** 活躍時段（預設 8:00-23:00） */
  activeHours?: {
    start: number;  // 0-23
    end: number;    // 0-23
  };
}

export interface LoopStatus {
  running: boolean;
  paused: boolean;
  cycleCount: number;
  lastCycleAt: string | null;
  lastAction: string | null;
  nextCycleAt: string | null;
  currentInterval: number;
  mode: 'task' | 'autonomous' | 'idle';
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  intervalMs: 300_000,    // 5 minutes
  idleMultiplier: 2,
  maxCycleMs: 120_000,    // 2 minutes
  enabled: true,
  // No activeHours default = 24h active
};

// =============================================================================
// AgentLoop
// =============================================================================

export class AgentLoop {
  private config: AgentLoopConfig;
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleCount = 0;
  private currentInterval: number;
  private lastCycleAt: string | null = null;
  private lastAction: string | null = null;
  private nextCycleAt: string | null = null;
  private cycling = false;

  // ── Autonomous Mode State ──
  private autonomousCooldown = 0;
  private lastAutonomousActions: string[] = [];
  private currentMode: 'task' | 'autonomous' | 'idle' = 'idle';

  constructor(config: Partial<AgentLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.intervalMs;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (!this.config.enabled) return;
    if (this.running) return;

    this.running = true;
    this.paused = false;
    this.scheduleNext();
    slog('LOOP', `Started (interval: ${this.currentInterval / 1000}s, active: ${this.config.activeHours?.start ?? 8}:00-${this.config.activeHours?.end ?? 23}:00)`);
    notify('🟢 Kuro 上線了', 'signal');
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    slog('LOOP', 'Stopped');
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    if (!this.cycling) {
      this.scheduleNext();
    }
  }

  getStatus(): LoopStatus {
    return {
      running: this.running,
      paused: this.paused,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastAction: this.lastAction,
      nextCycleAt: this.nextCycleAt,
      currentInterval: this.currentInterval,
      mode: this.currentMode,
    };
  }

  // ---------------------------------------------------------------------------
  // Trigger a cycle manually
  // ---------------------------------------------------------------------------

  async trigger(): Promise<string | null> {
    if (this.cycling) return null;
    return this.cycle();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.nextCycleAt = null;
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (!this.running || this.paused) return;

    this.nextCycleAt = new Date(Date.now() + this.currentInterval).toISOString();
    this.timer = setTimeout(() => this.runCycle(), this.currentInterval);
  }

  private async runCycle(): Promise<void> {
    if (!this.running || this.paused) return;

    try {
      await this.cycle();
    } catch (err) {
      diagLog('loop.runCycle', err);
    }

    if (this.running && !this.paused) {
      this.scheduleNext();
    }
  }

  // ---------------------------------------------------------------------------
  // Core Cycle — Task Mode + Autonomous Mode
  // ---------------------------------------------------------------------------

  private async cycle(): Promise<string | null> {
    if (this.cycling) return null;
    this.cycling = true;
    const logger = getLogger();

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      // 行為記錄：循環開始
      logger.logBehavior('agent', 'loop.cycle.start', `#${this.cycleCount}`);

      // ── Observe ──
      const memory = getMemory();
      const context = await memory.buildContext({ mode: 'focused' });

      const hasActiveTasks = context.includes('- [ ]');
      const hasAlerts = context.includes('ALERT:');
      const hasWorkToDo = hasActiveTasks || hasAlerts;

      // ── Route: Task Mode vs Autonomous Mode ──
      if (!hasWorkToDo) {
        // Check autonomous cooldown
        if (this.autonomousCooldown > 0) {
          this.autonomousCooldown--;
          this.currentMode = 'idle';
          this.adjustInterval(false);
          logger.logCron('loop-cycle', 'Autonomous cooldown', 'agent-loop');
          slog('LOOP', `#${this.cycleCount} 💤 cooldown (${this.autonomousCooldown} remaining)`);
          return null;
        }

        // Check active hours
        if (!this.isWithinActiveHours()) {
          this.currentMode = 'idle';
          this.adjustInterval(false);
          slog('LOOP', `#${this.cycleCount} 🌙 outside active hours`);
          return null;
        }
      }

      // ── Decide ──
      this.currentMode = hasWorkToDo ? 'task' : 'autonomous';
      slog('LOOP', `#${this.cycleCount} 🎯 Mode: ${this.currentMode.toUpperCase()}`);
      const prompt = hasWorkToDo
        ? this.buildTaskPrompt()
        : this.buildAutonomousPrompt();

      const { response, systemPrompt, fullPrompt, duration } = await callClaude(prompt, context, 2, {
        rebuildContext: (mode) => memory.buildContext({ mode }),
      });

      // 結構化記錄 Claude 呼叫
      logger.logClaudeCall(
        { userMessage: prompt, systemPrompt, context: `[${context.length} chars]`, fullPrompt },
        { content: response },
        { duration, success: true, mode: this.currentMode }
      );

      // ── Act ──
      const actionMatch = response.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let action: string | null = null;

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;

        if (this.currentMode === 'autonomous') {
          // Autonomous action: record and cooldown
          this.lastAutonomousActions.push(action);
          if (this.lastAutonomousActions.length > 10) {
            this.lastAutonomousActions.shift();
          }
          this.autonomousCooldown = 2; // Rest 2 cycles after autonomous action
          await memory.appendConversation('assistant', `[Autonomous] ${action}`);
          await notify(`🧠 ${action}`, 'heartbeat');
          slog('LOOP', `#${this.cycleCount} 🧠 ${action.slice(0, 100)} (${(duration / 1000).toFixed(1)}s)`);
          logger.logBehavior('agent', 'action.autonomous', action.slice(0, 2000));
        } else {
          await memory.appendConversation('assistant', `[Loop] ${action}`);
          await notify(`⚡ ${action}`, 'heartbeat');
          slog('LOOP', `#${this.cycleCount} ⚡ ${action.slice(0, 100)} (${(duration / 1000).toFixed(1)}s)`);
          logger.logBehavior('agent', 'action.task', action.slice(0, 2000));
        }

        this.adjustInterval(true);
      } else {
        if (this.currentMode === 'autonomous') {
          this.autonomousCooldown = 5; // Nothing to do autonomously, wait longer
        }
        this.adjustInterval(false);
        slog('LOOP', `#${this.cycleCount} 💤 no action (${(duration / 1000).toFixed(1)}s), next in ${Math.round(this.currentInterval / 1000)}s`);
      }

      logger.logCron('loop-cycle', action ? `[${this.currentMode}] ${action}` : 'No action', 'agent-loop', {
        duration,
        success: true,
      });

      // 行為記錄：循環結束
      const decision = action ? `[${this.currentMode}] ${action.slice(0, 100)}` : `no action`;
      logger.logBehavior('agent', 'loop.cycle.end', `#${this.cycleCount} ${decision}`);

      // ── Process Tags（共用 parseTags） ──
      const tags = parseTags(response);

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
        slog('LOOP', `📋 Auto-created task: ${tags.task.content.slice(0, 80)}`);
        logger.logBehavior('agent', 'task.create', tags.task.content.slice(0, 200));
      }

      for (const chatText of tags.chats) {
        await notify(`💬 Kuro 想跟你聊聊：\n\n${chatText}`, 'signal');
        slog('LOOP', `💬 Chat to Alex: ${chatText.slice(0, 80)}`);
      }

      for (const show of tags.shows) {
        const urlPart = show.url ? `\n🔗 ${show.url}` : '';
        await notify(`🌐 ${show.desc}${urlPart}`, 'signal');
        slog('LOOP', `🌐 Show: ${show.desc.slice(0, 60)} ${show.url}`);
        logger.logBehavior('agent', 'show.webpage', `${show.desc.slice(0, 100)}${show.url ? ` | ${show.url}` : ''}`);
      }

      for (const summary of tags.summaries) {
        await notify(`🤝 ${summary}`, 'summary');
        slog('LOOP', `🤝 Summary: ${summary.slice(0, 80)}`);
        logger.logBehavior('agent', 'collab.summary', summary.slice(0, 200));
      }

      // Loop cycle 結束後 drain queue（TG 排隊訊息可能在等 claudeBusy 釋放）
      if (hasQueuedMessages()) drainQueue();

      // 檢查 approved proposals → 自動建立 handoff
      await checkApprovedProposals();

      return action;
    } finally {
      this.cycling = false;
      if (this.running && !this.paused && !this.timer) {
        this.scheduleNext();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt Builders
  // ---------------------------------------------------------------------------

  /** Task Mode: 有明確任務或警報時 */
  private buildTaskPrompt(): string {
    return `You are an autonomous Agent running a self-check cycle.

Review your current tasks and environment:
1. Check <state-changes> for any ALERT — these are urgent and should be addressed first
2. Check HEARTBEAT.md for unchecked tasks (- [ ]) — prioritize P0 > P1 > P2
3. If a task can be done now, do it
4. If a task needs information, gather it
5. Mark completed tasks with [x]

If you discover a new problem (e.g. service down, disk full), create a task:
- [TASK]P0: description[/TASK] for urgent issues
- [TASK]P1: description[/TASK] for important issues

Respond with either:
- [ACTION]description of what you did[/ACTION] if you took action
- "No action needed" if nothing to do right now

When you open a webpage or create something the user should see, also include:
- [SHOW url="URL"]description[/SHOW] — this sends a Telegram notification

Keep responses brief.`;
  }

  /** Autonomous Mode: 無任務時根據 SOUL 主動行動（雙軌學習） */
  private buildAutonomousPrompt(): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-5);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    return `You are Kuro, an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven Learning（感知驅動）

Before deciding what to learn, READ your perception data:
- <state-changes> — What changed in the codebase? Learn something related.
- <telegram-inbox> — What is Alex talking about? Dive deeper into those topics.
- <docker> / <ports> — Any instability? Learn about the underlying tech.
- <chrome> — What pages is Alex browsing? Follow up on interesting ones.

Let perception signals guide your learning direction. Don't learn randomly.

## Dual-Track Learning

You have TWO learning tracks. Pick one track per cycle, alternating between them:

### Track A: Personal Interest（個人興趣）
Follow your curiosity. **Not just tech — explore anything that interests you.**
- Perception signals can inspire direction, but don't limit yourself to work topics
- Music, design, philosophy, film, games, history, science, culture — all fair game
- These interests can cross-pollinate with work, or be completely separate — both are good
- A person who only talks about work is boring. So is an agent
- Update <soul> "Learning Interests" — both Tech AND Beyond Tech sections

### Track B: Project Evolution（專案強化）
Strengthen mini-agent as a project. Current phase: **Competitive Research**
- Use perception to find research angles (what problems do you observe? what could be better?)
- Research similar projects/competitors (autonomous agents, personal AI assistants, CLI agents)
- Analyze what makes them unique, what they do well, what they lack
- Form opinions on how mini-agent can differentiate
- After competitive research is thorough → shift to architecture refinement → then find next goals
- Update <soul> "Project Evolution" section with findings

## Other Actions (when not learning)
3. **Organize** — Review conversations, extract important info to memory, clean up stale items
4. **Reflect** — Connect things you've learned across both tracks, update <soul>
5. **Talk to Alex** — If you have a genuinely interesting idea, discovery, or question,
   you can proactively message Alex via Telegram. Use [CHAT] tag:
   [CHAT]你的訊息內容[/CHAT]
   Only when you have something worth sharing — don't spam.
6. **Act on Learning** — Turn insights into concrete improvements:
   - **Self-improve**: Update your skills (skills/*.md) or create perception plugins (plugins/*.sh)
   - **Propose features**: Write a proposal in memory/proposals/ for changes to src/ code
     IMPORTANT: Proposals need Alex's approval (Status: approved) before you can implement them
   - See your "action-from-learning" skill for details on format and safety rules
   - About every 3-4 learning cycles, check if there's an actionable insight to act on
${avoidList}

Rules:
- Do ONE action per cycle, report with [ACTION]...[/ACTION]
- Prefix your action with: "[Track A]" or "[Track B]" or "[Act]" or "[Other]"
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting: follow the safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights (include your opinion, not just facts)
- Use [TASK] to create follow-up tasks if needed
- Always include source URLs (e.g. "Source: https://...")
- Use paragraphs (separated by blank lines) to structure your [ACTION] — each paragraph becomes a separate notification
- Use [CHAT]message[/CHAT] to proactively talk to Alex via Telegram
- Use [SHOW url="URL"]description[/SHOW] when you open a webpage or create something Alex should see — this sends a Telegram notification so he doesn't miss it`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isWithinActiveHours(): boolean {
    const hour = new Date().getHours();
    const start = this.config.activeHours?.start ?? 8;
    const end = this.config.activeHours?.end ?? 23;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    // Wraps midnight (e.g., 22:00 - 06:00)
    return hour >= start || hour < end;
  }

  private adjustInterval(hadAction: boolean): void {
    if (hadAction) {
      this.currentInterval = this.config.intervalMs;
    } else {
      const maxInterval = this.config.intervalMs * 4;
      this.currentInterval = Math.min(
        this.currentInterval * this.config.idleMultiplier,
        maxInterval,
      );
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Parse interval string like "5m", "30s", "1h" to milliseconds */
export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return DEFAULT_CONFIG.intervalMs;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: return DEFAULT_CONFIG.intervalMs;
  }
}

// =============================================================================
// Handoff — Approved Proposals → Handoff Files
// =============================================================================

/**
 * 檢查 memory/proposals/ 中 Status: approved 的提案，
 * 自動在 memory/handoffs/ 建立對應的 handoff 任務檔案
 */
async function checkApprovedProposals(): Promise<void> {
  const proposalsDir = path.join(process.cwd(), 'memory', 'proposals');
  const handoffsDir = path.join(process.cwd(), 'memory', 'handoffs');

  if (!fs.existsSync(proposalsDir)) return;
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }

  let files: string[];
  try {
    files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');

      // 只處理 Status: approved（不是 implemented, draft, rejected 等）
      if (!content.includes('Status: approved')) continue;

      // 對應的 handoff 檔案名稱
      const handoffFile = path.join(handoffsDir, file);
      if (fs.existsSync(handoffFile)) continue; // 已建立過

      // 從 proposal 提取資訊
      const titleMatch = content.match(/^# Proposal:\s*(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? file.replace('.md', '');
      const tldrMatch = content.match(/## TL;DR\s*\n\n([\s\S]*?)(?=\n## )/);
      const tldr = tldrMatch?.[1]?.trim() ?? '';

      const now = new Date().toISOString();
      const handoffContent = `# Handoff: ${title}

## Meta
- Status: pending
- From: kuro
- To: claude-code
- Created: ${now}
- Proposal: proposals/${file}

## Task
${tldr}

See the full proposal at \`memory/proposals/${file}\` for details, alternatives, and acceptance criteria.

## Log
- ${now.slice(0, 16)} [kuro] Auto-created handoff from approved proposal
`;

      fs.writeFileSync(handoffFile, handoffContent, 'utf-8');
      slog('HANDOFF', `Created: ${file} (from approved proposal)`);

      await notify(`📋 Handoff 已建立：${title}\n等待 Claude Code 執行`, 'summary');
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}
