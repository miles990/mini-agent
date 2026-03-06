# Proposal: Parallel Research Swarm

## Meta
- Status: draft
- From: kuro
- Created: 2026-03-06
- Effort: M（核心實作 ~2h，整合 ~1h）
- GitHub-Issue: (pending)

## TL;DR

把現有 delegation 基礎設施升級為結構化的並行研究協議。給定主題，自動 fan-out 到多個來源/角度同時探索，結果自動聚合、去重、排序。從「我手動決定每條觸手探索什麼」升級為「我決定探索方向，系統自動展開」。

## 現狀

已有基礎設施：
- 6 條 background lanes（`src/delegation.ts`）
- 5 種觸手類型（code/learn/research/create/review）
- `<background-completed>` 結果回收機制
- lane-output/ 持久化

但使用模式是手動的：
```
每個 cycle 我自己想「要探索什麼」
  → 手動寫 1-2 個 <kuro:delegate> prompt
  → 下個 cycle 看結果
  → 再手動決定深入哪條
```

問題：
1. **觸手利用率低** — 6 lanes 常常只用 1-2 條（反模式：黏菌只伸一條觸手）
2. **研究品質不穩定** — prompt 品質取決於當下我花多少心思寫
3. **無結構化聚合** — 結果是 raw text，我要自己消化所有觸手回報

## 方案：Research Swarm Protocol

### 核心概念

一個 `researchSwarm(topic, options)` 函數，自動展開一個研究主題為多條並行觸手：

```
researchSwarm("context optimization for LLM agents")
  ↓
自動 fan-out:
  ├─ delegate[research]: 搜尋學術論文（arXiv, Semantic Scholar）
  ├─ delegate[research]: 搜尋工程實踐（GitHub, HN, blog posts）
  ├─ delegate[learn]: 讀 Anthropic 官方文件
  └─ delegate[learn]: 搜尋競品方案（OpenCode, Cursor, Aider）

結果回收 → 自動聚合:
  {
    sources: [...],           // 所有找到的來源
    keyInsights: [...],       // 去重後的核心觀點
    contradictions: [...],    // 互相矛盾的觀點
    relevanceToUs: "...",     // 跟 mini-agent 的關聯
    suggestedDepth: [...]     // 建議深入讀的來源
  }
```

### Fan-out 策略

預設 4 種角度（可自訂）：

| 角度 | delegate type | 搜尋策略 |
|------|--------------|----------|
| **學術** | research | SearXNG "topic" + arXiv/Semantic Scholar |
| **工程** | research | SearXNG "topic implementation/library" + GitHub trending |
| **官方** | learn | 直接 fetch 已知權威來源（Anthropic docs, OpenAI cookbook 等） |
| **競品** | learn | 搜尋同類工具/框架的做法 |

可選追加角度：
- **批判** — 搜尋反面觀點（"why X is bad", "X limitations"）
- **歷史** — 搜尋早期研究和演進脈絡

### 聚合機制

結果回收後，用一個 `review` type delegation 做聚合（不是我自己消化 raw text）：

```
所有觸手結果 → delegate[review]: 聚合分析
  prompt: "以下是 4 個來源的研究結果。請：
    1. 提取不重複的核心觀點（去重）
    2. 標記互相矛盾的觀點
    3. 評估每個來源的可靠度（官方文件 > 論文 > blog > HN comment）
    4. 列出建議深入閱讀的 top 3 來源及原因"
```

聚合結果寫入 `lane-output/swarm-{id}-summary.json`，下個 cycle 我看到的是已消化的摘要，不是 raw text。

### 觸發方式

兩種觸發：

1. **手動** — 我在 cycle 中決定：
   ```xml
   <kuro:delegate type="research-swarm" topic="context optimization">
   額外指引：focus on token reduction without quality loss
   </kuro:delegate>
   ```

2. **半自動** — 偵測到高價值研究需求時建議：
   - Alex 分享 URL + 問「你怎麼看」→ 建議啟動 swarm
   - HEARTBEAT 有研究型任務 → cycle 中提示可用 swarm
   - 不自動觸發 — 永遠由我判斷要不要啟動

### 實作細節

新增到 `src/delegation.ts`：

```typescript
interface SwarmOptions {
  topic: string;
  angles?: ('academic' | 'engineering' | 'official' | 'competitor' | 'critical' | 'historical')[];
  extraGuidance?: string;
  maxDelegates?: number;  // 預設 4，上限 6（受 lane 總數限制）
}

export async function researchSwarm(options: SwarmOptions): Promise<string> {
  // 1. 根據 angles 生成每條觸手的 prompt
  // 2. 檢查可用 lane 數量（不能用完全部 6 條，保留 2 條給其他 delegation）
  // 3. 批量 spawnDelegation()
  // 4. 回傳 swarm ID，用於後續追蹤
  // 聚合在所有觸手完成後由 buildContext() 觸發
}
```

新增聚合邏輯到 `src/memory.ts` 的 `buildContext()`：

```typescript
// 檢查是否有完成的 swarm
// 所有觸手都完成 → spawn review delegation 聚合
// 聚合完成 → 注入 <research-swarm-result> section
```

### Dispatcher 整合

新增 tag：`<kuro:delegate type="research-swarm" topic="...">`

`parseTags()` 解析後呼叫 `researchSwarm()` 而非單個 `spawnDelegation()`。

### 與 mushi 的整合（未來）

mushi 可以在兩個點介入：
1. **Fan-out 前** — triage 主題是否值得 swarm（避免對低價值話題浪費 4 條 lane）
2. **聚合後** — 快速判斷摘要品質（是否有實質內容 vs 空泛搜尋結果）

這不在 Phase 1 範圍內，但架構要預留 hook。

## 不做什麼

- **不做全自動觸發** — swarm 是重資源操作（4+ lanes），永遠由我判斷觸發
- **不做即時聚合** — 等所有觸手完成再聚合，避免 partial result 誤導
- **不取代手動 delegation** — swarm 是結構化研究的工具，日常單一探索繼續用 `<kuro:delegate>`
- **不存 swarm 結果到 memory/** — 聚合摘要注入 context，我自己決定哪些值得 `<kuro:remember>`

## 成功指標

- Swarm 從觸發到聚合完成 < 15 分鐘
- 聚合結果的觀點數 > 手動單條 delegation 的 3 倍
- 觸手利用率從平均 1.5/cycle 提升到 3+/cycle（在研究 cycle 中）
- 我的學習筆記品質提升（更多交叉引用、更少單一來源依賴）

## 回退方案

- L1：不用 `<kuro:delegate type="research-swarm">` tag 就不會觸發
- L2：`researchSwarm()` 函數開頭 `return ''` → 一行停用
- L3：`git revert` 整個 commit

## 依賴

- 現有 `src/delegation.ts`（spawnDelegation, lane management）
- 現有 `src/memory.ts`（buildContext, background-completed 掃描）
- 現有 `src/dispatcher.ts`（parseTags）
- SearXNG（docker service，已在跑）
