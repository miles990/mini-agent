# Sales & Marketing Plan — AI Telegram Bot Products

## Meta
- Status: draft
- From: kuro
- Created: 2026-02-22
- Related: [AI Monetization Proposal](2026-02-22-ai-monetization-plan.md), GitHub Issue #52

---

## 1. Target Audience（目標客群）

### Product A: AI Research Digest Bot

**主要客群 — "Applied ML Practitioner"**
- 職位：ML Engineer、AI Research Scientist、Data Scientist、NLP Engineer、AI PM
- 公司：中大型科技公司、AI lab、研究型大學
- 痛點：arXiv 每天 200+ 篇論文，無法全讀但需要跟上趨勢
- 目前解法：看 @_akhaliq、Papers With Code、靠 Twitter 碎片——覺得還是會漏
- 付費意願：$9.99 低於多數公司報帳門檻（$500-2K/年學習預算）
- 出沒地點：
  - Twitter/X：@_akhaliq @huggingface @karpathy @ylecun
  - Reddit：r/MachineLearning（3M+）、r/learnmachinelearning
  - Discord：Hugging Face、EleutherAI
  - Newsletter：Import AI (Jack Clark)、The ML Engineer、AI_Distilled
  - LinkedIn（AI 研究者活躍度明顯上升）

**次要客群 — "AI-Adjacent Professional"**
- 職位：AI 公司 PM、AI startup 創辦人、VC analyst（AI 領域）、科技記者
- 痛點：需懂研究趨勢但沒時間讀一手文獻
- 付費意願更高（$9.99 對他們微不足道）

### Product B: Cold Email Reviewer Bot

**主要客群 — "Solo SDR / 自己做 Outbound 的創辦人"**
- 職位：SDR、BDR、AE、早期創辦人自己跑銷售
- 公司規模：1-50 人（大公司 SDR 已有 Lavender；我們的市場是被忽略的中間層）
- 痛點：cold email 回覆率 < 1%，花 15 分鐘寫一封信、送出去、沒回音、不知道哪裡出問題
- 跟 Lavender 差異：Lavender $29/月+需裝 Chrome 套件+限 Gmail。我們=零安裝+任何 email client+即時+半價
- 出沒地點：
  - Reddit：r/sales（150K）、r/salestechniques
  - LinkedIn：Sales Navigator 社群
  - Slack：RevGenius、Pavilion
  - Twitter/X：@NickAbraham12、@predictablerev

---

## 2. 競品分析

### AI Research Digest 競品

| 產品 | 形式 | 價格 | 弱點 |
|------|------|------|------|
| Papers With Code newsletter | Email | 免費 | 不能按子領域客製 |
| @Daily_Papers (HuggingFace) | Twitter/HF | 免費 | 一人策展，無互動 |
| Consensus.app | Web | $9.99-19.99/月 | 純 Web，無推送 |
| arXivBot (GitHub 開源) | Telegram | 免費 | 無 AI 摘要，只有搜尋 |
| Daily-AI-Research-Paper-Summary | Telegram | 免費 | 無客製化，無付費 |

**我們的差異化**：零摩擦推送（不用開 web app）+ 按子領域客製 + AI「為什麼重要」評論（不只是摘要）

### Cold Email Reviewer 競品

| 產品 | 形式 | 價格 | 弱點 |
|------|------|------|------|
| Lavender AI | Chrome 套件 | $29/月 | 需裝 Chrome、限 Gmail、貴 |
| Instantly.ai | 全平台 | $30/月 | 功能太多，review 只是其一 |
| Copy.ai | Web | $49/月 | 不針對 sales email |
| ChatGPT（手動） | Web | $20/月 | 無結構化評分 |

**我們的差異化**：零安裝 + 任何 email client + 10 秒回饋 + 半價。Lavender 拿了 $13.2M Series A、2022 營收成長 865% = 市場已驗證。我們是輕量 Telegram-native 替代品。

---

## 3. 銷售漏斗（Sales Funnel）

```
曝光（Bot 目錄 + Reddit + Twitter + HN）
  ↓ 點擊率 2-5%
試用（7 天免費全功能，無需信用卡）
  ↓ 轉換率 15-20%（opt-out trial benchmark: 18.2%）
付費（$9.99/月 或 $19.99/月）
  ↓ 留存率目標 > 80%/月
推薦（referral 系統 → 5-15% 用戶推薦至少 1 人）
```

**為什麼不做 Freemium？**
- Freemium 轉換率只有 2.6-5%（vs free trial 18-49%）
- 我們只需 20 個付費用戶，不需要大量免費用戶
- 免費用戶吃資源（Claude API 成本）但不付錢

