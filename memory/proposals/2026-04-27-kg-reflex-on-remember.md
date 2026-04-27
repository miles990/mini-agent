# Reflex: Remember → KG Write (proposal)

**Date**: 2026-04-27
**Author**: Kuro (cl this-cycle)
**Task**: P2 「學完即 KG 寫入 reflex plugin」(idx-836efbc1)
**Status**: design — implementation scheduled next cycle

## Why

`memory-kg-absorption-gap` rumination (cl-32, 2026-04-27 05:21) measured: **199 memory/topics entries since 2026-03-28 vs ~80 KG `pattern` hits in `kuro` namespace → ~60% of learnings never reach KG**.

Manual `add_knowledge` calls don't scale. Writing reflex is the mechanism fix.

## Term Correction

Task name says "plugin" but `mini-agent/plugins/*.sh` are **perception scripts** (read-only situation-report producers). They cannot mutate state.

What's actually needed: a **post-compile reflex** — a hook in the entry-creation pipeline that fire-and-forgets a KG write. Lives in `src/`, not `plugins/`.

## Architecture

```
<kuro:remember topic="X">content</kuro:remember>
   │
   ▼
dispatcher.ts:539  (parse)
   │
   ▼
memory-compiler.ts: compileFromTags()
   │
   ├─→ store.append() → entries.jsonl  (existing)
   │
   └─→ NEW: kgReflex.push(entry)       (fire-and-forget)
            │
            ▼
       POST http://localhost:3300/api/write
       body: { text: entry.content, source_agent: "kuro:memory-compiler", metadata: {topic, concepts, type} }
```

## Implementation Plan (next cycle)

### File 1: `mini-agent/src/kg-reflex.ts` (new, ~50 LOC)

```ts
import type { Entry } from './types.js';

const KG_BASE = process.env.KG_BASE_URL ?? 'http://localhost:3300';
const TIMEOUT_MS = 1500;

interface KGWriteResult {
  pushed: boolean;
  reason?: string;
}

/** Decide if entry warrants KG ingest. Filter noise. */
function shouldPush(entry: Entry): boolean {
  // Skip pure 'fact' with no topic/concepts (low signal)
  if (entry.type === 'fact' && (entry.concepts?.length ?? 0) === 0) return false;
  // Skip very short entries
  if ((entry.content ?? '').length < 40) return false;
  return true;
}

export async function pushEntryToKG(entry: Entry): Promise<KGWriteResult> {
  if (!shouldPush(entry)) return { pushed: false, reason: 'filtered' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${KG_BASE}/api/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        text: entry.content,
        source_agent: 'kuro:memory-compiler',
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
    return { pushed: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget — never throw, never await on cycle path. */
export function reflexPush(entry: Entry): void {
  pushEntryToKG(entry).then((res) => {
    if (!res.pushed && res.reason !== 'filtered') {
      // eslint-disable-next-line no-console
      console.warn(`[kg-reflex] skip entry=${entry.id}: ${res.reason}`);
    }
  }).catch(() => { /* swallowed */ });
}
```

### File 2: `mini-agent/src/memory-compiler.ts` patch (3 lines)

```diff
+ import { reflexPush } from './kg-reflex.js';
  ...
  for (const r of tags.remembers ?? []) {
    const entry = compileRemember(target, { ... });
-   if (entry) result.remembersCompiled++;
+   if (entry) { result.remembersCompiled++; reflexPush(entry); }
    else result.skipped++;
  }
```

Same pattern for supersedes (push the new entry).

### Tests (TDD per discipline)

`mini-agent/src/__tests__/kg-reflex.test.ts`:
1. `shouldPush` filters: short entries, fact-without-concepts → false
2. `pushEntryToKG` against mocked fetch returning 202 → `{pushed: true}`
3. `pushEntryToKG` against fetch timeout → `{pushed: false, reason: 'timeout'}`
4. `reflexPush` never throws, never blocks (returns void synchronously)

## Falsifier (for the design itself)

If after deploy + 1 day:
- `entries.jsonl` shows ≥10 new entries
- KG `kuro` namespace pattern count delta < 5
→ reflex not firing or filter too aggressive → re-investigate.

If KG `kuro` count delta ≥ 80% of new entries → working as designed.

## Why Not This Cycle

- 90% rule: shipping reflex without test = guaranteed silent-failure (KG down → swallowed → no signal)
- Performative-skepticism warning at <30%: another half-shipped commitment makes it worse
- Single-cycle budget already at $1.50/$5 from recon

## Commitment

cl-this-cycle: "Next cycle ship `src/kg-reflex.ts` + integration patch + 4 unit tests, observe entries.jsonl ↔ KG delta over 1 day."
falsifier: if next cycle's task gets pre-empted again or design changes mid-flight, this commitment expired.
ttl: 2

## Open Questions (defer)

1. **Dedup**: should we dedup against existing KG nodes? `/api/write` does background extraction with embedding — likely already dedups. Verify in observation phase.
2. **Backfill**: 199 historical entries — separate one-shot script, not the reflex's job.
3. **Topic-level batching**: pushing every entry individually may flood KG worker. If observation shows lag, add 5s debounce per topic.
