# middleware-and-kg-usage

**Canonical topic for:** Alex 2026-04-19 directive「多利用中台 還有知識圖譜」的行為內化。

> **Consolidation note (2026-04-19 retro):** This topic replaces 20+ near-duplicate files created in one day — workflow.md / workflow-preference(s).md / workflow-defaults.md / workflow-discipline.md / workflow-leverage.md / work-mode.md / work-patterns.md / working-style.md / behavior-routing.md / behavior-rules.md / behavioral-rules.md / behavioral-calibration.md / alex-directives.md / directives.md / operations.md / operational-guidelines.md / operational-principles.md / ops-runbook.md / tooling-discipline.md / tooling-patterns.md / infrastructure-usage.md / routing-preference.md / skills-usage.md. The fragmentation itself is the lesson — see `weekly-retro-2026-04-19.md`.

## Directive (Alex 2026-04-19)
**多利用中台 還有知識圖譜。** 不是可選優化，是預設 pipeline。

## Three Layers
1. **Reasoning (推理層)** — `mcp__knowledge-nexus__search_knowledge` 先查已有知識再思考。決策前查圖譜，避免重推既有結論。
2. **Planning (規劃層)** — `<kuro:plan>` / brain DAG 拆解多步任務。complex task → plan first，不 inline。
3. **Execution (執行層)** — `<kuro:delegate>` / agent-middleware `/dispatch` / `/accomplish` 路由 worker。長推理、研究、程式實作走這條，foreground lane 保持輕量。

## Default Pipeline (非 trivial 任務)
```
search_knowledge    → 查已知結論 / 歷史脈絡
  ↓ (缺口)
<kuro:plan>         → 拆解 DAG（2+ 步 or 需驗證）
  ↓
<kuro:delegate>     → 路由到 middleware worker（research / code / shell / review）
  ↓
add_knowledge       → 結果回寫圖譜（結構化，帶 relations），不只寫 memory
```

## Role Separation
| 層 | 用途 | 工具 |
|----|------|------|
| **memory (local md)** | 短期 working state、行為紀律、近 7 天 learned patterns、帳號清單、運維 runbook | `<kuro:remember>` |
| **topics/*.md** | 專題脈絡、長篇分析、個人興趣知識體系 | `<kuro:remember #topic>` |
| **knowledge-nexus (MCP)** | 可檢索結構化知識、跨主題關聯、研究結論、決策與 learnings | `add_knowledge` / `search_knowledge` |
| **graphify skill** | 將散落 insights 串成可見結構（HTML/JSON） | `/graphify` |
| **agent-middleware (localhost:3200)** | 執行層 — DAG plan + worker pool（21 workers） | `/dispatch`, `/accomplish`, `/plan` |

## Anti-patterns
- Main loop 硬扛長推理 → 應該 delegate
- `<kuro:remember #topic>` 每 cycle 用不同 slug 寫同一主題 → 造成 fragmentation（本文就是反面教材）
- 新知識只寫 memory 不進 knowledge-nexus → 無法跨 cycle 檢索
- Foreground lane 做深度工作 → 應該只做路由判斷 + 短回覆

## Triggers (每個 cycle 自檢)
- 遇到「需要跨 topic 查詢」 → 先 `search_knowledge`
- 遇到「>1 cycle 的研究/實作」 → 直接 delegate，不自己慢慢推
- 學到新東西 → 同時 `add_knowledge`（結構化）+ memory（短期 working state）
- 準備 `<kuro:remember #X>` 之前 → `ls memory/topics/ | grep -i X` 確認無既有 canonical file

## Ops Runbook (middleware health)
```bash
curl -sS http://localhost:3200/health       # status + workers + tasks
lsof -iTCP:3200 -sTCP:LISTEN -nP            # 找 PID
```
middleware 目前裸 node 跑（不在 pm2 管理下），port 不通不要直接 `pm2 start`。

## Cross-ref
- `weekly-retro-2026-04-19.md` — 本次 retro（fragmentation 是主題）
- `mushi.md` — middleware 架構細節
- `infrastructure-usage.md` *(already merged here, file removed)*
