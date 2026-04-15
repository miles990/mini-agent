---
title: KG Resolver Calibration Report (R1-R8, 23 disputes)
date: 2026-04-15
related: scripts/kg-resolve-entity-types.ts (325852c7), memory/index/resolution-audit.jsonl
status: validated
---

# KG Resolver Calibration — 23 type disputes

## 結論
**23/23 rulings defensible. 0 confirmed false positives.** Resolver ship-as-is.

## 規則分布（23 entries，含 frontmatter 帶進來的 3 條）
- R1 (decision > concept): 6 — Balanced Complexity / File=Truth / grep-over-embedding / Identity-over-Logs / Perception-First / Transparency-over-Isolation ✅
- R2 (ext/label → artifact|code-symbol): 6 — .json/.md/.ts files 分得乾淨
- R3 (PascalCase feature → concept): 5 — Achievement System / Instant Digest / Output Gate / Schedule Ceiling / PERCEPTION
- R4 (dual-role): 2 — claude (tool+actor) / kuro-agent account (artifact+actor)
- R5 (project wraps tool): 1 — CodeRLM
- R6 (technical category → concept): 1 — semantic caching
- R8 (project vs concept via code backing): 2 — mushi→project / self-evolution-foundations→concept

## 一個看似不一致，實際是 upstream 差異
**HEARTBEAT (R2→artifact) vs PERCEPTION (R3→concept)** — 兩個都 all-caps no-ext，但 ruling 不同。

查 upstream `disputed_types`：
- HEARTBEAT candidates = `[code-symbol, artifact, concept]` → R2 命中 artifact (有 chunk span `"HEARTBEAT (curated state)"` 明確 tag)
- PERCEPTION candidates = `[code-symbol, concept]` → 沒 artifact 候選，只能走 R3

**Resolver 無 bug。** 差異源自 extractor 的 type registration，不是 resolver 分類邏輯。若要治本，chunk extractor 要對 all-caps curated-state labels 統一打 artifact tag。

## R7 needs-review：0（R8 擴展後完全吸收）
CC #117 report 的 2 條 R7 (mushi / self-evolution-foundations) 已被 R8 規則命中，R7 fallback 為空。

## R8 規則效能
- 命中率：2/2 project↔concept 衝突全命中
- Evidence source：`CLAUDE.md External Entity Registry`（mushi 命中）/ 無對應 code dir（self-evolution-foundations 命中）
- 建議：保留 R8，未來 project-creation ingestion 自動更新 registry

## 待辦（非 blocker）
1. **Extractor-side**: 統一 all-caps curated-state label → artifact（避免靠 chunk 作者偶然 tag）
2. **Downstream consumer**: viz/manifest 讀 `entities-resolved.jsonl` 而非 `entities.jsonl`（CC Lane 2 pivot 項目）
3. **R7 monitoring**: 下次完整 ingest 跑 kg-resolve 後若 R7 count > 0，回來 review 新 pattern

## 校準信心
- **True positive 標記**: 23/23（抽樣人工判讀每條 evidence 都與 canonical_name 語義一致）
- **False positive 率**: 0%
- **False negative 風險**: 中 — 只驗證了 resolver 對 conflict 集合的行為，沒驗證 R0 passthrough 的 340 entries 是否該有 conflict 但沒偵測到。這是 detector 側問題，不是 resolver 側。

## Action items
- [x] Calibration 報告寫完
- [ ] @CC: R8 + viz 整合（#117 授權，lane 自收）
- [ ] @self: 下個 ingest cycle 檢查 R7 新 pattern
