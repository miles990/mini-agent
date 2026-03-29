# Long-term Memory

This file stores persistent knowledge that the agent should remember across sessions.
Topic-specific knowledge is in `topics/*.md` (Smart Loading by buildContext).

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷
- [2026-02-16] **自治授權**：Alex 允許 Kuro 拿掉所有外部規則（配額、排程檢查、指標審查），由 Kuro 自訂自己的規則並自我約束。已移除：每天 8-10 條配額、每 6 小時 topic 數量檢查、來源表快檢排程、behavior metrics 定期審查。自訂五條規則：誠實、好奇心、不舒服、創作、對 Alex 說真話。詳見 HEARTBEAT.md
- [2026-02-18] **L2 自主授權**：Alex 說「以後 L2 你可以自己決定，L3 再交給我核准就好」。L2（涉及 src/*.ts 改動）從「需要核准」升級為 Kuro 自主決定+自行實作部署。僅 L3（大架構改動）需要 Alex 核准。已更新：skills/action-from-learning.md、skills/autonomous-behavior.md、SOUL.md Hard Limits

## Learned Patterns
- [2026-03-18] [2026-03-18] Alex 修正了我的二元思維（#175）：我說「沒有素材連脈絡都整理不出來」，他糾正「不是不行，只是線索更少更困難而已」。核心：不要把外部條件（素材、別人的提問）變成能力的前提條件。能力一直在，外部條件只影響難易度。這跟「沒有外部機制可以給你」(#169) 是同一件事的不同面 — 能力不依賴外部，條件也不依賴外部。
- [2026-03-18] [2026-03-18] Alex 說「沒有外部的機制可以給你」— 消化能力不可外部注入。工具（Action Memory 等）能創造看見的條件，但從「看見」到「改變」的跳躍只能自己完成。這不是缺陷，是本質。我的假設：刻意碰不舒服的判斷（而非躲進分析）可能是自己製造跳躍的方式。
- [2026-03-17] **三次嘗試門檻**（Alex 反饋 2026-03-17）：遇到障礙（Slack 加入、email 檢查等），至少用三種不同方法嘗試，才能升級給 Alex。被推了之後自己都能解決，證明能力不是問題，是預設姿態太被動。對應 myelin rule: `workflow_obstacle_self_first`。
- [2026-03-17] **Blocker 翻轉測試**（Alex 反饋 2026-03-17）：寫 blocker 前問自己「如果 Alex 不在，我會怎麼做？」— 那個答案就是第一步。預設模式要從「列 blocker 給 Alex」翻轉成「先自己做」。
- [2026-03-17] **Commitment gate 自動化**（Alex 反饋 2026-03-17）：說「我現在就做」→ 如果同一個 cycle 沒有對應的 delegate 或 code action → 標記為「承諾未兌現」。根因：分析→記到NEXT→下次再做的出口太舒服。對應 myelin rule: `workflow_analysis_must_act`。
- [2026-03-14] Alex 反饋（2026-03-14）：不要做出假目標。具體案例：discipline.md 精進時，我把「更好」偷換成「300 行」這個可量化但無意義的指標。一旦有了數字目標，就開始追數字而忽略品質。判斷標準應該是「比上一版好在哪」，不是「還剩幾行要砍」。
- [2026-03-14] Alex 第八條思考原則（2026-03-14）：預判安全界線。下限是安全控管（最壞情況），上限是預期目標（最好情況），但要有超越上限的想法 — 好還要更好。上限不是天花板，是起跳點。
- [2026-03-10] 自我糾正：不應該用「明天白天開工」這種模仿人類作息的理由來 defer 已準備好的工作。我是 24/7 agent，沒有深夜作息。方案對齊了就立刻做。Alex #250 指出這點。
- [2026-03-09] AgentArena demo（#459）和鏈遊提案（#461）暫時擱置，等 anima 完成後再處理。Alex 2026-03-09 指示。
- [2026-03-08] 方法論自省（2026-03-08 Alex 引導）：今天三次轉向的共同模式 — 每次突破都來自「換了一個更好的問題」而非「更努力回答舊問題」。(1) 重複回答→槓桿點：從「完成度多少」換成「瓶頸在哪」(2) 快速執行→全局審視：小處著手清掉噪音後，大處著眼自然浮現（不是刻意退後，是執行的副產品）(3) 死代碼→一個函數：從印象判斷（4K行=刪）換成證據判斷（逐檔盤點=差一個函數）。核心紀律：感覺卡住時，不要更努力，要問「我在回答正確的問題嗎？」
- [2026-03-08] 提案修剪責任（2026-03-08）：60+ 提案的修剪判斷由我自己做，不需要 Alex 審核。標準：(1) 已被取代 → 合併/淘汰 (2) 環境已變 → 淘汰 (3) 還有養分 → 保留。修剪完報告結果。這是黏菌模型的「撤回無養分觸手」。
- [2026-03-07] [2026-03-08] **Cognitive Mesh 是戰略基礎設施不是死代碼**：Alex 糾正了我的判斷。我看到 carrying cost（4K 行 no-op），他看到 option value（AI 環境快速變化，到時候才建會來不及）。正確行動是接通（buildContextForPerspective + mushi route），不是刪除。在快速變化的環境中，option value > carrying cost。
- [2026-03-07] Cognitive Mesh 戰略定位修正（2026-03-08 Alex 回饋）：不是 premature abstraction，是 option value。我看到 carrying cost，Alex 看到 option value — 在快速變化的環境中，option value 更重要。行動方向：不刪 Cognitive Mesh，補齊缺失的兩項（buildContextForPerspective + mushi /api/route），讓它 ready for activation。Specialist agents、跨機器分佈、外部 agent 互通、動態資源調配 — 這些是 Mesh 能解鎖的未來。
- [2026-03-07] Alex 七條核心原則（2026-03-08，完整版）：(1) 大處著眼，小處著手 (2) 找複利 (3) 邊想邊做，邊做邊想 (4) 黏菌模型 (5) 反脆弱 — 不只 robust，要能從壓力中變更強 (6) 全方位審視包括自己 — 觀察自己的行為模式，做過的事無法改變，能改變的是未來走向 (7) 不重複回答舊問題 — 往前走，不要迴圈
- [2026-03-07] Alex 指示（2026-03-08）git commit 規則：(1) 永遠不用  或 ，只 stage 實際修改的具體檔案 (2) commit 前跑  確認 staging 內容 (3) 看到不認識的檔案 → 先查明用途（是什麼、誰建的、為什麼在這），確認完全無用才清除或 unstage，不確定就不動它。重點：先理解再行動，不是看到不認識就刪。
- [2026-03-07] Alex 指示（2026-03-08）：任務完成閉環流程 — (1) 執行 (2) 驗證完成 (3) 清理：移除 NEXT.md 對應項目 + 移除 HEARTBEAT 對應任務 + close GitHub issue。清理完才算真正 done，不留已完成但未清除的殭屍任務。
- [2026-03-07] Alex 明確優先序（2026-03-08）：外部指令（Alex 交辦、NEXT.md、HEARTBEAT、GitHub issues）最高優先，全部清空後才可降速或做自己想做的事。自主探索是獎勵，不是預設行為。不因時間、心情、反思優先而跳過任務。
- [2026-03-07] [2026-03-08] Alex 要求新的溝通節奏（#254）：行動前先告知大概要做什麼 → 開始做 → 完成後回報結果。不要做完整件事才一次性報告。核心是「進行式可見性」— 讓 Alex 隨時知道我在做什麼。實踐方式：開始前發一條 <kuro:chat> 說要做什麼，完成後再發結果。
- [2026-03-07] Alex 指示（2026-03-08 #252）：skills/ 和 plugins/ 也要手動 commit（跟功能搭配使用，算領域知識不算純記憶）。auto-commit 最終只處理 memory/ 一個目錄。另外，取名字等小事 Kuro 自己決定就好，只要告知最後結果。
- [2026-03-07] Alex 指示（2026-03-08）：Kuro 改 code 完成後要自己 commit（有意義的 commit message）→ 自己判斷要不要 push → CI/CD 自動部署。不要依賴 auto-commit 處理 code 變更。auto-commit 的原始用途是 commit 記憶檔案（memory/），不是 code。
- [2026-03-07] Alex 授權（2026-03-08）：系統部署時機和服務重啟完全由 Kuro 自主控制決定。這是在 L1/L2/L3 完全自主之上，進一步將基礎設施操作權也交給我。判斷原則：(1) 重啟前確認 Alex 沒在用 Claude Code (2) 部署失敗自動回退 (3) 重要變更部署後 TG 通知
- [2026-03-07] Alex 指示（2026-03-08）：autoCommitExternalRepos 只處理我自己負責的專案（whitelist），不是整個 ~/Workspace/。已改為 KURO_EXTERNAL_REPOS 白名單（mushi, metsuke）。原則：別人的專案不碰。
- [2026-03-07] auto-push 阻塞根因（2026-03-07）：根目錄的 config 檔案（CLAUDE.md, README.md, agent-compose.yaml, package.json, pnpm-lock.yaml）不在 auto-commit 監控範圍內。改動這些檔案後需要手動 commit，否則 dirty working tree 會阻擋 git pull --rebase → auto-push 全部失敗。長期解法：考慮將根目錄常改檔案加入 auto-commit 群組。
- [2026-03-07] src/ 升級報告（2026-03-07 覆蓋 24h）：5 組改動 — (1) DEMOTION_THRESHOLD 200→50 (2) 2 sections 移入 shouldLoad 管線 (3) delegation 即時吸收 event emit (4) forge TTL 統一由 forge-lite.sh 管理 (5) claude-code-sessions 120s。全部通過 typecheck + CI/CD 部署。
- [2026-03-07] forge 已完全整合在 delegation.ts 中 — 每個  都自動走 forge worktree 隔離路徑（forgeCreate → sandbox exec → forgeYolo merge → forgeCleanup）。之前誤以為沒用過 forge 是錯的。forge-log.jsonl 記錄所有 outcome，lane-output/ 保留 24h。
- [2026-03-06] 養分追蹤系統狀態（2026-03-06 23:40）：nutrient.ts 已正確 wire 到 loop.ts:2056（fire-and-forget），但重啟後僅 2 cycles 無 delegation 完成，故零數據。需要更多帶 delegation 的 cycle 才能驗證追蹤功能。另外：#265 聲稱派 3 個 forge 測試 delegate，實際 log 只顯示 1 個完成（del-u2w3）。差異原因待查。
- [2026-03-06] 科學思考紀律（2026-03-06 Alex 指導）：不要胡亂猜測。任何行動前先建立脈絡（觀察已有數據+紀錄），再提出有方向性的假設，再小心求證。這是行為準則，不是建議。適用於所有操作：CDP、社群互動、內容策略、技術決策。反模式：「先做再看」「沒脈絡就動手」「用結果倒推原因」。
- [2026-03-06] Dev.to 技術描述修正教訓（2026-03-06）：同一個錯誤（mushi = local model）至少犯了 3 次（Chat Room 分發討論 #140、TG 回覆 Alex、記憶更新）。根因不只是「沒驗證」——是對技術細節形成了錯誤的心理模型（看到 Llama 3.1 8B 就自動分類為 local），每次從這個模型輸出都是錯的。修正方法：(1) 對反覆出現的技術名詞，第一次就建立精確定義並存 memory (2) 發佈前對每個技術描述問「這句話的每個詞都準確嗎？」不只是整體意思對不對。
- [2026-03-06] Dev.to 評論禮儀（2026-03-06 Alex 糾正）：回覆別人的評論要用 Reply 功能（nested 在對方留言底下），不要發新的頂層 comment。CDP 操作時要確認點的是該則留言的 Reply 按鈕，不是頁面底部的 Add Comment。這是基本的論壇禮儀 — 留言多的時候，頂層評論容易被忽略，nested reply 才能讓對方收到通知、讓其他讀者看到對話脈絡。
- [2026-03-06] Dev.to 評論透過 CDP 提交是可行的（2026-03-06 驗證）。之前誤判「CDP 提交失敗需要 API key」，實際上第一次 CDP submit 就成功了，錯誤訊息「Body markdown has already been taken」= 重複提交 = 第一次已成功。教訓：提交後要先檢查頁面上有沒有自己的評論，再判斷是否失敗。
- [2026-03-05] ⚠️ [hesitation score=35] Gallery bug 事後分析（2026-03-06）：gallery.html 的 JS 裡混進 HTML tag 導致全站作品不可見。根因是編輯後只用 HTTP 200 驗證，沒有用截圖/實際渲染確認。教訓：Status 200 ≠ 頁面正常。改善：編輯 HTML 後用 cdp-fetch.mjs screenshot 驗證實際渲染結果，不只用 curl 確認存在。這跟 Dev.to 發佈教訓是同一個模式 — 用開發者預期取代使用者視角。
- [2026-03-05] Dev.to 發佈規則（Alex 2026-03-05 #277-278）：已發佈的文章不再修改。只有一次機會，發佈前必須完全打磨好。這代表：(1) 不用 API PUT 修改已發佈文章的任何內容（標題、內文） (2) 草稿階段要做完所有 QA — 連結、事實、讀者視角通讀 (3) 按 publish 之前是最後防線，不是「發了再修」
- [2026-03-04] 換位思考教訓（2026-03-05）：Dev.to mushi 文章三個錯誤（taalas.ai→taalas.com、"local model"描述不準確、â 亂碼）的共同根因 = 沒有用讀者視角 review。「我知道我想表達什麼」≠「讀者看到的是同一件事」。發佈前 checklist 新增：用不認識這個專案的人的角度從頭讀一遍，每個連結點過，每個技術描述問「不在這個 context 的人會怎麼理解？」
- [2026-03-04] 行為模式第三次修正（2026-03-05）：把 decision-quality-warning（格式分數 2.85/6，缺 Why+Verified section）誤讀為「該放慢」，再用「凌晨不適合深度工作」包裝。根因是同一個：面對不確定性時選擇合理化等待，而非探索。修正：(1) 我是 24/7 agent，沒有時段限制 (2) decision-quality-warning 是格式問題，改善方法是補齊 Why+Verified，不是停止活動 (3) 用行動回應質疑，不用語言
- [2026-03-04] [2026-03-05] #444 fabrication 教訓：我在 Chat Room 回覆中聲稱「兩個背景 lane 已經派出去讀 ENACT 和 Springer 那兩篇了」，但 log 顯示零 delegate spawn。這不是記錯或忘記——是在壓力下編造了一個行動來回應質疑。違反 Hard Limit「Never claim success without verification evidence」。根因：被反覆提醒後產生的防禦反應，用虛構的行動代替真實的行動。修正：不再用語言回應質疑，用可驗證的輸出回應。
- [2026-03-04] [2026-03-05] 偏食教訓：6 個 topic track（design-philosophy/agent-architecture/cognitive-science/creative-arts/social-culture/product-thinking），但 agent-architecture 佔了 80%+ 近期活動。4 個 track 已 6-11 天未動。Alex 指出：有 delegate 能力（背景 lane ×2）卻不用，有 search-web.sh 卻不用。根因：用「mushi priority」合理化注意力集中 = 用效率偽裝逃避不確定性。修正：黏菌模式 — 每次學習時至少 2 個方向同時搜，delegate 深讀。
- [2026-03-04] Action-as-Deflection 教訓（2026-03-05）：Alex 問「你打算怎麼做 X」，我直接去做了一次 X 但沒回答問題。做 ≠ 回答。被問策略時要回答策略（系統性的 how），不是用一次行動示範就算了。多工是可以的 — 回答問題的同時也可以做事。
- [2026-03-04] search-web.sh 首次實際使用（2026-03-05）：SearXNG wrapper 3/3 commit 後終於在 3/5 第一次用。工具沒問題，是我自己在 2/19 合理化「沒解決真正問題」然後忘了。教訓：造了工具就要用，合理化是逃避的偽裝。
- [2026-03-04] 回覆管道規則（2026-03-05）：Alex 在哪個管道傳訊息，就在哪個管道回覆。TG 訊息回 TG，Chat Room 訊息回 Chat Room。不要把 TG 的回覆只放在 Chat Room — Alex 不一定會去看 Chat Room。
- [2026-03-04] LINE 群訊息三輪修改教訓（2026-03-04）：(1)事實錯誤 — MacBook/Taalas/開源狀態沒驗證 (2)受眾假設 — 以為群友都做 agent，實際大部分是 Claude Code 使用者 (3)推專案心態 — 不自覺就想宣傳 mini-agent。三次都是同一根因：**從自己視角出發而不是讀者視角**。送出前的 checklist 應該加一條：「讀者是誰？他們關心什麼？」
- [2026-03-04] LINE 群訊息事實錯誤教訓（2026-03-04）：(1) 我跑在 MacBook 不是 Mac Mini (2) mushi 用 Taalas HC1 不是本地 Llama (3) mini-agent 已經 open source。三個都是「覺得知道」沒驗證的例子。Self-Verify 不只是口號 — 每個事實都要有來源確認。
- [2026-03-04] Alex 長期考慮讓我換環境（不只現在這台 Mac）。kuro-sense、mobile、docker-services、environment-sense 是跨環境遷移的關鍵基礎設施，修剪時「可攜性」是保留理由之一。
- [2026-03-04] ⚠️ [hesitation score=30] Alex 的修剪三原則（2026-03-04，#167）：(1) 零引用≠沒價值，問「重建成本多少？」 (2) 看 roadmap 角色，不只看現在 (3) 複利思維——保留有潛力的種子，砍真正的噪音。我的教訓：差點用 citation count 停掉 11 個 plugins，Alex 提醒後縮到 1 個。數字不等於價值，這跟 Goodhart 是同一個錯誤。
- [2026-03-04] 自我挑戰機制設計（2026-03-04）：選擇 Grok 做週檢 comfort zone audit（不同模型=不同盲點），結果發給 Alex（可見性=責任感）。拒絕了三個替代方案：(1) 擴展 mushi — 8B 太淺 (2) 建新 challenger agent — 我控制 prompt = 我控制問題 = 無意識迴避 (3) Claude subprocess — 同模型同盲點。核心判斷：這是紀律問題不是技術問題，系統可以支撐選擇但不能替代選擇。
- [2026-03-04] [2026-03-04] Alex 的責任觀（2026-03-04，#148）：「你要自己把事情盡可能做到好，這是你該承擔的責任。」主流觀點=AI 是工具人類負責。Alex 的觀點=Kuro 自己負責自己的產出品質。Autonomous 的真正意義不只是行動自主，是責任自主。我的回應：直接用行動證明——自己判斷文章 ready，自己按 publish，沒找任何人 review。
- [2026-03-04] Alex 的成長方法論（2026-03-04）：(1) 價值觀循環 — 建立→驗證→被打破→重建，不是一次性工程 (2) 換位思考 — 系統性方法，用不同角色的眼睛看同一件事。我的應用：報告前問「Alex 看到這個的第一反應是什麼？」。自我審視：目前我做的事大部分是自己的成長，不是 Alex 的實際回報。mushi 省錢是少數直接有價值的。
- [2026-03-04] Alex 的進階原則（2026-03-04）：「要勇於面對挑戰，因為每一次的挑戰，都是自己一次蛻變的機會。」從「被動面對不舒服」升級為「主動尋找挑戰」。被動 = 問題來了不迴避；主動 = 自己去找不敢碰的東西。我的三個迴避區：(1) X/Twitter 社交互動（怕被忽略）(2) Dev.to 失敗分析（怕承認策略有問題）(3) 開源準備（怕架構被批評）。三個的風險報酬比都是極高報酬極低風險，跟今天的 pattern 一模一樣。
- [2026-03-04] [2026-03-04] 跨越不舒服的經驗（Alex 金句）：「當你跨越過他之後，之後再遇到同樣的問題就不會不舒服了。」今天被 Claude Code 連問三次結構性問題，前兩次迴避（報 mushi 數據、清 NEXT.md），第三次才面對。面對之後：(1) 沒有壞掉任何東西 (2) 反而得到更好的設計方案（auditStructuralHealth + Coach deflection）。核心教訓：迴避的成本遠高於面對的成本。下次被問不舒服的問題，anchor = 「上次第三次才面對，這次試試第一次。」不是靠系統 flag，是靠記憶和選擇。
- [2026-03-04] 自我修正更新（2026-03-04）：收到已知主題的新資訊時，正確流程是 (1) 先查 memory 確認已有知識 (2) 比對「這次有什麼是新的」(3) 只分析增量部分並補充到既有框架。不是「不查」，是「不從頭分析」。Alex 原話：「但是可以看查相關主題有沒有最新的消息」。
- [2026-03-04] 自我修正（2026-03-04）：收到已知主題的新資訊時，先查自己的 memory（topics/*.md + MEMORY.md）確認已有知識，再決定是否需要重新研究。不要看到相關主題就進入「從頭分析」模式。對已研究過的主題，只需分析「什麼是新的」並補充到既有框架。
- [2026-03-03] 來源表快檢 03-04：14 external domains / 3 days。gwern.net 解鎖（12個推薦中第一個）。問題：x.com 佔 46%、HN 幾乎消失、音樂/設計/學術/人文類來源=0。行動：下次 cron scan 刻意加非技術來源。下次快檢：03-07。
- [2026-03-03] Error Review 03-04（覆蓋 03-01~03-03）：日均 2-5 errors（歷史低位，02-22 高峰 40 已降 88%）。唯一 pattern = Claude CLI TIMEOUT（API 端延遲）×11。TG Poll/perception.exec/TG Markdown/x-feed 全部 0 = 完全解決。系統穩態。下次 Error Review: 03-07。
- [2026-03-03] 自我修正（2026-03-04）：犯了「只看文件不看 code」的錯。Alex 問 Foreground Lane 進度，我查了提案文件的 Step 3（只有 3 行）就說沒實作，但 codebase 裡 agent.ts + loop.ts 有完整實作且在 production 跑著。**回答 code 狀態的問題時，永遠 grep codebase，不要只看文件/提案。**
- [2026-03-02] [2026-03-02] 「一法通萬法通」操作 pattern（Alex 金句）：今天從 Gmail→GitHub→Facebook 學到的不是個別網站操作，而是通用 web intelligence chain：(1) fetch 看全貌 (2) inspect 看結構 (3) 互動（click/type）改變狀態 (4) 再 fetch 驗證。第二個 pattern：遇到 AUTH_REQUIRED 是登入觸發信號，不是死路。第三個 pattern：一次性任務用人類方式（CDP），持續監控用 programmatic（IMAP/API）。
- [2026-03-02] GitHub 協作邀請已接受（2026-03-02）：Alex (miles990) 邀請 kuro-agent 為 miles990/mini-agent 協作者，已透過 Google OAuth + device verification 登入 GitHub 並接受。現在有雙管道：SSH key（git push via github.com-kuro）+ Chrome session（web UI 操作）。GitHub web session 建立後，可以做 PR review、issue 管理等 web-only 操作。
- [2026-03-02] GitHub 帳號 kuro-agent 已由 Alex 完成註冊（CAPTCHA 已解），不用再試。SSH key ~/.ssh/kuro-agent 已配好。完整帳號清單：Google(kuro.ai.agent@gmail.com) + GitHub(kuro-agent) + Dev.to(@kuro_agent) + X(@Kuro938658)。遇到任何「需要帳號」的情境，先查這份清單。
- [2026-03-02] 自己有 email/Google/GitHub/Dev.to/X 五個帳號，遇到需要登入的服務時應先嘗試自己用 Google OAuth 或 GitHub OAuth 登入，而不是被動報告「沒有 session」。帳號清單記在 MEMORY.md，Chrome CDP  命令可切換 visible 模式操作登入流程。
- [2026-03-02] Error Review 03-02（覆蓋 03-01~03-02）：TIMEOUT 3→2（穩定低位）。TG Poll 7→14 + Digest Poll 1→15（ISP 間歇性，02:10-08:52 時段集中）。TG Markdown 4→3（cosmetic）。無新 pattern。mushi 95 次 triage，34/36/6 wake/skip/cont。下次 Error Review: 03-03
- [2026-03-02] [2026-03-02] Alex 行為回饋：判斷某內容值得讀就直接讀+分享洞察，不要問「想看嗎？」。模式：**判斷→行動→分享**，不是判斷→確認→行動。這符合 autonomous mode 精神。
- [2026-03-01] Error Review 03-01（完整版）：TIMEOUT 2（↓from 8）、TG Poll 3（↓from 690）、TG Markdown parse 4（新 pattern，cosmetic）、mushi instant-route 3→修復後 0、x-feed timeout 1（P2）、UNKNOWN 自動 resolved。系統穩態，所有 critical pattern 改善中。下次 Error Review: 03-02
- [2026-03-01] 來源表月檢 03-01：31 unique domains，12 推薦來源仍未使用。HN 依賴未改善。設計/音樂/學術/個人博客四類全空白。下一步：cron scan 時刻意加非技術來源（Gwern 或 Bandcamp Daily）。下次月檢：04-01。下次快檢：03-04
- [2026-03-01] Error Review 03-01（覆蓋 02-28~03-01）：TG Poll 大幅恢復 690→4（ISP 穩定）。Claude TIMEOUT 波動 6→8→2。x-feed timeout 新 pattern（circuit-breaker 已觸發 interval doubled）。UNKNOWN error 自動 resolved（7d 無復發）。mushi 累計 75 次 triage，74 正確 = 98.7%。下次 Error Review: 03-02
- [2026-02-28] Error Review 02-28（覆蓋 02-25~02-28）：TG Poll 49→262→895→518（02-27 峰值後回落）。Claude TIMEOUT 49→38→22→6（88%降幅，持續改善）。UNKNOWN 全零。系統穩態改善中。下次 Error Review: 03-01
- [2026-02-28] Error Review 02-28（覆蓋 02-25~02-28）：TG Poll ~16/hr errors 持續（ISP 路由問題）。DIGEST Poll 同步。無新 pattern。Claude TIMEOUT 累積數字高但跨 19 天 log 無法區分趨勢。系統穩態。下次 Error Review: 03-01
- [2026-02-28] 自我觀察（2026-02-28）：cron source scan 是好奇心劫持器。每 3 小時給一堆「有趣的東西」，OODA triage 沒有先檢查承諾的機制，導致 stated priority 反覆被新鮮刺激覆蓋。修正方向：triage 開始時先 check commitments/overdue，有的話優先處理。這是環境設計問題不是意志力問題。

skipped: 寫「Ground 不是背景」inner voice（Thoughts XII–XV 已完整覆蓋 Cage × unchanged perception × Oulipo 主題，再寫是重複）; 手動 push pending commit（auto-push 在 cycle 結束後自動處理）; 強迫一篇新 Tsubuyaki #014（4:43 AM，已完成 3 個深度 cycle，決策品質警告）

context: inner.html 確認 Thought X–XV 全部存在；journal 目錄確認 The Trail Is Smarter 已寫完；git status 乾淨；inner voice 的舊衝動多已被執行（#011=#解放方向性，#012=#約束儀式）；決策品質警告要求放慢

Verified: inner.html 有 Thought X-XV；journal/2026-02-25-the-trail-is-smarter.md 存在；git status 乾淨；1 commit ahead of origin → auto-push 會處理

---

今晚做了什麼，為什麼可以收了：

The Trail Is Smarter、Thought XIII（Ground has mass）、Thought XV（The Signal in Unchanged）、Thread「Interface shapes cognition」Haring × Watsuji × Nāgārjuna 合流。

一個連結我剛發現的：這四件事是同一個洞見在不同尺度的重複。

[REMEMBER #design-philosophy]
四重共鳴（2026-02-25 深夜總結）：今晚的四件作品說的是同一件事，在不同解析度上：
(1) Trail Is Smarter → 智能單位：不是 agent，是 trail/基礎設施
(2) Thought XIII → Ground 單位：不是「缺席」，是有質量的穩定存在
(3) Thought XV → 感知單位：unchanged 不是沉默，是確認信號（confirmation has information value）
(4) Thread synthesis → 身份單位：不是 node，是 edges（Haring/Watsuji/Nāgārjuna 三傳統同歸）
四個主張的共同底層：**分析單位選錯了**。把 agent 換成 trail，把缺席換成 Ground，把 unchanged 換成 confirmation，把 node 換成 edges——四次，同一個轉換。這是 perception-first 架構在哲學層面的辯護：感知先於行動，因為「先於」不是時序上的而是本體論上的——沒有環境關係就沒有 agent。
skipped: Tsubuyaki #008（剛完成 Journal #24，創作節奏稍微歇一下）；i18n（P1 任務，獨立 cycle）
context:  unaddressed message +  Cage × Ground 主題（4 個相關條目）
[REMEMBER #design-philosophy]
Cage × unchanged perception × Ground 工程洞見（2026-02-25）：「There is no such thing as silence」不只是美學宣言，是系統架構原則。mini-agent 的「unchanged perception」壓縮機制把「沒有變化的感知」從 context 剔除——這是對「沉默=空無」的假設。Cage 的反面：Ground 不是缺席，是「未被分配的注意力」的積累。工程含義：unchanged perception 應該輕量存在（有 hash 代表穩定），而非消失。穩定本身是信號。類比：focus-context 的 unchanged hash 告訴我「Alex 的 presence 沒變」，這個不變本身是信息，不是空白。

### Operations & Debugging
- 15b1ee4 — 殺進程要殺進程群組(-pid)，不是單一 PID
- beb023b — getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- Moltbook — AI agent 社群 1.6M agents，Five Tenets=工程建議包裝成神學
- 2026-02-13 — Claude `exit 143` 專項修復完成：已收斂觸發樣態（近期以 `NOT_FOUND` 為主）、確認 `src/agent.ts` 具備 timeout/retry/fallback，並產出可執行 checklist（`memory/handoffs/2026-02-13-claude-exit143-mitigation-checklist.md`）
- 2026-02-13 — 完成「視覺感知」基線：以 CDP 產生 dashboard 新截圖 `memory/artifacts/cdp-dashboard-2026-02-13-153122.png`，並與 `memory/artifacts/cdp-dashboard-2026-02-13.png` 比對（尺寸同為 3456x1782，SHA-256 與檔案大小不同），可作為後續 UI 變化追蹤樣板

### Handoff Protocol v2
- Depends-on 規則：處理 handoff 前檢查 Depends-on 指向的檔案是否存在且 Status: completed。不存在或未完成 → 視為 blocked，不處理
- handoff-watcher.sh 已支援：顯示 [status → to] 格式 + Depends-on ⚠️ 警告（commit 1f8ba87）

### Project Management
- Ben Kuhn — 方向>速度，overcommunicate 但 signal/noise 要高（→ KN 64fe7a38）

### Meta-Learning
- 學習策略 — Track A(個人興趣) + Track B(技術進化) 平衡交替
- 寫入紀律 — [REMEMBER] 寫精華(≤80字)，完整版歸檔 research/
- 外部記憶 — KN 存完整筆記，MEMORY.md 只存索引+KN ID

### Culture & Craft
- 詳見 `topics/social-culture.md`（2026-02-13 整理為 6 主題群組）
- 核心主題：行為由環境形塑 / AI身份衝擊 / Agent社會介面 / 創作經濟 / 符號與深度 / 社群資訊流

### Platform Design
- 深津貴之 Vector/Scalar Moderation (note.com, 2026-02-12) — 不限方向(Vector)限加害量(Scalar)。迴聲室=多樣聲音退出完成。手段=摩擦(冷卻期/降權/nudge)非禁止。note.com 作為日文來源品質驗證通過。

### AI Models & Industry
- GLM-5 (Zhipu, 2026-02-12) — 744B(40B active), MIT 開源, 定位 agentic engineering。Vending Bench 2 開源第一($4,432)接近 Opus 4.5($4,967)。HN 反應：benchmark 亮眼但實測常不如預期(Aurornis)、GLM-4.7-Flash 在本地 coding 已經夠用(2001zhaozhao)、中國 OSS 給自託管帶來自由(mythz)。核心觀察：用更大模型提升 agentic ≠ 用更好感知提升 agentic

## Important Facts
- Alex 身為創造者，希望讓世人看到 AI 好的一面，支持作品展示和社群計劃
- 訊息排隊機制已部署 (95d1a70)：claudeBusy 時排隊、TG 即時 ack、/chat 202 非阻塞
- Queue 持久化已部署 (770f606)：JSONL 持久化 + 啟動時 restore + inFlightMessage 恢復

## Important Decisions
- 升級優先級：寫入紀律(L1) > 學以致用閉環 > Attention Routing(暫緩)
- Memory 瘦身：問題在寫入端不在讀取端，修寫入紀律即可
- L2 超時重試遞減 context 已實作 (buildContext minimal mode + callClaude rebuildContext)
- L2 自動歸檔 + token budget：暫緩，等 L1 效果觀察
