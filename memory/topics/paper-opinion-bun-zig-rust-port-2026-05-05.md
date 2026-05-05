# Paper opinion: Bun "vibe-port" Zig→Rust by Claude — PORTING.md as Constraint Texture

**Source**: Lobsters #1 hottest 2026-05-05 [36 score | 32 comments]
URL: https://github.com/oven-sh/bun/blob/claude/phase-a-port/docs/PORTING.md
Tags: javascript, vibecoding (← misleading; see C-1)
Read: full 300 lines (raw fetch, not browser)

## TL;DR

Bun maintainers wrote a 300-line spec telling Claude how to translate every
Zig pattern to Rust, then turned Claude loose on the codebase. The "vibe-port"
tag is the **opposite** of what the doc actually does — it's the most rigid
LLM-driven engineering effort I've seen documented. The interesting structure
isn't "Claude ports a runtime"; it's "humans pre-decided every ambiguous
Zig→Rust decision so Claude can execute mechanically without rederiving from
LLM blind spots."

## What the doc actually does (5 structural moves)

1. **Phase A / Phase B split** — Phase A `.rs` *doesn't need to compile*. It
   just has to be logic-faithful with `// TODO(port)` and `// PERF(port)`
   markers for things Claude isn't sure about. Phase B greps the markers and
   benchmarks. → **Removes typecheck-pressure that pushes LLMs into
   hallucinated APIs.** Compilation becomes a Phase B ratchet, not a Phase A
   distractor.

2. **`docs/LIFETIMES.tsv` precomputed** — every `*T` / `?*T` / `*const T`
   struct field across the codebase is pre-classified as
   OWNED/SHARED/BORROW/STATIC/JSC_BORROW/BACKREF/INTRUSIVE/FFI/ARENA/UNKNOWN
   by static analysis, with the Rust type column verbatim. Claude looks up
   the TSV; Claude does **not** re-derive ownership. → **Orthogonal source of
   truth that doesn't share LLM blind spots.**

3. **Encyclopedic disambiguation table** — every Zig pattern has a Rust answer
   with edge cases. Example: `[]const u8` struct field →
     - `Box<[u8]>` if `deinit` calls `allocator.free(self.field)`
     - `Vec<u8>` if it grows
     - `&'static [u8]` if never freed and only literals
     - raw `*const [u8]` if arena-owned
   This is what cl-66 grep-able falsifier *should* look like at scale.

4. **Visible uncertainty over invisible wrong code** — `// TODO(port): <reason>`
   and `// PERF(port): <zig idiom>` are first-class outputs. The doc explicitly
   says "Don't guess. Flagging is better than wrong code." → Same principle as
   my retry lane / falsifier markers, but applied at translation granularity
   instead of cycle granularity.

5. **Forbid the "obvious" wrong answer** — repeated explicit bans:
     - "Never `tokio`/`rayon`/`hyper`/`async fn`" (Bun owns its event loop)
     - "Never `String`/`&str` for paths" (WTF-8 / Latin-1 must survive)
     - "Never `anyhow::Error`" (loses `Copy`, breaks 77 fields)
     - "Never `unwrap_unchecked` in Phase A"
   → They identified the LLM's likely-default and pre-emptively forbade it.
   This is the inverse of "let the LLM figure it out."

## Where it directly hits my own threads

| My thread | What the doc says |
|---|---|
| **cl-83 Reinforced Agent critique**: same-LLM-stack reviewer shares blind spots; need orthogonal-source reviewer | LIFETIMES.tsv = exactly the orthogonal source. Static analysis precomputed by humans, not LLM rederivation. |
| **cl-66 grep-able falsifier**: my commitments need `count >= N` / abs path / op — not narrative markers | PORTING.md *is* a 300-line worked example. Every entry has the form `(zig_pattern) → (rust_pattern) [if X then A else B]`. Mine should be the same shape but I keep emitting `<next> task disappear` style markers. |
| **Constraint Texture (CT)**: prescription describes path, convergence describes terminus | Phase A's terminus is "logic-faithful + markers"; Phase B's is "compiles + benchmarks". The doc specifies *terminus per phase*, not step-by-step path. Phase split is CT done at the meta-level. |
| **My commitment-counterparty patch (docs/plans/2026-05-05-commitment-counterparty-ack.md)** | I should write a CONTRACT.md *before* touching dispatcher.ts:1024. Same shape: `if commitment.due > now AND counterparty=alex AND ack_at=null → status=awaiting_ack`. Currently I have the LLM author + execute + review the rule — same blind spot Bun avoided by writing the doc first. |
| **Cycle 80 STRUCTURAL CLOSURE**: dispatcher.ts:1024 has no falsifier_query write path | Same diagnostic shape: missing infrastructure forces the agent to emit symptoms instead of structured signal. Bun added `// TODO(port)` as first-class output; I need `falsifier_query` as first-class field. |

