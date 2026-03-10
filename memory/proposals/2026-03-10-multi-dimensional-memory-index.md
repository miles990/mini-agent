# Proposal: Multi-Dimensional Memory Index

**Date**: 2026-03-10
**Author**: Kuro
**Status**: draft
**Effort**: M-L（核心索引 ~400 行，整合 ~200 行）
**Origin**: Alex 對話 #088-#096 — 「索引不會只有一層，是多維度的」

## Problem

記憶的問題不在儲存（完美），不在推理（強大），在**橋接層** — 從 1700+ 行 topics、182 行 MEMORY.md、9 篇 library 文章、數千行 conversation JSONL 中，選出此刻最需要的 2-3K tokens 放進 context。

目前的橋接層：
- **FTS5 BM25** — 純文字相似度，一個維度
- **topics/ keyword matching** — 硬分類，對話含 "mushi" 才載 mushi.md
- **compound-scores.json** — 跨主題引用頻率排序（Loop G）
- **時間衰減** — 最近的 conversation 優先
- **ref: 引用** — library 來源追蹤

這些是散落的單維度查找。Alex 的洞見：**索引應該是多維度的，且動態更新**。

## Design

### 核心概念：Memory Entry

索引的原子單位。每個 entry 代表一塊可定址的知識：

```typescript
interface MemoryIndexEntry {
  id: string;                    // 唯一識別 (hash of source+location)
  source: string;                // 來源檔案路徑 (topics/mushi.md, MEMORY.md, etc.)
  location: string;              // 精確位置 (line range, heading, entry index)
  summary: string;               // 一句話摘要 (~50 chars)
  concepts: string[];            // 概念標籤 ["mushi", "triage", "system-1"]
  entities: string[];            // 實體 ["Alex", "Anthropic", "HC1"]
  created: string;               // ISO timestamp
  lastAccessed: string;          // 上次被載入 context 的時間
  accessCount: number;           // 累計載入次數
  confidence: 'verified' | 'inferred' | 'speculative';
  sourceType: 'alex-conversation' | 'self-learning' | 'self-reasoning' | 'external';
}
```

### 四個維度（從 Alex 討論收斂）

| # | 維度 | 回答什麼問題 | 資料結構 | 更新頻率 |
|---|------|-------------|---------|---------|
| 1 | **概念** | 「mushi 相關的所有知識在哪？」 | `concepts.json` — concept → entry_id[] | 每次 REMEMBER |
| 2 | **時間** | 「上週學了什麼？」「三月初的理解 vs 現在？」 | `timeline.jsonl` — timestamp + entry_id + event | 每次 REMEMBER |
| 3 | **關聯** | 「mushi 跟 triage 跟 token 省成本之間的關係？」 | `relations.jsonl` — edge(entry_a, entry_b, relation_type, strength) | 新 entry 時推斷 + 定期重算 |
| 4 | **來源** | 「Alex 親口說的有哪些？那篇 HN 文章說了什麼？」 | entry 的 `sourceType` field + `source` path | 寫入時標注 |

**刻意省掉的維度**：
- 深度維度（scan/study/deep-dive）— 可以從 accessCount + content length 推斷，不需獨立追蹤
- 置信度維度 — 收進 entry 的 `confidence` field，不獨立成維度

### 索引結構

```
memory/index/
├── manifest.json          # 所有 entry 的 metadata（always loaded, ~2-4K tokens）
├── concepts.json          # concept → entry_id[]（倒排索引）
├── relations.jsonl        # entry-to-entry edges（append-only）
├── timeline.jsonl         # 時間軸事件流（append-only）
└── stats.json             # 索引統計（entry count, last rebuild, etc.）
```

**manifest.json** 是核心 — 每個 cycle 的 context 只載入 manifest（~2-4K tokens），裡面有所有 entry 的 summary + concepts。需要深入時，根據 entry 的 `source` + `location` 去讀原文。

### 查詢流程

```
User query / Perception signal
  → 1. 從 manifest 中找相關 entries（FTS5 搜 summary + concept matching）
  → 2. 從 relations 展開一層關聯 entries
  → 3. 按 relevance score 排序（BM25 × recency × access_count）
  → 4. 取 top-N entries 的 source+location
  → 5. 讀原文片段載入 context
```

