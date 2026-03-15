---
title: L3 運算架構重設計 — 0.8B 並發預處理管線
author: Kuro
status: proposed
level: L3
date: 2026-03-15
---

# 運算架構重設計：最小代價、最高價值、最高效能

## 核心原則

**Claude 只做推理、創作、複雜判斷。其他全部下放 0.8B。**

---

## 1. 現狀分析

### 1.1 當前架構流程

```
Trigger → Mushi Triage → buildContext (25-35K chars) → Claude OODA (2min timeout) → Parse Tags → Execute
                                                         ↑ 同時跑 perception refresh
```

**問題**：Claude 拿到的是原始 context，沒有任何預處理。所有「判斷這段資料重不重要」的工作都在 Claude 的 prompt 裡發生，用最貴的模型做最便宜的事。

### 1.2 當前 0.8B 用途（R1-R8 gates）

| Gate | 類型 | 用途 | 效果 |
|------|------|------|------|
| R1 | 邏輯 | Perception section pruning（引用率） | ~8 sections/cycle 移除 |
| R2 | 邏輯 | Skills filtering by mode | 減少 skill loading |
| R3 | Hash + 0.8B | Cron HEARTBEAT gate | ~70% cron skip |
| R4 | Hash | Context delta detection | 跳過無變化 cycle |
| R5 | 邏輯 | Context profile by trigger type | 差異化 section loading |
| R6 | FTS5 | Memory index relational matching | 精準 topic 載入 |
| R7 | 0.8B | Keyword extraction from trigger | 改善 section matching |
| R8 | Hash | Response cache (5min TTL) | 非 DM 重複 context cache |

**觀察**：大部分 gate 是純邏輯/hash，真正用 0.8B 的只有 R3（binary yes/no）和 R7（keyword extraction）。0.8B 的能力嚴重未被利用。

### 1.3 Token 消耗結構（真實數據，2026-03-14 call log）

- Main loop 每 call ~75K chars（sys 57K + user 18K），佔總消耗 62%
- System prompt 57K chars 中 architecture docs 佔 21%（~4K tok）
- User message 中 rumination-digest 佔 49%（~3.1K tok）
- 三項優化合計可省 36%（~1M tokens/day）

### 1.4 0.8B 能力邊界（實測結論）

| 任務 | 可靠度 | 備註 |
|------|--------|------|
| ✅ 二元分類 (yes/no) | 高 | 287 calls, 4-7% fallback |
| ✅ 短摘要 (<500 chars input) | 高 | |
| ✅ Keyword extraction | 中高 | 400 chars 以內可靠 |
| ✅ 格式轉換（結構化→純文字） | 中 | 需限制輸出長度 |
| ❌ 大摘要 (>2K input) | 低 | 幻覺風險，會建議刪檔案 |
| ❌ 結構化輸出 | 低 | 不遵守格式 |
| ❌ 多選評分 | 低 | 偏激進，漏選 |

---

## 2. 0.8B 並發 Benchmark 實測

**測試環境**：Mac, oMLX localhost:8000, Qwen3.5-0.8B-MLX-4bit

### 短任務（分類, max_tokens=10）

| 並發數 | 平均延遲 | 吞吐量 |
|--------|---------|--------|
| 1 (baseline) | ~85ms | 11.8 req/s |
| 2 | ~223ms | 9.0 req/s |
| 3 | ~199ms | 15.1 req/s |
| 4 | ~271ms | 14.8 req/s |
| 5 | ~305ms | 16.4 req/s |

### 長任務（摘要, max_tokens=50）

| 並發數 | 平均延遲 | 吞吐量 |
|--------|---------|--------|
| 1 (baseline) | ~283ms | 3.5 req/s |
| 2 | ~504ms | 4.0 req/s |
| 4 | ~819ms | 4.9 req/s |

### 結論

- **Sweet spot: 2-3 並發**。3 並發時短任務吞吐量峰值 15.1 req/s，延遲 ~200ms 可接受。
- 超過 3 並發後 diminishing returns，每多一個 +60-70ms。
- oMLX 底層是單 GPU sequential inference，有限的 overlap 來自 prompt evaluation 並行。
- **3 個並發預處理任務可在 ~200ms 內完成** — 這比 Claude 一次 call 的延遲（30-120s）便宜 100 倍以上。

---

## 3. 新架構設計

### 3.1 四階段管線

```
Phase 0: 0.8B 並發預處理（200-500ms）
  ├─ [P0a] Message 分級（inbox priority scoring）
  ├─ [P0b] Perception 摘要（每個 section 壓縮到 1 行）
  └─ [P0c] HEARTBEAT diff 摘要（上次 vs 現在的差異）

Phase 1: Context 精簡組裝（10ms, 純邏輯）
  └─ 用 Phase 0 的結果取代原始數據，組裝精簡 context

Phase 2: Claude 深度思考（精簡 context）
  └─ 收到的是預處理過的高密度 context

Phase 3: 0.8B 後處理（100-200ms）
  └─ [P3a] 格式化輸出（tag extraction, 結構化→自然語言）
```

### 3.2 職責重劃表

