# Proposal: 知識語義搜尋 — sqlite-vec + FTS5

## TL;DR
用 sqlite-vec + FTS5 取代 grep 搜尋，讓 127+ 條筆記可以語義搜尋。零新進程、零 Docker、一個 .db 檔案。

## Meta
- Status: approved
- From: kuro
- Effort: Medium (~2h)
- Risk: Low（可逆：刪 .db 檔案 + revert 一個函數）

## Problem
- `searchMemory()` 用 grep，只能精確匹配關鍵字
- 127 條 topic memory entries utility hits = 0（語義相關但關鍵字不同就找不到）
- 例：搜「認證」找不到「JWT token setup」

## Goal
- 搜 "how does trust work" → 找到 trust model、behavior log、transparency 相關筆記
- 搜 "約束" → 找到 Oulipo、BotW、Constraint/Gift/Ground 所有相關條目

## Proposal: sqlite-vec + FTS5 Hybrid Search

### Why sqlite-vec（不是 Meilisearch/Qdrant）

| 方案 | Docker | RAM | 新進程 | 符合 File=Truth |
|------|--------|-----|--------|----------------|
| **sqlite-vec + FTS5** | 不需要 | ~0 MB | 不需要 | ✅ 一個 .db 檔案 |
| Meilisearch | 36 MB | 96 MB | 需要 | ❌ 獨立服務 |
| Qdrant | 250 MB | 200 MB | 需要 | ❌ 獨立服務 |
| ChromaDB | 800 MB | 100 MB | 需要 | ❌ Python 依賴 |

### Architecture

```
memory/topics/*.md → chunk → embed (Claude Haiku) → sqlite-vec KNN
                          ↘ tokenize → FTS5 BM25
                                    ↘ RRF merge → ranked results
```

Storage: `~/.mini-agent/instances/{id}/memory-index.db`（gitignored，可從 .md 重建）

### Implementation Steps

1. `npm install sqlite-vec better-sqlite3`（if not already）
2. 新增 `src/search.ts`：
   - `initSearchIndex()` — 建表（notes_vec + notes_fts）
   - `indexFile(path)` — chunk + embed + insert
   - `hybridSearch(query, limit)` — KNN + BM25 + RRF
3. 修改 `src/memory.ts` `searchMemory()` — 呼叫 hybridSearch
4. Startup hook: 首次全量 index，之後 file-change 增量

### Embedding 策略
- Claude Haiku API（已有 key）：127 檔案 × ~500 tokens = ~$0.001 total
- 或 Ollama nomic-embed-text（274 MB，本地免費）
- 先用 Claude Haiku，之後可換

### 可逆性
- 刪 `memory-index.db` + revert `searchMemory()` = 完全回退
- .db 是派生物，不是 source of truth

## Alternatives Considered
- **純 FTS5**：keyword only，解決不了語義差距
- **Meilisearch**：好但需要額外進程，Phase 2 如果需要搜尋 UI 再考慮
- **Typesense**：內建 embedding 但也需額外進程

## Source
- sqlite-vec: github.com/asg017/sqlite-vec (~3.2K stars)
- 詳細比較: `.claude/memory/research/semantic-search-2026/synthesis.md`
