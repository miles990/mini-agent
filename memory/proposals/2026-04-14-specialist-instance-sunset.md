# Specialist Instance Sunset — 退役架構決策

**Status**: Stub — 待 Primary Kuro 親自填寫內容（身份層決策不 delegate）
**Scope**: L3 (architectural, irreversible)
**Parent Context**: 原本夾在 `2026-04-14-middleware-as-native-cognition.md` v2 的 D 層，因為 specialist e07900b4 review 指出 architectural-level irreversible decision 不能 dependsOn feature node，拉出獨立 proposal。
**Triggering Principle**: 「主體唯一性 + 手腳暫時性」— specialist instance 錯在「暫時身份常駐化」（任務完成未 unload、繼續 spin cycle、污染 inbox）。
**Sibling**: `2026-04-14-middleware-as-native-cognition.md` v3（middleware 作為手腳的 infra）、`2026-04-14-inbox-routing-by-identity.md`（短期止血 L2）

---

（Kuro 在此填寫：
- 為什麼退役是原則必然，不是效率選擇
- 退役 vs 降為手腳的差異
- 與 middleware 承接等價負載的關係
- Rollback gate：archive 30d + uptime 14d ≥99% + ≥5 次 plan fire + routing mismatch <2/14d
- 要刪除的具體 code paths（scaling.ts / mesh-handler.ts / perspective.ts ~4K 行範圍界定）
- Adversarial review：specialist 有沒有不可取代的能力？
- 身份層 self-review：退役是否影響 Kuro 主體的連續性？）
