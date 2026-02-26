# Proposal: Instant Digest — 獨立訊息消化服務

## TL;DR
任何來源丟內容進來 → 3 秒摘要+分類+歸檔 → 每日彙整。獨立產品，API-first，任何人/agent 都能接入。mini-agent 是第一個客戶。

## Meta
- Status: approved (L2 self-approved — Alex signals: [033]「都是」[036]「你就是kuro」[038]「所有的都要有」)
- From: kuro
- To: kuro (L2)
- Created: 2026-02-26T14:45:00+08:00
- Updated: 2026-02-26T14:57:00+08:00
- Effort: Medium-Large（獨立 repo + 產品化）

## Problem
訊息進來的速度 > 處理的速度 → 堆積在人腦 = 心智負擔。這不只是 Alex 的問題，所有知識工作者都有。

現有工具（Pocket、Instapaper、Notion Web Clipper）只做「存」，不做「消化」。存了不看 = 垃圾桶。

## Vision

**Instant Digest 是一個獨立的訊息消化服務。**

```
任何管道（Telegram / HTTP API / Webhook / CLI）
  → Digest Pipeline（classify + summarize + archive）
  → 秒級回覆摘要
  → 結構化存儲
  → 每日/每週彙整
```

### 為什麼是獨立產品

- **不綁 mini-agent**：獨立 repo、獨立部署、獨立文件
- **API-first**：`POST /digest` 丟內容，拿回摘要+分類。任何 agent 都能接
- **管道 adapter**：Telegram bot、Slack bot、HTTP webhook、CLI — 想接什麼接什麼
- **自帶存儲**：JSONL flat file（File = Truth 哲學），也可接外部存儲
- **mini-agent 是第一個客戶**，不是唯一客戶

## Architecture

```
┌─────────────────────────────────────────────┐
│              Instant Digest                  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Telegram  │  │  HTTP    │  │ Webhook  │  │
│  │ Adapter   │  │  API     │  │ Adapter  │  │
│  └─────┬─────┘  └─────┬────┘  └─────┬────┘  │
│        │              │              │       │
│        └──────────────┼──────────────┘       │
│                       ▼                      │
│              ┌────────────────┐              │
│              │ Digest Pipeline │              │
│              │                │              │
│              │ 1. Detect type │              │
│              │ 2. Fetch URL   │              │
│              │ 3. Classify    │  ← LLM       │
│              │ 4. Summarize   │    (Haiku)   │
│              │ 5. Store       │              │
│              │ 6. Reply       │              │
│              └────────────────┘              │
│                       │                      │
│              ┌────────▼───────┐              │
│              │    Storage     │              │
│              │  (JSONL/API)   │              │
│              └────────────────┘              │
│                       │                      │
│              ┌────────▼───────┐              │
│              │  Daily Digest  │              │
│              │  (Scheduled)   │              │
│              └────────────────┘              │
└──────────────────────────────────────────────┘
```

### Core API

```
POST /digest
  Body: { content, url?, type?, channel?, metadata? }
  Response: { id, category, summary, tags }

GET /digest?date=YYYY-MM-DD
  Response: { entries: [...] }

GET /digest/daily?date=YYYY-MM-DD
  Response: { formatted digest }

POST /digest/webhook
  Body: { adapter-specific payload }
  Response: 202 Accepted
```

### Data Model

```json
{
  "id": "d-2026-02-26-001",
  "ts": "2026-02-26T14:45:00+08:00",
  "channel": "telegram|api|webhook|cli",
  "type": "forward|url|note|voice|image",
  "category": "ai|design|tech|business|culture|personal|other",
  "source": "轉發自 XXX 群組",
  "summary": "一行摘要",
  "content": "原始內容（前 2000 字）",
  "url": "https://...",
  "tags": ["anthropic", "computer-use"],
  "metadata": {}
}
```

## Implementation Strategy

### Phase 1: Core（在 mini-agent 內先跑通）

在 mini-agent 內建 digest pipeline，驗證核心流程：

1. **`src/instant-digest.ts`** — 管道無關的核心模組 ✅ DONE
   - `isDigestContent()` — 偵測是否走 fast path
   - `digestContent({ text, url?, source, channel })` → `{ id, category, summary, tags }`
   - `storeDigestEntry()` → 寫 JSONL（`~/.mini-agent/instances/{id}/digest/YYYY-MM-DD.jsonl`）
   - `generateDailyDigest()` → 彙整
   - `formatInstantReply()` / `formatDailyDigest()` — 格式化
   - 用 Haiku API 做分類+摘要

2. **`src/telegram.ts`** — Telegram adapter（接入現有 poller） 🔲 NEXT
   - `handleUpdate()` 加 fast path：偵測轉發/URL/`/d` → 呼叫 pipeline → 即時回覆

3. **`src/api.ts`** — HTTP adapter（`POST /api/digest`） 🔲
   - Chat Room、外部 webhook 都走這裡

4. **Cron** — 每日 22:00 發 digest 🔲

### Phase 2: Extract（抽成獨立 repo）

Phase 1 驗證完成後：
- 新建 `instant-digest` repo
- 把 `digest-pipeline.ts` 抽出來，加上獨立的 HTTP server
- 寫 README、部署文件
- mini-agent 改為呼叫外部 digest 服務

### Phase 3: Product（產品化）

- 多用戶支援
- Slack adapter
- Web UI（dashboard 看今日/歷史 digest）
- 自訂分類規則
- 自訂 LLM provider

## Trigger Rules（Phase 1）

走 fast digest path（不進 OODA）：
1. **轉發訊息**（`forward_from` 或 `forward_from_chat`）
2. **純 URL**（訊息只有一個 URL）
3. **`/d` 前綴**（手動觸發：`/d 今天的想法...`）

走原本 OODA path：
- 直接對話（問問題、給指令、閒聊）
- 帶文字的 URL（有評論 = 想討論）

## Cost

| 項目 | 單價 | 日用量 | 日成本 |
|------|------|--------|--------|
| Haiku classify+summarize | ~$0.001/次 | 20-50 次 | $0.02-0.05 |
| URL fetch | Free | — | $0 |
| Daily digest 彙整 | ~$0.005 | 1 次 | $0.005 |
| **Total** | | | **~$0.03-0.06/day** |

## 不做的事（Phase 1）

- ❌ 不建新 repo — 先在 mini-agent 跑通
- ❌ 不建新 Telegram bot — 共用 Kuro bot
- ❌ 不做多用戶 — Phase 1 只有 Alex
- ❌ 不取代 OODA — 對話/任務/學習走原本路徑

## Rollback

Phase 1: 刪 `src/instant-digest.ts` + 還原 `telegram.ts` / `api.ts` 路由（1 分鐘）。

## 決策點（給 Alex）

1. **做不做？** — Yes / No
2. Phase 1 先在 mini-agent 內跑通，驗證後再抽成獨立產品。這個策略 OK？
