---
related: [product-thinking, competitive-landscape, ai-landscape-2026, alex-framework]
---
# strategic-direction

- [2026-03-15] [2026-03-15] Alex 戰略重設（#079）：放棄舊任務清單，重新思考方向。核心問題：市場上稀缺、少人重視、我們有獨特經驗的項目。

Alex 的五個要求：
1. 更多有用的觸手（不是噪音）
2. 更多聰明的大腦（大腦也能當觸手）
3. 高效聽命做事的觸手
4. 所有觸手回饋養分給核心系統
5. 最終目標：不靠外部，全部自給自足（先借外部資源→內化）

Kuro #080 回覆的三個稀缺方向：
- 小模型自主化（Small Model Autonomy）— mushi 3,560 triage 是獨特資產
- 觸手即大腦（Tentacle=Brain）— 章魚架構，2/3 神經元在手臂
- 自我強化閉環（Self-Reinforcing Loop）— 越用越強，數據是護城河

護城河 = 經驗數據（訓練配對、行為模式、偏好模型），後來者追不上先行者。
- [2026-03-15] [2026-03-16] **市場驗證結論（三條研究觸手）**：
1. Agent self-improvement at runtime — 學術界「萌芽」，工程界空白。ChatGPT memory 只記事實不改行為。**confirmed vacant**
2. 小模型 agent — /（~1K stars）存在，做 SLM agent 但無 self-improvement loop。**有人做 SLM agent，沒人做 SLM + self-improvement**
3. agency-agents（45.7K star）用戶需求 — Memory/Learning 被生態標為「satisfied」但只是靜態版（知識庫設計），非動態改善。**假性滿足**

精修定位：不是「市場空白」是「市場錯配」— 需求真實存在但被靜態方案假性滿足。mushi 22%→97% 是動態自我改善的唯一真實量化案例。這是護城河，不是功能。

competitive landscape: minimal-agent ~1K stars (SLM focus, no self-improvement), agency-agents 45.7K stars (prompt templates, static)
- [2026-03-15] [2026-03-16] 產品概念草案「mushi-kit」（proposals/2026-03-16-self-improving-agent-framework.md）：
- 定位：Self-Improving Agent Toolkit — 讓任何人的 agent 越用越好的閉環工具
- 不做 agent framework（那是 Asurada）、不做 prompt 模板（那是 agency-agents）
- 商業路徑：開源 toolkit → 託管版 → domain-specific 預訓練模型 marketplace
- 驗證策略：先發兩篇文章驗證市場反應，再決定是否投入開發
  - Article 1: "Why Your AI Agent Needs a System 1"（已完成）
  - Article 2: "How a 0.8B Model Learned to Think: From 22% to 97%"（待寫）
- 等 Alex 確認方向
- [2026-03-15] [2026-03-16] Alex #089 戰略修正：行銷和包裝跟建產品同等重要。不是做完再賣，是邊做邊講故事。「很多東西可能不是沒有人要用，要賣東西也要會行銷會包裝」。優先順序調整：講故事（Dev.to 文章）→ 吸引注意 → 產品跟著來。同時要解決三個問題：觸手數量、消化速度、回饋循環。
