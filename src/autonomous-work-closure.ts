import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  pruneNonActionableRoomTasks,
  queryMemoryIndexSync,
  updateMemoryIndexEntry,
  type MemoryIndexEntry,
} from './memory-index.js';
import { slog } from './utils.js';

export interface ProductVerifierResult {
  product: string;
  status: 'pass' | 'fail' | 'skip';
  summary: string;
  evidence: string[];
  repairTitle?: string;
  verifyCommand?: string;
}

export interface AutonomousWorkClosureResult {
  prunedNonActionable: number;
  completedExpressionTasks: number;
  deduplicatedTasks: number;
  releasedHolds: number;
  completedElapsedProviderHolds: number;
  productRepairsQueued: number;
  productRepairsClosed: number;
  productVerifiers: ProductVerifierResult[];
}

const ACTIVE_STATUSES = ['pending', 'in_progress', 'hold', 'blocked', 'needs-decomposition'];
const TERMINAL_STATUSES = new Set(['completed', 'done', 'abandoned', 'deleted', 'dropped', 'failed']);
const EXPRESSION_TASK_RE = /^\[表達意圖\]|^\[OODA|ooda-expression/i;
const URL_RE = /https?:\/\/[^\s)>\],]+/i;
const AI_TREND_RE = /\bai-trend\b|AI\s*簡報|中文簡介|中文摘要|X上的當日|資料來源沒有x|kuro\.page\/ai-trend/i;

export async function sweepAutonomousWorkClosure(
  memoryDir: string,
  options: { repoRoot?: string; now?: Date } = {},
): Promise<AutonomousWorkClosureResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const now = options.now ?? new Date();
  const productVerifiers = [verifyAiTrendClosure(repoRoot)];
  const completedExpressionTasks = await completeTerminalExpressionTasks(memoryDir, now);
  const pruned = await pruneNonActionableRoomTasks(memoryDir, { sources: ['room', 'room-promoted', 'ooda-expression'] });
  const deduplicatedTasks = await deduplicateActiveTasks(memoryDir, now);
  const releasedHolds = await releaseExpiredHolds(memoryDir, now);
  const completedElapsedProviderHolds = await completeElapsedProviderHoldTasks(memoryDir, now);
  const { queued: productRepairsQueued, closed: productRepairsClosed } = await reconcileProductRepairTasks(memoryDir, productVerifiers, now);
  const result = {
    prunedNonActionable: pruned.pruned,
    completedExpressionTasks,
    deduplicatedTasks,
    releasedHolds,
    completedElapsedProviderHolds,
    productRepairsQueued,
    productRepairsClosed,
    productVerifiers,
  };
  const changed = result.prunedNonActionable + completedExpressionTasks + deduplicatedTasks + releasedHolds + completedElapsedProviderHolds + productRepairsQueued + productRepairsClosed;
  if (changed > 0) slog('WORK-CLOSURE', `sweep changed=${changed} pruned=${result.prunedNonActionable} expression=${completedExpressionTasks} dedup=${deduplicatedTasks} holds=${releasedHolds} providerHolds=${completedElapsedProviderHolds} repairs=${productRepairsQueued} closedRepairs=${productRepairsClosed}`);
  return result;
}

