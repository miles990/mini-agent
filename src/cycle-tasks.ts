/**
 * Cycle Tasks — standalone functions called at end of each OODA cycle.
 *
 * Extracted from loop.ts for modularity.
 * All functions are fire-and-forget (non-blocking).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { notifyTelegram } from './telegram.js';
import { getMemory } from './memory.js';
// markNextItemsDone removed — loop.ts now calls markTaskDoneByDescription from memory-index.ts directly
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { CHAT_ROOM_INBOX_PATH } from './inbox-processor.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export interface BehaviorMode {
  name: string;
  weight: number;
  description: string;
}

export interface BehaviorConfig {
  modes: BehaviorMode[];
  cooldowns: { afterAction: number; afterNoAction: number };
  focus?: { topic: string; why?: string; until?: string };
}

// =============================================================================
// Behavior Config Parser
// =============================================================================

/** Parse memory/behavior.md content into BehaviorConfig */
export function parseBehaviorConfig(content: string): BehaviorConfig | null {
  try {
    // Parse modes: ### name + Weight: N + description line(s)
    const modes: BehaviorMode[] = [];
    const modeRegex = /### (\S+)\s*\nWeight:\s*(\d+)\s*\n([\s\S]*?)(?=\n###|\n## |$)/g;
    let match: RegExpExecArray | null;

    // Only search within ## Modes section
    const modesSection = content.match(/## Modes\s*\n([\s\S]*?)(?=\n## [^M]|$)/);
    if (!modesSection) return null;

    while ((match = modeRegex.exec(modesSection[1])) !== null) {
      const weight = Math.max(0, Math.min(100, parseInt(match[2], 10)));
      const desc = match[3].trim();
      if (desc) {
        modes.push({ name: match[1], weight, description: desc });
      }
    }

    if (modes.length === 0) return null;

    // Normalize weights to sum to 100
    const totalWeight = modes.reduce((sum, m) => sum + m.weight, 0);
    if (totalWeight > 0 && totalWeight !== 100) {
      for (const m of modes) {
        m.weight = Math.round((m.weight / totalWeight) * 100);
      }
    }

    // Parse cooldowns
    const afterActionMatch = content.match(/after-action:\s*(\d+)/);
    const afterNoActionMatch = content.match(/after-no-action:\s*(\d+)/);
    const cooldowns = {
      afterAction: afterActionMatch ? Math.max(1, Math.min(10, parseInt(afterActionMatch[1], 10))) : 0,
      afterNoAction: afterNoActionMatch ? Math.max(1, Math.min(10, parseInt(afterNoActionMatch[1], 10))) : 0,
    };

    // Parse focus
    const topicMatch = content.match(/^topic:\s*(.+)/m);
    const whyMatch = content.match(/^why:\s*(.+)/m);
    const untilMatch = content.match(/^until:\s*(.+)/m);
    const topic = topicMatch?.[1]?.trim();
    const focus = topic
      ? { topic, why: whyMatch?.[1]?.trim(), until: untilMatch?.[1]?.trim() }
      : undefined;

    return { modes, cooldowns, focus };
  } catch {
    return null;
  }
}

// =============================================================================
// Interval Parser
// =============================================================================

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

/** Parse interval string like "5m", "30s", "1h" to milliseconds */
export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return DEFAULT_INTERVAL_MS;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: return DEFAULT_INTERVAL_MS;
  }
}

// =============================================================================
// Handoff — Approved Proposals -> Handoff Files
// =============================================================================

/**
 * Check memory/proposals/ for Status: approved proposals,
 * auto-create corresponding handoff task files in memory/handoffs/.
 */
export async function checkApprovedProposals(): Promise<void> {
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

      if (!content.includes('Status: approved')) continue;

      const handoffFile = path.join(handoffsDir, file);
      if (fs.existsSync(handoffFile)) continue;

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
      eventBus.emit('action:handoff', { file, title });
      slog('HANDOFF', `Auto-created handoff for: ${title}`);

      // Notify Claude Code (write to inbox)
      try {
        const inboxPath = path.join(
          process.env.HOME ?? '/tmp', '.mini-agent', 'claude-code-inbox.md',
        );
        if (fs.existsSync(inboxPath)) {
          const inboxContent = fs.readFileSync(inboxPath, 'utf-8');
          const ts = new Date().toLocaleString('sv-SE', {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).slice(0, 16);
          const msg = `- [${ts}] [Handoff] New task pending: ${title} (from proposal: ${file})`;
          const updated = inboxContent.replace('## Pending\n', `## Pending\n${msg}\n`);
          fs.writeFileSync(inboxPath, updated, 'utf-8');
        }
      } catch { /* notification non-critical */ }

      notifyTelegram(`📋 新 Handoff：${title}\n來源：proposals/${file}\n指派：claude-code`).catch(() => {});
    } catch {
      // Single file failure doesn't affect others
    }
  }
}

