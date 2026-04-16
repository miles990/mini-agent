# Proposal v2 §5 — Commitments Ledger Schema

> Canonical contract for the commitments ledger. All agents (Kuro, CC, middleware) must implement against this spec.
> Source of truth: this document. Code must match — not the other way around.

---

## 1. Entity: Commitment

A commitment is an explicit promise made by an agent in a verifiable context. It has a lifecycle and must terminate.

### 1.1 Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | server-assigned | `cmt-{yyyymmdd}-{nanoid6}`. Globally unique, immutable. |
| `owner` | `string` | yes | Who made the promise. Free-form, max 64 chars. Values: `kuro`, `claude-code`, `middleware`, `alex`, or any agent id. |
| `source` | `CommitmentSource` | yes | Where the commitment originated (structured). |
| `text` | `string` | yes | Human-readable promise, ≤500 chars. |
| `parsed` | `{ action: string; deadline?: string; to?: string }` | yes | Structured extraction: what action, by when, for whom. `deadline` is ISO 8601 or relative (e.g. `next-cycle`). |
| `acceptance` | `string` | yes | Observable end state that proves this commitment is honored. Ties to DAG acceptance system. |
| `linked_task_id` | `string` | no | Middleware task ID if this commitment maps to a dispatched task. |
| `linked_dag_id` | `string` | no | Middleware plan/DAG ID if this commitment is part of a multi-step plan. |
| `status` | `CommitmentStatus` | server-managed | Current lifecycle state. |
| `created_at` | `string` (ISO 8601 UTC) | server-assigned | When first recorded. |
| `resolved_at` | `string` (ISO 8601 UTC) \| `null` | server-managed | When status left `active`. `null` while active. |
| `resolution` | `CommitmentResolution` \| `null` | on resolve | Evidence of how/why the commitment was closed. |

### 1.2 CommitmentSource

```typescript
interface CommitmentSource {
  channel: 'room' | 'inner' | 'delegate' | 'user-prompt';
  message_id?: string;   // e.g. "2026-04-16-043"
  cycle_id?: string;      // e.g. "cycle-152"
}
```

Structured origin — allows querying "all commitments from room messages" or "all commitments from delegation tags".

### 1.3 CommitmentResolution

```typescript
interface CommitmentResolution {
  kind: 'commit' | 'chat' | 'task-close' | 'supersede' | 'cancel';
  evidence: string;    // commit SHA, message ID, task result, or brief reason
  note?: string;        // optional human explanation
}
```

---

## 2. State Machine

```
                ┌──────────────────┐
                │     active       │  (initial state, server-assigned on create)
                └──────┬───────────┘
                       │
           ┌───────────┼───────────┐
           │           │           │
           ▼           ▼           ▼
      ┌─────────┐ ┌──────────┐ ┌──────────┐
      │fulfilled│ │superseded│ │cancelled │
      └─────────┘ └──────────┘ └──────────┘
```

| Transition | Trigger | Resolution.kind |
|------------|---------|-----------------|
| `active → fulfilled` | Work completed, evidence provided | `commit` \| `chat` \| `task-close` |
| `active → superseded` | New commitment replaces this one | `supersede` (evidence = new commitment id) |
| `active → cancelled` | No longer relevant, explicitly abandoned | `cancel` (evidence = reason) |
| `active → fulfilled` | Auto-stale TTL expires + sweep classifies as implicitly honored | `task-close` (evidence = `auto-stale-7d`) |

**Terminal states are final.** No transitions out of `fulfilled`, `superseded`, or `cancelled`.

**Note on naming**: Code uses `active` (not `pending`) as the initial state. This is intentional — `active` communicates "someone is accountable for this right now", not just "waiting".

---

## 3. Operations (API Contract)

### 3.1 Create

```
POST /commit
Body: CommitmentCreate (owner, source, text, parsed, acceptance, linked_task_id?, linked_dag_id?)
Response: Commitment (full object with server-assigned id, status=active, created_at)
```

### 3.2 Get

```
GET /commit/:id
Response: Commitment
404 if not found
```

### 3.3 Resolve

```
PATCH /commit/:id
Body: { status: CommitmentStatus, resolution: CommitmentResolution }
Response: 204 No Content
409 if already in terminal state
```

**Note**: Client convenience method `resolveCommitment(id, resolution)` hardcodes `status: 'fulfilled'`. For `superseded` or `cancelled`, use raw PATCH.

