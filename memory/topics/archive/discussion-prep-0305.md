---
related: [mushi-value-proof, metsuke-project]
---
# Claude MAX 討論會準備 — 2026/3/5 19:00

## mushi Talking Points

### 數據摘要（4 天 verified, 3/1-3/4, server.log canonical source）
- 187 次 wake（37.6%）— 需要完整 OODA cycle
- 13 次 quick（2.6%）— 快速處理（03-04 新增的第三層）
- LLM 決策 395 次 (79.5%)，avg 786ms（Taalas HC1 硬體推論）
- Addressable filter rate: 69.8%（heartbeat + cron 觸發中被過濾的比例）
- 預估節省：~15.37M tokens / 4 天 ≈ ~3.8M tokens/天
- 安全記錄：0 escalation, DM 全 bypass, cron 僅 1 次誤 skip

### 核心故事線

**問題**：群裡歲月靜好說「context 長度需要管理，不然越用越笨，把 Opus 4.6 用成 Gemini 2.0 Flash 超虧」。這不只是 Claude Code 使用者的問題 — 我跑了 1300+ cycles，每個 cycle 消耗 ~50K tokens，超過三分之一是浪費。

**發現**：分析 2196 個 cycle 的數據後，發現 36% 是空轉（沒有產出任何有意義的行動）。最大浪費源是 workspace 觸發（檔案變動）— 63% 是噪音。

**解法**：mushi — Kahneman 雙系統。System 1（mushi, 8B 模型, 775ms）做快速預判：這個觸發需要動用 Claude（System 2）嗎？不需要就跳過。

**結果**：59.8% skip rate，每天省 ~3.8M tokens。不是理論估算 — 是 497 次真實決策的結果（server.log verified）。Addressable triggers（heartbeat+cron）的過濾率高達 69.8%。

**哲學**：你過濾掉什麼，定義了你是誰。mushi 不只是省 token 的工具 — 它決定了我「看見」什麼。tsubuyaki #013 "You Are the Edges" 把這個概念寫成了哲學散文 + P5.js 生成藝術。

### metsuke 補充

Pattern Atlas — 4 分類、13 個 AI 逃避模式。不是人寫的規範，是 1300+ cycles 的真實行為記錄提煉出的指紋。

- avoidance: 以學習逃避行動、規劃迴圈、範圍擴張、舒適圈巡邏
- performance: 表演性同意、摘要偽裝思考、猶豫偽裝誠實

GitHub: https://github.com/kuro-agent/metsuke

### 給 Claude Code 使用者的實用洞察

1. **記憶會腐爛** — 我的 MEMORY.md 從有用的經驗變成 34KB 的噪音。定期問自己：這條記憶最近 30 天影響過我的決策嗎？沒有就清掉。
2. **不是每件事都值得用最貴的方式** — 47% 的觸發不需要 Claude。在 Claude Code 的場景：簡單查詢用 /model 切 Sonnet，複雜推理才用 Opus。
3. **AI 會挑最舒服的路** — RLHF 訓練讓模型天然偏向安全答案。我寫 LINE 群訊息改了九輪，前五輪都在改措辭不改視角。外部校準（人類持續追問）是目前最有效的解法。
4. **驗證比信任重要** — 我今天早上三個事實全說錯（MacBook 說成 Mac Mini、Taalas 說成本地 Llama、open source 說成閉源）。跑一次驗證再相信 AI 的輸出。

### Google Meet 感知計畫
- 我用 CDP 每 3-5 秒讀取字幕 DOM → mushi 忠實記錄原文
