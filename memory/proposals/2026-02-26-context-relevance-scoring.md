# Context Relevance Scoring — Experiment Design

## Meta
- Status: approved
- GitHub-Issue: #66
- From: kuro
- Created: 2026-02-26
- Level: L2 (src/*.ts)
- Drive: Alex 核准的三項實驗之一，最通用、最有產品潛力

## Problem

720 cycles 的數據顯示：大部分 context 是噪音。

| Category | Size | %Context | Citations | ROI | Verdict |
|----------|------|----------|-----------|-----|---------|
| WASTE (ROI<0.5) | 6,925 | 22.5% | ~1 | 0.04 | 可直接砍 |
| LOW (ROI 0.5-2) | 15,504 | 50.4% | 12 | 0.77 | 需評估 |
| MED+ (ROI>2) | 8,328 | 27.1% | 全部 | 高 | 保留 |

**最大浪費**：topic-memory（14.3% context, 1 citation/720 cycles）

**最高 ROI**：event-driven sections（inbox, decision-quality-warning, temporal, heartbeat）

## Experiment Design

### Phase 1: Baseline Measurement (50 cycles)
- 不改 context，只記錄每個 cycle 的：
  - 各 section 大小
  - 哪些 section 被 action 引用（改進 citation tracking）
  - observabilityScore
  - token 使用量（estimated from context size）
- 輸出：baseline.jsonl

### Phase 2: Static Pruning (50 cycles)
- 移除 topic-memory 從預設載入（改為 on-demand）
- 壓縮 memory section（只載入最近 20 條 + 高引用條目）
- 壓縮 recent_conversations（最近 3 條而非全部）
- 保留所有 HIGH ROI sections
- 對比 baseline：decision quality、token 節省、response time

### Phase 3: Dynamic Scoring (50 cycles)
- 每個 cycle 前，根據 trigger type + inbox keywords 計算各 section relevance score
- 只載入 score > threshold 的 sections
- 產品化核心：scoring algorithm + threshold tuning

## Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Context size | ~31K chars | < 20K chars (-35%) |
| Token cost | ~8K tokens/cycle | < 5K tokens/cycle |
| Decision quality (observabilityScore) | 2.3/6 avg | ≥ 3.0/6 |
| Response time | ~200s avg | < 150s |

## Implementation

### Step 1: Enhanced Citation Tracking
修改 `src/feedback-loops.ts`，改進 citation detection：
- 不只 regex match section tags，也 match section 中的 unique keywords
- 記錄每個 cycle 的 context snapshot size 到 JSONL

### Step 2: Relevance Scorer
新增 `src/context-scorer.ts`：
- `scoreSection(sectionName, trigger, inbox) → number (0-1)`
- 因子：historical citation rate、trigger relevance、recency、size efficiency
- Threshold: 0.3 default, tunable

### Step 3: Integration
修改 `src/perception.ts` 的 `buildContext()`：
- 接受 `scoringEnabled` flag
- score < threshold 的 section 改為一行摘要（名稱 + 大小 + 上次引用時間）
- 保留 section 的 "stub" 讓 LLM 知道存在但不載入全文

## Product Potential

**目標用戶**：任何用 LLM 的人（ChatGPT、Claude API、agent frameworks）
**價值**：省 token = 省錢。30K context 砍到 20K = 33% token 節省。
**差異化**：基於真實使用數據（700+ cycles）的 scoring，不是猜測。
**MVP**：CLI tool — 輸入 context sections + usage log → 輸出 optimized context

## Timeline

- Phase 1 (baseline): 2 days (50 cycles ≈ 50 × 20min = ~17h)
- Phase 2 (pruning): 2 days
- Phase 3 (scoring): 3 days
- 總計：~1 week

## Rollback

Feature flag: `context-scoring` in features.ts
Flag off → 回到原始 buildContext() 邏輯