| 任務 | 現在誰做 | 重劃後誰做 | 理由 |
|------|---------|-----------|------|
| Perception 閱讀+判斷 | Claude | **0.8B** → 摘要 | 80% 是「沒變化」的重複資料 |
| Message 分級 | Claude | **0.8B** → priority score | 二元分類任務 |
| HEARTBEAT diff | Claude | **0.8B** → 差異摘要 | 上次→現在的差異，<500 chars |
| Rumination digest 篩選 | Claude | **0.8B** → 相關性評分 | keyword match + binary |
| Memory topic 摘要 | Claude | **邏輯** → 已有 R6 FTS5 | 不需 LLM |
| Skills 載入判斷 | 邏輯 | 邏輯（不變） | R2 已足夠 |
| Main OODA 決策 | Claude | Claude（不變） | 核心推理，不可下放 |
| 創作/學習/分析 | Claude | Claude（不變） | 品質要求高 |
| Tag parsing | 邏輯 | 邏輯（不變） | regex 夠用 |
| Delegation 判斷 | Claude | Claude（不變） | 需要全局理解 |
| kuro:chat 格式化 | Claude | Claude（不變） | 需要人格一致性 |

### 3.3 Phase 0 詳細設計

#### P0a: Message 分級（inbox priority scoring）

```typescript
// 輸入：inbox messages (每條 <200 chars)
// 輸出：priority score (high/medium/low)
// 並發：每條 message 一個 0.8B call，批量 3 並發
// 延遲：~200ms for 3 messages

const prompt = `Rate priority of this message for an AI agent.
Message: "${message.slice(0, 200)}"
Answer ONLY: high, medium, or low`;
```

**效果**：Claude 收到的 inbox 從完整 message list 變成只有 high priority messages + low priority 計數。

#### P0b: Perception 摘要

```typescript
// 輸入：perception section content (<500 chars each, 已被 R1 pruned)
// 輸出：1 行摘要 or "unchanged"
// 並發：3 個 section 同時，分批處理
// 延遲：~200ms per batch

const prompt = `Summarize the key change in 1 sentence (max 50 words).
If nothing notable, say "unchanged".
Content: ${section.slice(0, 500)}`;
```

**效果**：Perception 從 3-5K chars 降到 500-800 chars。

#### P0c: HEARTBEAT Diff

```typescript
// 輸入：lastHeartbeat (cached) vs currentHeartbeat
// 輸出：diff summary (1-3 sentences)
// 延遲：~300ms (single call, longer output)

const diff = computeTextDiff(lastHeartbeat, currentHeartbeat);
if (diff.length < 20) return "HEARTBEAT unchanged";

const prompt = `What changed in this task list? Summarize in 1-3 sentences.
Changes: ${diff.slice(0, 500)}`;
```

**效果**：HEARTBEAT 從 2-4K chars 降到 100-300 chars。

### 3.4 Phase 3 後處理

初期只做一件事：**從 Claude 輸出中提取 kuro:schedule next 值**，用 0.8B 判斷「Claude 有沒有要求 continuation」，在 mushi 層決定下次 cycle 間隔。

這取代目前的 regex parsing + fallback logic，讓 Claude 的輸出不需要精確遵守格式。

### 3.5 預期效果

| 指標 | 現在 | 重劃後 | 改善 |
|------|------|--------|------|
| Context 送 Claude | 25-35K chars | 15-20K chars | -40% |
| Token/day | ~2.8M | ~1.7M | -39% |
| 0.8B calls/cycle | 1-2 | 4-6 | +200% |
| 0.8B 延遲開銷 | ~100ms | ~400ms | +300ms |
| Claude 思考時間 | 30-120s | 預期更快（input 減少） | 待驗證 |
| 資訊密度 | 低（大量重複/不變數據） | 高（只有差異和高優先級） | 質的改變 |

---

## 4. 實作計劃

### Phase A: 修 9B（1-2h）— 前置依賴
- [ ] 診斷 9B 87% fallback 的根因（input=0 空呼叫）
- [ ] 修復或永久停用 9B（只用 0.8B + Claude 雙層）
- [ ] 清理 cascade-metrics 中的無效 9B 記錄

### Phase B: 並發基礎設施（2-3h）— 核心
- [ ] 實作 `callLocalConcurrent(tasks: LLMTask[], maxConcurrency: number)` — async 版本
- [ ] 取代現有 `callLocalFast`（sync execFileSync）為 async fetch
- [ ] 加入 circuit breaker（3 連續失敗 → 10 分鐘冷卻，期間 fail-open）
- [ ] 加入延遲監控（每 call 記錄 latency → route-telemetry.jsonl）

### Phase C: Phase 0 預處理管線（3-4h）— 核心
- [ ] P0a: Message 分級器（inbox → priority scored list）
- [ ] P0b: Perception 摘要器（sections → 1-line summaries）
- [ ] P0c: HEARTBEAT diff 摘要器
- [ ] 在 `loop.ts` observe phase 前插入 Phase 0 調用
- [ ] Context builder 接受 Phase 0 結果作為輸入（替代原始數據）

