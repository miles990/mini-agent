/**
 * Temporal Sense — Kuro 的主觀時間體驗
 *
 * 三個組件：
 * 1. Topic Heat: 追蹤每個 topic 的「溫度」（升溫/冷卻/穩定）
 * 2. Recent Days: 最近 3 天的日摘要
 * 3. Active Threads: 持續多天的思考線索（最多 3 個）
 *
 * 所有狀態持久化在 memory/temporal.json
 * buildContext 時注入 <temporal> section（硬上限 800 chars）
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface TopicHeat {
  lastTouch: string;       // ISO timestamp
  touchCount7d: number;    // 過去 7 天的寫入次數
  trend: 'warming' | 'cooling' | 'stable';
}

export interface DaySummary {
  date: string;            // YYYY-MM-DD
  cycles: number;
  actions: number;
  themes: string[];        // 當天最活躍的 topics（前 3）
  highlight: string;       // 當天最重要的事（≤80 chars）
}

export interface ActiveThread {
  id: string;              // kebab-case identifier
  title: string;
  startedAt: string;       // ISO timestamp
  lastProgressAt: string;  // ISO timestamp
  progressNotes: string[]; // 最多 10 條，每條 ≤80 chars
  status: 'active' | 'paused' | 'completed';
}

export interface TemporalState {
  updatedAt: string;
  topicHeat: Record<string, TopicHeat>;
  recentDays: DaySummary[];       // 最近 3 天, FIFO
  activeThreads: ActiveThread[];  // 最多 3 個 active
  daysSinceBoot?: number;         // 從首次啟動到今天的天數
}

// =============================================================================
// State I/O
// =============================================================================

function getTemporalPath(): string {
  return path.join(process.cwd(), 'memory', 'temporal.json');
}

async function loadState(): Promise<TemporalState> {
  try {
    const raw = await fs.readFile(getTemporalPath(), 'utf-8');
    return JSON.parse(raw) as TemporalState;
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      topicHeat: {},
      recentDays: [],
      activeThreads: [],
    };
  }
}

async function saveState(state: TemporalState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(getTemporalPath(), JSON.stringify(state, null, 2), 'utf-8');
}

// =============================================================================
// Topic Heat
// =============================================================================

function recalculateTrends(state: TemporalState): void {
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  for (const [, heat] of Object.entries(state.topicHeat)) {
    const age = now - new Date(heat.lastTouch).getTime();
    if (age > WEEK_MS) {
      // 超過一週沒碰 → cooling
      heat.trend = 'cooling';
      heat.touchCount7d = 0;
    } else if (age < 2 * 24 * 60 * 60 * 1000 && heat.touchCount7d >= 3) {
      heat.trend = 'warming';
    } else if (age > 3 * 24 * 60 * 60 * 1000 || heat.touchCount7d <= 1) {
      heat.trend = 'cooling';
    } else {
      heat.trend = 'stable';
    }
  }
}

// =============================================================================
// Temporal Markers — 為日期加上相對時間標記
// =============================================================================

export function addTemporalMarkers(content: string): string {
  const now = Date.now();
  return content.replace(/\[(\d{4}-\d{2}-\d{2})\]/g, (_match, dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.floor((now - date.getTime()) / 86_400_000);
    if (diffDays <= 0) return `[${dateStr} ⟨today⟩]`;
    if (diffDays === 1) return `[${dateStr} ⟨yesterday⟩]`;
    if (diffDays <= 7) return `[${dateStr} ⟨${diffDays}d ago⟩]`;
    if (diffDays <= 30) return `[${dateStr} ⟨${Math.ceil(diffDays / 7)}w ago⟩]`;
    return `[${dateStr} ⟨${Math.ceil(diffDays / 30)}mo ago⟩]`;
  });
}

// =============================================================================
// Update — cycle 結束時呼叫
// =============================================================================

export async function updateTemporalState(cycleResult: {
  mode: string;
  action: string | null;
  topics?: string[];  // 本次 cycle 觸碰的 topics
}): Promise<void> {
  const state = await loadState();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 1. Update topic heat
  if (cycleResult.topics) {
    for (const topic of cycleResult.topics) {
      const heat = state.topicHeat[topic] ?? {
        lastTouch: now.toISOString(),
        touchCount7d: 0,
        trend: 'stable' as const,
      };
      heat.lastTouch = now.toISOString();
      heat.touchCount7d++;
      state.topicHeat[topic] = heat;
    }
  }

  // 2. Update today's summary
  let todaySummary = state.recentDays.find(d => d.date === today);
  if (!todaySummary) {
    todaySummary = { date: today, cycles: 0, actions: 0, themes: [], highlight: '' };
    state.recentDays.push(todaySummary);
  }
  todaySummary.cycles++;
  if (cycleResult.action) {
    todaySummary.actions++;
    // Auto-extract highlight from action (strip tags, take first 80 chars)
    const cleaned = cycleResult.action
      .replace(/\[.*?\]/g, '')
      .replace(/##\s*\w+/g, '')
      .trim();
    if (cleaned.length > todaySummary.highlight.length) {
      todaySummary.highlight = cleaned.slice(0, 80);
    }
  }

  // Update themes from topic heat for today
  if (cycleResult.topics) {
    for (const t of cycleResult.topics) {
      if (!todaySummary.themes.includes(t)) {
        todaySummary.themes.push(t);
      }
    }
    // Keep top 3 themes (by frequency — simplification: just keep first 3 unique)
    todaySummary.themes = todaySummary.themes.slice(0, 3);
  }

  // 3. Keep only last 3 days
  state.recentDays = state.recentDays
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  // 4. Recalculate trends
  recalculateTrends(state);

  // 5. Mark stale threads (idle > 7 days)
  for (const thread of state.activeThreads) {
    if (thread.status === 'active') {
      const idleDays = (Date.now() - new Date(thread.lastProgressAt).getTime()) / 86_400_000;
      if (idleDays > 7) {
        thread.status = 'paused'; // auto-pause stale threads
      }
    }
  }

  // 6. Calculate days since boot
  const bootDate = state.recentDays.length > 0
    ? state.recentDays[state.recentDays.length - 1].date
    : today;
  state.daysSinceBoot = Math.max(1, Math.floor(
    (now.getTime() - new Date(bootDate + 'T00:00:00').getTime()) / 86_400_000,
  ) + 1);

  await saveState(state);
}

// =============================================================================
// Thread CRUD — 從 [THREAD] tags 呼叫
// =============================================================================

export async function startThread(id: string, title: string, note: string): Promise<boolean> {
  const state = await loadState();
  const activeCount = state.activeThreads.filter(t => t.status === 'active').length;
  if (activeCount >= 3) return false; // 超過上限

  // 不重複建立
  if (state.activeThreads.some(t => t.id === id)) return false;

  const now = new Date().toISOString();
  state.activeThreads.push({
    id,
    title,
    startedAt: now,
    lastProgressAt: now,
    progressNotes: [formatProgressNote(note)],
    status: 'active',
  });

  await saveState(state);
  return true;
}

export async function progressThread(id: string, note: string): Promise<boolean> {
  const state = await loadState();
  const thread = state.activeThreads.find(t => t.id === id);
  if (!thread) return false;

  thread.lastProgressAt = new Date().toISOString();
  thread.progressNotes.push(formatProgressNote(note));
  // Keep max 10 notes
  if (thread.progressNotes.length > 10) {
    thread.progressNotes = thread.progressNotes.slice(-10);
  }
  if (thread.status === 'paused') {
    thread.status = 'active'; // resume on progress
  }

  await saveState(state);
  return true;
}

export async function completeThread(id: string, note?: string): Promise<boolean> {
  const state = await loadState();
  const thread = state.activeThreads.find(t => t.id === id);
  if (!thread) return false;

  thread.status = 'completed';
  thread.lastProgressAt = new Date().toISOString();
  if (note) {
    thread.progressNotes.push(formatProgressNote(note));
  }

  await saveState(state);
  return true;
}

export async function pauseThread(id: string, note?: string): Promise<boolean> {
  const state = await loadState();
  const thread = state.activeThreads.find(t => t.id === id);
  if (!thread) return false;

  thread.status = 'paused';
  if (note) {
    thread.progressNotes.push(formatProgressNote(note));
  }

  await saveState(state);
  return true;
}

function formatProgressNote(note: string): string {
  const date = new Date().toISOString().slice(5, 10); // MM-DD
  return `${date}: ${note.slice(0, 80)}`;
}

// =============================================================================
// Build <temporal> Section for Context
// =============================================================================

const TEMPORAL_MAX_CHARS = 800;

export async function buildTemporalSection(): Promise<string | null> {
  let state: TemporalState;
  try {
    state = await loadState();
  } catch {
    return null;
  }

  // No data yet
  if (Object.keys(state.topicHeat).length === 0 && state.recentDays.length === 0) {
    return null;
  }

  const now = new Date();
  const timeStr = now.toLocaleString('zh-TW', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts: string[] = [];

  // Header with day count
  const dayCount = state.daysSinceBoot ?? '?';
  parts.push(`Now: ${timeStr} (day ${dayCount})`);

  // Recent days
  if (state.recentDays.length > 0) {
    parts.push('');
    parts.push('Last days:');
    for (const day of state.recentDays) {
      const themes = day.themes.slice(0, 3).join(', ');
      parts.push(`  ${day.date.slice(5)}: ${day.cycles}cy, ${day.actions}act — ${themes}`);
      if (day.highlight) {
        parts.push(`    ★ ${day.highlight}`);
      }
    }
  }

  // Topic heat
  const heatEntries = Object.entries(state.topicHeat)
    .sort((a, b) => b[1].touchCount7d - a[1].touchCount7d);

  if (heatEntries.length > 0) {
    parts.push('');
    parts.push('Topic heat (7d):');
    for (const [topic, heat] of heatEntries) {
      const icon = heat.trend === 'warming' ? '🔥'
        : heat.touchCount7d >= 3 ? '📚' : '💤';
      const ago = formatTimeAgo(heat.lastTouch);
      parts.push(`  ${icon} ${topic} (${heat.touchCount7d}t, ${heat.trend}) — ${ago}`);
    }
  }

  // Active threads
  const activeThreads = state.activeThreads.filter(t => t.status === 'active');
  const pausedThreads = state.activeThreads.filter(t => t.status === 'paused');

  if (activeThreads.length > 0 || pausedThreads.length > 0) {
    parts.push('');
    if (activeThreads.length > 0) {
      parts.push('Active threads:');
      for (const t of activeThreads) {
        const dayCount = Math.ceil((Date.now() - new Date(t.startedAt).getTime()) / 86_400_000);
        const ago = formatTimeAgo(t.lastProgressAt);
        parts.push(`  📌 ${t.title} (day ${dayCount}, last: ${ago})`);
        const latest = t.progressNotes[t.progressNotes.length - 1];
        if (latest) parts.push(`     Latest: ${latest}`);
      }
    }
    if (pausedThreads.length > 0) {
      parts.push('Paused threads:');
      for (const t of pausedThreads) {
        const ago = formatTimeAgo(t.lastProgressAt);
        parts.push(`  ⏸ ${t.title} (paused, last: ${ago})`);
      }
    }
  }

  let result = parts.join('\n');

  // Enforce hard limit
  if (result.length > TEMPORAL_MAX_CHARS) {
    // Trim highlights first, then paused threads
    result = result.slice(0, TEMPORAL_MAX_CHARS - 3) + '...';
  }

  return result;
}

// =============================================================================
// Thread Convergence Detection — 偵測 active threads 之間的共享概念
// =============================================================================

/**
 * 偵測 active threads 之間的概念交叉
 * 提取 progress notes 中的 Capitalized terms（人名、術語、框架）
 * 兩個 threads 共享 2+ 概念時產生 hint
 */
