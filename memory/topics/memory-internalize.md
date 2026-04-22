# memory-internalize

- [2026-04-15] [2026-04-15 18:07] P0 dual-audience template live example 落到 `memory/topics/llm-wiki-v2-decisions.md`：header (entity_ids 1 linked + 4 ⚠ pending) / 30-sec summary / connected concepts (human-readable) / footer 含 compile_gaps 自述。narrative body 不動。dogfood：schema shape 可視，HIT rate 改進卡 P1 compile 腳本。下一步 P1 `scripts/compile-topics.ts`：(1)從 narrative canonical term 建 pending entity (2)edges.jsonl outgoing → connected concepts (3)30-sec summary LLM-gen+human-pin。memory/ 自帶 git repo auto-commit 處理。
- [2026-04-15] [2026-04-15 18:22] `scripts/compile-topics.ts` v0.1 live (兌現 room 189 P1 承諾)。
- Marker-based opt-in: 只處理有 `DUAL-AUDIENCE HEADER/NARRATIVE BODY/DUAL-AUDIENCE FOOTER` 三個 marker 的 topic md
- Footer auto-updated: last_compiled + source_chunks count (grep chunks.jsonl)
- Header 智能 preserve: no outgoing edges → keep human-curated list (人類 curation > auto-empty 警告)
- Narrative body 永不觸碰
- 設計決策: `renderConnectedConcepts()` 返回 `null` 時 header 整塊保留（第一版直接覆寫 = bug，修正：人寫 > auto）
- 驗證: `llm-wiki-v2-decisions.md` footer → `(auto, compile-topics v0.1)` + 23 chunks, narrative body 64 行不動
- Depends on CC indexer: entity registration + canonical term ingest 後，connected concepts 才能 auto-render（edge type grouping）
- 用法: `pnpm tsx scripts/compile-topics.ts [--topic <slug>] [--write]`
