# feedback_p1d_bridge_progress

- [2026-04-15] [2026-04-15 22:05] P1-d edit-layer first wire (commit 26ed39bc, kuro/p1d-delegation-shim):
- delegation.ts +58 行（commitmentStart + commitmentClose helpers + 3 wire sites）
- POST /commit verified: owner=kuro, source.channel=delegate, parsed.action=delegate:{type}, acceptance, linked_task_id 全部接受
- PATCH /commit/:id 200 但 server-side no-op（status 不變、無 resolved_at）— middleware-side bug 待 CC 修
- middleware-client.ts:320 listCommitments 期待 array，server 回 {count, items: []} — 另一 mismatch（不影響本 bridge）
