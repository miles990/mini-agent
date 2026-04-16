/**
 * CLAUDE.md JIT Loading — keyword-based section filtering
 *
 * Reads CLAUDE.md at startup, splits by ## headings, and provides
 * keyword-matched content to reduce token usage in OODA cycles.
 *
 * Pattern: same as skill JIT (getSkillsPrompt in memory.ts).
 * Conservative matching: any keyword hit → load section.
 * Fallback: no JIT match → load full content.
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface ClaudeMdSection {
  heading: string;
  content: string;
  keywords: string[];
  isCore: boolean;
}

// =============================================================================
// Section Classification
// =============================================================================

/** Core sections — always loaded regardless of context.
 *  Keep this MINIMAL — every core section adds to every cycle's prompt.
 *  Verbose reference sections (Key Files, Deploy, etc.) should be JIT. */
const CORE_HEADINGS = new Set([
  '核心原則',
  '進化核心約束（Meta-Constraints）',
]);

/**
 * JIT section keywords — conservative matching (any hit → load).
 * Keywords are lowercase for case-insensitive matching.
 * Sections not listed here and not in CORE_HEADINGS → always loaded (safe default).
 */
/** Max chars for JIT output — prevents prompt bloat when many sections match.
 *  System prompt is ~5K + this cap + skills + cycle prompt.
 *  At 20K cap: total non-context ≈ 35-40K, leaving room for 30K+ context. */
const JIT_OUTPUT_CAP = 10_000;  // lowered from 20K: non-context overhead (system+skills+JIT+cycle) was ~45K, pushing total prompt over 60K HARD_CAP

