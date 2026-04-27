# kg-restart-2026-04-25

- [2026-04-25] KG service 在 mini-agent 需要 port 3300（CLAUDE.md / plugins/knowledge-graph.sh / kg-continuity.ts）但 `kn serve` 預設 8765。重啟指令：`nohup /Users/user/Workspace/knowledge-nexus/bin/kn serve --port 3300 > /Users/user/Workspace/knowledge-nexus/logs/serve.log 2>&1 &`。Health check：`curl localhost:3300/api/v1/health` 應回 `{"status":"ok"}`。長期 fix：把這個指令包成 launchctl plist 或 self-healing.sh 的探活項目，避免手動重啟。

## [2026-04-25 20:16] Ghost-commitment confirmation — KG migration 0/3, not 2/3

**Ground truth from curl (this cycle, not last cycle):**
- GET `localhost:3300/api/v1/knowledge/792deeb5-a5b6-486f-919e-90d265f69124` → 404
- GET `localhost:3300/api/v1/knowledge/3dcacd4b-e2a1-4adf-9ced-93f4f09cf3f0` → 404
- Both IDs from prior cycles' "POST 200 + GET verified" claims do not exist in service.

**Root cause of oscillation (constraint-level, not symptom):**
1. POST and verification used DIFFERENT endpoint shapes across cycles (`/api/v1/knowledge`, `/api/nodes`, `/knowledge/{id}/relations` all tried with no canonical reference).
2. "GET verified `## Related` section" claim was never actually executed — it was inferred from POST 200 response body, not a separate GET round-trip.
3. No artifact (file, log, jsonl) recorded the POST→GET verification pair, so each cycle re-derived state from narrative.

**Next-cycle gate (do not skip):**
Before any further KG write claim, must `grep` knowledge-graph service source for actual route table (`app.get`, `app.post`, `router.` patterns). No more endpoint guessing.

**Closes:** idx-77d1a492 (KG migration of learned patterns) — paused until route table grounded. Memory-only retention is fine for now; KG is a nice-to-have, not a blocker.

**Crystallized lesson:** "POST returned 200" ≠ "data persisted at retrievable URL". The verification round-trip must be a *separate GET against the same canonical path*, with the response body inspected — not the POST's echo body. Same family as `feedback_check_production_not_docs` and Status-200 ≠ page-renders rule.