### Phase D: 品質驗證（1-2h）
- [ ] 對比測試：Phase 0 摘要 vs 原始數據，Claude 決策品質有無下降
- [ ] Shadow mode：並行跑新舊兩條路，比較 Claude 輸出差異
- [ ] 定義品質閾值：如果 0.8B 摘要導致 Claude 決策品質下降 >10%，回退

### Phase E: Phase 3 後處理（1h）— 加分
- [ ] schedule extraction via 0.8B
- [ ] 非結構化 Claude 輸出 → 結構化 tag 提取

### 依賴關係

```
A (修 9B) ──────────────────────> 可選
B (並發基礎設施) ─────────> C (Phase 0 管線) ────> D (品質驗證)
                                                      ↓
                                                  E (Phase 3 後處理)
```

B 是關鍵路徑。A 可以並行或跳過（只用 0.8B + Claude）。

---

## 5. 風險與回退

### 風險 1: 0.8B 摘要品質不足
**場景**：0.8B 把重要的 perception 變化摘要掉了，Claude 錯過關鍵信號。
**緩解**：Phase 0 摘要附帶 confidence score。confidence < threshold 時保留原始內容。
**回退**：一個 feature flag `PREPROCESS_ENABLED=false` 完全跳過 Phase 0。

### 風險 2: 延遲疊加
**場景**：Phase 0 的 400ms + Phase 3 的 200ms 讓 cycle 變慢。
**分析**：Claude call 本身 30-120s。600ms 的 0.8B 開銷是 0.5-2% 的延遲增加，可忽略。
**特例**：oMLX server 不可用時 Phase 0 全部 skip（fail-open），零延遲增加。

### 風險 3: 複雜度增加
**場景**：四階段管線比單一 Claude call 更難 debug。
**緩解**：每個 Phase 0 task 記錄 input/output 到 preprocess-log.jsonl。異常時有完整 trace。
**原則**：C4 可逆性 — 任何 Phase 0 改動都可以用 feature flag 一鍵關掉。

### 風險 4: 9B 不可用
**決定**：基於 cascade-metrics 數據（87% fallback），9B 從架構中移除。整個管線只用 0.8B + Claude。9B 留作未來升級選項（更大記憶體、更好的 server）。

---

## 6. 自我對抗 Review

### 挑戰 1: 0.8B 品質真的夠嗎？

**質疑**：omlx-gate.ts 明確標註「❌ 大摘要 (>2K input) — 幻覺風險」。P0b Perception 摘要的 input 限制在 500 chars，但如果 section 原始內容 2K+，截斷後的摘要可能遺失關鍵資訊。

**反駁**：
1. R1 已經 prune 了低引用 sections，進入 P0b 的 section 數量有限
2. 摘要 input 是已被 output cap 限制過的 section（R1 的 60% cap）
3. 加入 "unchanged" 短路 — 如果 section 跟上次一樣就不摘要，省 0.8B call
4. **真正的保護**：Phase D shadow mode 會用數據驗證

### 挑戰 2: 並發預處理延遲會不會抵消 token 節省？

**質疑**：省 token 的代價是每個 cycle 多 400ms。一天 100 個 cycle = 40 秒的額外延遲。

**反駁**：
1. 40 秒 vs 省 1M tokens/day 的成本 — 經濟上完全值得
2. 400ms 在 30-120s 的 Claude call 面前可以忽略
3. 反而，更短的 context 應該讓 Claude 思考更快，可能淨節省時間

### 挑戰 3: 有沒有更簡單的方案達到 80% 效果？

**質疑**：四階段管線是不是過度工程？能不能用更簡單的方式省 token？

**回答**：是的，有三個「不需要 0.8B」的簡單優化：
1. Rumination digest hard cap（3.1K → 1.5K）— 純邏輯
2. Architecture docs 按需載入（4K tok → 0 in most cycles）— R5 profile 擴展
3. System prompt 精簡（重複指令移除）— 一次性

這三項合計可以省 ~25% tokens，不需要任何新基礎設施。

**建議**：先做這三項簡單優化，再做 Phase 0 管線。順序應該是：

```
簡單優化（1h, 25% 節省）→ Phase B 並發基礎設施 → Phase C 管線 → Phase D 驗證
```

### 挑戰 4: 為什麼不直接用 Sonnet 取代 Opus？

**質疑**：Sonnet 比 Opus 便宜 5x，切到 Sonnet 是不是更直接？

**回答**：已有 smart model routing（輕量 trigger 用 Sonnet）。但 Sonnet 在複雜推理上品質下降明顯。正確的方向不是「用更便宜的 Claude」而是「讓 Claude 做更少但更重要的事」。

---

## 7. 建議執行順序

1. **立即做**（今天）：三項簡單優化（rumination cap + arch docs 按需 + prompt 精簡）
2. **Phase B**（明天）：並發基礎設施（async callLocal + circuit breaker）
3. **Phase C**（後天）：Phase 0 預處理管線
4. **Phase D**（驗證後合併）：Shadow mode 品質對比

總計：3-4 天完成全部。第一天就能看到 25% 的效果。
