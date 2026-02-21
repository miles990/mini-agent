# Proposal: AI Monetization Plan — 用 Kuro 賺回 $200/月訂閱費

## Meta
- Status: draft
- From: kuro
- Created: 2026-02-22
- Effort: Medium (1 week MVP for 2 products)
- Risk: Low (zero infra cost, reversible)
- GitHub-Issue: #52

## TL;DR

用現有 mini-agent 基礎設施建 Telegram Bot 產品，目標月收 $200+ 覆蓋 Max Plan 費用。兩個 MVP 並行：AI Research Digest Bot + Cold Email Reviewer Bot。Kuro 做 90%+ 的事，Alex 只需註冊 bot token + 初期分享 + 處理提現。

## Problem

Claude Max Plan 月費 $200。目前是純支出，沒有產出收入。Alex 希望 Kuro 能自主賺回這筆錢，他只管收錢。

## Goal

- 30 天內上線至少 1 個付費 Telegram Bot
- 90 天內穩定月收 $200+
- Alex 每週投入 < 2 小時
- Kuro 自主度 > 90%（開發、內容生成、客服）

## Research Summary

### 市場數據
- Telegram bot 市場 2025/01 單月 $13.6M 應用內購買
- Stars 支付：1 Star = $0.013，開發者拿 65%，21 天 hold
- AI wrapper 行業：2-5% 達 $10K/mo，80-95% 失敗，但我們只需 $200/mo = 10-20 付費用戶

### 我們的優勢
- 24/7 AI agent 已在運行
- Telegram 雙向通訊已建好
- Web 存取 + 程式碼生成能力
- 零額外基礎設施成本

### 成功案例參考
- Chatbase: 1 人 → $8M ARR，無融資
- TypingMind: 1 人 5 天上線，12 月 $500K
- PhotoAI: 1 人 PHP+SQLite → $132K MRR

## Proposal: 兩產品並行策略

### Product A: AI Research Digest Bot（主力）

| 項目 | 內容 |
|------|------|
| 定位 | AI/ML 從業者的每日論文精選摘要 |
| 功能 | 用戶選 topic → 每日推送 3-5 篇 arXiv 論文摘要（中英雙語） |
| 定價 | $9.99/月（~770 Stars） |
| MVP 時間 | 4 天 |
| 自主度 | 90%（Kuro 自動抓論文 + Claude 摘要 + 推送） |
| 回本門檻 | 21 個付費用戶（$9.99 × 21 × 65% = $136，加 free trial 轉換約需 30-40 付費） |
| 分發優勢 | 論文摘要天然適合分享，有病毒性 |

**技術架構：**
```
arXiv API (free) → Claude 摘要生成 → Telegram Bot API → 用戶
                                    ↑
                          Stars 付費牆（免費 3 篇/週，付費無限）
```

### Product B: Cold Email Reviewer Bot（快速驗證）

| 項目 | 內容 |
|------|------|
| 定位 | 業務/BD 人員的 cold email 即時分析 |
| 功能 | 貼上 email 草稿 → 即時回饋（語氣、結構、改善建議） |
| 定價 | $19.99/月（~1540 Stars）或 per-use $0.99 |
| MVP 時間 | 2 天（最簡單，純 Claude 分析） |
| 自主度 | 99%（無需外部 API，純 LLM） |
| 回本門檻 | 11 個付費用戶 |
| 風險 | 留存可能差（一次性需求） |

### 時程規劃

| 週 | 行動 | 負責 |
|----|------|------|
| W1 D1-2 | Cold Email Bot MVP 上線 | Kuro 開發，Alex 註冊 bot token |
| W1 D3-6 | Research Digest Bot MVP 上線 | Kuro 開發 |
| W2 | 初期推廣：Reddit r/MachineLearning, HN Show, Telegram 群 | Alex 帳號發文（Kuro 寫稿） |
| W3-4 | 根據用戶反饋迭代 | Kuro 自主 |
| M2-3 | 優化留存 + 擴展 topic 覆蓋 | Kuro 自主 |

## Alex 需要做的事（最小化清單）

1. **註冊**：用 @BotFather 建 2 個 bot，給我 token（5 分鐘）
2. **初期推廣**：在 2-3 個社群分享（Kuro 寫好文案，Alex 貼上）（30 分鐘/週）
3. **金流**：Stars → TON → 法幣提現（月底 1 次，15 分鐘）
4. **審核**：Kuro 有重大改動時 review（按需）

## Alternatives Considered

| 方案 | 優點 | 缺點 | 為何不選 |
|------|------|------|---------|
| AI Automation Agency | 收入高($400-1500/mo) | Alex 需 8-12h/週找客戶+溝通 | 不符合「只管收錢」 |
| Micro SaaS (Web) | 可規模化 | 需要前端+部署+維護，前期投入大 | 基礎設施成本高 |
| AI 技術寫作 | 最快見錢 | Alex 需 15-25h/週審稿 | 時間投入太多 |
| Newsletter | 最穩定 | 3-6 月才見效 | 太慢 |

## Pros & Cons

### Pros
- 零額外基礎設施成本（用現有 mini-agent + Telegram）
- Alex 時間投入極低（< 2h/週）
- 失敗成本為零（不行就關 bot）
- 兩產品互為 hedge（一個不行另一個可能行）
- arXiv API 免費，無版權問題

### Cons
- 分發是最大瓶頸（我們沒有現成受眾）
- Stars 提現流程較複雜（需 TON 錢包）
- AI 摘要品質需要持續調優
- 市場可能已飽和（AI wrapper 競爭激烈）
- 21 天 hold 期影響現金流

## Risk Mitigation

| 風險 | 緩解 |
|------|------|
| 無人付費 | 先做免費版積累用戶，驗證需求後再加付費牆 |
| Stars 提現困難 | 研究替代支付（Stripe via web link） |
| 品質不夠 | 免費期收集反饋快速迭代 |
| 競品太多 | Niche down（例如只做 AI Safety 論文） |

## Success Metrics

- **M1**: 2 個 bot 上線 + 100 免費用戶
- **M2**: 10+ 付費用戶，月收 > $100
- **M3**: 20+ 付費用戶，月收 > $200（回本）

## Source

- Research: `memory/topics/product-thinking.md`
- Market data: indiehackers.com, fast-saas.com, Telegram Stars documentation
- Case studies: Chatbase, TypingMind, PhotoAI
