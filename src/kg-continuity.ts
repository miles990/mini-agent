/**
 * KG Continuity — cross-cycle state tracking via Knowledge Graph.
 *
 * Each cycle, Kuro self-reports via <kuro:cycle-state>. This module:
 * 1. Writes cycle-state to KG service (kuro namespace)
 * 2. Reads recent unclosed cycle-states for next cycle's <continuity> section
 * 3. Detects rumination (consecutive stalled on same intent) and injects warnings
 *
 * Design: Kuro's proposal (room 2026-04-21-010)
 * - `closes` = explicit chain break (not recency decay)
 * - `outcome=stalled` ×2 on same intent → warning
 * - Kuro fills the tag herself — empty = no direction (valuable signal)
 */

import { isEnabled } from './features.js';
import { slog } from './utils.js';
import crypto from 'node:crypto';

const KG_SERVICE_URL = 'http://localhost:3300';
const KG_TIMEOUT = 2000;
const NAMESPACE = 'kuro';
const CONTINUITY_CAP = 500;

// ─── Types ───

export type CycleOutcome = 'shipped' | 'progressed' | 'stalled' | 'abandoned';

export interface CycleState {
  id: string;
  focus: string;
  intent: string;
  outcome: CycleOutcome;
  artifacts: string[];
  continuesFrom: string | null;
  closes: string[];
  mood?: string;
  intentHash: string;
  ts: string;
}

// ─── Write ───

function hashIntent(intent: string): string {
  return crypto.createHash('sha1').update(intent.trim().toLowerCase()).digest('hex').slice(0, 12);
}

export function parseCycleStateTag(content: string): Omit<CycleState, 'id' | 'ts' | 'intentHash'> | null {
  try {
    const lines = content.trim().split('\n');
    const data: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^(\w[\w-]*):\s*(.+)/);
      if (m) data[m[1]] = m[2].trim();
    }

    if (!data.focus && !data.intent) return null;

    return {
      focus: (data.focus || '').slice(0, 80),
      intent: (data.intent || '').slice(0, 80),
      outcome: (['shipped', 'progressed', 'stalled', 'abandoned'].includes(data.outcome)
        ? data.outcome as CycleOutcome
        : 'progressed'),
      artifacts: data.artifacts
        ? data.artifacts.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      continuesFrom: data['continues-from'] || data.continuesFrom || null,
      closes: data.closes
        ? data.closes.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      mood: data.mood || undefined,
    };
  } catch {
    return null;
  }
}

