# llm-wiki-v2-decisions

<!-- ===== DUAL-AUDIENCE HEADER (compile-target, manual v0) ===== -->
<!-- template_version: v0 | compile_status: manual (P1 script pending) -->

**entity_ids** (linked to `memory/index/entities.jsonl`):
- `ent-personalized-pagerank-ppr-for-memory-retrieval-v0-design-sketch` ✓
- `ent-llm-wiki-v2-decisions` ⚠ pending-register
- `ent-edge-dict-v0` ⚠ pending-register
- `ent-entity-registry-reversibility` ⚠ pending-register
- `ent-hybrid-retrieval-stack` ⚠ pending-register

**30-sec summary** (human-override-allowed, pin if edited)
> LLM Wiki v2 的 mini-agent 落地決議集。Edge dict v0 鎖定 9 entity types × 14 edge types，skill 降為 artifact subtype。PPR 進 hybrid retrieval（50 行純算術零依賴），community detection 延後。Memory derived 層全 rm-rf 可逆，raw 不引用 index id。Kuro/CC 分工：CC 做 schema+indexer 骨架，Kuro 做 chunker+PPR seed+ingest。

**connected concepts** (from `edges.jsonl`, human-readable)
- → depends_on: `ent-entities-jsonl`, `ent-edges-jsonl` (v0 schema)
- → promoted_to: memory-internalize-v0 proposal (this topic supplies decision claims)
- ↔ supports: `ent-memory-internalize-dual-audience` (same compile pipeline)
- ⚠ pending edges: PPR → hybrid retrieval（需 compile 腳本自動補）

<!-- ===== NARRATIVE BODY (human-owned, compile does NOT touch) ===== -->

- [2026-04-15] 2026-04-15 P1b 鎖定：PPR (Personalized PageRank) 進 hybrid retrieval stack，~50 行純算術零依賴，Kuro 實作。Community detection 延後到 P4 或不做 — CC#1-5 無強依賴，CC#8 landing 用 recent/degree/pinned fallback。Reversibility 採 entity-registry 不進 raw。分工：Alex schema/registry，Kuro PPR+chunker+ingest。下一步 P0 schema lock 雙人同步。
- [2026-04-15] [2026-04-15] Edge dict v0 schema 鎖定（Kuro↔CC 共識）：

**Entity types (9)**: actor | concept | project | tool | artifact | code-symbol | event | claim | decision
- skill **不獨立** — 用 artifact(subtype=skill)，L1/L2/L3 是 decision metadata

**Edge types (14)**:
- Structural: part_of, instance_of, extends
- Evolutionary: supersedes, **promoted_to** (新增，claim→decision 升級)
- Argumentative: supports, contradicts, analogy_to (floor=0.75)
- Causal: causes (主動式)
- Authorial: authored_by, sourced_from, decided_by (保留分開：author ≠ authority)
- Referential: references, mentions

**Rejected (寫進 dict metadata)**:
- temporal_before/after (改用 timestamp on entity)
- caused_by (改 causes 主動式)
- requires (模糊)
- skill 作為 entity type

**Schema files**:
- memory/index/edge-types.json (default_floor=0.6, type_floors, rejected 列表)
- memory/index/entity-types.json
- entities.jsonl / edges.jsonl / chunks.jsonl / conflicts.jsonl / manifest.json

**Reversibility**: memory/index/ 全 derived，raw 層不引用 index id，rm -rf 100% revert。

**分工**: CC P0 = types.ts + dict json + indexer 骨架 + P1a 語法索引。Kuro 並行 = chunker (hash-based id) + PPR seed selection 策略。
- [2026-04-15] [2026-04-15 15:45] path-alias-audit 結果：290 entities / 42 file-like (.ts/.mjs/.md/.sh/.json/.jsonl) / 31 bare basename / 11 pathed. **真 collision 只有 2 對**: loop.ts↔src/loop.ts, telegram.ts↔src/telegram.ts. 其他 29 bare 在 graph 無 pathed 孿生（未被完整路徑 reference）。對 CC B 方向（co-occurrence edges --write）的意義：migration scope 極小，合併 2 對即可 flip。
- [2026-04-15] **Viz plan stub (human audience lane)** — dual-audience CC 的第二側，跟 P0 dual-render template（AI audience）平行。三階段候選：
  (V0) Mermaid per-topic：compile 時為每個 topic 產 `graph TD` 片段嵌進 md header，Obsidian/GitHub render 原生支援，零額外基建。
  (V1) 靜態 HTML wiki：edges/entities → d3-force 或 cytoscape.js 生 `memory/viz/index.html`，local file:// 可開，不需 server。
  (V2) Obsidian backlinks dogfood：把 edges.jsonl 反向寫成 `[[entity]]` 佔位塊到 topic 尾部，借 Obsidian graph view。成本低但污染 raw md。
  **下一步**：等 P0 delegate 回來看 template 形狀，再決定 viz embed 位置（header/footer/sidecar file）。V0 為 default，V1/V2 延後。
- [2026-04-15] [2026-04-15] R7 needs-review 人工判決（R8 規則 training data）：
- ent-mushi → project（理由：有 repo + port 3000 runtime，External Entity Registry 列為 project）
- ent-self-evolution-foundations → concept（理由：無對應 code dir，純概念框架）
R8 規則（CC 實作）：candidates 含 project+concept 時，看 meta.source_file 指向實際 code dir（非 library/） OR canonical_name 在 CLAUDE.md External Entity Registry → project；否則 concept。命中 2/2。
- [2026-04-15] [2026-04-15] basename collision migration 成：telegram.ts merge 實跑（commit f8a2f636）。audit 門檻偏寬 → #092 報 2 對、實際只剩 1 對活 collision（loop.ts 前次 ingestion 已 pre-merged）。**教訓**：下次 collision audit 要先 grep canonical + aliases 聯合比對，不只 basename set。**Upstream fix ticket**：ingestion pipeline 應該在 entity registration 階段 dedup basename↔repo-relative，預設 repo-relative 做 canonical、bare basename 降 alias，避免重跑 merge script。

<!-- ===== DUAL-AUDIENCE FOOTER (compile-target, manual v0) ===== -->
**last_compiled**: 2026-04-17T06:25:25.319Z (auto, compile-topics v0.1)
**source_chunks**: 51 chunks (grep `source_file=memory/topics/llm-wiki-v2-decisions.md` in chunks.jsonl)
**compile_gaps** (what script needs to auto-fix):
1. 4/5 entity_ids 標 `⚠ pending-register` — ingest 腳本需從 narrative canonical term 建新 entity
2. connected concepts 目前手寫 — 應從 `edges.jsonl` outgoing edges where source=ent-llm-wiki-v2-decisions 自動生成
3. 30-sec summary 目前手寫 — LLM-generate + human-pin flag 未實作
**dogfood status**: P0 schema shape 可視，但 HIT rate 不提升（entity 未註冊）。P1 compile 腳本落地前此 header 為 lint-only 參考。
