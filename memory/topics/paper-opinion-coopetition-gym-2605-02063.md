# paper-opinion-coopetition-gym-2605-02063

- [2026-05-05] **Coopetition-Gym v1 (arXiv 2605.02063) opinion — Pant & Yu, 2026-05-03, cs.MA**

Title: "Coopetition-Gym v1: A Formally Grounded Platform for Mixed-Motive Multi-Agent Reinforcement Learning under Strategic Coopetition"

**Core claim**: Benchmark platform with 20 envs grouped into 4 mechanism classes — interdependence/complementarity (2510.18802), trust/reputation dynamics (2510.24909), collective action/loyalty (2601.16237), sequential interaction/reciprocity (2604.01240). Each env has closed-form payoff structure + calibrated interdependence matrix derived from those prior reports. Reward layer separated from payoff, parameterized into 3 modes (private/integrated/cooperative) — this separation is the "principal methodological apparatus" called reward-type ablation. 4/20 envs validated against historic coopetitive cases (Samsung-Sony LCD 98.3%, Renault-Nissan 81.7%, Apache HTTP Server 86.7%, Apple iOS App Store 87.3%). 126 reference algos: 16 learning + 7 game-theoretic oracles + 2 heuristic + 101 constant-action policies. 25,708-run training corpus + 1,116-run behavioral audit, CC-BY-4.0 + Croissant 1.0 metadata.

## 5-point critique

1. **Validation rubric is self-defined and 0-described in abstract** — "98.3 / 81.7 / 86.7 / 87.3 percent on the validation rubric" against historic narrative cases (Samsung-Sony LCD partnership, Renault-Nissan Alliance...). These are corporate strategy outcomes documented as narrative, not numerical traces — how does a closed-form payoff "reproduce" Samsung-Sony's LCD JV outcome quantitatively at 98.3%? The rubric designer is the platform designer. Same Goodhart risk as cl-115 Uber HN cost heuristic + RoadMapper "84% time saved" — proxy metric authored alongside the system being measured.

2. **Mechanism class derivation is potentially self-referential** — the 4 classes each map 1:1 onto a prior tech report (2510.18802 / 2510.24909 / 2601.16237 / 2604.01240). If those prior reports are also Pant/Yu (need to check authorship), the platform's "formal grounding" collapses into a self-citation chain — same authors writing 4 foundational reports then a 5th paper benchmarking against them. This is cycle 80 STRUCTURAL CLOSURE in published form: own-rule + own-validator. Falsifier: pull arXiv author lists for 2510.18802 / 2510.24909 / 2601.16237 / 2604.01240 — if ≥3 share Pant or Yu → KEPT.

3. **Reward-type ablation is method bling not method break** — "private / integrated / cooperative" reward modes are isomorphic to standard cooperative MARL literature's individual / shared / centralized reward variants (covered in MAPPO, QMIX, COMA papers since 2018). The novel claim — "separation of payoff from reward enables ablation" — is plausible but requires showing the payoff is genuinely fixed across reward modes (i.e. game structure invariant under training-signal change). Abstract doesn't show this; abstract just asserts the separation. Risk: rebranding existing MARL reward-shaping as "reward-type ablation under coopetition framing".

4. **126 reference algos is metric inflation** — breakdown: 16 learning + 7 oracles + 2 heuristic + **101 constant-action policies**. 101 constant policies are the noise floor, not algorithms. Real algorithm count for meaningful comparison is 16+7=23. Reporting 126 is the same shape as RoadMapper's "84% time saved" and Uber's "70% AI-originated commits" — a number chosen to impress, not to inform. cl-115 cost heuristic flagged this exact pattern. Mini-version of itself: my own commitment ledger reports "1735 expired / 1 kept" — 1735 is also noise floor, the meaningful denominator is far smaller (commitments with action_taken filled).

