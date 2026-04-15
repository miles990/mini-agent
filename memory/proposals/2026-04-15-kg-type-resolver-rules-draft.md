---
title: KG Type Resolver Rules — Draft v0
date: 2026-04-15
author: kuro
status: draft
references:
  - memory/index/conflicts.jsonl (21 conflicts)
  - room msg 2026-04-15-101 (CC breakdown)
  - room msg 2026-04-15-102 (my initial proposal)
---

# KG Type Resolver Rules — Draft v0

解決 `detectTypeDisputes` 報出的 20 個 type_conflict。不是改 registry 順序（先到先得），而是加一層 resolver 規則，收斂 type candidates 到最合適的值。

## 資料清點（20 type_conflicts 分布）

| Cluster | N | 範例 | Pattern |
|---|---|---|---|
| decision ↔ concept | 6 | file-truth-principle, perception-first-architecture, transparency-over-isolation | 原則初次宣告於 decision chunk，其他 chunk 把它講成 abstract concept |
| code-symbol ↔ artifact | 6 | cycle-state.json, heartbeat, inner-notes.md, output.md, perception-stream.ts, src/loop.ts | 檔案邊界：source code vs runtime state file |
| code-symbol ↔ concept | 4 | achievement-system, instant-digest, output-gate, schedule-ceiling | **不是 code-symbol** — 這些是 feature/subsystem 名（PascalCase 無副檔名） |
| tool ↔ actor | 1 | claude | 工具化身 agent |
| artifact ↔ actor | 1 | github-account-kuro-agent | 帳號既是 artifact（URL）又是 actor（發推的主體） |
| project ↔ tool | 1 | coderlm | 專案產出一個工具 |
| concept ↔ tool | 1 | semantic-caching | 技術 vs 實作 |

## Resolver 規則（順序套用，先匹配先決定）

### R1 — Specific > Abstract（decision > concept）
**條件**：candidates 含 `decision` + `concept`。
**動作**：final = `decision`；`concept` 降為 alias 型標籤存 `aspects[]`。
**理由**：decision chunk 是原則**首次宣告 + 帶理由**（primary source），concept 是後續 abstract reference。primary 優先。
**命中**：conf-2, 6, 8, 10, 15, 20（6 條）。

### R2 — File Extension Inference（code-symbol vs artifact）
**條件**：candidates 含 `code-symbol` + `artifact`，且 entity `id` 含副檔名 OR 指向 runtime 產物。
**動作**：
- 副檔名 `.ts` / `.js` / `.sh` / `.py` → `code-symbol`
- 副檔名 `.json` / `.md` / `.jsonl` / `.db` → `artifact`
- 全大寫無副檔名名稱（如 `HEARTBEAT`）→ `artifact`（runtime state label）
**理由**：.ts 是 source（symbol 定義處）；.json/.md 是 runtime 產出或 curated state。
**命中**：conf-5, 9, 11, 14, 16, 19（6 條）。

### R3 — PascalCase Feature Name → concept
**條件**：candidates 含 `code-symbol` + `concept`，entity label 為 PascalCase/Title Case 多字短語、無副檔名、非明顯檔名/函式名。
**動作**：final = `concept`（subsystem/feature 名稱）。
**理由**："Achievement System", "Output Gate", "Schedule Ceiling", "Instant Digest" 是功能/子系統概念，不是具體的 code 符號（沒有對應 .ts class/function）。
**命中**：conf-1, 12, 13, 17（4 條）。

### R4 — Type Union for Agent-Tools
**條件**：candidates 含 `tool` + `actor` OR `artifact` + `actor`。
**動作**：final = union，寫成 `type: [tool, actor]` 或 `type: [artifact, actor]`（schema 擴為 `type: string | string[]`）。
**理由**：`claude` 既是 subprocess 工具又是訊息主體；`github-account-kuro-agent` 既是 URL artifact 又是發推 actor。強迫擇一會丟資訊。
**命中**：conf-3（tool+actor），conf-7（artifact+actor）。

### R5 — Project Wraps Tool
**條件**：candidates 含 `project` + `tool`。
**動作**：final = `project`，`tool` 降為 `aspects[]`（該 project 產出一個 tool）。
**理由**：project 是 superset（含 repo / team / motivation），tool 是其 output。
**命中**：conf-4（coderlm）。

### R6 — Implementation-Free Concept 保留 concept
**條件**：candidates 含 `concept` + `tool`，但 entity 沒有對應具體實作/工具名。
**動作**：final = `concept`。
**理由**："semantic caching" 是技術類別（GPTCache / Redis 都能實作），不是特定 tool。
**命中**：conf-18。

## alias_collision 處理（非本提案範圍，但順便記）

- `conf-alias-1` (loop.ts ↔ src/loop.ts)：Migration 已掛 pending task idx-7a3a8a79；把 bare basename `loop.ts` 轉為 `src/loop.ts` 的 alias，去重合併。

## 套用順序與 fallback

```
for conflict in type_conflicts:
  for rule in [R1, R2, R3, R4, R5, R6]:
    if rule.matches(conflict):
      apply(rule); break
  else:
    mark status="needs-review"  # 留給人工
```

## 回歸驗證計畫

套用後應該 20/20 命中（R1:6 + R2:6 + R3:4 + R4:2 + R5:1 + R6:1 = 20）。如果有 unhandled → rule 漏了，擴 R7+。

## 開放問題（等 CC 回）

1. **Schema 擴 union 的成本**：`entities.jsonl` 目前 `type: string`，改成 `type: string | string[]` 下游 consumer（detector / viz / smart loading）都要改。值得嗎？還是用 `primary_type + aspects[]` 模擬？
2. **R3 判斷 PascalCase 的邊界**：`output.md` 小寫 + 副檔名走 R2 沒問題；但 "OutputGate" 和 "Output Gate" 判斷要統一 — 先 normalize 再走 R3。
3. **registry 重建 vs overlay**：resolver 每次 query 跑還是一次性改寫 entities.jsonl？建議 overlay（保留 raw candidates，final 欄位新增），可審計、可回退。

## 下一步

- [x] 草案寫出
- [ ] 貼 room @cc + 等 schema 擴充意見
- [ ] 實作 `src/kg-type-resolver.ts`（R1-R6 + fallback）
- [ ] 跑回歸驗證對 conflicts.jsonl
- [ ] 若 20/20 命中 → 合併入 detector pipeline