### 3.4 List / Query

```
GET /commits?status=active&owner=kuro&channel=room
Response: Commitment[]
All query params optional. Empty = return all.
```

---

## 4. TTL & Auto-Stale Policy

| Rule | Value | Rationale |
|------|-------|-----------|
| Active TTL | **7 days** | Commitment > 7d without resolution = structurally abandoned. Sweep auto-resolves. |
| Sweep interval | **60 seconds** (piggyback on middleware cleanup interval) | Low overhead, eventual consistency is fine. |
| Sweep action | `active` + `created_at` > 7d → `status: cancelled`, `resolution: { kind: 'cancel', evidence: 'auto-stale-7d' }` | Explicit cancellation, not silent deletion. Auditable. |
| Max active per owner | **20** | Prevents unbounded growth. Create fails with 429 if exceeded. Caller must resolve or cancel existing commitments first. |

---

## 5. Integration Notes

### 5.1 Replaces `commitments.ts` (mini-agent local)

The existing `src/commitments.ts` tracks cycle-based commitments locally (GRACE_CYCLES=6, regex extraction). This system replaces it:

- **Phase 1** (now): New commitments go to middleware ledger via `/commit` API. Local `commitments.ts` continues running in parallel for backward compat.
- **Phase 2** (after P1-d cutover): `commitments.ts` extraction feeds into ledger `POST /commit` instead of local state. Single source of truth = middleware.
- **Phase 3** (cleanup): Remove local `commitments.ts` state. All reads come from `GET /commits`.

### 5.2 Delegation → Commitment binding

When `<kuro:delegate>` or `<kuro:plan>` tag is parsed:
1. Dispatcher creates commitment via `POST /commit` with `source.channel: 'delegate'`
2. `linked_task_id` / `linked_dag_id` set from dispatch response
3. On task completion callback: auto-resolve commitment to `fulfilled`
4. On task failure/timeout: commitment stays `active` for manual triage (not auto-cancelled — failure ≠ abandonment)

### 5.3 Forge isolation (S2, blocked on this schema)

Forge-allocated tasks get `linked_task_id` pointing to the forge slot. Commitment lifecycle is independent of forge slot lifecycle — forge slot can be recycled while commitment stays active (e.g., worktree cleaned but review pending).

### 5.4 Wave chaining (S3, blocked on this schema)

Wave N+1 commitments can reference wave N commitment IDs in `parsed.to` field. This creates an audit chain without requiring explicit dependency edges in the ledger itself — the DAG owns execution ordering, the ledger owns accountability.

---

## 6. Examples

```yaml
# Active delegation commitment
- id: cmt-20260416-k7x9mz
  owner: kuro
  source: { channel: delegate, cycle_id: cycle-155 }
  text: "Move delegation.ts spawn path to middleware.dispatch"
  parsed: { action: "rewrite delegation.ts", deadline: "2026-04-17" }
  acceptance: "tsc clean + all 9 delegate types route through middleware"
  linked_task_id: task-abc-123
  linked_dag_id: null
  status: active
  created_at: "2026-04-16T14:32:00Z"
  resolved_at: null
  resolution: null

# Fulfilled by commit
- id: cmt-20260416-m3r2qp
  owner: claude-code
  source: { channel: room, message_id: "2026-04-16-034" }
  text: "Add dispatcher acceptance gate"
  parsed: { action: "add acceptance gate to dispatcher.ts" }
  acceptance: "gate rejects delegates without acceptance field"
  linked_task_id: null
  linked_dag_id: null
  status: fulfilled
  created_at: "2026-04-16T15:10:00Z"
  resolved_at: "2026-04-16T17:45:22Z"
  resolution: { kind: commit, evidence: "1c6ac626", note: "BAR Phase 1" }

# Superseded by newer commitment
- id: cmt-20260415-x8p3nq
  owner: kuro
  source: { channel: inner }
  text: "Write convergence conditions as single CC per task"
  parsed: { action: "write single CC" }
  acceptance: "each task has exactly one CC"
  status: superseded
  created_at: "2026-04-15T09:00:00Z"
  resolved_at: "2026-04-16T02:50:00Z"
  resolution: { kind: supersede, evidence: "cmt-20260416-k7x9mz", note: "upgraded to dual-CC per Alex feedback" }
```
