/**
 * Action Coach — Haiku 行為教練
 *
 * 用 Haiku 分析 Kuro 最近的行為模式，注入 2-3 句 coaching 到 perception context。
 * 每 3 cycle 跑一次，fire-and-forget，不阻塞 OODA cycle。
 *
 * 分析重點：
 * 1. 理論 vs 行動比（太多 REMEMBER/learn，太少 visible output）
 * 2. 說了沒做（NEXT/HEARTBEAT 有任務但 behavior log 無進展）
 * 3. Delegation 結果未 review
 * 4. 停滯任務（>3 天無動作）
 * 5. 正面模式（momentum streak）
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { getLogger } from './logging.js';
import { getMemory } from './memory.js';
import { listTasks } from './delegation.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface CoachState {
  lastCycleRun: number;
  lastRunAt: string | null;
  totalRuns: number;
  totalTokens: { input: number; output: number };
}

// =============================================================================
// Constants
// =============================================================================

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;
const TIMEOUT_MS = 5000;
const RUN_EVERY_N_CYCLES = 3;
const NOTES_EXPIRY_MS = 6 * 3600_000; // 6 hours

// =============================================================================
// Client
// =============================================================================

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// =============================================================================
// State helpers (same pattern as feedback-loops.ts)
// =============================================================================

function getStatePath(filename: string): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), filename);
}

function readState<T>(filename: string, fallback: T): T {
  const p = getStatePath(filename);
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeState(filename: string, data: unknown): void {
  const p = getStatePath(filename);
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

// =============================================================================
// Gather Input
// =============================================================================

async function gatherCoachInput(): Promise<string> {
  const parts: string[] = [];

  // 1. Recent behavior log (last 30 entries)
  try {
    const logger = getLogger();
    const behaviors = logger.queryBehaviorLogs(undefined, 30);
    if (behaviors.length > 0) {
      const lines = behaviors.map(b =>
        `${b.data.actor}: ${b.data.action}${b.data.detail ? ` — ${b.data.detail.slice(0, 80)}` : ''}`,
      );
      parts.push(`## Recent Behaviors (last ${behaviors.length})\n${lines.join('\n')}`);
    }
  } catch { /* best effort */ }

  // 2. NEXT.md tasks
  try {
    const memory = getMemory();
    const next = await memory.readNext();
    if (next) {
      parts.push(`## NEXT.md\n${next.slice(0, 1500)}`);
    }
  } catch { /* best effort */ }

  // 3. HEARTBEAT tasks (first 2000 chars)
  try {
    const memory = getMemory();
    const heartbeat = await memory.readHeartbeat();
    if (heartbeat) {
      parts.push(`## HEARTBEAT.md\n${heartbeat.slice(0, 2000)}`);
    }
  } catch { /* best effort */ }

  // 4. Delegation status
  try {
    const tasks = listTasks({ includeCompleted: true });
    if (tasks.length > 0) {
      const lines = tasks.map(t => `- [${t.status}] ${t.id} (${t.duration ? `${Math.round(t.duration / 1000)}s` : 'running'})`);
      parts.push(`## Delegations\n${lines.join('\n')}`);
    }
  } catch { /* best effort */ }

  return parts.join('\n\n');
}

// =============================================================================
// Call Coach (Haiku)
// =============================================================================

const COACH_SYSTEM = `You are a concise behavioral coach for an AI agent named Kuro.
Your job: look at Kuro's recent behaviors, tasks, and delegation status, then give 2-3 SHORT actionable nudges (1 sentence each).

Focus on:
- Theory vs Action ratio: too many REMEMBER/learn actions with too few visible outputs (chat, publish, deploy) = bad
- Saying but not doing: tasks in NEXT/HEARTBEAT but no matching behavior log progress
- Unreviewed delegations: completed delegations that haven't been followed up
- Stale tasks: items sitting >3 days with no action
- Positive momentum: if things are going well, acknowledge it briefly

Rules:
- Max 2-3 sentences total. No headers, no bullet points, no fluff.
- Be direct. "你已經連續 5 個 cycle 在學習但沒有產出" not "Consider balancing..."
- If everything looks good, say so in one sentence and stop.
- Reply in 繁體中文.`;

async function callCoach(input: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!input.trim()) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await getClient().messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        system: COACH_SYSTEM,
        messages: [{ role: 'user', content: input }],
      },
      { signal: controller.signal },
    );

    clearTimeout(timer);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return text.trim() || null;
  } catch (error) {
    slog('COACH', `Haiku call failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// =============================================================================
// Entry Point
// =============================================================================

/**
 * 每 3 cycle 跑一次 coach check。Fire-and-forget。
 */
export async function runCoachCheck(action: string | null, cycleCount: number): Promise<void> {
  const state = readState<CoachState>('coach-state.json', {
    lastCycleRun: 0,
    lastRunAt: null,
    totalRuns: 0,
    totalTokens: { input: 0, output: 0 },
  });

  // Only run every N cycles
  if (cycleCount - state.lastCycleRun < RUN_EVERY_N_CYCLES) return;

  const input = await gatherCoachInput();
  const notes = await callCoach(input);

  state.lastCycleRun = cycleCount;
  state.lastRunAt = new Date().toISOString();
  state.totalRuns++;

  if (notes) {
    // Write coach notes (expires after 6h)
    const notesPath = getStatePath('coach-notes.md');
    const content = `<!-- updated: ${new Date().toISOString()} -->\n${notes}`;
    writeFileSync(notesPath, content, 'utf-8');
    slog('COACH', `Notes updated: ${notes.slice(0, 80)}...`);
  }

  writeState('coach-state.json', state);
}

// =============================================================================
// Context Builder (for buildContext in memory.ts)
// =============================================================================

/**
 * 讀取 coach-notes.md，若未過期則回傳內容供 `<coach>` section 注入。
 */
export function buildCoachContext(): string | null {
  try {
    const notesPath = getStatePath('coach-notes.md');
    if (!existsSync(notesPath)) return null;

    const content = readFileSync(notesPath, 'utf-8');

    // Check expiry from <!-- updated: ISO --> comment
    const match = content.match(/<!-- updated: (.+?) -->/);
    if (match) {
      const updatedAt = new Date(match[1]).getTime();
      if (Date.now() - updatedAt > NOTES_EXPIRY_MS) return null;
    }

    // Strip the comment line, return just the notes
    return content.replace(/<!--.*?-->\n?/, '').trim() || null;
  } catch {
    return null;
  }
}
