/**
 * Action Memory — 向內感知：追蹤近期成功行動和行為模式
 *
 * 解析 behavior log 中的 action.autonomous 條目，提取：
 * 1. 工具使用記錄（CDP, curl, gh, cloudflared 等）
 * 2. 行動類別（fix, deploy, create, update 等）
 * 3. 重複行為偵測（同類動作 N 小時內出現 M 次）
 *
 * 輸出為 context section，讓 Kuro 看見自己的能力和模式。
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Tool extraction keywords ──

const TOOL_PATTERNS: Array<{ keywords: string[]; tool: string }> = [
  { keywords: ['cdp', 'cdp-fetch', 'CDP', 'Chrome DevTools', 'chrome'], tool: 'CDP' },
  { keywords: ['cloudflared', 'tunnel', 'Cloudflare tunnel'], tool: 'cloudflared' },
  { keywords: ['gh ', 'gh pr', 'gh issue', 'GitHub API'], tool: 'gh-cli' },
  { keywords: ['curl ', 'curl -', 'fetch(', 'POST /'], tool: 'curl/fetch' },
  { keywords: ['FTS5', 'searchMemory', 'search index'], tool: 'FTS5' },
  { keywords: ['git add', 'git commit', 'git push', 'git diff'], tool: 'git' },
  { keywords: ['pnpm', 'npm ', 'node '], tool: 'node/pnpm' },
  { keywords: ['ffmpeg', 'ffprobe'], tool: 'ffmpeg' },
  { keywords: ['Kokoro', 'TTS', 'tts'], tool: 'Kokoro-TTS' },
  { keywords: ['Puppeteer', 'puppeteer'], tool: 'Puppeteer' },
  { keywords: ['Playwright', 'playwright'], tool: 'Playwright' },
];

// ── Action category extraction ──

const CATEGORY_PATTERNS: Array<{ keywords: string[]; category: string }> = [
  { keywords: ['修復', 'fixed', 'fix:', 'repair', 'debug', '根因'], category: 'fix' },
  { keywords: ['deploy', '部署', 'push', 'CI/CD'], category: 'deploy' },
  { keywords: ['learned', '研究', 'study', 'research', '學到'], category: 'learn' },
  { keywords: ['created', 'wrote', '實作', '新增', 'implement', '建立'], category: 'create' },
  { keywords: ['updated', '更新', 'upgrade', '升級', '改進'], category: 'update' },
  { keywords: ['tunnel', 'Tunnel', 'URL', 'endpoint'], category: 'tunnel' },
  { keywords: ['OAuth', 'login', '登入', '帳號', '註冊'], category: 'auth' },
  { keywords: ['commit', 'merge', 'PR'], category: 'git-ops' },
];

interface ActionRecord {
  timestamp: string;
  tools: string[];
  categories: string[];
  summary: string;
  hoursAgo: number;
}

interface RepetitionAlert {
  category: string;
  count: number;
  windowHours: number;
}

function extractTools(text: string): string[] {
  const found = new Set<string>();
  for (const { keywords, tool } of TOOL_PATTERNS) {
    if (keywords.some(k => text.includes(k))) found.add(tool);
  }
  return [...found];
}

function extractCategories(text: string): string[] {
  const found = new Set<string>();
  for (const { keywords, category } of CATEGORY_PATTERNS) {
    if (keywords.some(k => text.includes(k))) found.add(category);
  }
  return [...found];
}

/** Parse today's behavior log and extract action records */
export function parseActionRecords(instanceDir: string): ActionRecord[] {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(instanceDir, 'logs', 'behavior', `${today}.jsonl`);
  if (!fs.existsSync(logPath)) return [];

  const now = Date.now();
  const records: ActionRecord[] = [];

  try {
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry?.data?.action !== 'action.autonomous') continue;
        const detail = entry.data.detail ?? '';
        if (!detail) continue;

        const ts = new Date(entry.timestamp).getTime();
        const hoursAgo = (now - ts) / 3_600_000;

        // Extract a clean summary: skip Decision boilerplate, find the "What" or first meaningful line
        let summary = detail;
        const whatMatch = detail.match(/## What\n(.+)/);
        const choseMatch = detail.match(/chose: (.+)/);
        if (whatMatch) summary = whatMatch[1];
        else if (choseMatch) summary = choseMatch[1];
        summary = summary.slice(0, 100).replace(/\n/g, ' ').trim();

        records.push({
          timestamp: entry.timestamp,
          tools: extractTools(detail),
          categories: extractCategories(detail),
          summary,
          hoursAgo,
        });
      } catch { /* skip malformed line */ }
    }
  } catch { /* file read error */ }

  return records;
}

// Categories that are naturally frequent — don't flag as repetition
const NORMAL_HIGH_FREQUENCY = new Set(['git-ops', 'deploy', 'update', 'create', 'learn']);

/** Detect repetitive actions within a time window */
export function detectRepetitions(records: ActionRecord[], windowHours = 6, threshold = 5): RepetitionAlert[] {
  const recentRecords = records.filter(r => r.hoursAgo <= windowHours);
  const categoryCounts = new Map<string, number>();

  for (const r of recentRecords) {
    for (const cat of r.categories) {
      if (!NORMAL_HIGH_FREQUENCY.has(cat)) {
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }
    }
  }

  const alerts: RepetitionAlert[] = [];
  for (const [category, count] of categoryCounts) {
    if (count >= threshold) {
      alerts.push({ category, count, windowHours });
    }
  }

  return alerts.sort((a, b) => b.count - a.count);
}

/** Build the <action-memory> context section */
export function buildActionMemorySection(instanceDir: string): string {
  const records = parseActionRecords(instanceDir);
  if (records.length === 0) return '';

  const parts: string[] = [];

  // ── Recent successful actions with tools ──
  const recentWithTools = records
    .filter(r => r.tools.length > 0 && r.hoursAgo <= 12)
    .slice(-8)
    .reverse();

  if (recentWithTools.length > 0) {
    parts.push('Recent actions (tools used):');
    for (const r of recentWithTools) {
      const ago = r.hoursAgo < 1
        ? `${Math.round(r.hoursAgo * 60)}m ago`
        : `${r.hoursAgo.toFixed(1)}h ago`;
      parts.push(`- [${ago}] ${r.tools.join(', ')}: ${r.summary}`);
    }
  }

  // ── Repetition alerts ──
  const alerts = detectRepetitions(records);
  if (alerts.length > 0) {
    parts.push('');
    parts.push('⚠ Repetition detected:');
    for (const a of alerts) {
      parts.push(`- "${a.category}" — ${a.count} times in ${a.windowHours}h. 治標還是治本？`);
    }
  }

  // ── Tool capability summary (last 24h) ──
  const last24h = records.filter(r => r.hoursAgo <= 24);
  const toolCounts = new Map<string, number>();
  for (const r of last24h) {
    for (const t of r.tools) {
      toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
    }
  }
  if (toolCounts.size > 0) {
    const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
    parts.push('');
    parts.push(`Available tools (used today): ${sorted.map(([t, c]) => `${t}(${c}x)`).join(', ')}`);
  }

  return parts.join('\n');
}