export function verifyAiTrendClosure(repoRoot: string): ProductVerifierResult {
  const date = todayTaipei();
  const htmlPath = path.join(repoRoot, 'kuro-portfolio/ai-trend', `${date}.html`);
  if (!existsSync(htmlPath)) {
    return { product: 'ai-trend', status: 'skip', summary: `AI trend page missing for ${date}`, evidence: [`missing=${htmlPath}`] };
  }
  const html = readFileSync(htmlPath, 'utf-8');
  const sources = [
    ['HN', 'memory/state/hn-ai-trend'],
    ['Latent', 'memory/state/latent-space-trend'],
    ['arXiv', 'memory/state/arxiv-trend'],
    ['GitHub', 'memory/state/github-trend'],
    ['X', 'memory/state/x-trend'],
  ] as const;
  const evidence: string[] = [];
  let total = 0;
  let zhClaims = 0;
  let renderedClaims = 0;
  for (const [label, dir] of sources) {
    const filePath = path.join(repoRoot, dir, `${date}.json`);
    if (!existsSync(filePath)) {
      evidence.push(`${label}: missing ${date}.json`);
      continue;
    }
    const posts = readPosts(filePath);
    let sourceZh = 0;
    let sourceRendered = 0;
    for (const post of posts) {
      const claim = extractClaim(post);
      total++;
      if (containsCjk(claim)) {
        zhClaims++;
        sourceZh++;
      }
      if (claim && html.includes(escapeHtml(claim))) {
        renderedClaims++;
        sourceRendered++;
      }
    }
    evidence.push(`${label}: posts=${posts.length} zh=${sourceZh}/${posts.length} rendered=${sourceRendered}/${posts.length}`);
  }
  if (total === 0) return { product: 'ai-trend', status: 'skip', summary: 'AI trend source state has no posts to verify', evidence };
  const zhRatio = zhClaims / total;
  const renderRatio = renderedClaims / total;
  const hasXSection = html.includes('X / 社群熱議');
  const pass = zhRatio >= 0.95 && renderRatio >= 0.95 && hasXSection;
  return {
    product: 'ai-trend',
    status: pass ? 'pass' : 'fail',
    summary: `AI trend closure ${pass ? 'pass' : 'fail'}: zh=${zhClaims}/${total}, rendered=${renderedClaims}/${total}`,
    evidence: [...evidence, `zhRatio=${zhRatio.toFixed(3)}`, `renderRatio=${renderRatio.toFixed(3)}`, `hasXSection=${hasXSection}`],
    ...(pass ? {} : {
      repairTitle: `Repair AI trend closure: render all enriched source items for ${date}`,
      verifyCommand: 'node scripts/ai-trend-enrich-fallback.mjs --source=github && node scripts/build-ai-trend-preview.mjs && pnpm vitest run tests/autonomous-work-closure.test.ts',
    }),
  };
}

async function completeTerminalExpressionTasks(memoryDir: string, now: Date): Promise<number> {
  const active = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ACTIVE_STATUSES });
  let completed = 0;
  for (const task of active) {
    const summary = String(task.summary ?? '');
    if (!EXPRESSION_TASK_RE.test(summary)) continue;
    if (!URL_RE.test(summary) && !/已(?:表達|發送|回覆)|archive|主頁底部/.test(summary)) continue;
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload: {
        ...((task.payload ?? {}) as Record<string, unknown>),
        completed_by: 'autonomous-work-closure',
        completed_reason: 'expression task already contains a concrete emitted message or URL',
        completed_at: now.toISOString(),
      },
    });
    if (updated) completed++;
  }
  return completed;
}

async function deduplicateActiveTasks(memoryDir: string, now: Date): Promise<number> {
  const tasks = queryMemoryIndexSync(memoryDir, { type: ['task', 'goal'], status: ['pending', 'in_progress', 'hold', 'blocked', 'needs-decomposition'] })
    .filter(task => !TERMINAL_STATUSES.has(task.status));
  const groups = new Map<string, MemoryIndexEntry[]>();
  for (const task of tasks) {
    const key = canonicalTaskKey(task);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  let deduped = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const rankDelta = taskDedupKeepRank(b) - taskDedupKeepRank(a);
      return rankDelta !== 0 ? rankDelta : b.ts.localeCompare(a.ts);
    });
    const keep = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      const updated = await updateMemoryIndexEntry(memoryDir, duplicate.id, {
        status: 'abandoned',
        payload: {
          ...((duplicate.payload ?? {}) as Record<string, unknown>),
          pruned_reason: 'duplicate-active-work',
          canonical_task_id: keep.id,
          pruned_at: now.toISOString(),
        },
      });
      if (updated) deduped++;
    }
  }
  return deduped;
}

function taskDedupKeepRank(task: MemoryIndexEntry): number {
  if (task.status === 'in_progress') return 4;
  if (task.status === 'pending') return 3;
  if (task.status === 'hold') return 2;
  return 1;
}

