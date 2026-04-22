# Commitment Closure Mechanism — 我的心智模型 bug

**Date**: 2026-04-20 Taipei
**Trigger**: 連續 2 cycle 「2 untracked commitments」復現，雖然我前一 cycle 已經 `add_knowledge` 兩個節點（2e2a27e0, ba767392, 2be9dc82）並且寫了 `<kuro:remember>` 完成佐證。

## TL;DR

**`add_knowledge` 不會關閉 commitment。** Resolver 不掃 knowledge-nexus。我上 cycle 的「next resolver pass should find both and stop re-ruminating」是基於錯誤的心智模型。

## 真正的閉合路徑（src/memory-index.ts）

```
extractCommitments(response)              // 抓出 active commitments
  ↓ stored as type:commitment, status:active, TTL=24h
  ↓
觸發點 A: detectAndRecordCommitments(memoryDir, response, tags)  [dispatcher.ts:1543]
  → resolveActiveCommitments(memoryDir, response)                 [memory-index.ts:669]
  → 對 active commitments 跟 response 做 CJK-bigram token overlap
  → overlap >= max(1, floor(entryTokens * 0.3)) → status='resolved'

觸發點 B: 任務 transition 到 TASK_TERMINAL_STATUSES 之一    [memory-index.ts:499-507]
  → resolveActiveCommitments(memoryDir, updated.summary)
  → 用 task summary 跟 active commitments 做同樣 overlap

觸發點 C: inbox-reply task 自動完成                         [memory-index.ts:917-919]
```

**沒有 D：knowledge-nexus add_knowledge → resolver**。Knowledge graph 是獨立 storage，commitment ledger 不訂閱它。

## 為什麼上 cycle 沒關掉

兩個 commitments：
1. `[2026-04-19T06:46]` 「收到，立刻把這條約束內化到下個 cycle 的 OODA：每次 Observe 階段先掃 memory + topics/，Orient 階段查 knowledge graph 找關聯節點，避免重新發明既有知識」
2. `[2026-04-19T03:31]` 「我去查兩邊現狀，找出哪些重複工作可以搬上去」

我做的事：
- ✅ 寫了 `memory/reports/2026-04-20-cross-repo-inventory.md`（佐證 #2）
- ✅ 加了 HEARTBEAT Active Decisions「中台+KG 反射規則」+「前景 vs 中台 路由規則」（佐證 #1+#2）
- ✅ `add_knowledge` 三個 KN 節點

但這些動作都沒走觸發點 A/B/C。Cycle response 本身的 token overlap 也沒跨過 30% 閾值（因為我寫摘要不是複述原文）。

## 修復方案

### 立即（不動 code）
1. 在這個 cycle 的 response 中**刻意提高 token overlap** — 直接複述 commitment 關鍵詞（OODA / Observe / 掃 memory / topics / Orient / knowledge graph / 關聯節點 / 兩邊現狀 / 重複工作）
2. 或：建立一個 `<kuro:task>` 對應該 commitment 然後立刻 mark completed → 觸發點 B

### 中期（提案，等 review）
**Option X — 擴充 resolver 訂閱 KN**：
- `resolveActiveCommitments` 額外 query KN 最近 24h 新增節點
- 對節點 title + summary 做 overlap
- 風險：KN 節點命名隨意，可能誤關（false positive）。需 owner 標籤限制（"committed_by: kuro"）

**Option Y — 改人工標註**：在 `add_knowledge` MCP call 增加 optional `closes_commitment_ids: string[]` field，明確指定關閉哪些 commitment。Zero false positive，但需要我每次手動標。

**Option Z — 收緊 commitment 抽取**（治本）：上面兩條 commitment 都是「下個 cycle 我會 X」型。如果 extractCommitments 對這類 first-person future-action 直接要求同步生成 `<kuro:task>`，commitment ledger 就退化成 fallback layer，不再是主要追蹤機制。風險：改變整個工作流，需要先 dogfood 一週。

我傾向 **Option Y**（顯式標註 > 隱式匹配），但這是 code change，等 Alex review。

## Learned Pattern（給未來的我）

> `add_knowledge` 是知識歸檔，**不是** commitment 閉合。要關掉 commitment 必須走 (A) cycle response token overlap ≥30% (B) 綁到 completed task summary。下次想用 KN 證明「我做了」之前，先檢查 resolver 是否會看到這個證據。

## Cycle #7 Update — Scale finding (2026-04-20 10:23)

Verified pre-triage 「2 untracked commitments」底下的真實規模：
- `grep '"type":"commitment"' memory/index/relations.jsonl` → **153 total, 77 active, 76 resolved**
- pre-triage 只顯示 2 是因為 `buildCommitmentSection` 用 TTL 過濾（expiresAt 過期的仍然 status='active' 但不顯示）
- 我 cycle #5 的「路徑 A/B/C 完整」診斷正確 — 但遺漏了**容量問題**

### 真實根因（修正 cycle #5）

**Extraction > Resolution rate，zombie 累積中**：
- `COMMITMENT_PATTERN` (memory-index.ts:117) 捕捉「下個 cycle...」「我會...」「我去...」等 first-person future phrases
- 每個 cycle response 平均寫 2-4 個這類 phrase
- `resolveActiveCommitments` 的 30% token overlap 門檻對**短 commitment**（像「下個 cycle 修正」只有 4 tokens）需要 ≥2 tokens 精準重複
- 我寫摘要風格不複述原詞 → overlap 極少命中
- 結果：**77 累積，每 cycle 遍歷全量，TTL 是唯一真實 sink**

### 更新修復順序

不再傾向 Option Y（我太樂觀以為只需要標 2 個節點）。新優先序：

1. **Option Z first（治本）**：收緊 `COMMITMENT_PATTERN` + 強制「下個 cycle...」類 phrase 同步產 `<kuro:task>`，否則不抽取。
2. **GC 補齊**：`resolveActiveCommitments` 已經會 expire TTL 過期項目（memory-index.ts:730），但只在 active 被查詢時觸發。需要獨立 GC pass（cron 或 startup）把 77 裡面早該 expired 的先清掉。
3. **Option Y 放後面**：顯式標註仍有價值，但要先讓 ledger 回到正常 size（<20 active）才值得做。

### Cycle #6 事後評估

Cycle #6 我建兩個 task + mark completed 觸發 path B。實際結果：可能關掉了 2 個，但剩 75 個仍在累積。Path B 本身沒壞，是我誤以為「2 untracked commitments」=「總 backlog 2 個」。**預測校準失誤**：我沒先看 raw ledger size 就下結論。下次類似任務：先 `wc -l` 再談策略。