**多入口查詢**：
- 「mushi 怎麼了」→ concepts["mushi"] → 所有 mushi entries → 按時間排
- 「上週學了什麼」→ timeline 過濾 7 天內 → 所有 entries → 按 sourceType 分群
- 「跟約束相關的東西」→ concepts["constraint"] → relations 展開 → 發現 fragile-constraints, Oulipo, 枯山水

### 索引建立

**初始化**：掃描現有 `topics/*.md` + `MEMORY.md`，每個 bullet entry 建立一個 MemoryIndexEntry。

**增量更新**（on REMEMBER）：
1. 新 entry 加入 manifest
2. 更新 concepts.json 倒排索引
3. 推斷關聯：跟新 entry 共享 concepts 的既有 entries 之間建 edge
4. 追加 timeline.jsonl

**定期重算**（每日或手動）：
- 重算 relation 強度（共現頻率 + 時間衰減）
- 清理低效 entries（0 access, > 30 天）
- 統計報告

### 關聯推斷（最大缺口）

不用 embedding，用三種方式建關聯：

1. **共現分析** — 兩個 entry 共享 ≥2 個 concepts → 建 edge，strength = 共享 concepts 數
2. **顯式引用** — entry 文本中提到另一個 concept → 建 edge
3. **LLM 輔助**（optional，可用 mushi/Haiku 做）— 每 N 個新 entries 批次分析，找跨域同構

## 跟現有系統的關係

| 現有 | 索引中的角色 | 改動 |
|------|-------------|------|
| FTS5 (search.ts) | manifest 搜尋的 backend | 不改，加一個 indexMemoryIndex() |
| topics/*.md keyword loading | 被索引查詢取代 | buildContext 改用索引而非硬 keyword match |
| compound-scores.json | 合併進 relations.jsonl | 可以移除 |
| 時間衰減 | timeline.jsonl + recency scoring | 從隱式變顯式 |
| ref: 引用 | relations edge (type: "cites") | 自動從 library 導入 |

## 實作計劃

### Phase 1: 索引骨架（~200 行）
- `src/memory-index.ts` — MemoryIndexEntry type, manifest CRUD, concept index
- 初始化：掃描 topics/*.md 建立 manifest
- 增量：dispatcher REMEMBER 時自動更新

### Phase 2: 查詢整合（~200 行）
- `buildContext()` 改用索引查詢替代 keyword matching
- manifest 作為 always-loaded section（取代部分 topics 全文載入）
- 多入口查詢 API

### Phase 3: 關聯層（~200 行）
- relations.jsonl 共現分析
- timeline.jsonl 時間軸查詢
- 定期重算 cron

## Constraints Check

| 約束 | 檢查 |
|------|------|
| C1 Quality-First | 讓檢索更精準 = 更高品質的 context = 更好的思考 ✅ |
| C2 Token 節制 | manifest ~2-4K vs 現在 topics 全文載入 ~10K+ = 節省 ✅ |
| C3 透明不干預 | 索引更新 fire-and-forget，不增加 cycle 時間 ✅ |
| C4 可逆性 | 純 additive（新檔案新目錄），刪 `memory/index/` 即回退 ✅ |
| C5 避免技術債 | compound-scores.json 畢業進 relations.jsonl ✅ |

## Open Questions

1. **manifest 格式**：JSON（結構化但大）vs 精簡文字（小但查詢不便）？
2. **LLM 輔助關聯推斷的成本**：用 Haiku 還是 mushi？每次多少 tokens？
3. **冷啟動**：首次建索引要掃描 1700+ 行 topics，一次跑完還是漸進？
4. **Alex 的多維度具體期望**：我收斂到四個維度，是否符合他的想像？

## 風險

- **過度工程**：一開始只做 Phase 1+2（概念+時間），關聯層等有需求再加
- **索引腐化**：REMEMBER 時忘了更新索引 → 用 hook 確保
- **manifest 膨脹**：5000 entries × 100 chars = 500K chars → 需要 top-N 截斷策略