function detectThreadConvergence(threads: ActiveThread[]): string[] {
  const activeThreads = threads.filter(t => t.status === 'active');
  if (activeThreads.length < 2) return [];

  const hints: string[] = [];

  for (let i = 0; i < activeThreads.length; i++) {
    for (let j = i + 1; j < activeThreads.length; j++) {
      const a = activeThreads[i];
      const b = activeThreads[j];
      // Extract Capitalized multi-word terms from progress notes + title
      const textA = [a.title, ...a.progressNotes].join(' ');
      const textB = [b.title, ...b.progressNotes].join(' ');
      const wordsA = new Set(textA.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? []);
      const wordsB = new Set(textB.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? []);
      const shared = [...wordsA].filter(w => wordsB.has(w));
      if (shared.length >= 2) {
        hints.push(`Threads 「${a.title}」and 「${b.title}」share concepts: ${shared.join(', ')}. Consider cross-pollinating or merging.`);
      }
    }
  }
  return hints;
}

// =============================================================================
// Build Active Threads Section for Autonomous Prompt
// =============================================================================

export async function buildThreadsPromptSection(): Promise<string | null> {
  let state: TemporalState;
  try {
    state = await loadState();
  } catch {
    return null;
  }

  const activeThreads = state.activeThreads.filter(t => t.status === 'active');
  if (activeThreads.length === 0) return null;

  const lines: string[] = [
    '## Active Threads',
    'You have ongoing thought threads. Consider whether this cycle should advance one:',
  ];

  for (const t of activeThreads) {
    const dayCount = Math.ceil((Date.now() - new Date(t.startedAt).getTime()) / 86_400_000);
    lines.push(`- 「${t.title}」(${dayCount} days, ${t.progressNotes.length} notes)`);
  }

  // Convergence hints
  const convergenceHints = detectThreadConvergence(state.activeThreads);
  if (convergenceHints.length > 0) {
    lines.push('');
    lines.push('### Convergence Detected');
    for (const hint of convergenceHints) {
      lines.push(`- ${hint}`);
    }
  }

  lines.push('');
  lines.push('You are NOT obligated to work on these. But if your perception signals or curiosity naturally connect to a thread, follow that connection. Use [THREAD progress="id"]note[/THREAD] to record progress.');

  return lines.join('\n');
}