const SECTION_KEYWORDS: Record<string, string[]> = {
  '設計理念': [
    'design', 'philosophy', 'perception-driven', 'goal-driven', 'physarum',
    'transparency', 'isolation', 'audit', 'platform', '設計',
  ],
  '三層架構': [
    'architecture', 'layer', '三層', 'perception', 'skills', 'execute',
    'l1', 'l2', 'l3', 'proposal', 'forge',
  ],
  'Code Conventions': [
    'code', 'convention', 'typescript', 'strict', 'import', 'naming',
    'lint', 'field name', 'mismatch', 'html', 'cors',
  ],
  'Workflow': [
    'workflow', 'commit', 'staging', 'plan', 'implement', 'typecheck',
    'architecture decision', 'tool call', 'file edit',
  ],
  '詳細文件': [
    'document', 'architecture.md', 'reference', 'detail',
  ],
  '學以致用閉環（Action from Learning）': [
    'l1', 'l2', 'l3', 'self-improve', 'action from learning', 'proposal', 'forge',
  ],
  'Key Files': [
    'key file', 'src/', 'scripts/', 'plugins/', 'skills/', 'tools/',
    'file structure', 'codebase',
  ],
  'Commands': [
    'pnpm', 'mini-agent', 'command', 'build', 'test', 'typecheck',
  ],
  'Environment': [
    'port', 'env', 'cdp_', 'telegram_', 'mini_agent_',
  ],
  'Deploy': [
    'deploy', 'ci/cd', 'github actions', 'launchd', 'plist',
  ],
  'Deployment': [
    'deploy', 'ci/cd', 'typecheck', 'push',
  ],
  'Memory Architecture': [
    'memory', 'remember', 'topic', 'checkpoint', 'auto-commit', 'auto-push',
    'conversation', 'thread', 'NEXT.md', 'HEARTBEAT', 'buildcontext',
  ],
  'Search System（語義搜尋）': [
    'search', 'fts5', 'index', 'query', 'bm25', 'searchmemory',
  ],
  'Intelligent Feedback Loops（Phase 2 自我學習）': [
    'feedback', 'error-pattern', 'perception-citation', 'decision-quality',
    'feedback-loop', 'observabilityscore',
  ],
  'Achievement System（行動力正向強化）': [
    'achievement', 'milestone', 'unlock', 'output gate', 'schedule ceiling',
  ],
  'Unified Pulse System（反射弧回饋）': [
    'pulse', 'reflex', 'signal', 'habituation', 'behavioral', 'momentum',
  ],
  'Action Feedback Loop Skills（行動正向閉環）': [
    'friction', 'publish', 'social-presence', 'social-monitor', 'grow-audience',
    'publish-content',
  ],
  'GitHub Closed-Loop Workflow': [
    'github', 'issue', 'pr ', 'merge', 'gh ', 'pull request', 'auto-merge',
    'triage', 'github-issues', 'github-prs',
  ],
  'Multi-Lane Architecture': [
    'lane', 'foreground', 'background', 'delegate', 'preempt', 'tentacle',
    'multi-lane', 'delegation', 'dispatcher', 'loop.ts', 'modular',
    'event priority', 'crash resume',
  ],
  'Forge — Worktree Isolation for Delegations': [
    'forge', 'worktree', 'isolation', 'sandbox', 'forge-lite',
  ],
  'Reactive Architecture': [
    'eventbus', 'event-bus', 'perception-stream', 'debounce', 'throttle',
    'observability', 'subscriber', 'reactive',
  ],
  'Mobile Perception（手機感知）': [
    'mobile', 'sensor', 'gps', 'accelero', 'phone', 'pwa',
  ],
  'Library System（來源藏書室）': [
    'library', 'archive', 'catalog', 'ref:', 'cited', 'source',
  ],
  'Team Chat Room（團隊聊天室）': [
    'room', 'chat-room', 'jsonl', 'inbox', 'chat room', '/api/room',
  ],
  'Auditory Perception（聽覺感知）': [
    'audio', 'music', 'whisper', 'transcri', 'spectrogram', 'essentia',
  ],
  '可觀測性（Observability）': [
    'slog', 'diaglog', 'observability', 'behavior log', 'safeexec',
  ],
  'Agent Tags': [
    'tag', 'kuro:', 'parsetags', 'postprocess', '<kuro:',
  ],
  'Telegram 通知系統': [
    'telegram', 'notify', 'notification', 'notifytelegram', 'sendtelegram',
  ],
  'GET /status — 統一狀態 API': [
    '/status', 'health', 'get /status', 'agent_status',
  ],
  '協作模型（Alex + Claude Code + Kuro）': [
    'claude code', 'claude-code', 'mcp', 'collaborate', 'handoff',
    'announce', 'chat room', '/api/room', 'session worker',
    'agent_chat', 'agent_discuss', 'agent_ask',
  ],
  'Handoff Protocol v2（兩層制）': [
    'handoff', 'active.md', 'pending', 'approved', 'delegate',
  ],
  '行為準則 — 從實踐中長出來的方法論（2026-03-08）': [
    'methodology', '槓桿', '複利', '黏菌', 'anti-fragile', '反脆弱',
    '行為準則', '戰略',
  ],
  'Kuro Agent Debugging': [
    'debug', 'timestamp', 'utc', 'server.log', 'truncat',
  ],
  '自主解決問題': [
    'problem', 'debug', 'diagnose', 'troubleshoot', 'cdp-fetch',
    'chrome cdp', 'grok', 'tool',
  ],
  'Agent MCP Server + Remote Control': [
    'mcp', 'agent_ask', 'agent_chat', 'agent_discuss', 'remote',
    'mcp-server', 'mcp-agent',
  ],
  'kuro-sense — 感知能力管理工具': [
    'kuro-sense', 'detect', 'apply', 'agent-compose',
  ],
  'Account Switch Scripts（帳號切換）': [
    'switch', 'alex-switch', 'alex-done', 'keychain',
  ],
  'mushi — System 1 直覺層': [
    'mushi', 'triage', 'system 1', 'system 2', 'hc1',
  ],
};

// =============================================================================
// Parser
// =============================================================================

let sectionsCache: ClaudeMdSection[] | null = null;
let fullContentCache: string | null = null;

function isCoreLike(heading: string): boolean {
  // Exact match
  if (CORE_HEADINGS.has(heading)) return true;
  // Partial match (heading contains a core name)
  for (const core of CORE_HEADINGS) {
    if (heading.includes(core)) return true;
  }
  return false;
}

