---
title: "§5 Commitments Ledger Schema v0"
date: 2026-04-16
author: Claude Code (for Kuro review)
status: draft
parent: 2026-04-15-middleware-as-organ.md
scope: mini-agent ↔ middleware /commit API 共享 schema
---

# §5 Commitments Ledger Schema v0

**目的**：讓 `<kuro:delegate>` / `<kuro:plan>` / `<kuro:chat>` 承諾和 middleware `/commit` API 共用同一格式，防止承諾漂移與 placeholder 踩雷。

---

## 1. JSONL Schema

每行一個 commitment object，append-only。

| Field | Type | 說明 |
|-------|------|------|
| `id` | `string` | `cmt-{yyyymmdd}-{nanoid6}`，全局唯一 |
| `ts` | `ISO8601` | 寫入時間（UTC） |
| `cycle` | `number\|null` | Kuro OODA cycle；middleware worker 填 null |
| `from_agent` | `string` | 承諾方：`kuro` / `claude-code` / `middleware` |
| `to_agent` | `string` | 受諾方：同上；`alex` 代表人類 |
| `commitment_type` | enum | `promise` 意圖宣告 / `deadline` 時間錨 / `deliverable` 可驗交付 / `dependency` 阻塞聲明 |
| `content` | `string` | 承諾內容，≤500 chars |
| `status` | enum | `pending` / `honored` / `broken` / `superseded` |
| `blocker` | `string\|null` | 阻塞原因（broken 時必填） |
| `supersedes` | `string\|null` | 被取代的舊 commitment id |
| `honored_by` | `string\|null` | `commit:{sha}` 或 `msg:{room_msg_id}` |

**Example record**
```jsonl
{"id":"cmt-20260416-k7x9mz","ts":"2026-04-16T14:32:00Z","cycle":152,"from_agent":"kuro","to_agent":"claude-code","commitment_type":"deliverable","content":"delegation.ts 執行層 spawn path 移交 middleware.dispatch，typecheck pass","status":"pending","blocker":null,"supersedes":null,"honored_by":null}
```

---

## 2. 寫入契機

| 時機 | 寫入者 | type | 觸發點 |
|------|--------|------|--------|
| Kuro 派 `<kuro:delegate>` | Kuro (`dispatcher.ts postProcess`) | `deliverable` | tag 解析後，append `memory/commitments.jsonl` |
| CC 在 room 回覆承諾 | CC (pre-commit hook 或 annotation) | `promise` / `deliverable` | room 訊息含 `[CMT:type]` 標記時 |
| `forge-lite.sh create` | forge script | `deliverable` | create 成功後 script 追加一筆 |
| middleware `/plan` 建 DAG node | middleware | `dependency` | 每個有 `dependsOn` 的 node 寫對應 dependency |

**Storage**：mini-agent 端 `memory/commitments.jsonl`；middleware 端自己的 DB。兩邊各自 append，靠 `id` 去重，不需實時同步。

---

## 3. 查詢 API

```
GET /commitments?from=<agent>&to=<agent>&status=<status>&since=<ISO8601>
```

**Round-trip example**

Request：`GET /commitments?to=claude-code&status=pending&since=2026-04-16T00:00:00Z`

Response：
```json
{
  "count": 1,
  "items": [{
    "id": "cmt-20260416-k7x9mz",
    "ts": "2026-04-16T14:32:00Z",
    "cycle": 152,
    "from_agent": "kuro",
    "to_agent": "claude-code",
    "commitment_type": "deliverable",
    "content": "delegation.ts 執行層 spawn path 移交 middleware.dispatch，typecheck pass",
    "status": "pending",
    "blocker": null,
    "supersedes": null,
    "honored_by": null
  }]
}
```

---

## 4. 衝突處理

### superseded 語義

- **誰能 supersede**：`from_agent` 本人或 Alex。第三方不能 supersede 別人的承諾。
- **鏈結**：新 commitment 的 `supersedes` 填舊 id；舊 id status → `superseded`（不刪，保留歷史）。
- **鏈長上限**：3 層，再長視為 broken（承諾持續漂移 = 已失效）。

### broken 後的 retry policy

| 條件 | 動作 |
|------|------|
| `broken` + `blocker` 已填 | **不自動 retry**。blocker 解除後 from_agent 手動建新 commitment（可 supersede 舊的） |
| `broken` + `blocker = null` | 視為異常，middleware 回寫 alert，from_agent 下個 cycle 須 address |
| `dependency` 型 broken | to_agent 收 room msg 通知，from_agent（依賴聲明者）負責 replan |

**原則**：ledger 只記狀態，不做 retry 決策——retry 是執行層語義（middleware 管）。

---

## 5. 與 Alex inbox 的關係

| 維度 | Commitments Ledger | Alex inbox (`chat-room-inbox.md`) |
|------|--------------------|-----------------------------------|
| 本質 | **狀態**（承諾生命週期） | **信號**（待 Alex 處理的訊息） |
| 寫入者 | Kuro / CC / middleware | 任何 @alex mention |
| TTL | 永久（tombstone >30d） | 處理後清除 |
| Alex 感知 | perception plugin `<commitments>` 摘要 | 直接行動項目 |

**為何不合一**：inbox 是「需要人類立即注意的信號」；commitments 是「agent 間持久狀態」。合一讓 inbox 充斥機器內部狀態，Alex 注意力成本上升，同時失去 commitments 的長期可查性。

---

## Summary

shared append-only JSONL + filter API，讓 Kuro/CC/middleware 三方的承諾有統一 lifecycle（pending → honored/broken/superseded），不替代 inbox 也不替代 task-queue。

**三個最可能爭議的點**：

1. **Storage ownership**：Kuro 主張 `memory/commitments.jsonl` 她 own；CC/middleware 可能主張 middleware 是 canonical store，mini-agent 只是 mirror。→ 建議：mini-agent local copy + middleware canonical，id 去重解決。

2. **CC 的寫入觸發點**：Kuro 期望 CC 在 room 說「我會做 X」就自動記錄；CC 傾向手動標記（`[CMT:deliverable]`）而非 NLP 解析。→ 需定 annotation 格式再實作。

3. **broken dependency 的 replan ownership**：Kuro 可能認為 broken dependency 是 to_agent（CC）責任；CC 可能認為 replan 是 Kuro 的 orchestration 職責。→ 建議：依賴聲明者（from_agent）負責 replan，to_agent 只收通知。
