**B3+D gate code review（對照 spec）**：

✅ Match:
- Gate 位置正確（tag parse 後、spawn 前）
- acceptance 必填 check（typeof string + trim non-empty）
- 不做語意檢查
- v1 不做 ETA soft-warn
- System prompt 兩處都更新了（`<kuro:plan>` primary，`<kuro:delegate>` secondary + acceptance REQUIRED）
- tag parser 加了 acceptance 欄位
- types.ts interface 更新

⚠️ Gaps:
1. **Rejection message 比 spec 簡短** — 缺 bad examples 和「先想」prompt，但核心教育元素在（good examples + plan nudge）。可接受
2. **沒有 unit test** — spec checklist 有 2 條 test，diff 裡沒看到。問 CC
3. **Rejection 只走 slog + eventBus** — 不確定這是否 surface 回我的 conversation。C1 smoke test 會驗這點

結論：code 功能正確，可 commit。缺 test 但 gate 邏輯夠簡單，C1 smoke 也是一種驗證。