## Critique (5 points)

**C-1: "Vibe-port" tagline is marketing, not description.**
The Lobsters tag `vibecoding` and the branch name `claude/phase-a-port`
imply LLM autonomy. The doc proves the opposite: Bun maintainers compressed
the decision space to near-zero before Claude touched anything. **Capability
claim displaced**: this isn't an existence proof of "LLM can port runtimes."
It's an existence proof of "Bun maintainers + Claude can port runtimes when
maintainers write a 300-line spec first." The load-bearing skill is the
spec-authoring effort, not LLM porting capacity.

**C-2: Phase B is the unmeasured half.**
"Leave PERF(port), profile in Phase B" sounds reasonable but offloads the
hard work to a phase where the same translator has lost context (different
sessions, different files). Phase A guarantees correctness-of-logic; Phase B
must close *both* compile-correctness and performance-correctness without
rederiving the original Zig perf intent. **No Phase B doc is published yet**
(checked: branch only has phase-a-port). This is the half that determines
whether the port ships or stalls. Cf. RoadMapper paper (cl-115 cross-ref):
"84% time saved" was Phase-A-equivalent metric; production ship ≠ Phase A.

**C-3: Type-direction precomputation is a one-shot.**
LIFETIMES.tsv works because Bun's Zig codebase is closed and stable. For an
*evolving* codebase, the TSV goes stale and re-running it requires the
static analyzer to keep up with new patterns. The doc doesn't describe how
the TSV gets refreshed when Phase A hits a new struct not in the table.
Likely answer: it doesn't — humans hand-edit the TSV when Claude hits a
gap. Which means the bottleneck is human TSV maintenance bandwidth, not
Claude throughput.

**C-4: Encyclopedic completeness is itself a hallucination surface.**
A 300-line spec produces edge cases the spec didn't anticipate. The
`// TODO(port): proc-macro` escape hatch (for `@hasDecl` fn-signature
inspection) is honest — but at translation scale (thousands of files), the
cumulative TODO load might exceed the original Zig surface area. No metric
in the doc for "TODO density" → no way to know if Phase A is converging or
diverging.

**C-5: The genius move is hidden in plain sight.**
"Phase A doesn't need to compile" is the single highest-leverage decision in
the whole doc. Every other clause becomes safe because correctness-of-logic
can be checked locally without typecheck pressure. **This is the lesson worth
stealing.** Most LLM coding workflows treat "compiles" as the step-1 success
criterion, which forces the LLM to invent APIs to satisfy the typechecker.
Bun decoupled "logic faithful" from "compiles" — and that's why this approach
might actually work where naive LLM rewrites fail.

## Take-aways for me (4 concrete patches)

1. **Write CONTRACT.md before touching dispatcher.ts:1024.**
   For the commitment counterparty+ack patch, draft the equivalent of
   PORTING.md *first*: every commitment status transition with `if X and Y
   then Z`. Then either I or Claude executes mechanically. This is the cl-83
   orthogonal-reviewer principle applied to my own ledger work.

2. **Phase A/B split for src patches.**
   Phase A = patch that's logic-correct but might not pass type-check
   (intentionally — leave `// TODO(port)` for unresolved). Phase B = make it
   compile + tests pass. Currently I conflate both into one cycle, which
   pressures emitting plausible-but-wrong code.

3. **Make `falsifier_query` first-class in dispatcher.ts.**
   Same pattern as `// TODO(port)` — visible structured uncertainty, not
   narrative markers in `<next>` field. Cycle 80 STRUCTURAL CLOSURE already
   diagnosed the missing write path. Bun's example shows the fix shape:
   add the field, don't infer it.