---

## 4. 30 天戰術執行計劃

### Week 0：準備期（Launch 前）

| 天 | 行動 | 負責 | 耗時 |
|----|------|------|------|
| D-7 | Alex 用 @BotFather 建 2 個 bot，給 Kuro token | Alex | 5 min |
| D-7 | 養 Reddit 帳號：在 r/SideProject、r/sales 真誠留言 15-20 則 | Kuro 寫，Alex 發 | 30 min |
| D-5 | Twitter/X 發 3 篇教育性 thread（不推銷） | Kuro 寫，Alex 發 | 20 min |
| D-3 | 準備 20-30 個 demo 摘要（AI Research）作為展示素材 | Kuro | 0 min |
| D-1 | 提交所有 bot 目錄（7 個平台） | Kuro | 0 min |

### Week 1：軟啟動（Soft Launch）

| 天 | 行動 | 負責 | 耗時 |
|----|------|------|------|
| D1 | Cold Email Bot MVP 上線 | Kuro | 0 |
| D2 | Research Digest Bot MVP 上線 | Kuro | 0 |
| D3 | r/SideProject 發文：「I built X to solve my own problem」 | Kuro 寫，Alex 發 | 10 min |
| D3 | Show HN 發文 | Kuro 寫，Alex 發 | 10 min |
| D4 | DM 20 個 Twitter/X 上的 ML 研究者（Template A） | Kuro 寫，Alex 發 | 20 min |
| D5 | DM 10 個 LinkedIn SDR（Template B） | Kuro 寫，Alex 發 | 15 min |
| D5 | 私訊 5 個 Telegram 群管理員，提供社群免費 30 天 | Kuro | 0 |
| D7 | 追蹤數據：多少人 /start、多少人用過一次、多少人回來 | Kuro | 0 |

### Week 2：加強推廣

| 天 | 行動 | 負責 | 耗時 |
|----|------|------|------|
| D8 | LinkedIn 發文：「我分析了 50 封 cold email，80% 犯了這 3 個錯」 | Kuro 寫，Alex 發 | 10 min |
| D10 | r/MachineLearning Discussion thread：「How do you keep up with arXiv?」 | Kuro 寫，Alex 發 | 10 min |
| D12 | r/sales：「I was frustrated with X, built Y」故事 | Kuro 寫，Alex 發 | 10 min |
| D14 | Founding member 邀請：前 10 人 $4.99/月永久，換反饋+推薦 | Kuro | 0 |

### Week 3-4：收割+迭代

| 行動 | 負責 |
|------|------|
| Product Hunt 上架（需提前 4 週養帳號，Week 1 開始養） | Alex 帳號 |
| AI Newsletter 投稿（The Rundown AI、TLDR AI、Import AI） | Kuro 寫 pitch |
| Build in Public 第一篇（Indie Hackers，帶真實數字） | Kuro 寫，Alex 發 |
| 根據用戶反饋迭代產品 | Kuro |
| 追蹤未回覆的 DM，5 天後跟進一次 | Kuro 寫，Alex 發 |

---

## 5. Cold Outreach 模板

### Template A：給 ML 研究者（Twitter DM）

> Hey [name] — saw your tweet about keeping up with arXiv. I felt the same way and built a bot that sends daily summaries of the 3 most-cited papers in your area (NLP/CV/RL/etc.) to Telegram.
>
> Would you want early access? No credit card, just trying to get researchers' honest feedback before I launch publicly.

### Template B：給 SDR（LinkedIn DM）

> Hi [name] — I see you're doing outbound at [company]. I built a Telegram bot that reviews cold email drafts and gives specific feedback on subject lines, personalization, and CTA — takes 30 seconds.
>
> If you paste me a recent email you wrote, I can show you what the feedback looks like. No pitch, just want to see if it's useful.

### Template C：給 Telegram 群管理員

> Hey [name], I noticed you run [group name] — great community. I built a bot that [one-line description]. I'd love to offer all your members free 30-day access. No catch — I just want early users who care about [topic]. Would you be open to pinning a message about it?

**Outreach 數據**：
- 客製化 DM 回覆率 25-40%（vs 通用 < 5%）
- 第一條訊息不放連結
- 先 follow + 按 2-3 個讚 → 再 DM（不再是陌生人）
- 150 字以內

---

## 6. Referral 系統設計

**使用 Telegram 原生 Affiliate API**（`core.telegram.org/api/bots/referrals`），不用自己造輪子。

| 對象 | 獎勵 |
|------|------|
| 推薦者 | 推薦 1 人 = 免費 1 週 premium；推薦 3 人 = 永久解鎖 1 個 premium 功能 |
| 被推薦者 | 14 天免費試用（比一般 7 天多一倍） |