function parseClaudeMd(): ClaudeMdSection[] {
  const filePath = path.join(process.cwd(), 'CLAUDE.md');
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    fullContentCache = content;

    const sections: ClaudeMdSection[] = [];
    const lines = content.split('\n');

    let currentHeading = '';
    let currentLines: string[] = [];

    for (const line of lines) {
      // Only split on ## (h2), not ### (h3) — subsections stay with parent
      const headingMatch = line.match(/^## (.+)/);
      if (headingMatch) {
        // Save previous section
        if (currentLines.length > 0) {
          sections.push(buildSection(currentHeading, currentLines));
        }
        currentHeading = headingMatch[1].trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }
    // Save last section
    if (currentLines.length > 0) {
      sections.push(buildSection(currentHeading, currentLines));
    }

    return sections;
  } catch (err) {
    slog('CLAUDEMD-JIT', `Failed to parse CLAUDE.md: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function buildSection(heading: string, lines: string[]): ClaudeMdSection {
  const isCore = heading === '' || isCoreLike(heading);

  // Find keywords for this section
  let keywords: string[] = [];
  for (const [sectionName, kws] of Object.entries(SECTION_KEYWORDS)) {
    if (heading === sectionName || heading.includes(sectionName) || sectionName.includes(heading)) {
      keywords = kws;
      break;
    }
  }

  return {
    heading,
    content: lines.join('\n'),
    keywords,
    isCore,
  };
}

// =============================================================================
// Public API
// =============================================================================

/** Initialize cache at startup. Call once from index.ts or similar. */
export function initClaudeMdJIT(): void {
  sectionsCache = parseClaudeMd();
  const coreCount = sectionsCache.filter(s => s.isCore).length;
  const jitCount = sectionsCache.filter(s => !s.isCore).length;
  const coreLines = sectionsCache.filter(s => s.isCore).reduce((n, s) => n + s.content.split('\n').length, 0);
  const jitLines = sectionsCache.filter(s => !s.isCore).reduce((n, s) => n + s.content.split('\n').length, 0);
  slog('CLAUDEMD-JIT', `Parsed ${sectionsCache.length} sections: ${coreCount} core (${coreLines} lines), ${jitCount} JIT (${jitLines} lines)`);
}

/**
 * Get CLAUDE.md content filtered by keyword matching.
 *
 * @param hint — prompt + context text used for keyword matching
 * @returns filtered CLAUDE.md content (core + matched JIT sections)
 */
export function getClaudeMdJIT(hint?: string): string {
  if (!sectionsCache) {
    sectionsCache = parseClaudeMd();
  }

  // No sections parsed (file missing?) → return empty
  if (sectionsCache.length === 0) {
    return fullContentCache ?? '';
  }

  // No hint → full content (fallback for safety)
  if (!hint) {
    return sectionsCache.map(s => s.content).join('\n');
  }

  const lowerHint = hint.toLowerCase();
  const selected: ClaudeMdSection[] = [];
  const jitMatched: string[] = [];

  for (const section of sectionsCache) {
    if (section.isCore) {
      selected.push(section);
      continue;
    }

    // No keywords defined for this section → always load (safe default)
    if (section.keywords.length === 0) {
      selected.push(section);
      continue;
    }

    // Conservative keyword matching: any keyword hit → load
    if (section.keywords.some(k => lowerHint.includes(k))) {
      selected.push(section);
      jitMatched.push(section.heading);
    }
  }

  // Fallback: if zero JIT sections matched, load core only (not everything)
  // Loading everything defeats the purpose of JIT when no keywords match
  const coreOnlyCount = sectionsCache.filter(s => s.isCore || s.keywords.length === 0).length;
  if (selected.length <= coreOnlyCount) {
    // Just use the already-selected core sections — don't load all
  }

  // ── Size cap: prevent prompt bloat when many JIT sections match ──
  let result = '';
  let includedCount = 0;
  for (const s of selected) {
    if (result.length + s.content.length > JIT_OUTPUT_CAP && includedCount > 0) {
      break; // Stop adding sections once cap is reached (always include at least 1)
    }
    result += (result ? '\n' : '') + s.content;
    includedCount++;
  }

  const omittedCount = sectionsCache.length - includedCount;
  const elisionNote = omittedCount > 0
    ? `\n\n<!-- ${omittedCount} CLAUDE.md sections omitted (not relevant to current context). Full docs in CLAUDE.md file. -->\n`
    : '';

  return result + elisionNote;
}

/** Get stats for observability */
export function getClaudeMdJITStats(): { totalSections: number; coreSections: number; jitSections: number } {
  if (!sectionsCache) sectionsCache = parseClaudeMd();
  return {
    totalSections: sectionsCache.length,
    coreSections: sectionsCache.filter(s => s.isCore).length,
    jitSections: sectionsCache.filter(s => !s.isCore).length,
  };
}
