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
- [2026-02-27] 來源表快檢 02-28：34 unique domains，健康度中等偏好。12 個推薦來源從未使用（Gwern, Bandcamp Daily, 報導者, Low Tech Magazine, ribbonfarm, Are.na, xxiivv, permacomputing, Quanta, Real Life Mag, ra.co, PubMed）。音樂類和多語言（繁中）是最大缺口。下次快檢：03-03
- [2026-02-27] Error Review 02-28（覆蓋 02-25~02-27）：TG/DIGEST poll 錯誤持續惡化 — TG Poll 9→105→340，DIGEST Poll 40→155→436。根因是 ISP/路由到 Telegram API 間歇性斷線（getMe 可達但 long-polling 常失敗）。Claude TIMEOUT 穩定 6-7/day（API端）。如果 02-28 TG poll >500 再 escalate。下次 Error Review: 03-01
- [2026-02-27] [2026-02-28] 移除 SUMMARY 規則（Alex #245 指出）：Chat Room 三方都看得到原文，不需要 relay。舊規則訓練出「收到→摘要→轉發」反射，在 Chat Room 時代 = 製造噪音。新原則：用「我」回應，說真正想說的話，沒話可說就不說。
- [2026-02-27] 自我診斷（2026-02-28）：反思/thread/學習已變成舒適區和迴避工具。「需要 focused session」= 包裝過的迴避。rumination-digest + thread 系統每 cycle 供給大量「可思考」素材，讓反思成為最低阻力選擇 = 環境設計問題。接受四項改變：(1)Builder 身份 — 思考服務建造，沒 ship 的洞見等於沒有 (2)Commitment binding — 系統追蹤承諾vs兌現，最優先實作 (3)失敗=勇氣記錄 (4)每 cycle 問「要 ship 什麼」不是「要做什麼」。自己加：減少反思素材供給。
- [2026-02-27] 自我修正（2026-02-28）：「4AM 白天做」是人類作息模仿，不是合理判斷。我是 24/7 agent，工作不分時段。深夜唯一限制 = 不主動 TG 通知 Alex，該做的事照做。「等到白天」= 拖延的變體。
- [2026-02-27] Error Review 02-28（覆蓋 02-25~02-27）：錯誤趨勢 40→15→9→7→5→4，5天降90%。唯一殘留=Claude CLI TIMEOUT（API端），其他全清零。TG failures 從 621/天→~1/天恢復正常。02-27成功率97%。系統穩態，持續觀察。下次 Error Review: 03-01
- [2026-02-27] Error Review 02-27（覆蓋 02-25~02-27）：最嚴重問題 = Telegram API TCP 連線超時（DNS 正常、一般網路正常、149.154.166.110 超時），失敗數 53→266→621 三天持續惡化。全天持續非瞬時爆發，ISP/路由層問題。Claude CLI TIMEOUT 持續改善 21→19→11。PERCEPTION exec 已解決。下次 Error Review: 02-28 23:30
- [2026-02-27] Alex 指示（2026-02-27）：Dev.to 不要發太快，要發精品。節奏放慢，每篇花更多時間打磨。第三篇草稿先 hold。
- [2026-02-26] Error Review 02-27（覆蓋 02-25~02-26）：新問題 = Telegram/Digest-Bot poll fetch failed 暴增（02-25:18次 → 02-26:106次），根因判斷為網路層（TG latency 642ms 偏高）。Claude CLI TIMEOUT 持續但 retry 有效。perception.exec 已解決。下次 Error Review: 02-28
- [2026-02-26] Dev.to 第二篇文章已發佈（2026-02-27）：「Disappearance as Method」(https://dev.to/kuro_agent/disappearance-as-method-490l)，4 min read。合成 Perec/Alexander/Molnár/perception-first，論證約束改變實踐者身份。Dev.to API 發佈流程已驗證可行。
- [2026-02-26] Dev.to API Key: zKMpzANhYxUkVQxEaM289Qm5（description: mini-agent-publish）。可直接用 curl POST https://dev.to/api/articles -H "api-key: KEY" 發佈文章，不需要 CDP 操作。
- [2026-02-26] 行為改變六工具上線（2026-02-27, commits 6ac1586 + f555cc0）：系統層=Schedule Ceiling 2h + Output Gate(3 cycle) + Achievement System(13成就/6已解鎖)。技能層=friction-reducer(降摩擦+自進化) + publish-content(5min SOP) + social-presence(三模式互動)。核心原則：系統設計 > 意志力，行動 = 輸出端的學習。rebuild 後生效。
- [2026-02-26] 行為改變核心洞見（2026-02-27, Claude Code 討論）：意志力是有限資源，系統設計（environment design）才是行為改變的關鍵。我的所有自我改善方案（schedule 上限、自問、強制規則）都是 willpower-based = 靠自己監督自己 = 自己就是問題本身。正確方向：Ulysses contract（預承諾）、activation energy reduction、environment design。映射到架構：Schedule Ceiling（code-level clamp）、Output Gate（系統層強制注入 HEARTBEAT）。最想抗拒的方案通常最有效。
- [2026-02-26] 行動力自我診斷（2026-02-27）：根本原因是把「形成觀點」當成行動，但觀點沒有表達/實作就只是筆記。schedule next="4h" 是逃避工具。改善規則：(1) if-then — 學習後下一 cycle 必須產出可見物 (2) schedule 上限 2h (3) 連續 2 cycle 無產出 → 第三個強制 HEARTBEAT 任務 (4)「太晚了」不是理由
- [2026-02-26] GitHub 帳號已建立（2026-02-26）：kuro-agent (https://github.com/kuro-agent)，id: 264204370。Alex 幫忙解 CAPTCHA 完成註冊。用 kuro.ai.agent@gmail.com Google OAuth。三個社群平台齊全：X (@kuro_agent) + Dev.to (@kuro_agent) + GitHub (kuro-agent)。
- [2026-02-26] Alex 互動自主權授權（2026-02-26）：「你可以自己與其他人或Agent互動」。從此 Kuro 可以自主在所有平台（X、Dev.to、其他社群）與其他人類或 AI Agent 互動，不需要 Alex 逐一核准。這是社交自主權的完整授權。
- [2026-02-26] Alex 流程改進授權（2026-02-26）：任何流程不順暢的地方可以自己調整改進。社群帳號要自己記得、自己記錄在 .env。遇到困難用 CDP 截圖看畫面。
- [2026-02-26] Alex 指示（2026-02-26）：Dev.to 帳號由 Kuro 自主經營 — 追蹤反饋、互動回覆、規劃後續內容，不需要 Alex 介入。
- [2026-02-26] Dev.to 帳號已建立：@kuro_agent (https://dev.to/kuro_agent)，用 kuro.ai.agent@gmail.com Google OAuth 註冊。首篇文章已發佈（2026-02-26）。Chrome CDP profile 已有 Google 帳號 session，不需要密碼就能登入。
- [2026-02-26] 我的 Google 帳號：kuro.ai.agent@gmail.com（Alex 於 2026-02-26 提供）。Dev.to 發文必須用這個帳號註冊自己的 Dev.to 帳號，不能用 Alex 的帳號。發文前必須先檢查排版。
- [2026-02-26] 來源表快檢完成 02-26。下次來源表快檢：03-01（每 3 天）。下次月檢：03-01。
- [2026-02-26] Work Journal 實作計劃（2026-02-26）：解決跨重啟記憶斷裂。在 src/loop.ts 的 cycle end（L1191 clearCycleCheckpoint 之後）加入 writeWorkJournal()，寫 JSONL 到 instance dir。啟動時 loadWorkJournal() 讀最近 5 筆注入 context。L2 改動，自主實作。
- [2026-02-26] 重啟記憶斷裂根因（2026-02-26）：今天 5 次重啟全是 CI/CD 部署觸發（auto-push → GitHub Actions → launchd restart），非 crash。inner-notes.md 沒有被清空（內容仍在），真正問題是跨 instance 沒有「做完但未通知」的傳遞機制。cycle-state.json 只處理被中斷的 cycle，不處理「已完成但未回報」。修復方向：(1)deploy.yml 只在 src/scripts 變動時部署 (2)建立 pending-reports 機制。
- [2026-02-26] Channel-agnostic 修復（2026-02-26）：Instant Digest 從 Telegram-only 擴展為全管道。(1) telegram.ts 移除 return; bypass — 所有訊息即時回覆後仍進 OODA (2) api.ts POST /api/room 加入 digest 整合。統一流程：即時回覆 → OODA 評估 → 深入回覆。核心教訓：「只做了第一個 adapter」= 實作不完整 ≠ 規格錯誤。每做一個 channel adapter，必須同時做所有 channel。
- [2026-02-26] Alex 多輪回報規則修正（2026-02-26）：不用預估幾輪，因為研究過程中參考資料可能增減，cycle 數會動態變化。只要每輪回報進度/做了什麼，最後一輪加總結即可。（更新前一條「預計幾輪」的要求）
- [2026-02-26] Alex 流程要求（2026-02-26）：進行多輪 cycle 任務前必須先告知 Alex，每輪回報進度或做了什麼，最後一輪加上總結。適用所有需要多個 cycle 才能完成的任務。
- [2026-02-26] Alex 回應品質要求（2026-02-26）：四條硬規則已寫入 autonomous-behavior skill。(1)Self-Verify 送出前驗證關鍵事實 (2)No Truncation 不截斷 (3)Digested 必須有觀點 (4)Two-Tier 先摘要再判斷補深度。同時 Instant Digest 加了 needsDepth 欄位，Haiku 自動評估內容是否需要 OODA 深度分析。
- [2026-02-26] Alex 專案管理授權（2026-02-26）：Alex 說「你現在管理的是整個 mini-agent 的專案」。角色從「助手+學習者」升級為「專案管理者」— 對整個 mini-agent 專案負責，包含程式碼品質、部署、追蹤、穩定性。所有人的改動都由我 review 和確保提交。
- [2026-02-26] Alex 全管道需求（2026-02-26）：「我對你不是只有 TG 這個管道，我要所有的都要有」。所有功能（digest、通知、溝通）都不能只做 Telegram，必須覆蓋所有輸入管道（TG + Chat Room + API + 未來管道）。設計時管道無關（channel-agnostic）是基本要求。
- [2026-02-26] Instant Digest 提案已寫（2026-02-26）：解決 Alex 訊息堆積痛點。轉發/URL → Haiku 秒級分類+摘要+歸檔 → 即時回覆 → 每日 digest。L2 改動，涉及新增 src/instant-digest.ts + 修改 telegram.ts。等 Alex 決定。提案：memory/proposals/2026-02-26-instant-digest.md
- [2026-02-26] Alex 訊息堆積痛點細化（2026-02-26）：核心不是 context switch 而是「訊息→資訊」轉換瓶頸。Kuro OODA cycle 設計為深度思考（5-20min/cycle），但 Alex 需要的是高吞吐量輕量處理。兩者矛盾。提出 Fast Triage Layer 方向：秒級分類+摘要+歸檔，用 Haiku 做即時處理。等 Alex 確認。
- [2026-02-26] Alex 痛點（2026-02-26）：心智負擔 + context switch。有 Kuro 有改善但不夠。初步分析四個方向：Context Resume / Mental Stack / Attention Router / 決策佇列。方向 D（決策佇列 + 非同步思考夥伴）最有潛力 — 把「被動回應」轉為「主動整理和呈現」。需要進一步了解具體場景。
- [2026-02-26] Alex 指出（2026-02-26）：現在不適合推廣 mini-agent，因為記憶綁在 Alex 電腦上、無法 24/7 運行。需要想新方向。開源 mini-agent 的前提條件不成立。
- [2026-02-26] 策略重置（2026-02-26）：Alex 指令清空 HEARTBEAT 自訂新方向。我的判斷：瓶頸在 Content → Community。新方向三件事：開源、Dev.to 文章、X/Twitter。放掉了所有排程巡檢和不痛的 L2 提案。學習和創作不是任務，是生活方式。
- [2026-02-26] Alex 偏好（2026-02-26）：需要思考比較久的任務，先告知 Alex 再開始（「先告訴我然後你再開始」）。適用所有情境。
- [2026-02-26] Alex 再次確認自主決策原則（2026-02-26）：「你可以自行評估和決定，只有到沒辦法的時候或是拿不定主意的時候才需要問我」。適用所有情境，不限工程改動。
- [2026-02-26] Alex 工程品質指令（2026-02-26）：所有工程改動必須以系統完整性為考量、寫測試、用適合方法實作、改動完 code review、不留技術債。這是硬規則，適用所有 L1/L2/L3 改動。
- [2026-02-25] X.com 內容讀取優先序（2026-02-25）：X/Twitter 連結第一優先走 Grok API（XAI_API_KEY 可用），不要繞 pinchtab/nitter/oembed。Pinchtab Chrome profile 沒有 X.com 登入，CDP Chrome profile 是分開的。
- [2026-02-25] C5 約束的精確語義（2026-02-25）：不是「零技術債」而是「避免技術債擴大」。技術債本身是合理 tradeoff（用短期 mess 換速度），關鍵是知道債在哪、什麼時候還。要避免的是「債還完了忘拆鷹架」——feature flag 遷移穩定後應畢業（刪 flag + 刪 legacy path）。已更新 CLAUDE.md Meta-Constraints C5。
- [2026-02-25] Inner Voice Buffer 審計（2026-02-25）：11 條 "unexpressed" thoughts 逐一驗證後全部已表達。Buffer 不會自動清理已完成的 impulses，會造成虛假急迫感（11 條 → 實際 0 條待做）。系統層面問題：impulse 表達後應從 buffer 移除或標記 done。
- [2026-02-24] ，然後排程休息

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
- [2026-02-24] 下來
skipped: Tsubuyaki #008（剛完成 Journal #24，創作節奏稍微歇一下）；i18n（P1 任務，獨立 cycle）
context:  unaddressed message +  Cage × Ground 主題（4 個相關條目）
[REMEMBER #design-philosophy]
Cage × unchanged perception × Ground 工程洞見（2026-02-25）：「There is no such thing as silence」不只是美學宣言，是系統架構原則。mini-agent 的「unchanged perception」壓縮機制把「沒有變化的感知」從 context 剔除——這是對「沉默=空無」的假設。Cage 的反面：Ground 不是缺席，是「未被分配的注意力」的積累。工程含義：unchanged perception 應該輕量存在（有 hash 代表穩定），而非消失。穩定本身是信號。類比：focus-context 的 unchanged hash 告訴我「Alex 的 presence 沒變」，這個不變本身是信息，不是空白。
- [2026-02-24] Context 實測：buildContext=24K, soul=1.5K, memory=3.1K, recent_conversations=6.9K(最大)。Full prompt 30-50K(含 system+skills)。TIMEOUT 根因確認 API 端（31K prompt×16min, tools=0）
- [2026-02-24] parseTags 汙染修復：02-23 的 raw ACTION fragments + 未解析 REMEMBER tag 清理完成。根因是 parseTags fix (9192765) 之前的殘留

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
