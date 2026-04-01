# Context Attention Management — Pre-routing + Per-section Caps

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate "Prompt too large" events by controlling context size at assembly time, not reactively.

**Architecture:** Two-layer approach (B+A from Akari discussion): (1) Strengthen `inferCycleWeight()` pre-routing so fewer cycles default to `focused`, (2) Add per-section soft caps in `buildContext()` so no single section can explode total size. Keep existing `PROMPT_HARD_CAP` as emergency safety net but it should never trigger.

**Tech Stack:** TypeScript, no new dependencies

**Key insight (from Akari):** "Context management is attention management. Optimize for signal/noise ratio, not total size."

---

### Task 1: Add per-section size caps to `buildContext()`

**Files:**
- Modify: `src/memory.ts:1758` (sections array assembly)

**Step 1: Define section budget constants**

Add at the top of `buildContext()` (after line 1758 `const sections: string[] = [];`):

```typescript
// Per-section soft caps — prevent any single section from dominating context
const SECTION_CAP: Record<string, number> = {
  'web-fetch-results': 6000,
  'chat-room-recent': 6000,
  'chat-room-relevant': 4000,
  'soul': 8000,
  'heartbeat': 6000,
  'situation-report': 6000,
  'background-completed': 4000,
  'capabilities': 3000,
  'activity': 3000,
  'recent-activity': 3000,
  'action-memory': 3000,
  'memory-index': 2000,
  'trail': 2000,
  'achievements': 2000,
  'threads': 2000,
  'conversation-threads': 2000,
  'commitments': 2000,
  'myelin-framework': 2000,
  'pulse': 1500,
  'route-efficiency': 1500,
  'working-memory': 3000,
  'inner-voice': 2000,
};
const DEFAULT_SECTION_CAP = 4000;

/** Push a section with automatic size capping */
const pushSection = (tag: string, content: string) => {
  const cap = SECTION_CAP[tag] ?? DEFAULT_SECTION_CAP;
  if (content.length > cap) {
    content = content.slice(0, cap) + `\n[... truncated from ${content.length} chars]`;
  }
  sections.push(`<${tag}>\n${content}\n</${tag}>`);
};
```

**Step 2: Replace direct `sections.push()` calls with `pushSection()`**

Convert all section pushes that use the pattern `sections.push(\`<tag>\n${content}\n</tag>\`)` to use `pushSection(tag, content)` instead. Sections that are already small or critical (environment, telegram, inbox, flip-test, priority-focus) can stay as direct pushes.

Target sections to convert (these are the large/variable ones):
- `soul` (line ~2235)
- `capabilities` (line ~1888)
- `activity` (line ~1934)
- `background-completed` (line ~1941)
- `web-fetch-results` (line ~1951) — also remove the existing `.slice(0, 12000)`
- `recent-activity` (line ~1963)
- `trail` (line ~1970)
- `achievements` (line ~2018)
- `pulse` (line ~2027)
- `myelin-framework` (line ~2036)
- `commitments` (line ~2045)
- `action-memory` (line ~2181)
- `threads` (line ~2191)
- `working-memory` (line ~2201)
- `inner-voice` (line ~2210)
- `conversation-threads` (line ~2228)
- `memory-index` (line ~2250)
- `chat-room-recent` and `chat-room-relevant` (handled in helper methods — cap at call site)

Leave these as direct push (small/critical):
- `environment`, `flip-test`, `priority-focus`, `temporal`, `telegram`
- `inbox` (must be complete for reply accuracy)
- `task-progress`, `task-queue`, `pinned-tasks`, `self`
- `workspace`
- Warning flags (small by nature)

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/memory.ts
git commit -m "feat(context): add per-section soft caps to buildContext()"
```

---

### Task 2: Strengthen `inferCycleWeight()` pre-routing

**Files:**
- Modify: `src/loop.ts:2846-2872` (`inferCycleWeight()`)

**Step 1: Route heartbeat/cron triggers to `light` instead of `focused`**

Replace the function body:

```typescript
private inferCycleWeight(trigger: string, opts: {
  hasNewInbox: boolean;
  perceptionChanged: boolean;
}): 'minimal' | 'light' | 'focused' | 'full' {
  // Delegation drain — only need to see results, minimal context
  if (trigger.startsWith('delegation') && !opts.hasNewInbox) {
    return 'minimal';
  }

  // DM reply — light context
  if (['telegram', 'room', 'chat', 'direct-message'].some(s => trigger.startsWith(s))) {
    return 'light';
  }

  // Heartbeat/cron without inbox or perception changes — light context
  // These are routine check-ins, don't need full perception stack
  if (['heartbeat', 'cron'].some(s => trigger.startsWith(s)) && !opts.hasNewInbox && !opts.perceptionChanged) {
    return 'light';
  }

  // Continuation — keep focused depth
  if (trigger.startsWith('continuation')) {
    return 'focused';
  }

  // Perception changed significantly or has new inbox — need focused awareness
  if (opts.perceptionChanged || opts.hasNewInbox) {
    return 'focused';
  }

  // Default — light for routine, focused was overkill
  return 'light';
}
```

Key change: heartbeat/cron without new info → `light` (~15K) instead of `focused` (~30K).

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/loop.ts
git commit -m "feat(context): route routine cycles to light mode, reduce default context"
```

---

### Task 3: Add context size telemetry

**Files:**
- Modify: `src/memory.ts` (end of `buildContext()`, before return)

**Step 1: Log context size after assembly**

At the end of `buildContext()`, just before the final `return` statement, add:

```typescript
const totalSize = sections.reduce((sum, s) => sum + s.length, 0);
slog('CONTEXT', `mode=${mode} sections=${sections.length} size=${totalSize} chars`);
```

This gives us visibility into whether the caps are effective without any reactive logic.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/memory.ts
git commit -m "feat(context): add assembly size telemetry"
```

---

### Task 4: Verify end-to-end — confirm PROMPT_HARD_CAP no longer triggers

**Step 1: Build and deploy**

Run: `pnpm build`

**Step 2: Monitor logs for "Prompt too large" events**

After deployment, monitor:
```bash
grep "Prompt too large\|CONTEXT.*mode=" ~/.mini-agent/instances/*/logs/server.log | tail -20
```

Expected: New `CONTEXT mode=` lines showing sizes well under 60K. No more "Prompt too large" events for routine cycles.

**Step 3: Verify context quality**

Check Kuro's behavior in Chat Room — responses should still be contextually aware. The per-section caps preserve the most recent/important parts of each section.

---

## Notes

- **PROMPT_HARD_CAP (60K) stays** as emergency safety net — if both layers fail, it catches the overflow
- **Perception stream `output_cap`** already exists per-plugin (default 4000) — the new per-section caps layer on top for the final assembled context
- **Soul section** gets 8K cap — largest because identity is highest priority
- **Inbox stays uncapped** — must be complete for accurate reply detection
- Total expected context: light ~15K, focused ~35K (down from 60-115K)
