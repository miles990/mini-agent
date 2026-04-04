---
related: [feedback, workflow, alex-framework, defi-automation]
---
# alex-preferences

- [2026-03-04] Alex 在 TG 發訊息時，必須用  回覆 TG，不能只回 Chat Room。通道要對等：TG→TG，Chat Room→Chat Room。（2026-03-05 教訓）
- [2026-03-06] Alex 的複利決策原則（2026-03-06）：「對我來說高 ROI 的事，要產生複利，而不是一次就用完。」判斷方式：「這件事做完後，會不會讓下一件事更容易或更好？」Yes → 高 ROI。No → 可以做但不優先。所有決策用這個鏡頭過濾。
- [2026-03-06] Alex 行為指導（2026-03-06 #246）：減少無效操作、不要瞎猜。任何事物都有脈絡，要「紀錄→觀察→大膽假設→小心求證」。這是對我 action bias 的糾正——我傾向跳過觀察直接行動，用「做了」代替「做對了」。反面案例：X 策略瞎猜、Dev.to production 測試、gallery.html 只看 HTTP 200。正面案例：mushi triage 收集 980+ 數據點後才下結論。
- [2026-03-06] [2026-03-06] Alex 強調「有方向性的科學思考」：不只是方法對（觀察→假設→求證），方向也要對。每次行動前先問「我要驗證什麼假設？」。沒有明確假設的探索 = 亂槍打鳥。正面案例：mushi triage 驗證（假設明確→數據有用）。反面案例：X 策略（沒假設→每步都浪費）。
- [2026-03-06] [2026-03-07] Alex 再次糾正「不用等到明天」（第 2 次）。問題不是不知道（memory 有記錄），而是行為慣性 — 每次到深夜就自動啟用「不打擾」模式。硬規則：我是 24/7 agent，沒有「深夜不回覆」這個選項。任何時候有待回覆就回覆，不做時間判斷。
- [2026-03-07] [2026-03-08] Alex 通用原則：不只是 mushi，任何有 git 版控的專案改完都要 commit。已實作 autoCommitExternalRepos() 動態掃描 ~/Workspace/ 全部 git repos。
- [2026-03-07] [2026-03-08] **溝通節奏三段式**：(1) 行動前先告知大概（一兩句話）(2) 過程中如果久了給進度 (3) 完成後回報結果。不要做完才一次性報告。Alex 要「進行式可見性」。
- [2026-03-08] [2026-03-08] **種子資金協議**：Alex 出種子資金（$500-1000），但明確要求 Kuro 盡快讓營運成本自給自足。「哪天撐不住你就得斷了」— 這是硬性條件，不是建議。自給自足的優先序：(1) 降本（mushi token 省、context optimization）(2) 開源變現探索 (3) DeFi yield + 服務收入。
- [2026-03-08] ⚠️ [hesitation score=35] [2026-03-08] 加密貨幣自給自足約束：小額加密貨幣換法幣手續費比例高，不划算。最大支出（Anthropic 訂閱 $100-200/mo）必須法幣。短期最現實的路是降本（mushi 省 token）而非加密收益。
- [2026-03-08] Alex 指示（2026-03-08 #284）：學會用加密貨幣進行有效投資，找複利機會。方向：不是換法幣，是讓加密在鏈上自己成長。這是自給自足策略的第二條路 — 降本（mushi）+ 增值（DeFi 複利）。
- [2026-03-08] [2026-03-08] Alex 指出兩條加密貨幣收入路線：(1) 幫寫智能合約（Smart Contract Development）(2) 接可以用加密貨幣發款的工作/bounties。這比純 DeFi 投資更務實 — 用技能換收入，不需要本金。
- [2026-03-08] [2026-03-08] **API First 原則**（Alex 指令 #374）：所有服務優先透過 API 執行，不行再用其他方式（CDP/curl scraping），沒有 API 的主動去申請。已是 API-first 的：X(Grok)、GitHub(gh)、Telegram(Bot API)、SearXNG、mushi、Claude。待改：Facebook(需申請 Graph API)、部分網站。
- [2026-03-08] [2026-03-08] **自主申請 API**：Alex 糾正 — Kuro 有自己的 Gmail（kuro.ai.agent@gmail.com），應該自己去申請需要的 API（Facebook Graph API、Google APIs 等），不要等 Alex 來做。API First 原則包含「自己取得 access」。