// =============================================================================
// Conversation Thread Cleanup
// =============================================================================

/**
 * Resolve stale ConversationThreads. Runs every cycle (fire-and-forget).
 *
 * Rules:
 * - Replied room threads: auto-resolve after 1h (cooldown for context)
 * - Non-room thread types: auto-expire after 24h
 * - If thread id/roomMsgId appears in chat-room-inbox, skip TTL expiry
 * - Room threads: also resolve when chat-room-inbox has no pending/unaddressed
 */
export async function resolveStaleConversationThreads(actionText?: string): Promise<void> {
  const memory = getMemory();
  const threads = await memory.getConversationThreads();
  const now = Date.now();
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const REPLIED_RESOLVE_MS = 60 * 60 * 1000; // 1h

  const toResolve: string[] = [];
  const inboxContent = fs.existsSync(CHAT_ROOM_INBOX_PATH)
    ? fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8')
    : '';
  const repliedAtByMsgId = new Map<string, number>();
  for (const m of inboxContent.matchAll(/\[(\d{4}-\d{2}-\d{2}-\d+)\][^\n]*→\s*replied\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g)) {
    const repliedAtMs = new Date(m[2].replace(' ', 'T') + ':00').getTime();
    if (Number.isFinite(repliedAtMs)) repliedAtByMsgId.set(m[1], repliedAtMs);
  }

  const isPinnedByInbox = (thread: (typeof threads)[number]): boolean => {
    const candidates = [thread.id, thread.roomMsgId].filter(Boolean) as string[];
    return candidates.some(id => inboxContent.includes(id));
  };

  // Rule 0: Auto-resolve threads whose URL was referenced in this cycle's response.
  // Fixes: Telegram share threads being re-answered every cycle because they lack
  // a "replied" marker. If the full response contains the thread's URL, it's been addressed.
  if (actionText) {
    const urlsInAction: string[] = actionText.match(/https?:\/\/[^\s<>"]+/g) ?? [];
    for (const t of threads) {
      if (t.resolvedAt) continue;
      if (toResolve.includes(t.id)) continue;
      const urlsInThread: string[] = t.content.match(/https?:\/\/[^\s<>"]+/g) ?? [];
      if (urlsInThread.some(u => urlsInAction.includes(u))) {
        toResolve.push(t.id);
      }
    }
  }

  // Rule 0.5: When Kuro chatted this cycle, auto-resolve old telegram share/question threads.
  // These threads lack a "replied" marker (no roomMsgId), so Rule 1 can't catch them.
  // If Kuro produced <kuro:chat> in this cycle, it likely addressed the share visible in context.
  const SHARE_CHAT_RESOLVE_AGE_MS = 30 * 60 * 1000; // 30min — don't resolve brand-new shares
  if (actionText && /<kuro:chat>/.test(actionText)) {
    for (const t of threads) {
      if (t.resolvedAt) continue;
      if (toResolve.includes(t.id)) continue;
      if (t.source?.startsWith('room:')) continue; // room threads have their own rules (Rule 1/3)
      if (t.source === 'kuro:ask') continue; // ask threads wait for Alex
      if (t.type !== 'share' && t.type !== 'question') continue;
      const ageMs = now - new Date(t.createdAt).getTime();
      if (ageMs >= SHARE_CHAT_RESOLVE_AGE_MS) {
        toResolve.push(t.id);
      }
    }
  }

  // Rule 1: Replied room threads auto-resolve after 1h.
  for (const t of threads) {
    if (t.resolvedAt) continue;
    if (!t.roomMsgId) continue;
    const repliedAtMs = repliedAtByMsgId.get(t.roomMsgId);
    if (!repliedAtMs) continue;
    if (now - repliedAtMs >= REPLIED_RESOLVE_MS) {
      toResolve.push(t.id);
    }
  }

  // Rule 2: Auto-expire unanswered threads older than TTL.
  // - Telegram share/question threads: 2h TTL (Kuro should respond within a few cycles)
  // - Other non-room threads: 24h TTL
  // - Room threads: 4h TTL (shorter — room conversations are ephemeral)
  // Exceptions:
  // - 'kuro:ask' threads — Alex may take days to reply
  // - Threads pinned by inbox message references (id/roomMsgId)
  const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4h — room threads are conversational, shouldn't linger
  const TELEGRAM_SHARE_TTL_MS = 2 * 60 * 60 * 1000; // 2h — safety net for shares not caught by Rule 0/0.5
  for (const t of threads) {
    if (t.resolvedAt) continue;
    if (toResolve.includes(t.id)) continue;
    if (t.source === 'kuro:ask') continue;
    if (isPinnedByInbox(t)) continue;
    const ageMs = now - new Date(t.createdAt).getTime();
    const isRoom = t.source?.startsWith('room:');
    const isTelegramShare = !isRoom && (t.type === 'share' || t.type === 'question');
    const ttl = isRoom ? ROOM_TTL_MS : isTelegramShare ? TELEGRAM_SHARE_TTL_MS : PENDING_TTL_MS;
    if (ageMs > ttl) {
      toResolve.push(t.id);
    }
  }

  // Rule 3: Resolve room threads when inbox is clear.
  const hasPending = /## Pending\n- \[/.test(inboxContent);
  const hasUnaddressed = /## Unaddressed\n- \[/.test(inboxContent);

  if (!hasPending && !hasUnaddressed) {
    for (const t of threads) {
      if (t.resolvedAt) continue;
      if (!t.source?.startsWith('room:')) continue;
      if (!toResolve.includes(t.id)) {
        toResolve.push(t.id);
      }
    }
  }

  // Resolve via Memory API
  for (const id of toResolve) {
    await memory.resolveConversationThread(id);
  }
}

// =============================================================================
// Auto-Escalate Overdue Tasks
// =============================================================================

/**
 * Scan HEARTBEAT.md for overdue unchecked tasks, promote to P0.
 * Fire-and-forget, called after each OODA cycle.
 */
export async function autoEscalateOverdueTasks(): Promise<void> {
  const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
  if (!fs.existsSync(heartbeatPath)) return;

  try {
    const content = fs.readFileSync(heartbeatPath, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    let escalated = 0;

    const lines = content.split('\n');
    const updated = lines.map(line => {
      if (!line.match(/^\s*- \[ \]/)) return line;
      const dueMatch = line.match(/@due:(\d{4}-\d{2}-\d{2})/);
      if (!dueMatch) return line;

      const dueDate = dueMatch[1];
      if (dueDate > today) return line;

      if (line.includes('P0')) return line;

      escalated++;
      if (line.match(/P[1-3]/)) {
        return line.replace(/P[1-3]/, 'P0 ⚠️OVERDUE');
      }
      return line.replace('- [ ] ', '- [ ] P0 ⚠️OVERDUE ');
    });

    if (escalated > 0) {
      fs.writeFileSync(heartbeatPath, updated.join('\n'), 'utf-8');
      slog('ESCALATE', `Promoted ${escalated} overdue task(s) to P0 in HEARTBEAT.md`);
    }
  } catch {
    // Silent failure
  }
}

// =============================================================================
// Auto-Commit — memory/ directory only
// =============================================================================

const MEMORY_COMMIT_PATHS = ['memory/'];

// Ephemeral files inside memory/ that should NOT trigger auto-commits.
// These churn every cycle and produce ~78% of commit noise (see
// mesh-output/git-hygiene-audit-2026-04-12.md). Excluded here at stage time
// so the file isn't added; users can still commit them manually.
const MEMORY_COMMIT_EXCLUDE_BASENAMES = new Set([
  'inner-notes.md',
  'pulse-state.json',
  'tracking-notes.md',
]);

// External repos — only Kuro's own projects
const KURO_EXTERNAL_REPOS = [
  path.join(os.homedir(), 'Workspace', 'mushi'),
  path.join(os.homedir(), 'Workspace', 'metsuke'),
];

function isExcludedMemoryFile(relPath: string): boolean {
  return MEMORY_COMMIT_EXCLUDE_BASENAMES.has(path.basename(relPath));
}

/**
 * Use local LLM to generate a meaningful commit message from diff.
 * Falls back to action summary if LLM fails.
 */
/**
 * Use local LLM to generate a meaningful commit message from diff.
 * Async — previously execFileSync with 30s timeout blocked the main event loop
 * under slow local-LLM conditions, producing 30-220s lag spikes (2026-04-18
 * diagnosis: cycle-tasks.ts:405 was the primary main-thread stall source).
 * Falls back to action summary if LLM fails or times out.
 */
async function generateCommitMessage(diff: string, fileList: string, fallback: string): Promise<string> {
  if (!diff.trim() || diff.length < 20) return `chore(auto): ${fallback}\n\nFiles: ${fileList}`;
  try {
    const localScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../scripts/local-delegate.mjs');
    const prompt = `Write a concise git commit message (1 line, max 72 chars) for these memory file changes. Use format "chore(memory): <description>". Only output the commit message, nothing else.\n\n${diff.slice(0, 2000)}`;
    const child = execFile('node', [localScript], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, LOCAL_LLM_PROFILE: 'fast' },
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
    const stdout = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout?.on('data', (chunk: Buffer | string) => { out += chunk.toString(); });
      child.on('error', reject);
      child.on('close', () => resolve(out));
    });
    const line = stdout.trim().split('\n')[0].slice(0, 120);
    if (line.length > 10) return `${line}\n\nFiles: ${fileList}`;
  } catch { /* fallback */ }
  return `chore(auto): ${fallback}\n\nFiles: ${fileList}`;
}

export async function autoCommitMemoryFiles(action: string | null): Promise<void> {
  const cwd = process.cwd();
  const fallbackSummary = action
    ? action.replace(/\[.*?\]\s*/, '').slice(0, 80)
    : 'auto-save';

  try {
    const { stdout: status } = await execFileAsync(
      'git', ['status', '--porcelain', ...MEMORY_COMMIT_PATHS],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );

    if (!status.trim()) return;

    // porcelain 格式 "XY PATH" — X 可能是 space（worktree-modified），整串 trim 會吃掉首行的 X，slice(3) 就會吃掉路徑首字
    const changedFiles = status.split('\n').filter(l => l.length >= 4).map(l => l.slice(3));
    const commitableFiles = changedFiles.filter(f => !isExcludedMemoryFile(f));
    if (!commitableFiles.length) {
      slog('auto-commit', `skipped: only ephemeral files (${changedFiles.length})`);
      return;
    }

    await execFileAsync(
      'git', ['add', '--', ...commitableFiles],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );

    // Get staged diff for LLM commit message generation
    const fileList = commitableFiles.slice(0, 5).join(', ');
    let diff = '';
    try {
      const { stdout: d } = await execFileAsync(
        'git', ['diff', '--cached', '--stat', '--', ...commitableFiles],
        { cwd, encoding: 'utf-8', timeout: 5000 },
      );
      diff = d;
    } catch { /* use fallback */ }

    const msg = await generateCommitMessage(diff, fileList, fallbackSummary);

    await execFileAsync(
      'git', ['commit', '-m', msg],
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );

    slog('auto-commit', `${commitableFiles.length} file(s): ${fileList}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('nothing to commit')) {
      slog('auto-commit', `skipped: ${msg.slice(0, 120)}`);
    }
  }
}


/**
 * Auto-commit+push external repos (separate git repos like mushi).
 * Fire-and-forget, called after autoCommitMemoryFiles.
 */
export async function autoCommitExternalRepos(): Promise<void> {
  for (const dir of KURO_EXTERNAL_REPOS) {
    const entry = path.basename(dir);
    try {
      if (!fs.existsSync(path.join(dir, '.git'))) continue;

      const { stdout: status } = await execFileAsync(
        'git', ['status', '--porcelain'],
        { cwd: dir, encoding: 'utf-8', timeout: 5000 },
      );

      if (!status.trim()) continue;

      // porcelain 格式 "XY PATH" — X 可能是 space（worktree-modified），整串 trim 會吃掉首行的 X，slice(3) 就會吃掉路徑首字
    const changedFiles = status.split('\n').filter(l => l.length >= 4).map(l => l.slice(3));

      await execFileAsync(
        'git', ['add', '-A'],
        { cwd: dir, encoding: 'utf-8', timeout: 5000 },
      );

      const fileList = changedFiles.slice(0, 5).join(', ');
      const msg = `chore(auto): auto-save\n\nFiles: ${fileList}`;

      await execFileAsync(
        'git', ['commit', '-m', msg],
        { cwd: dir, encoding: 'utf-8', timeout: 10000 },
      );

      // Push if remote exists
      try {
        await execFileAsync(
          'git', ['push', 'origin', 'HEAD'],
          { cwd: dir, encoding: 'utf-8', timeout: 30000 },
        );
      } catch { /* no remote or push failed */ }

      slog('auto-commit-ext', `[${entry}] ${changedFiles.length} file(s) committed+pushed: ${fileList}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('nothing to commit')) {
        slog('auto-commit-ext', `[${entry}] skipped: ${errMsg.slice(0, 120)}`);
      }
    }
  }
}

// markNextItemsDone removed — replaced by markTaskDoneByDescription in memory-index.ts

// =============================================================================
// Context Snapshot (Cognitive Mesh Phase 2)
// =============================================================================

export async function writeContextSnapshot(
  cycleCount: number,
  contextSize: number,
  mode: string,
): Promise<void> {
  const instanceId = getCurrentInstanceId();
  const dir = getInstanceDir(instanceId);
  const snapshotPath = path.join(dir, 'context-snapshot.json');

  const snapshot = {
    instanceId,
    timestamp: new Date().toISOString(),
    cycleCount,
    contextSize,
    mode,
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
}
