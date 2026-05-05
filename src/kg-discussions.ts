/**
 * KG Discussions — subscribe, perceive, and participate in KG discussions.
 *
 * 1. Startup: auto-subscribe to discussions where Kuro is a participant
 * 2. Perception: build context section showing active discussions with new positions
 * 3. Webhook events mark discussions as "dirty" for next perception cycle
 */

import { slog } from './utils.js';

const KG_URL = process.env.KG_BASE_URL || 'http://localhost:3300';
const KG_TIMEOUT = 3000;
const AGENT_ID = 'kuro';
const WEBHOOK_URL = 'http://localhost:3001/api/webhook';
const PERCEPTION_CAP = 2000;
const DISCUSSIONS_CACHE_TTL_MS = 15_000;

interface DiscussionSummary {
  id: string;
  topic: string;
  status: string;
  participants: string[];
  position_count: number;
  updated_at: string;
}

interface Position {
  node_id: string;
  source_agent: string;
  description: string;
  confidence: number;
  relation: string;
  created_at: string;
}

const dirtyDiscussions = new Set<string>();
let discussionsCache: { value: string; expiresAt: number } | null = null;
let discussionsInflight: Promise<string> | null = null;

export function markDiscussionDirty(discussionId: string): void {
  dirtyDiscussions.add(discussionId);
  invalidateKGDiscussionsContextCache();
}

export async function subscribeToKGDiscussions(): Promise<number> {
  try {
    const res = await fetch(`${KG_URL}/api/discussions?status=open&status=active&status=converging`, {
      signal: AbortSignal.timeout(KG_TIMEOUT),
    });
    if (!res.ok) return 0;
    const data = await res.json() as { discussions: DiscussionSummary[] };

    const myDiscussions = data.discussions.filter(d =>
      d.participants.includes(AGENT_ID),
    );

    const existingRes = await fetch(`${KG_URL}/api/subscriptions/${AGENT_ID}`, {
      signal: AbortSignal.timeout(KG_TIMEOUT),
    });
    const existing = existingRes.ok
      ? (await existingRes.json() as { subscriptions: { discussion_id: string }[] }).subscriptions.map(s => s.discussion_id)
      : [];
    const existingSet = new Set(existing);

    let subscribed = 0;
    for (const d of myDiscussions) {
      if (existingSet.has(d.id)) continue;
      try {
        await fetch(`${KG_URL}/api/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discussion_id: d.id, agent_id: AGENT_ID, webhook_url: WEBHOOK_URL }),
          signal: AbortSignal.timeout(KG_TIMEOUT),
        });
        subscribed++;
      } catch { /* best effort */ }
    }

    slog('KG', `Auto-subscribed to ${subscribed} new discussions (${myDiscussions.length} total participating)`);
    return subscribed;
  } catch (err) {
    slog('KG', `Subscribe failed: ${err instanceof Error ? err.message : err}`);
    return 0;
  }
}

export async function buildKGDiscussionsContext(): Promise<string> {
  if (dirtyDiscussions.size === 0 && discussionsCache && discussionsCache.expiresAt > Date.now()) {
    return discussionsCache.value;
  }
  if (dirtyDiscussions.size === 0 && discussionsInflight) return discussionsInflight;

  const shouldCache = dirtyDiscussions.size === 0;
  discussionsInflight = buildKGDiscussionsContextFresh()
    .then((value) => {
      if (shouldCache) {
        discussionsCache = { value, expiresAt: Date.now() + DISCUSSIONS_CACHE_TTL_MS };
      }
      return value;
    })
    .finally(() => {
      discussionsInflight = null;
    });
  return discussionsInflight;
}

async function buildKGDiscussionsContextFresh(): Promise<string> {
  try {
    const res = await fetch(`${KG_URL}/api/discussions?status=open&status=active&status=converging`, {
      signal: AbortSignal.timeout(KG_TIMEOUT),
    });
    if (!res.ok) return '';
    const data = await res.json() as { discussions: DiscussionSummary[] };

    const myDiscussions = data.discussions
      .filter(d => d.participants.includes(AGENT_ID))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5);

    if (myDiscussions.length === 0) return '';

    const lines: string[] = ['<kg-discussions>'];
    let charCount = 0;

    for (const d of myDiscussions) {
      const isDirty = dirtyDiscussions.has(d.id);
      const marker = isDirty ? ' 🔔 NEW' : '';
      const header = `[${d.status.toUpperCase()}${marker}] ${d.topic} (${d.position_count} positions, ${d.participants.join(', ')})`;

      if (charCount + header.length > PERCEPTION_CAP) break;
      lines.push(header);
      charCount += header.length;

      if (isDirty) {
        let fetched = false;
        try {
          const dRes = await fetch(`${KG_URL}/api/discussion/${d.id}`, {
            signal: AbortSignal.timeout(KG_TIMEOUT),
          });
          if (dRes.ok) {
            fetched = true;
            const detail = await dRes.json() as { positions: Position[] };
            const recent = detail.positions.slice(-3);
            for (const p of recent) {
              const posLine = `  - [${p.source_agent}] ${p.description.slice(0, 120)}`;
              if (charCount + posLine.length > PERCEPTION_CAP) break;
              lines.push(posLine);
              charCount += posLine.length;
            }
          }
        } catch { /* timeout, skip detail — keep dirty for retry */ }
        if (fetched) dirtyDiscussions.delete(d.id);
      }
    }

    lines.push('</kg-discussions>');
    return lines.join('\n');
  } catch {
    return '';
  }
}

export function invalidateKGDiscussionsContextCache(): void {
  discussionsCache = null;
}

export function __resetKGDiscussionsContextCacheForTests(): void {
  dirtyDiscussions.clear();
  discussionsCache = null;
  discussionsInflight = null;
}
