/**
 * Commitment Binding — 承諾綁定系統
 *
 * 追蹤 Kuro 說的「下一步做 X」承諾，在 context 中顯示兌現狀態。
 * 說了就要做，做了就記錄。逃避變成顯性記錄。
 *
 * 每個 cycle 結束後：
 * 1. extractCommitments() — 從 response 抓取承諾
 * 2. updateCommitments() — 根據 action 標記已兌現的承諾
 *
 * buildContext() 注入 <commitments> section 顯示待兌現/逾期承諾。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

type Priority = 'high' | 'medium' | 'low';

interface Commitment {
  text: string;           // 承諾內容（精簡）
  priority: Priority;     // 重要度（自動推斷）
  cycleCreated: number;   // 建立時的 cycle
  cycleDeadline: number;  // 預期完成的 cycle（created + GRACE_CYCLES）
  status: 'pending' | 'fulfilled' | 'dropped';
  fulfilledAt?: number;   // 兌現時的 cycle
  droppedReason?: string;
}

interface CommitmentsState {
  commitments: Commitment[];
  totalCreated: number;
  totalFulfilled: number;
  totalDropped: number;
  totalExpired: number;
}

// =============================================================================
// Constants
// =============================================================================

/** 承諾的寬限 cycle 數（建立後幾個 cycle 內要完成） */
const GRACE_CYCLES = 6;

/** 最多追蹤幾個承諾（防止無限增長） */
const MAX_COMMITMENTS = 10;

/** 承諾文字最大長度 */
const MAX_TEXT_LEN = 120;