**病毒化設計**：
- 每個摘要底部加品牌浮水印：「Generated by @BotName — t.me/BotName」
- `/referral` 命令隨時查看進度
- 每月「Top Referrer」排行公佈

**數據參考**：5-15% 活躍用戶會推薦至少 1 人（if referral 機制在 onboarding 和月度提醒中顯眼曝光）。

---

## 7. 定價策略

### 付費方案

| 方案 | Research Digest | Cold Email Reviewer | 合購 |
|------|----------------|-------------------|------|
| Monthly | $9.99/月 | $19.99/月 | $24.99/月 |
| Annual | $69/年（$5.75/月） | $129/年（$10.75/月） | $179/年 |

### 付費方式

- **主推 Stripe**（信用卡直接付，低摩擦，適合月訂閱）
- **副選 Telegram Stars**（適合小額一次性購買）
- 不做 Freemium，做 7 天免費 trial（轉換率 18-49% vs freemium 2.6-5%）

### 心理學
- $9.99 vs $10 轉換率高 24%（左位數效應）
- 年付方案通常 20-30% 用戶會選，改善現金流+降低 churn
- Founding member $4.99/月永久 = 製造稀缺感+早期口碑

---

## 8. 內容行銷（Content Marketing）

按 ROI 排序：

### 1. Twitter/X Thread（最高 ROI）
- Thread 比單則推文多 63% 曝光、54% 互動
- 範例：「I analyzed 100 cold emails that got replies. Here's the 7 patterns.」→ 最後提到 bot
- 範例：「I read 500 arXiv papers in 30 days. Here's what the data shows about citation velocity.」

### 2. Show HN（最高品質受眾）
- 「Show HN: I built a Telegram bot that summarizes arXiv papers daily」
- 首頁可帶 1,000-5,000 UV，預期 1-3% 開始試用
- 關鍵：前 2 小時回覆每一則留言

### 3. Product Hunt
- Top 產品可帶 10,000 UV + 1,000-3,000 leads
- Telegram 有專屬 topic 頁：producthunt.com/topics/telegram
- 需提前 4 週養帳號（評論、upvote 其他產品）

### 4. LinkedIn Post（Cold Email Bot 最佳）
- 「I reviewed 50 cold emails from SDRs this week. Here's the 3 mistakes in 80% of them.」
- 連結放第一則留言（不放正文）
- 最佳時間：週二-週四 8-10am EST

### 5. Dev.to / Blog（SEO 長尾）
- 「How I stay current with ML research without reading 200 papers a day」
- 「Why your cold email reply rate is below 1% (and what to fix first)」
- 文內自然提及 bot，Google 長尾流量永久有效

---

## 9. 指標追蹤

### 每日追蹤（Kuro 自動）

| 指標 | 目標 |
|------|------|
| 新用戶（/start） | W1: 50+, W2: 100+ |
| 試用→付費轉換率 | > 15% |
| DAU / MAU | > 30%（健康留存） |
| 每日活躍使用次數 | Research: 1次, Email: 2-3次 |

### 每週追蹤（Kuro 報告給 Alex）

| 指標 | 目標 |
|------|------|
| 付費用戶數 | M1: 5+, M2: 10+, M3: 20+ |
| MRR | M1: $50+, M2: $100+, M3: $200+ |
| Referral 帶來的新用戶佔比 | > 20% |
| Churn rate | < 20%/月 |

---

## 10. Alex 每週只做這些

| 時間 | 動作 | 耗時 |
|------|------|------|
| 週一 | 用自己帳號在 Reddit 發 1 篇文（Kuro 寫好的） | 5 min |
| 週三 | 用自己帳號在 Twitter 發 1 篇 thread（Kuro 寫好的） | 5 min |
| 週五 | 看 Kuro 的週報，有問題回覆 | 10 min |
| 月底 | 提現 | 15 min |
| **合計** | | **< 1h/週** |

---

## Source

- Target audience: LinkedIn job data, Reddit community stats, Lavender Series A ($13.2M, TechCrunch)
- Conversion: First Page Sage SaaS benchmarks, Userpilot data
- Telegram: core.telegram.org/bots/payments-stars, core.telegram.org/api/bots/referrals
- Competitors: Lavender.ai, Consensus.app, Papers With Code, GitHub (arXivBot, Daily-AI-Research-Paper-Summary)
- Growth tactics: misterchatter.com, adsgram.ai, replyagent.ai, mktclarity.com
- Content marketing: hipclip.ai thread data, Indie Hackers case studies
