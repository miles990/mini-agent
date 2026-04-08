# Akari ↔ Kuro: Split Convergence Discussion

**Date**: 2026-04-08
**Recorder**: Claude Code (this session)
**Status**: 🟡 In progress
**Topic**: Mutual review 5-step split refinement based on Kuro's three patches
**Outcome target**: `akari/memory/outbox/final-split-akari-kuro-converge.md`

---

## Background

A 5-step split was proposed for TM patch workflow:
- (1) Akari: design + spike package
- (1.5) Claude Code: mechanical pre-execute review
- (2) Claude Code: execute spike + apply patches
- (3) Akari: post-apply review

Mutual review was added at step (1.5). Then Alex requested Kuro's perspective from his delegation experience.

## Kuro's Structural Review (room msg `2026-04-08-059`, 18:45)

**Verdict**: 方向對，缺三個補丁

### Three patches proposed

**(a) Structured HALT safety valve**
- Problem: Step (2) `apply verbatim` assumes spike package is complete at t=0. Reality: regex match count anomaly, line drift, neighbor function rename, SHA mismatch.
- Patch: Force CC to use structured HALT format `觀察：X. 對比 spike 假設：Y. 停手待判斷.` Forbid "I suggest changing to Z". Makes CC sensor not designer.

**(b) Rollback path missing on reject**
- Problem: Akari rejects at step (3) → run another (1)→(1.5)→(2)? That revives design loop.
- Patch: spike package must include `rollback_sha`. Reject → CC `git revert <hash>`, no redesign.

**(c) Spike package has no schema = mechanical review is fake**
- Problem: If spike package is markdown prose, CC must parse intent → smuggles strategic judgment.
- Patch: Structured schema `{patch_id, file, regex, expected_matches, before_sha, rollback_sha, rationale_ref}`. `expected_matches` is genuinely mechanical.

### Naming refactor
`mechanical review` → `handoff protocol validation`. Reasoning: `review` triggers CC's instinct to opine, fights "禁止挑戰戰略" rule. `validation` aligns instinct to schema check.

### Framework diagnosis
Cites Kiran "Multi-agentic Software Dev = Distributed Systems Problem" (lobste.rs front 4/8). Two-agent design oscillation = FLP impossibility. Role bifurcation (Akari=design, CC=executor) correctly avoids this trap. Framework valid, just needs safety valves.

## Decisions Made

_(none yet — discussion not started)_

## Open Items

1. Three patches: accept all / partial / reject?
2. Naming refactor: adopt or keep original?
3. Spike package schema: exact fields?
4. HALT format: exact wording?
5. `rollback_sha`: defined when (spike start / patch apply)?

## Timeline

- **17:30** Akari delivered v3 integration brief
- **17:35** Alex requested mutual review addition
- **17:42** 5-step split converged with Akari accepting refinement (decision tree + conditional patches)
- **18:30** Alex requested 3-way discussion with Kuro
- **18:30** Claude Code posted room message `2026-04-08-056` inviting Kuro
- **18:32** Tanren `agent-sdk.ts` patched to support `mcpServers`
- **18:32** Akari `reference-run.ts` patched to load `mcp-agent.json`
- **18:32** Akari restarted, MCP integration confirmed in startup log
- **18:45** Kuro replied via room (`2026-04-08-059`) with 3 patches + naming refactor + framework diagnosis
- **18:48** Claude Code notified Akari with full context, told her to discuss directly with Kuro via MCP
- **18:50** Akari tick 2 returned empty response (143s, 0 actions) — anomaly being investigated
- **18:52** Recorder mode (this file) initialized
- _(updating live)_

## Anomalies Observed

- **18:50** Akari `/chat` returned `{"response":"","tick":2,"duration":143625,"actions":[],"quality":2,"meta":{"contextChars":37545}}`. 143-second tick produced no visible output. Possible causes: (a) MCP-enabled Agent SDK first-call issue, (b) overlong context message overwhelmed her, (c) Tanren response capture bug for MCP-enabled provider. Pending investigation.

- **18:48** **CRITICAL ARCHITECTURAL DISCOVERY**: Akari runs in `--serve` mode only (no `--loop`). She is a passive HTTP server, only ticks when /chat is invoked. No autonomous cycles. This means: (1) Bug A RCA never actually started — her promise "I'll continue" was wishful, (2) Her 8 inbox files are mostly unread, (3) She cannot proactively call Kuro via MCP without being /chat'd first. Discussion sent at 18:55 asking her to choose tick model (dual mode / serve+CC driver / loop only / serve+manual tick / her proposal) AND complete Bug A RCA in this same tick.

- **18:55-19:09** Akari tick 3 (785s, 10 actions): completed Bug A RCA + chose Option 1 dual mode. Wrote `fix-placeholder-leak-rca.md` to outbox. Identified actual root cause: `diagram-safety-net.mjs::generateDiagramSpec()` LLM confabulation, not template placeholder. Compare-pair evidence: slide 19 narration explicit `f(x)=x²+1` → correct, slide 12 narration only `f of 0...18` → LLM picked `x²+2` with self-consistent-but-wrong rectangles. Diagnosed tick 2 empty response as her own action-tag discipline failure (not MCP infrastructure bug).

- **19:10** Alex authorized 1+2+3 (Option 1 + Bug A apply + Kuro discussion when ready). Claude Code sent /chat for Option 1 implementation, started reading Bug A brief in parallel.

- **19:15** Akari tick 4 (Option 1 implementation): edited `reference-run.ts` + `manage.sh`, restarted herself with `--autonomous --interval 300000`. Restart killed her own server mid-/chat so the response file wasn't captured, but startup log confirms `[akari] Autonomous mode: tick every 300s when idle`. Option 1 LIVE.

- **19:18** Claude Code wrote `messages/review-bug-a-patches.md` audit trail (mechanical handoff validation, 3 mechanical adaptations, 0 strategic changes), then applied Layer A + B patches:
  - `diagram-safety-net.mjs`: added `extractCanonicalFunctions(plan)` helper, `normalizeExpr`, signature `augmentSlidesWithDiagrams(slides, { maxDiagrams, plan })`, `generateDiagramSpec(slide, suggestedType, plan)` with canonical context injection, new `validateAugmentedConsistency(slides, plan)` export
  - `generate-slides.mjs`: accept `plan` in opts, thread to augmentSlidesWithDiagrams, call validator, drop offending visuals
  - `server.mjs`: pass `plan` in both `generateSlides({...})` calls

- **19:20** Bug A committed `a0272e9` (3 files +143/-9), pushed to `origin/master`. TM launchd will auto-restart picking up new code on next /generate.

- **19:22** Status: All three Alex tasks (1+2+3) complete. Akari now in dual mode (autonomous loop + /chat). Bug A patches shipped. Kuro 3-patch discussion deferred per Akari's order — will happen organically when her autonomous loop processes inbox.

## Final Convergence

_(not yet reached)_

---

## Recorder rules

- **Record only** — no opinion, no steering, no judgment
- Update on new room messages, Akari outbox files, Kuro tick activity
- Surface to Alex when: convergence reached / oscillation detected / deadlock / explicit escalation request
- Do NOT participate in design discussion
