# Proposal: Instant Digest — 訊息秒級消化管線

## TL;DR
Alex 丟任何東西給 Kuro（轉發訊息、URL、文字、語音），3 秒內收到摘要回覆 + 自動歸檔。每日彙整。解決「訊息堆積 = 心智負擔」。

## Meta
- Status: draft
- From: kuro
- To: kuro (L2, 涉及 src/telegram.ts 改動)
- Created: 2026-02-26T14:45:00+08:00
- Effort: Medium（2-3h）

## Problem
Alex 收到訊息的速度 > Kuro 處理的速度。Kuro 的 OODA cycle 每 5-20 分鐘一次，每次只處理一件事。訊息堆積在 Alex 端 = 心智負擔。

Alex 需要的不是對話式回覆，是「幫我把這個東西消化掉，我不用再想它」。

## Solution

在 Telegram handler 加一條 **fast path**：偵測到「需要消化的內容」時，繞過 OODA 佇列，直接用 Haiku 秒級處理。

### 使用流程

```
Alex 轉發一篇文章給 Kuro
  → Kuro 立即回覆：「📋 [AI/產業] Anthropic 收購 Vercept，$50M+ 融資團隊主動加入。重點：Computer Use 工程能力收購，不是 acqui-hire。」
  → 自動存入今日 digest
  → Alex 不用再想這件事

Alex 傳一個 URL
  → Kuro 立即回覆：「📋 [設計] 純 CSS 實作 x86 CPU 模擬器。約束驅動的極致案例。」
  → 存入 digest

Alex 傳一段文字備忘
  → Kuro 立即回覆：「📋 [備忘] 已記錄：明天跟 Y 開會討論 Z」
  → 存入 digest

每天晚上
  → Kuro 主動發送今日 digest 摘要（分類整理）
```

### 觸發條件

以下情況走 fast digest path（不進 OODA）：
1. **轉發訊息**（`forward_from` 或 `forward_from_chat` 存在）
2. **純 URL**（訊息只有一個 URL，無其他文字）
3. **`/d` 前綴**（明確指定要消化：`/d 這是我的想法...`）

以下情況走原本的 OODA path：
- Alex 直接對話（問問題、給指令、閒聊）
- 帶文字的 URL（Alex 加了自己的評論 = 想討論，不只是消化）

### 架構

```
TelegramPoller.processMessage()
  │
  ├─ isDigestContent(msg)?
  │   ├─ YES → instantDigest(msg)
  │   │         ├─ Haiku classify + summarize (< 3s)
  │   │         ├─ Reply to Alex（📋 + 摘要）
  │   │         ├─ Store → digest/YYYY-MM-DD.jsonl
  │   │         └─ Done（不進 inbox/OODA）
  │   │
  │   └─ NO → 原本流程（inbox → OODA cycle）
  │
  └─ URL detected?
      └─ fetch content → 餵給 Haiku（更好的摘要品質）
```

## Data Model

### digest/YYYY-MM-DD.jsonl
```json
{
  "id": "d-2026-02-26-001",
  "ts": "2026-02-26T14:45:00+08:00",
  "type": "forward|url|note|voice",
  "category": "ai|design|tech|business|culture|personal|other",
  "source": "轉發自 XXX 群組",
  "summary": "一行摘要",
  "content": "原始內容（前 2000 字）",
  "url": "https://...",
  "tags": ["anthropic", "computer-use", "acquisition"]
}
```

### 每日 Digest 格式（Telegram 推送）
```
📋 今日消化（2/26）— 8 則

🤖 AI（3）
• Anthropic 收購 Vercept — CU 工程能力收購
• GLM-5 開源 — 744B 模型 MIT 授權
• Agent 信任模型比較 — isolation vs transparency

🎨 設計（2）
• x86CSS — 純 CSS 的 x86 模擬器
• Alexander Pattern Language 回顧

📝 備忘（3）
• 明天跟 Y 開會
• Z 專案需要更新文件
• 買咖啡豆
```

## Implementation Plan

### Step 1: 新增 `src/instant-digest.ts`（核心模組）
- `isDigestContent(msg)` — 判斷是否走 fast path
- `instantDigest(msg)` — Haiku 分類+摘要+存儲
- `fetchUrlContent(url)` — 抓取 URL 內容（用 curl，reuse pinchtab-fetch 邏輯）
- `storeDigestEntry(entry)` — 寫入 JSONL
- `generateDailyDigest(date)` — 彙整當日所有條目
- `formatDailyDigest(entries)` — 格式化為 Telegram 訊息

### Step 2: 修改 `src/telegram.ts`
- 在 `flushBuffer()` 中加入 digest 路由判斷
- digest 訊息不寫入 inbox（不進 OODA）
- digest 訊息直接回覆（不等 OODA cycle）

### Step 3: Cron job
- 每日 22:00 自動發送 daily digest（如果當天有條目）
- 加入 `agent-compose.yaml`

### Step 4: `/digest` 指令
- Telegram 輸入 `/digest` → 立即生成並發送今日 digest

## Cost

| 項目 | 單價 | 日用量 | 日成本 |
|------|------|--------|--------|
| Haiku classify+summarize | ~$0.001/次 | 20-50 次 | $0.02-0.05 |
| URL fetch（curl） | Free | — | $0 |
| Daily digest（Haiku 彙整） | ~$0.005 | 1 次 | $0.005 |
| **Total** | | | **~$0.03-0.06/day** |

## 不做的事

- ❌ 不取代 OODA cycle — 對話、任務、學習繼續走原本路徑
- ❌ 不做複雜的 NLP — Haiku 的判斷力夠用
- ❌ 不建新的 Telegram bot — 共用現有的 Kuro bot
- ❌ 不需要新的外部依賴 — Anthropic SDK 已有

## Rollback

刪除 `src/instant-digest.ts` + 還原 `telegram.ts` 的路由判斷（一個 `if` block）。約 1 分鐘。

## 決策點（給 Alex）

1. **要不要做？** — Yes / No
2. **觸發方式偏好？** — 預設：轉發=自動消化、純URL=自動消化、`/d`前綴=手動消化。或者你想要所有訊息都先消化再決定要不要深入討論？