/** 用於匹配承諾的 patterns */
const COMMITMENT_PATTERNS: RegExp[] = [
  // 中文
  /下一步[：:](.+?)(?:[。\n]|$)/g,
  /接下來[：:](.+?)(?:[。\n]|$)/g,
  /接下來(?:要|會|做)(.+?)(?:[。\n]|$)/g,
  /我(?:會|要)(?:先|接著|接下來)?做(.+?)(?:[。\n]|$)/g,
  /等下(?:做|來|要)(.+?)(?:[。\n]|$)/g,
  // English
  /next step[:\s]+(.+?)(?:\.|$)/gi,
  /(?:I'll|I will|going to)\s+(.+?)(?:\.|$)/gi,
];

/** 優先級推斷關鍵字 */
const HIGH_PRIORITY_KW = ['實作', '實現', 'implement', 'deploy', 'fix', '修復', '修', 'ship', '部署', 'build', '完成', 'commit', 'push', '發佈', 'publish'];
const LOW_PRIORITY_KW = ['研究', '想想', '考慮', 'think', 'explore', '觀察', '分析', 'analyze', '看看', '調查', 'investigate', '了解'];

function inferPriority(text: string): Priority {
  const lower = text.toLowerCase();
  if (HIGH_PRIORITY_KW.some(kw => lower.includes(kw))) return 'high';
  if (LOW_PRIORITY_KW.some(kw => lower.includes(kw))) return 'low';
  return 'medium';
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** 用於匹配 action 是否兌現承諾的模糊比對閾值 */
const MATCH_KEYWORDS_MIN = 2;

// =============================================================================
// State helpers
// =============================================================================

function getStatePath(): string {
  return path.join(getMemoryStateDir(), 'commitments.json');
}

function readState(): CommitmentsState {
  const p = getStatePath();
  try {
    if (!existsSync(p)) return { commitments: [], totalCreated: 0, totalFulfilled: 0, totalDropped: 0, totalExpired: 0 };
    return JSON.parse(readFileSync(p, 'utf-8')) as CommitmentsState;
  } catch {
    return { commitments: [], totalCreated: 0, totalFulfilled: 0, totalDropped: 0, totalExpired: 0 };
  }
}

function writeState(state: CommitmentsState): void {
  const p = getStatePath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// =============================================================================
// Extract commitments from response
// =============================================================================

function extractKeywords(text: string): string[] {
  return text
    .replace(/[，。：；！？、\s]+/g, ' ')
    .split(' ')
    .filter(w => w.length > 1)
    .map(w => w.toLowerCase());
}

function isDuplicate(existing: Commitment[], newText: string): boolean {
  const newKw = extractKeywords(newText);
  return existing.some(c => {
    if (c.status !== 'pending') return false;
    const existKw = extractKeywords(c.text);
    const overlap = newKw.filter(w => existKw.includes(w)).length;
    return overlap >= Math.min(MATCH_KEYWORDS_MIN, Math.floor(existKw.length * 0.5));
  });
}

/**
 * 從 Kuro 的 response 中抽取承諾。
 * 在 postProcess 或 cycle 結束時呼叫。
 */
export function extractCommitments(response: string, cycleCount: number): void {
  const state = readState();
  const found: string[] = [];

  for (const pattern of COMMITMENT_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(response)) !== null) {
      const text = match[1].trim().slice(0, MAX_TEXT_LEN);
      if (text.length > 5 && !isDuplicate(state.commitments, text) && !found.includes(text)) {
        found.push(text);
      }
    }
  }

  if (found.length === 0) return;

  for (const text of found) {
    const priority = inferPriority(text);
    state.commitments.push({
      text,
      priority,
      cycleCreated: cycleCount,
      cycleDeadline: cycleCount + GRACE_CYCLES,
      status: 'pending',
    });
    state.totalCreated++;
    slog('COMMIT', `New [${priority}]: "${text}" (deadline: cycle ${cycleCount + GRACE_CYCLES})`);
  }

  // Trim old fulfilled/dropped to keep list manageable
  const pending = state.commitments.filter(c => c.status === 'pending');
  const resolved = state.commitments.filter(c => c.status !== 'pending').slice(-5);
  state.commitments = [...resolved, ...pending].slice(-MAX_COMMITMENTS);

  writeState(state);
}

// =============================================================================
// Update commitments based on action
// =============================================================================

function actionMatchesCommitment(action: string, commitment: Commitment): boolean {
  const actionKw = extractKeywords(action);
  const commitKw = extractKeywords(commitment.text);
  const overlap = commitKw.filter(w => actionKw.some(a => a.includes(w) || w.includes(a))).length;
  return overlap >= MATCH_KEYWORDS_MIN;
}

/**
 * 根據 cycle 的 action 更新承諾狀態。
 * - action 匹配的承諾 → fulfilled
 * - 超過 deadline 的承諾 → 標記 overdue（保持 pending，顯示在 context）
 */
export function updateCommitments(action: string | null, cycleCount: number): void {
  const state = readState();
  let changed = false;

  for (const c of state.commitments) {
    if (c.status !== 'pending') continue;

    // Check if action fulfills this commitment
    if (action && actionMatchesCommitment(action, c)) {
      c.status = 'fulfilled';
      c.fulfilledAt = cycleCount;
      state.totalFulfilled++;
      changed = true;
      slog('COMMIT', `Fulfilled: "${c.text}" (took ${cycleCount - c.cycleCreated} cycles)`);
    }

    // Auto-expire very old commitments (deadline + GRACE_CYCLES again)
    if (c.status === 'pending' && cycleCount > c.cycleDeadline + GRACE_CYCLES) {
      c.status = 'dropped';
      c.droppedReason = 'expired';
      state.totalExpired++;
      changed = true;
      slog('COMMIT', `Expired: "${c.text}" (${cycleCount - c.cycleCreated} cycles without action)`);
    }
  }

  if (changed) writeState(state);
}

// =============================================================================
// Context builder
// =============================================================================

/**
 * 檢查是否有 overdue 的 high-priority 承諾。
 * 用於 hasPendingWork() — 讓 interval cap 對未兌現的重要承諾生效。
 */
export function hasOverdueCommitments(cycleCount: number): boolean {
  try {
    const state = readState();
    return state.commitments.some(
      c => c.status === 'pending' && c.priority === 'high' && cycleCount > c.cycleDeadline
    );
  } catch {
    return false;
  }
}

/**
 * 產生 <commitments> section 供 buildContext() 注入。
 * 只在有 pending 承諾時才回傳。
 */
export function buildCommitmentsContext(cycleCount: number): string | null {
  const state = readState();
  const pending = state.commitments.filter(c => c.status === 'pending');

  if (pending.length === 0) return null;

  const lines: string[] = [];
  const priorityLabel: Record<Priority, string> = { high: '🔴', medium: '🟡', low: '🔵' };

  // Sort by: overdue first, then by priority (high→medium→low)
  const overdue = pending
    .filter(c => cycleCount > c.cycleDeadline)
    .sort((a, b) => PRIORITY_ORDER[a.priority ?? 'medium'] - PRIORITY_ORDER[b.priority ?? 'medium']);
  const upcoming = pending
    .filter(c => cycleCount <= c.cycleDeadline)
    .sort((a, b) => PRIORITY_ORDER[a.priority ?? 'medium'] - PRIORITY_ORDER[b.priority ?? 'medium']);

  if (overdue.length > 0) {
    for (const c of overdue) {
      const late = cycleCount - c.cycleDeadline;
      lines.push(`⚠️ OVERDUE ${priorityLabel[c.priority ?? 'medium']} (${late} cycles late): ${c.text}`);
    }
  }

  if (upcoming.length > 0) {
    for (const c of upcoming) {
      const left = c.cycleDeadline - cycleCount;
      lines.push(`${priorityLabel[c.priority ?? 'medium']} Pending (${left} cycles left): ${c.text}`);
    }
  }

  // Stats
  const { totalFulfilled, totalExpired, totalCreated } = state;
  if (totalCreated > 0) {
    const rate = totalCreated > 0 ? Math.round((totalFulfilled / totalCreated) * 100) : 0;
    lines.push(`\nCommitment rate: ${totalFulfilled}/${totalCreated} fulfilled (${rate}%)`);
  }

  return lines.join('\n');
}