// =============================================================================
// Build Threads Section for Context (reads from memory/threads/*.md files)
// =============================================================================

export function buildThreadsContextSection(): string | null {
  const threadsDir = path.join(process.cwd(), 'memory', 'threads');
  if (!fsSync.existsSync(threadsDir)) return null;

  let files: string[];
  try {
    files = fsSync.readdirSync(threadsDir).filter(f => f.endsWith('.md'));
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  const activeThreads: string[] = [];
  for (const file of files) {
    try {
      const content = fsSync.readFileSync(path.join(threadsDir, file), 'utf-8');
      if (content.includes('Status: active')) {
        activeThreads.push(summarizeThread(content));
      }
    } catch {
      // skip unreadable files
    }
  }

  if (activeThreads.length === 0) return null;

  return activeThreads.join('\n---\n');
}

/**
 * Summarize a thread file: Meta + last 3 Trail entries + Next
 */
function summarizeThread(content: string): string {
  const lines = content.split('\n');
  const parts: string[] = [];

  // Title line
  const titleLine = lines.find(l => l.startsWith('# Thread:'));
  if (titleLine) parts.push(titleLine);

  // Meta section (Status + Touches)
  const statusLine = lines.find(l => l.includes('Status:'));
  const touchesLine = lines.find(l => l.includes('Touches:'));
  if (statusLine || touchesLine) {
    parts.push(`${statusLine ?? ''} ${touchesLine ? `| ${touchesLine.trim()}` : ''}`);
  }

  // Trail — last 3 entries
  const trailEntries = lines.filter(l => l.startsWith('- ['));
  if (trailEntries.length > 0) {
    parts.push('Trail:');
    const recent = trailEntries.slice(-3);
    for (const entry of recent) {
      parts.push(addTemporalMarkers(entry));
    }
  }

  // Next section
  const nextIdx = lines.findIndex(l => l.startsWith('## Next'));
  if (nextIdx >= 0 && nextIdx + 1 < lines.length) {
    const nextContent = lines.slice(nextIdx + 1).join('\n').trim();
    if (nextContent) {
      parts.push(`Next: ${nextContent.slice(0, 150)}`);
    }
  }

  return parts.join('\n');
}

// =============================================================================
// Helpers
// =============================================================================

function formatTimeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