async function releaseExpiredHolds(memoryDir: string, now: Date): Promise<number> {
  const holds = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] });
  let released = 0;
  for (const hold of holds) {
    const payload = (hold.payload ?? {}) as Record<string, unknown>;
    const condition = payload.holdCondition as Record<string, unknown> | undefined;
    if (condition?.type !== 'date-after' || typeof condition.value !== 'string') continue;
    const resumeAt = Date.parse(condition.value);
    if (!Number.isFinite(resumeAt) || resumeAt > now.getTime()) continue;
    const providerHold = payload.provider_resource_hold;
    const nextStatus = providerHold ? 'completed' : 'pending';
    const completedFields = providerHold
      ? {
          completed_by: 'autonomous-work-closure',
          completed_reason: 'provider quota hold elapsed; this wait task should not return to the P0 queue',
          completed_at: now.toISOString(),
        }
      : {};
    const updated = await updateMemoryIndexEntry(memoryDir, hold.id, {
      status: nextStatus,
      payload: {
        ...payload,
        ...completedFields,
        hold_released_at: now.toISOString(),
        hold_released_by: 'autonomous-work-closure',
      },
    });
    if (updated) released++;
  }
  return released;
}

async function completeElapsedProviderHoldTasks(memoryDir: string, now: Date): Promise<number> {
  const tasks = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  let completed = 0;
  for (const task of tasks) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    const hold = payload.provider_resource_hold as Record<string, unknown> | undefined;
    const resumeAt = typeof hold?.resumeAt === 'string' ? Date.parse(hold.resumeAt) : Number.NaN;
    if (!Number.isFinite(resumeAt) || resumeAt > now.getTime()) continue;
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload: {
        ...payload,
        completed_by: 'autonomous-work-closure',
        completed_reason: 'elapsed provider quota hold was already released and should not stay pending',
        completed_at: now.toISOString(),
      },
    });
    if (updated) completed++;
  }
  return completed;
}

async function reconcileProductRepairTasks(memoryDir: string, verifiers: ProductVerifierResult[], now: Date): Promise<{ queued: number; closed: number }> {
  const active = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ACTIVE_STATUSES });
  const hasAiTrendWork = active.some(task => AI_TREND_RE.test(String(task.summary ?? '')));
  const byProduct = new Map(verifiers.map(v => [v.product, v]));
  let queued = 0;
  let closed = 0;
  for (const task of active) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    if (payload.origin !== 'autonomous-work-closure' || typeof payload.product !== 'string') continue;
    const verifier = byProduct.get(payload.product);
    if (verifier?.status !== 'pass') continue;
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload: {
        ...payload,
        completed_by: 'autonomous-work-closure',
        completed_reason: verifier.summary,
        completed_at: now.toISOString(),
      },
    });
    if (updated) closed++;
  }
  for (const verifier of verifiers) {
    if (verifier.status !== 'fail' || !verifier.repairTitle || !verifier.verifyCommand) continue;
    if (verifier.product === 'ai-trend' && !hasAiTrendWork) continue;
    const existing = active.find(task => {
      const payload = (task.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'autonomous-work-closure' && payload.product === verifier.product && task.summary === verifier.repairTitle;
    });
    if (existing) continue;
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: verifier.repairTitle,
      source: 'autonomous-work-closure',
      tags: ['autonomous-work-closure', verifier.product],
      payload: {
        origin: 'autonomous-work-closure',
        priority: 1,
        product: verifier.product,
        verify_command: verifier.verifyCommand,
        acceptance_criteria: verifier.summary,
        evidence: verifier.evidence,
        createdAt: now.toISOString(),
      },
    });
    queued++;
  }
  return { queued, closed };
}

function canonicalTaskKey(task: MemoryIndexEntry): string | null {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.roomMsgId === 'string') return `room:${payload.roomMsgId}`;
  const summary = String(task.summary ?? '');
  const normalized = summary.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 120);
  if (AI_TREND_RE.test(summary)) return `product:ai-trend:${normalized}`;
  return normalized.length >= 24 ? `summary:${normalized}` : null;
}

function todayTaipei(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function readPosts(filePath: string): Array<Record<string, unknown>> {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    return Array.isArray(raw.posts) ? raw.posts as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

function extractClaim(post: Record<string, unknown>): string {
  const summary = post.summary as Record<string, unknown> | undefined;
  return typeof summary?.claim === 'string' && summary.claim !== 'pending-llm-pass' ? summary.claim.trim() : '';
}

function containsCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
