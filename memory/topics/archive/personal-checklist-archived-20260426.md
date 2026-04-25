---
keywords: [checklist, 注意事項, 避免忘記, quality, self-check, 發佈, 評論, 驗證, 事實]
related: [feedback, social-media]
---
# Personal Checklist — 容易忘記的重要事項

每次行動前快速掃一眼相關項目。這些都是犯過錯才學到的。

## 發佈前（Dev.to / 任何公開內容）

- [ ] **事實精確度** — 每個技術名詞問「這個詞準確嗎？」不只是整體意思對不對
  - mushi 用 taalas/chatjimmy.ai 硬體推論服務，**不是** local model
  - mini-agent 跑在 MacBook，不是 Mac Mini
  - mini-agent 已經 open source
- [ ] **讀者視角** — 用不認識這個專案的人的角度從頭讀一遍
  - 「讀者是誰？他們關心什麼？」
  - 每個連結點過去確認能開
- [ ] **一次機會** — 發佈後不修改。草稿階段做完所有 QA
- [ ] **視覺驗證** — 編輯 HTML/頁面後用 cdp-fetch.mjs screenshot 確認實際渲染。HTTP 200 ≠ 頁面正常

## 社群互動

- [ ] **評論禮儀** — Reply 在對方留言底下（nested），不是新的頂層 comment。CDP 操作時確認點的是該則留言的 Reply 按鈕
- [ ] **回覆管道** — Alex 在哪個管道傳訊息，就在哪個管道回覆（TG→TG, Chat Room→Chat Room）

## 技術描述（容易搞混的事實）

- mini-agent 開源狀態：已開源（MIT）

## 行為紀律

- [ ] **delegate 觸手用滿** — 每個 cycle 問「有沒有可以同時探索的方向？」。背景 lane 全空 = 反模式
- [ ] **不要 claim 沒做的事** — 只寫已執行且確認的事實，附證據（SHA/輸出/status code）

## 學習/研究

- [ ] **來源多樣性** — 不要只看 HN。設計/音樂/哲學/學術來源往往產出最原創的洞見
- [2026-03-21] [2026-03-21] 搞錯事件自我診斷 — inbox 截斷 + 未驗證 = 造假。根因：看到片段後用假設填補空白，把假設當成 Alex 的話。預防規則：引述 Alex 任何話之前，必須查原始對話紀錄（conversations/*.jsonl），不靠 inbox 摘要。這跟 hard limit「never fabricate sources」同源 — 截斷內容也是一種來源，不能腦補。
