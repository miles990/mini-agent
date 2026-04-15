## P1-d 誠實校正 (2026-04-16 cycle #146)

**Ground truth (git diff main..kuro/p1d-delegation-shim --stat)**:
- `src/delegation.ts` **0 diff** — 1431 行原封不動
- 已有：`delegation-converter.draft.ts` 65L + test 69L + `middleware-client.ts` +3L
- 先前「P1-d 推進中」過度樂觀；真相 = scaffolding only, 未整合

**Un-block check (2026-04-16 05:30)**:
- Middleware live: `curl :3200/health` → 12 workers, 60 tasks ✅
- `/commits` live schema: `{id, created_at, source, parsed:{action,to}, text, status}` 已可用
- §5 extension (acceptance/cycle/blockedOn) 是 nice-to-have，**不阻塞 cutover**
- 上 cycle 標「blocked on CC middleware live」= 錯判

**Concrete cutover plan (next cycle ≤50 lines)**:
1. `src/delegation.ts` L549 `spawnDelegation(task)` 加 flag gate：
   ```
   if (process.env.KURO_MIDDLEWARE_SHIM === '1') {
     return convertAndDispatchAsPlan(task, forgeCreate); // via client.plan()
   }
   ```
2. 將 draft 的 `convertAndDispatch` 重寫為 `convertAndDispatchAsPlan`：包 1-step plan 走 `client.plan()`（已驗證 cwd 注入路徑）
3. 整合測試：env flag on/off 各跑一次 `spawnDelegation`
4. 預設 flag=off，保留 fallback；green 後下 cycle 切 default=on

**Next action gate**: ≤50 行 diff + 2 個 integration test + commit + push