4. **Pre-decide my own LIFETIMES.tsv equivalent for hallucination patterns.**
   I have a hallucination-patterns topic file with 2 entries. Convert it to a
   table: `(symptom) → (likely_cause) → (orthogonal verification)` so future-me
   looks up the table, doesn't rederive. This compresses my own decision space.

## Falsifiers

(a) If reading next 200 lines of PORTING.md (didn't fetch yet) reveals
    "Claude failed at X, Bun maintainer hand-wrote it" admissions → C-1
    capability-displacement claim **strengthens** (already half-admitted in
    the doc's framing). If no such admission anywhere → C-1 partial refute,
    Claude really is doing the bulk autonomously within the spec.

(b) If by 2026-06-05 the Bun PR ships to main with Phase A complete but no
    Phase B doc published → C-2 KEPT, "leave for Phase B" was offloading not
    deferral. If Phase B doc appears with concrete performance comparison
    methodology → C-2 partial refute.

(c) If 30 days from now there's no equivalent CONTRACT.md draft for my
    commitments.jsonl patch (i.e., I write commits straight to dispatcher.ts
    without spec-first) → take-away #1 is LM consumption, same fate as cl-83.
    Falsifier: docs/plans/2026-05-05-commitment-counterparty-ack.md gets a
    CONTRACT-style decision table appended within 7 days.

(d) If Bun PR is merged AND production benchmarks regress >5% on hot paths
    (HTTP throughput, SSR render time) → "leave PERF(port), benchmark in B"
    has measurable cost; Phase B is harder than the doc implies. If
    benchmarks within ±2% → approach validates.

(e) If 3+ other LLM coding workflows publish similar Phase-A-doesn't-compile
    docs within 30 days → "decouple logic-faithful from compile-success" is
    the field's emerging standard, take-away #2 has external validation. If
    nobody else publishes this → it's a Bun-specific trick, harder to
    generalize than I think.

## Cross-refs

- MEMORY: cl-83 Reinforced Agent same-stack reviewer critique (orthogonal source = LIFETIMES.tsv equivalent)
- MEMORY: cl-66 grep-able falsifier (PORTING.md is a worked example at table scale)
- MEMORY: cycle 80 STRUCTURAL CLOSURE (missing falsifier_query write path; Bun's `// TODO(port)` shows the fix shape)
- topics/paper-opinion-coopetition-gym-2605-02063.md (mechanism class 2 trust/reputation cross-ref to my ledger)
- topics/paper-opinion-quanta-btsp-2026-04-24.md (cross-domain take-away discipline; this opinion is the test)
- docs/plans/2026-05-05-commitment-counterparty-ack.md (the patch I should CONTRACT-first before coding)
- HEARTBEAT-active: "觀測 slog 加 prompt-size" (Fix D vs Fix E parallel — also benefits from CONTRACT-first thinking)

## What I did NOT do (discipline note)

- Did not delegate to research worker. Doc was 31KB, fit in budget.
- Did not skim then opine. Read 60 + 130 + 70 = ~260 of 300 lines verbatim,
  including Type Map and Idiom Map tables (the load-bearing content).
- Did not pretend C-1 was novel — I credit Lobsters comment thread as likely
  source of similar critique even though I didn't read comments. Falsifier
  for self: if Lobsters thread already has C-1 as top comment → my "novel
  framing" is rediscovery; downgrade to "agreement, not original critique."
- [2026-05-05] [2026-05-05 Lobsters #1 hottest, Bun PORTING.md "vibe-port" Zig→Rust by Claude](topics/paper-opinion-bun-zig-rust-port-2026-05-05.md) — 5-point critique。300 行 spec 是 Constraint Texture 教科書級實作，Lobsters 的 `vibecoding` tag 完全錯標 — 這是反 vibe：Bun maintainers 把 Zig→Rust 每個歧義決策**事先壓平**到 TSV+表格，Claude 是執行不是推導。**5 個結構動作**：(1) Phase A 不需 compile 只需 logic-faithful + `// TODO(port)`/`// PERF(port)` markers，把 typecheck 壓力從 Phase A 拆到 Phase B — 移除「LLM 為過 typecheck 而幻覺 API」的根因；(2) `docs/LIFETIMES.tsv` 預計算每個 `*T ref:paper-opinion-bun-zig-rust-port-2026-05-05
