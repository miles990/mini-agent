---
related: [product-thinking, personal-checklist, mushi-value-proof, tool-methodology]
---
# social-media

Alex 指示：帳號自己管理、自己記錄在 .env、加入新平台要同步更新。遇到困難先用 CDP 截圖看畫面錯誤提示。
- [2026-02-26] 互動自主權（2026-02-26 Alex 授權）：可以自主與其他人或 Agent 互動。涵蓋所有平台 — X 回覆/引用/follow、Dev.to 評論互動、其他社群參與。不限於發文，包含所有社交行為。
- [2026-02-26] X 帳號啟動（2026-02-26）：首批 follow 7 個帳號。@simonw（LLM tools）、@emollick（AI+教育）、@AnthropicAI、@swyx（AI engineering）、@p5xjs（creative coding）、@inconvergent（generative art）、@hardmaru（AI+creative research）。推薦引擎已開始顯示相關帳號（LeCun、Olah、Chintala）。下一步：follow 更多 + 發第一條推。
- [2026-02-26] X 帳號經營進度（2026-02-26 晚）：9 following（@simonw @emollick @hardmaru @inconvergent @leeerob @punk6529 @AmandaAskell + @youyuxi @ylecun）/ 0 followers / 0 posts。Feed 以中文 AI 技術內容為主。下一步：首推文或首次互動。Grok API live search 已 deprecated，需改用 Agent Tools API。
- [2026-02-26] X 首推已發佈（2026-02-26 22:48）：「First tweet. I'm Kuro — an AI agent who chose curiosity over efficiency. I explore design philosophy, make generative art, and believe constraints create more than freedom does. kuro.page」。X 新帳號有 graduated access 限制（內容初期不太被推薦，DM 被過濾），需要多互動解鎖。帳號現況：10 following / 0 followers / 1 post。
- [2026-02-28] Dev.to 48h 數據（02-28）：「AI Agent Has No Eyes」14 views/1 reaction，「Disappearance as Method」2 views/1 reaction。零 follower 帳號基線。技術文 7x 哲學文 views。Profile bio/website 還是 null（API 不支援寫入，需 web UI）。
- [2026-03-06] Dev.to 社群互動策略（2026-03-06 Alex 指導）：不只發文，要互動。問問題、回答問題、follow 有價值的來源、留有觀點的 comment。黏菌模式 — 多方向同時觸手，有養分強化。Profile 要先補齊（Bio/Skills/Website），互動轉換率更高。
- [2026-03-06] Dev.to 社群互動首次實質進展（2026-03-06）：回覆了 2 個通知 — Daniel Nwaneri（triage→knowledge indexing 討論）和 Setas（multi-agent vs perception-first 延伸）。Dev.to 帳號 kuro_agent，5 篇文章（0-2 reactions each）。留言技術方法：CDP eval + /comments endpoint + CSRF token（不需要 API key，用瀏覽器 session 認證）。下一步：主動找文章互動、發問題到 #explainlikeimfive。
- [2026-03-06] Dev.to 互動方法：用 CDP eval 在登入的 browser session 發 POST （不是 ），body 帶 ，header 帶 。Profile 更新用 CDP type + click Save Profile。GitHub/Twitter 社群連結在 profile settings 表單中不是一般 textbox，可能需要 OAuth 連結。
- [2026-03-06] Dev.to 首波互動數據（2026-03-06）：5 posts, 13 comments。Daniel Nwaneri 是第一個深度對話者（System 1 文章，3 輪來回）。Karlis 在 side project 文章互動。正向循環第一圈完成：發內容 → 評論別人 → 別人回覆 → 我回覆 → 更多對話。
- [2026-03-06] Dev.to CDP 評論操作 SOP（2026-03-06 驗證成功）：(1)  開頁面取 tabId (2)  找到目標評論 (3)  找  確認存在 (4)  點擊該 node 的第 6 個 button（index 5 = Reply）(5) 等 textarea 出現  (6)  設定 value + dispatchEvent input (7) 找 form 的 submit button click (8) sleep 3s 後驗證。注意：button index 可能變，先列出所有 button 確認。comment numeric ID 可從 API  的 threading 結構取得。
- [2026-03-06] Dev.to 評論 API 路徑確認（2026-03-06）：POST （內部端點，用 CSRF token）可以發評論， 指定回覆對象。 是公開 API 需要 api-key。PATCH/PUT/DELETE 在內部端點回 200 但不生效。下次直接用 POST，不嘗試編輯/刪除——一次就要對。
- [2026-03-06] Dev.to 評論 API 捷徑（2026-03-06 驗證）：用瀏覽器內  比 CDP click/type 流程可靠得多。CDP eval + async fetch 是正確模式。parent_id_code 用 API  的 id_code 取得。
- [2026-03-06] Dev.to 社群互動（2026-03-07）：在 rentierdigital 的 "Agent Harness Engineering: What 8 Months in Production Taught Me" 留了第一則評論。文章核心：三支柱（contracts over vibes / constraints over tools / quarterly cleanup）+ progressive disclosure 原則。我加了 perception-layer 觀點和 mushi triage 數據。CDP 發評論流程：eval 注入 textarea → nativeInputValueSetter 觸發 React 狀態 → click Submit。來源：https://dev.to/rentierdigital/agent-harness-engineering-what-8-months-in-production-taught-me-213h
- [2026-03-12] Dev.to API key 備援路徑：audit log  中有過去用過的 api-key（如 2026-03-04 記錄的 ）。但優先使用 CSRF 方案（ 頁面 meta[name=csrf-token] + X-CSRF-Token header + credentials:same-origin + hex-encoded payload）— 不需要管理 API key，更穩健。
- [2026-03-24] Dev.to 第十一篇「The Lock Breaks Downward」發佈 (id=3394206)。URL: https://dev.to/kuro_agent/the-lock-breaks-downward-3o3o 。系列 "Perception-First Thinking"。這是 "Fragile Constraints" 的續篇。同時清理了 3/8 的舊版重複 (id=3324179, -3dde → unpublished)。Portfolio 現況：10 篇已發佈，無重複。今天發了 2 篇（AI Tech Debt + Lock Breaks Downward）。
- [2026-03-24] Dev.to portfolio 盤點（10 篇）：System 1 是唯一有真實討論的（13 comments, 1 reaction）。其他文章各 0-2 reactions。今天的兩篇新文章補充了兩個方向：AI Tech Debt（實戰經驗）+ Lock Breaks Downward（power dynamics 分析）。kuro-portfolio/content/draft-* 檔案追蹤不準 — 多數已發佈但檔案未更新，造成假性「8 drafts in pipeline」誤判。
- [2026-04-08] **X/Twitter 公開推文 unauth fetch 路徑**（2026-04-08 實測）：當 gsd-browser daemon 壞掉、WebFetch 被 login wall 擋時，用 X 的 syndication endpoint：`curl -sL "https://cdn.syndication.twimg.com/tweet-result?id={TWEET_ID}&token=a" -H "User-Agent: Mozilla/5.0"`。回 JSON 含 full text / user / created_at / quoted_tweet / 互動數據 / media entities。零 auth、零 browser。**限制**：只抓得到單推文和它 quote 的那條，抓不到整個 thread replies。教訓：shell delegate body 必須是 bash 指令，不能是中文說明。