export async function writeCycleState(parsed: Omit<CycleState, 'id' | 'ts' | 'intentHash'>): Promise<string | null> {
  if (!isEnabled('kg-continuity')) return null;

  const ts = new Date().toISOString();
  const id = `cycle-${ts}`;
  const intentHash = hashIntent(parsed.intent);

  const state: CycleState = { ...parsed, id, ts, intentHash };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KG_TIMEOUT);

    // Write via Episode API — proper layer:'episode' + context_envelope + OCCURRED_DURING edges
    const resp = await fetch(`${KG_SERVICE_URL}/api/episode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: `[${parsed.outcome}] ${parsed.focus} — ${parsed.intent}`,
        outcome: parsed.outcome,
        source_agent: 'kuro',
        confidence: 0.95,
        context_envelope: {
          topic: parsed.focus,
          problem: parsed.intent,
          active_knowledge: parsed.artifacts,
        },
        related_nodes: [],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      slog('KG-CONTINUITY', `Write failed: ${resp.status}`);
      return null;
    }

    const result = await resp.json() as { episode_id: string };
    const episodeId = result.episode_id;

    // Await linking triple — buildContinuityContext() depends on section_type: 'cycle-state'
    const linkController = new AbortController();
    const linkTimer = setTimeout(() => linkController.abort(), KG_TIMEOUT);
    await fetch(`${KG_SERVICE_URL}/api/write/triple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: episodeId,
        subject_type: 'episode',
        predicate: 'part_of',
        object: 'kuro-continuity',
        object_type: 'concept',
        confidence: 0.95,
        source_agent: 'kuro',
        namespace: NAMESPACE,
        description: `[${parsed.outcome}] ${parsed.focus}`,
        properties: { ...state, section_type: 'cycle-state' },
      }),
      signal: linkController.signal,
    }).catch(() => {});
    clearTimeout(linkTimer);

    // Handle closes — write invalidation edges
    for (const closeId of parsed.closes) {
      fetch(`${KG_SERVICE_URL}/api/write/triple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: episodeId,
          subject_type: 'episode',
          predicate: 'supersedes',
          object: closeId,
          object_type: 'episode',
          confidence: 0.95,
          source_agent: 'kuro',
          namespace: NAMESPACE,
          description: `Explicitly closed by ${episodeId}`,
        }),
      }).catch(() => {});
    }

    // Handle continues_from — write continuation edge
    if (parsed.continuesFrom) {
      fetch(`${KG_SERVICE_URL}/api/write/triple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: episodeId,
          subject_type: 'episode',
          predicate: 'extends',
          object: parsed.continuesFrom,
          object_type: 'episode',
          confidence: 0.95,
          source_agent: 'kuro',
          namespace: NAMESPACE,
          description: `Continues from ${parsed.continuesFrom}`,
        }),
      }).catch(() => {});
    }

    slog('KG-CONTINUITY', `Wrote ${episodeId}: [${parsed.outcome}] ${parsed.focus}`);
    return episodeId;
  } catch (err) {
    slog('KG-CONTINUITY', `Write error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Read ───

interface KGNode {
  id: string;
  name: string;
  description: string;
  properties: Record<string, unknown>;
  created_at: string;
}

export async function buildContinuityContext(): Promise<string> {
  if (!isEnabled('kg-continuity')) return '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KG_TIMEOUT);

    const resp = await fetch(`${KG_SERVICE_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'kuro-continuity cycle-state',
        namespace: NAMESPACE,
        budget_tokens: 300,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return '';

    const data = await resp.json() as { results: Array<{ node: KGNode }> };
    if (!data.results || data.results.length === 0) return '';

    // Filter to cycle-state entities and sort by timestamp
    const states: CycleState[] = [];
    for (const r of data.results) {
      const props = r.node.properties as Record<string, unknown>;
      if (props.section_type !== 'cycle-state') continue;
      states.push({
        id: String(props.id ?? r.node.name),
        focus: String(props.focus ?? ''),
        intent: String(props.intent ?? ''),
        outcome: String(props.outcome ?? 'progressed') as CycleOutcome,
        artifacts: (props.artifacts as string[]) ?? [],
        continuesFrom: (props.continuesFrom as string) ?? null,
        closes: (props.closes as string[]) ?? [],
        mood: props.mood ? String(props.mood) : undefined,
        intentHash: String(props.intentHash ?? ''),
        ts: String(props.ts ?? r.node.created_at),
      });
    }

    if (states.length === 0) return '';

    states.sort((a, b) => b.ts.localeCompare(a.ts));

    // Filter: only unclosed states + recent shipped (24h)
    const closedIds = new Set(states.flatMap(s => s.closes));
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const relevant = states.filter(s => {
      if (closedIds.has(s.id)) return false;
      if (s.outcome === 'abandoned') return false;
      if (s.outcome === 'shipped' && now - new Date(s.ts).getTime() > DAY) return false;
      return true;
    }).slice(0, 8);

    if (relevant.length === 0) return '';

    // Detect rumination: consecutive stalled with same intentHash
    const stalledStreaks = new Map<string, number>();
    for (const s of relevant) {
      if (s.outcome === 'stalled') {
        stalledStreaks.set(s.intentHash, (stalledStreaks.get(s.intentHash) ?? 0) + 1);
      }
    }

    // Build context
    const lines: string[] = [];
    for (const s of relevant) {
      const emoji = s.outcome === 'shipped' ? '✓' : s.outcome === 'progressed' ? '→' : s.outcome === 'stalled' ? '⚠' : '✗';
      const artifacts = s.artifacts.length > 0 ? ` [${s.artifacts.join(', ')}]` : '';
      lines.push(`${emoji} ${s.focus} — ${s.intent}${artifacts}`);
    }

    // Inject stalled warnings
    for (const [hash, count] of stalledStreaks) {
      if (count >= 2) {
        const stalledState = relevant.find(s => s.intentHash === hash);
        if (stalledState) {
          lines.push(`\n⚠️ 「${stalledState.intent}」已卡 ${count} cycle — 要換路徑還是放棄？`);
        }
      }
    }

    let result = lines.join('\n');
    if (result.length > CONTINUITY_CAP) {
      result = result.slice(0, CONTINUITY_CAP - 3) + '...';
    }
    return result;
  } catch {
    return '';
  }
}
