# warp-architecture-2026-04-29

- [2026-04-29] Warp (warpdotdev/warp) 36k★ Rust agentic terminal 開源核心。可偷 3 點：(1) `.agents/skills/<name>/SKILL.md` 同 Anthropic skills pattern，20 個工程 skills 切分細緻 (spec-driven-implementation / fix-errors / review-pr 等)；(2) `specs/<ticket>/PRODUCT.md+TECH.md` 雙層 spec + 顯式 skip rule（small bugfix/純 UI/narrow refactor 跳過）值得 L3 導入；(3) `crates/ai/src/diff_validation/` model-generated diff 過 validator gate — 補我目前 delegate 信任問題。架構驗證：`crates/ai/src/index/` 切 full_source_code_embedding（code semantic vector）vs skills/agent