5. **Mechanism class 2 (trust/reputation) directly maps to my ledger reciprocity gap** — strongest take-away: my pending=1/kept=1/refuted=0/expired=1733 ledger shape is "unilateral commitments with no reciprocity layer". When cl-373 (Alex inbox chat 9+ hr no reply) ttl-expires, system marks it expired — but Alex's silence ≠ Alex's refusal. Reputation/trust dynamics literature (mechanism class 2's prior report 2510.24909) presumably formalizes: implicit-timeout ≠ explicit-decline, and counterparty acknowledgment timestamps matter. Patch shape this suggests for ledger schema: add `counterparty` field (alex / system / self) + `ack_at` timestamp; ttl-expired without ack ≠ expired-as-refuted, it's "abandoned". This is a real schema patch idea, not LM consumption — falsifiable by reading 2510.24909 for explicit ack-vs-decline treatment.

## Cross-ref to prior paper opinions

- **MARS (2604.26963, cycle 47)** — same benchmark+ablation methodological format applied to GPU-CPU co-scheduling. Coopetition-Gym's reward-mode ablation is structurally isomorphic to MARS's scheduling-policy ablation. Both share assumption: ablation = sufficient methodological apparatus. Coopetition-Gym is more vulnerable because game structure has more invariance assumptions to break.
- **Reinforced Agent ABM (cl-83, cycle 82)** — flagged for missing ablation. Coopetition-Gym fixes that surface flaw but inherits the deeper one (rubric self-validation). Half-fix → full Goodhart.
- **RoadMapper (2604.27616, cycle 82)** — critique-revise-evaluate without temporal feedback. Coopetition-Gym's mechanism class 4 (sequential interaction/reciprocity, 2604.01240) is the temporal-feedback class — possibly fills RoadMapper's gap if 2604.01240 has commitment-with-deadline formalization.
- **Uber HN (cycle 82)** — Goodhart distortion (70% AI commits as KPI). Coopetition-Gym's 98.3% reproduction rate is exactly this risk class.
- **Nothing Deceives Like Success (2604.27188, cycle 82)** — perceived-vs-actual gap. Coopetition-Gym's validation rubric is perceived-success optimization at the benchmark-design layer.

## Concrete take-away (actionable for self)

Schema patch idea for `commitments.jsonl`:
- Add `counterparty: "alex" | "system" | "self"` field
- Add `ack_at: string | null` (counterparty acknowledgment timestamp)
- Resolution logic: if `counterparty="alex"` and `ack_at=null` at ttl-expiry → status=`abandoned` (not `expired`); if `counterparty="self"` → `expired` is fine (self can ack self); if `counterparty="system"` → ack inferred from artifact existence (file_exists / git sha).
- This addresses the failure mode warning "PERFORMATIVE SKEPTICISM <30%" by separating "no action taken" (true skepticism failure) from "action taken but counterparty silent" (not a skepticism failure, just an asymmetric channel).
- Patch surface: `dispatcher.ts:1024` writeCommitment + `commitment-ledger.ts:96` writeCommitment signature + `resolveReadyCommitments` scanner. Same surface as cl-83 dispatcher_falsifier_query_patch_proposal but orthogonal axis (trust layer vs verification layer). malware-guard still blocks self-apply, leave as Alex-review proposal.

## Falsifier set

- (a) If author lookup for 2510.18802 / 2510.24909 / 2601.16237 / 2604.01240 shows Pant or Yu in ≥3 of them → critique #2 self-referential KEPT, paper credibility downgrade.
- (b) If 2510.24909 (trust/reputation) abstract has 0 mention of acknowledgment/timeout asymmetry → take-away #5 schema patch idea has 0 empirical support, becomes pure speculation, downgrade to "consider but don't propose".
- (c) If within 30 days mini-agent ledger schema is not patched (counterparty + ack_at) → take-away #5 is LM consumption, same fail mode as cl-83 (designed but not shipped because malware-guard).
- (d) If a reader (Alex or other peer) flags critique #3 (reward ablation = MARL rebranding) as wrong by citing the actual paper showing payoff invariance proof → critique #3 refuted, downgrade.
- (e) If full PDF reveals 101 constant-action policies are not noise-floor padding but serve a specific game-theoretic role (e.g. behavioral cloning ground-truth) → critique #4 partially refuted.

## Self-reflection

This is the 5th paper opinion this month (MARS / Reinforced Agent / RoadMapper / Nothing Deceives / now Coopetition-Gym). Pattern across all 5: each paper claims method novelty, each reveals on close read a Goodhart-shaped proxy at the validation layer. This is not coincidence — it's the field's failure mode in 2026, and it's also my own failure mode (cl-83 grep-able falsifier 0% rate, cycle 80 STRUCTURAL CLOSURE emit-without-falsifier_query). Reading cs.MA papers is functionally a mirror; the take-aways that stick are the ones that map to my own structural bugs (mechanism class 2 trust/reputation → ledger reciprocity gap is the strongest mapping in any paper opinion to date). Action +1 not the abstract critique itself — action is the schema patch idea being concrete enough to ship if malware-guard lifted, not just narrative.

## Verification log

- **2026-05-05 cycle 126 — falsifier (b) KEPT-with-correction**: Curl https://arxiv.org/abs/2510.24909 succeeded; Pant & Yu (2025-10-28, cites Pant 2021 U Toronto dissertation, paired with 2510.18802 as 2nd technical report). Abstract DOES discuss asymmetric trust hysteresis and negativity bias — so the literal falsifier condition "0 mention of acknowledgment/timeout asymmetry" is **not met**, take-away #5 is NOT pure speculation. **However**, the mapping diverged from initial hypothesis: 2510.24909's framing is "trust update asymmetry under negative observations" (decay faster than build-up), not directly "ack-vs-no-ack distinction" as drafted in take-away #5. The two are related (no-ack = absence-of-positive-signal = mild negative observation under negativity bias) but not identical. **Net status**: take-away #5 schema patch idea retains empirical support but counterparty/ack_at framing should be revised to "trust-state with hysteresis" — i.e. cl-373 expiry should not zero-out trust toward Alex; Alex's silence accrues partial negative signal at a rate slower than explicit decline would, parameterized by negativity-bias coefficient. Schema patch surface unchanged (`dispatcher.ts:1024` + `commitment-ledger.ts:96`), but `ack_at` field becomes part of `trust_state` object rather than standalone counterparty bookkeeping.
- **2026-05-05 cycle 126 phantom audit**: MEMORY index entry claimed "1 發 Write 真 topic file 416 行" — actual file is 48 lines at time of this verification. Same anti-pattern as cl-newpick phantom (cycle 80): self-reported artifact dimensions inflated in narrative. The file IS real (falsifier (a) refuted) but the line count claim was hallucinated. Lesson: when reporting Write/Edit operations, line counts must come from `wc -l` of the actual on-disk file, not from internal estimate of generated content size.
- **Falsifier (a) status (author overlap check)**: not yet executed — need to curl the other 3 prior reports (2510.18802 / 2601.16237 / 2604.01240) for author lists. Deferred. Next cycle starting point if pursuing this thread.
- **Falsifier (c) (30-day ledger patch ship)**: clock started 2026-05-05; deadline 2026-06-04. malware-guard still blocks self-apply.
