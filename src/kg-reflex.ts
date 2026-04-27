// kg-reflex.ts — fire-and-forget KG ingest on memory entry creation.
//
// Design: memory/proposals/2026-04-27-kg-reflex-on-remember.md
// Closes the ~60% memory→KG absorption gap measured 2026-04-27 (cl-32 rumination).
//
// Contract:
//   - Never throws on the cycle path (reflexPush is sync void).
//   - Never blocks beyond TIMEOUT_MS (AbortController fires at 1500ms).
//   - Filters obvious noise (short entries, bare facts) before network call.
//   - Failure of KG service is silent-warn — memory writes are the source of truth.

import type { Entry } from './types.js';

const KG_BASE = process.env.KG_BASE_URL ?? 'http://localhost:3300';
const TIMEOUT_MS = Number(process.env.KG_REFLEX_TIMEOUT_MS ?? '1500');
const DISABLED = process.env.KG_REFLEX_DISABLED === '1';

export interface KGWriteResult {
  pushed: boolean;
  reason?: string;
}

/** Decide if entry warrants KG ingest. Filter obvious noise. */
export function shouldPush(entry: Entry): boolean {
  // Pure 'fact' with no concept tags is low-signal noise (e.g. ephemeral status).
  if (entry.type === 'fact' && (entry.concepts?.length ?? 0) === 0) return false;
  // Very short entries rarely contain useful patterns.
  if ((entry.content ?? '').length < 40) return false;
  return true;
}

export async function pushEntryToKG(
  entry: Entry,
  fetchImpl: typeof fetch = fetch,
): Promise<KGWriteResult> {
  if (DISABLED) return { pushed: false, reason: 'disabled' };
  if (!shouldPush(entry)) return { pushed: false, reason: 'filtered' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${KG_BASE}/api/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        text: entry.content,
        source_agent: 'kuro:memory-compiler',
        namespace: 'kuro',
        metadata: {
          entry_id: entry.id,
          topic: entry.source?.replace(/^topics\//, '').replace(/\.md$/, ''),
          concepts: entry.concepts,
          type: entry.type,
        },
      }),
    });
    return { pushed: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e) {
    const name = (e as Error).name;
    return { pushed: false, reason: name === 'AbortError' ? 'timeout' : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget — never throws, never blocks the cycle path. */
export function reflexPush(entry: Entry): void {
  // Wrap in try so even synchronous fetch-construction errors can't escape.
  try {
    pushEntryToKG(entry)
      .then((res) => {
        if (!res.pushed && res.reason && res.reason !== 'filtered' && res.reason !== 'disabled') {
          // eslint-disable-next-line no-console
          console.warn(`[kg-reflex] skip entry=${entry.id}: ${res.reason}`);
        }
      })
      .catch(() => {
        /* swallowed — never let reflex break the cycle */
      });
  } catch {
    /* swallowed */
  }
}
