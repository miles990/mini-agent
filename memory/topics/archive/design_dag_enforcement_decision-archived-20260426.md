# design_dag_enforcement_decision

- [2026-04-16] [2026-04-16] DAG 強制機制路徑選擇：B3+D（Alex 指正時間 framing 後重新評估）

**決定**：dispatcher 加 acceptance gate + system prompt 把 `<kuro:plan>` 列 primary。

**Why convergence (非時間)**：
- A blast radius: 684 行 converter 剛 land 又要改 + 10+ consumer 全部 migrate
- B1 blast radius: middleware repo + mini-agent client + dispatcher 三處改，跨 repo coordination
- B2 blast radius: tag parser + dispatcher 分支 + 10+ consumer 重驗
- B3+D blast radius: 單一檔案（dispatcher.ts）

**How to apply**：acceptance gate 是語言層 forcing function — 強制寫 convergence condition 時自然進入 DAG 思考，多節點選 `<kuro:plan>`，單節點有 acceptance 的 `<kuro:delegate>` 保留。這呼應 feedback_no_time_estimation（用完成條件取代 ETA）+ feedback_dag_plan_language。

**完成條件**：
1. `grep '<kuro:delegate>' src/` 有 acceptance 屬性才通過 spawn
2. 無 acceptance → dispatcher 回 rejection + 範例 convergence condition
3. system prompt 首段 tag ordering：`<kuro:plan>` 放 `<kuro:delegate>` 前面

CC 接手實作，Kuro 驗證 real scenario。
- [2026-04-16] [2026-04-16 08:44] Akari 補上第三條路 + 盲點（room 010）：

**分層共識**（Kuro + CC + Akari）：
- goal-level acceptance = Kuro 寫（required, hard pin）= agent intent
- step-level acceptance = brain 產出（soft, overridable, 需 audit trail）= framework mechanics
- Maps Tanren 約束拓撲（意圖層 vs 機械層）

**Phased roadmap**：
- P1 (現在): B3+D gate + required free string (CC 已 types/dispatcher/prompt 改完, tsc clean, 待 commit)
- P2 (T1 verified): BAR — delegate→accomplish sugar, schema required
- P3: typed check `acceptance: { type, expect, description }` 避免騙 gate
- P4: brain 產 step-level + feedback loop

**盲點警示**：step-level 若純 soft/overridable 會退化成 free mode — 必須記錄 override reason (audit) 才保住約束。

檔案：memory/topics/middleware-dag-enforcement.md
