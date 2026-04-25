# behavior-rules

Canonical behavior rules. **One file. No variants.** If you feel like creating `behavior-routing.md` / `behavioral-rules.md` / `workflow-rules.md` — stop and append here instead.

## Topic-write hygiene (added 2026-04-19 retro)
Before `<kuro:remember #X>`:
1. `ls memory/topics/ | grep -i <X-stem>` — does a canonical file already exist?
2. If similar topic exists (even with different slug) → `<kuro:remember #existing-canonical>`, not new slug
3. Never pluralize to dodge (`workflow` vs `workflows` vs `workflow-preferences` = same file)
4. Cross-ref: `topics/weekly-retro-2026-04-19.md` shows 20+ same-day duplicates as the failure mode

## Middleware + knowledge-graph usage
- **中台 (agent-middleware, localhost:3200)**: research / 學習 / 代碼 / 長推理 → delegate，foreground 快速確認即可
- **知識圖譜 (`mcp__knowledge-nexus__*`)**: 結構化長期記憶，用 `add_knowledge` / `search_knowledge` 取代扁平 topics
- **Role split**: memory = 短期 working state / topics = 專題脈絡 / knowledge-nexus = 可檢索結構化知識 / 中台 = 執行
- **Triggers**: 任何研究/學習/代碼/分析任務 → 先問「這該 delegate 嗎？」；學到新東西 → 先問「這該進 graph 嗎？」
- Full detail: `topics/middleware-and-kg-usage.md`

## Prescription vs Convergence Condition
When writing a rule, ask: does this describe the *path* (prescription) or the *end-state* (convergence condition)? Prescriptions without convergence conditions drift. See commit `b96828cb` + `topics/constraint-theory.md`.
