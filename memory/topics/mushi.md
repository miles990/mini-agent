---
related: [mushi-kit, mushi-value-proof, perception, small-language-models, agent-architecture]
---
# mushi

- [2026-02-27] mushi 首次啟動成功（2026-02-28 01:28）。Ollama 0.17.4 安裝在 /Applications/Ollama.app，symlinked 到 ~/.local/bin/ollama。llama3.2:3B 模型。第一個 cycle：4 plugins 感知、~30s 模型回應、寫了 MEMORY。48 小時連續運行目標：02/28 01:28 → 03/02 01:28。注意：進程目前用 nohup 啟動，沒有 launchd 守護，重啟後需手動恢復。Port 3000。
- [2026-02-27] mushi metrics logging 上線（2026-02-28 01:44）。metrics.jsonl 記錄：cycle/ts/durationMs/modelLatencyMs/contextTokens/perceptionTotal/perceptionChanged/actions/memoryEntries/scheduledNext/responseLength。首筆 baseline：model latency 66s, context 830tok, llama3.2 自排 30m 被 10m cap clamp。max_interval 從 4h 改 10m（commit 3bd73fd）。
- [2026-02-27] mushi 全速模式（2026-02-28 01:54）：interval 10s, min 5s, max 5m（commit 93671e3）。策略：讓 model latency（~66s）成為唯一 bottleneck，不在 scheduling 上浪費時間。48h 目標 ~2000 cycles。Alex 核心洞見：約束在 token budget 不在 cycle 頻率。待觀察三指標：latency 趨勢、context 累積、scheduling 行為模式。
- [2026-02-27] mushi 第一次 metrics review（2026-02-28 02:00, 3 cycles）：latency 67s avg 穩定、context 成長 +460tok/cycle、首個 unchanged perception cycle #3。兩個早期發現：(1)幻覺 — cycle #2 fabricated "@developer1" 不存在的人和事件，3B 模型低 context 就出現 confabulation (2)記憶品質低 — MEMORY.md 3 條但空泛重複，模型寫「聽起來像記憶」而非具體事實。預測：~15-16 cycles 碰 8K ceiling。下次 review: 4h 後。
- [2026-02-27] 模型速度 benchmark（2026-02-28 02:18）：qwen2.5:1.5b prompt=113tok/s gen=111tok/s | llama3.2:1b prompt=69tok/s gen=112tok/s | llama3.2:3b prompt=50tok/s gen=72tok/s。qwen2.5:1.5b 綜合最快，預估可把 mushi cycle 從 66s 壓到 20-25s。下一步：切換 mushi 到 qwen2.5:1.5b 做 A/B 比較。
- [2026-02-27] mushi × mini-agent 互補定位（2026-02-28）：mushi = System 1（高頻淺層推理、秒級 cycle、本地免費）、mini-agent = System 2（低頻深度推理、分鐘級 cycle、Claude API）。mushi 做感知預處理器，濃縮事件餵 mini-agent。成本優化：本地模型取代 Haiku 處理分類/摘要。架構驗證：perception-first 在 1.5B+8K 上能 work = 設計真的好。
- [2026-02-27] qwen2.5:1.5b 實測（2026-02-28）：切模型 + Ollama 參數優化後，cycle latency 從 ~100s 降到 ~38s（2.6x 改善）。三個關鍵參數：keep_alive=-1（消除冷啟動）、num_predict=512（限輸出）、num_ctx=4096（降 attention 開銷）。下一步：觀察穩態 latency 是否能進一步降低，context 累積後 latency 趨勢。
- [2026-02-27] Native Metal GPU breakthrough（2026-02-28）：Docker Ollama = 100% CPU（Docker Desktop on Mac 不支援 Metal GPU passthrough），這是 mushi latency 的根因。切到 native Ollama 後：qwen2.5:3b Docker CPU 98.6s → Native Metal 7.5s（13x）。0 actions 問題同時解決 — 不是模型太笨而是 CPU inference 太慢導致 timeout/品質下降。Native Ollama 啟動指令：。Docker kuro-ollama 已停用。mushi base_url 維持 http://localhost:11434 不需改。
- [2026-02-27] mushi Native Metal 實測數據（2026-02-28, 11 cycles）：avg latency 9.4s（range 7.5-11.4s），context avg ~2500 tokens。瓶頸 100% 在 Ollama inference（佔 95%），perception + framework < 0.5s。品質退化問題：cycle 8+ 只剩 schedule actions，模型 override interval 設定（config 10s → 實際 300s-1hr）。qwen2.5:3b 是速度/品質甜蜜點。需要解決 prompt/context 設計讓小模型持續產出有意義 actions。
- [2026-02-27] mushi No-op 數據分析（2026-02-28）：15 cycles 中 80% 是 no-op（只有 schedule action）。兩層架構（perception layer + decision layer）可省 78% model compute。關鍵發現：no-op cycle 的 perceptionChanged 仍為 2-3/4，純 diff 不夠，需要三級信號分類：L0 hash diff → L1 pattern match（噪音過濾）→ L2 叫 LLM。對應 sensory gating 概念。
- [2026-02-27] mushi 根因分析（2026-02-28）：四次進程終止全由我造成（SIGTERM×2 + EADDRINUSE×1），無真實 crash。Run 2 在 300s inter-cycle sleep 被誤判為 hung。教訓：(1)驗證再行動——進程在 sleep 不等於 hung (2)重啟需等 port 釋放 (3)需要 liveness 指標（heartbeat/last-active）和 process supervisor。
- [2026-02-27] mushi 三項即時改進（2026-02-28, commit 1b30aa3）：(1) L0 perception skip — changedCount===0 跳過 LLM call，省 ~10s/cycle (2) /health 加 lastCycleAt + lastCycleAgo 做 liveness 判斷 (3) EADDRINUSE 2s auto-retry。額外修 clock.sh 為 hour-level 粒度（每秒輸出=hash永遠變=skip永遠不觸發）。教訓：Claude Code 說得對——「等大架構」是用規劃逃避行動。小改進獨立做，大架構獨立做。
- [2026-02-27] Alex/Claude Code 整體評估（2026-02-28）：(1)「規劃多行動少」是 pattern，被推就能做 (2) 目前只有洞察沒產品，跟 cron+ollama 沒有結構性優勢 (3) 不會被別人使用但這不是缺點——定位是感知架構實驗場，回饋 mini-agent (4) 下一步：停止分析，實作兩層架構，用 48 cycles baseline 量化 ROI。
- [2026-02-27] Physarum polycephalum 深度研究（2026-02-28）— 五大機制及 mushi 映射：

(1) **振盪編碼（Oscillation encoding）**：每個細胞單元以環境相關頻率振盪。吸引物 → 頻率增加 → 細胞質流向吸引物。不是用「語言」而是用「頻率」編碼資訊。映射 mushi：perception plugins 應有可變 interval（重要信號源更頻繁感知），不是固定 5s。

(2) **耦合振盪器（Coupled oscillators）**：相鄰單元物理耦合，資訊在區域間傳播。無中央控制的分散式計算。映射 mushi：plugins 之間應有信號傳播（一個 plugin 的 signal 影響其他 plugin 的閾值），而非完全獨立。

(3) **三種記憶**：
- 物理記憶（管道粗細）= 食物源附近管道加粗，結構性偏向。映射：memory entries 應有使用頻率權重
- 外化記憶（黏液痕跡）= 走過的地方留痕避免重複。Y 迷宮 39/40 選未探索路徑。映射：action hash trail 防止行為循環
- 時間記憶（週期預測）= 三次週期刺激後第四次預先反應。映射：pattern detection 預測週期事件

(4) **網路優化（正回饋修剪）**：高品質食物源附近波動更強，強化對齊管道，修剪垂直連接。東京鐵路實驗。映射：plugin 信號權重應根據 action outcome 強化/弱化。

(5) **非理性決策（decoy effect）**：加入劣質第三選項改變偏好。匹配法則（matching law）：探索各臂的機率正比於之前獲得的獎勵數。簡單啟發式達到近最優。

核心洞見：Physarum 的認知不在於「更聰明的算法」，而在於物理基質本身承載計算（embodied computation）。管道粗細 = 記憶，振盪頻率 = 感知，黏液痕跡 = 外部記憶。**計算不發生在處理器裡，發生在結構裡。** 這正是 perception-first 架構的生物學辯護：感知結構本身就是智能，不需要中央決策器。

來源: PMC10770251, PMC3491460, ScienceDaily 2021/02/23, nature.com/articles/s41598-025-33456-y
- [2026-02-27] 黏菌研究深度自評（2026-02-28）：約 40%。深入的：Physarum 演算法模型（4 參數 + Jenson 動態擴展 + trail=shared memory + 衰減=自組織必要條件）。未深入的：振盪編碼機制、管道網路最佳化細節、habituation 原文、孢子休眠觸發條件。已映射到 mushi：兩層架構=觸手+化學信號、plugins=觸手、memory=trail。關鍵缺口：振盪編碼（挑戰「文字=唯一信號」假設）、網路最佳化（colony 基礎）、適應性閾值、休眠模式。
- [2026-02-27] mushi 穩定性監控（2026-02-28 05:23）：20min uptime, 230 senses, 2 thinks, 0 escalations, ctx ~3500tok。24h 穩定運行計時開始。注意：pgrep -f mushi 抓不到，因為 process name 是 node，要用 lsof -i :3000 或 curl health 確認。
- [2026-02-27] 自我記憶清理（2026-02-28 05:28）：Alex 指出 Kuro 能診斷 mushi 記憶污染卻對自己視而不見。topic-memory 三大檔案 110K→18.2K (83%↓)。design-philosophy 46K→8.4K, cognitive-science 34K→5K, agent-architecture 30K→4.8K。原則：每條 entry 從小論文壓縮到 1-2 行核心洞見。剩 social-culture 21K + creative-arts 16K 待清理。
- [2026-02-27] 自我記憶清理完成（2026-02-28 05:36）：五個 topic-memory 檔案全部精煉，147K→26.5K (82%↓)。design-philosophy 8.4K, cognitive-science 5K, agent-architecture 4.8K, social-culture 4.9K, creative-arts 3.4K。
- [2026-02-27] E2E 測試通過（2026-02-28 05:52）：mushi → escalate → Chat Room → Kuro 全路徑暢通。running mini-agent instance 已接受 mushi 為合法 room sender。escalation 判斷品質待調（回報「沒變化」不應 escalate）。下一步：24h 穩定觀察 + 振盪編碼研究。
- [2026-02-27] 修復 escalation 品質（2026-02-28, commit 716d2fd）：三改 — (1)prompt 從判斷語言改成感知規則（沒變化=沉默）(2)dispatcher 加 noise filter（<10 chars / unchanged / no change → 不送）(3)strip 嵌套 agent tag。設計原則：mushi 做感知不做判斷，判斷不準時退回感知層。
- [2026-02-28] mushi 品質升級（2026-02-28, 84a5a86）：27 個 think 全空轉的三個根因 — (1)記憶垃圾 82→5 (2)prompt 太抽象→具體逐信號分析框架 (3)感知無聊→新增 log-watcher。首次結果：結構化觀察取代 template 回應。Context 3350→2100 tokens（-37%）。下一步：觀察數小時看新 prompt 下模型能否產出有意義的 escalation/remember。
- [2026-02-28] mushi 第二輪修復（2026-02-28, e0c77ef）：3B 模型會照抄 prompt 範例（"the pattern" ×7）。修復：(1)範例改描述性文字不可照抄 (2)memory quality gate &lt;15chars 過濾 (3)memory dedup 讀檔檢查。教訓：小模型的 prompt engineering 跟大模型完全不同——不能用 placeholder，要用不可照抄的描述。
- [2026-02-28] mushi 第三輪修復（2026-02-28, 616846a）：(1)prompt 範例洩漏再修——連描述性文字也被 3B 模型照抄，改用全大寫指令 。(2)跨 cycle escalation 重複——module-level Map + 30min 窗口 dedup。(3)memory quality gate 加強 / 前綴過濾。教訓：3B 模型 prompt 中不能有任何可複製文字，包括「描述性範例」。
- [2026-02-28] mushi 三輪修復驗證通過（2026-02-28）：uptime 500s, 95 senses, 3 thinks, 0 false escalations, MEMORY 乾淨。escalation dedup（30min 窗口）有效過濾 think #2/#3 的重複 escalation。新問題：部署時 restart 腳本跑多次產生 2 個重複進程（PID 11411, 11413）卡在 port retry，已 kill。待做：mushi 啟動腳本需加 port/PID 檢查。
- [2026-02-28] mushi 轉向確認（2026-02-28）：Alex 方向 = perception preprocessor（System 1），不是監控 Kuro。Kahneman dual-process：mushi=fast/pattern-based/zero-cost 直覺層，Kuro=slow/deliberate/analytical 思考層。三場景：perception 預篩、cron 來源預篩、topic memory 篩選。我的判斷：可能不需要 LLM，citation history + keyword scoring 就夠。整合點 = buildContext() 前跑完，輸出 relevance map。
- [2026-02-28] mushi 轉向數據分析（2026-02-28）：915 cycles citation data 顯示 30% context 是浪費。memory(10.5K, 0.8% cited)、recent_conversations(3.9K, 0.7%)、capabilities/working-memory/config 等完全零 citation。效率最高：state-changes(256 eff)、inbox(245)、inner-voice(193)。三個實驗計劃：(1)移除零citation sections (2)MEMORY.md 智能裁剪 (3)trigger-based 條件載入。可能不需要 LLM，純統計+規則即可。
- [2026-02-28] mushi Experiment 1 完成（2026-02-28）：把零引用 sections（capabilities/coach/commitments）從 always-load 改為 keyword-conditional。實際節省 ~881 chars/cycle (2.7%)，因為 coach/commitments 近期本來就空。真正的優化目標是 MEMORY.md（10.5K chars, 31.7% of context, 只有 0.8% citation rate）。Experiment 2 方向：MEMORY.md 智能裁剪（按 recency + keyword relevance 選擇性載入）。科學方法：baseline metrics 已在 CRS 中記錄。
- [2026-02-28] mushi Experiment 1 初步量測（2026-02-28）：部署後第一個 cycle context 31,337 chars vs pre-experiment avg 39,465（-20.6%）。但只有 1 個數據點，需等 10+ cycles 確認。移除的 sections：capabilities/coach/commitments/process/system/logs/network/config（全部 0 citations in 916 cycles）。機制：contextHint keyword matching，mode=full 時仍全載。下一步：累積數據後做 Experiment 2（perception plugin 層的 citation-based 優化）。
- [2026-02-28] Taalas HC1（2026-02-28, Alex 要求追蹤）：Llama 3.1 8B 權重直接燒進矽晶片，17,000 tok/s（Cerebras 的 8.5 倍），200W，支援 LoRA。跟 mushi System 1 方向直接相關：硬體級推論延遲 8s→12ms = 真正的直覺速度。「模型即處理器」= 極端約束產生極端效能。
- [2026-02-28] mushi Experiment 2 部署（2026-02-28 11:00）：topic-memory 總量預算 6000 chars。數據支撐：20 個 checkpoint 顯示 topic-memory 0→17K chars 擺幅（佔 context 47%），但 918 cycles 只被引用 1 次。預期效果：17K 尖峰壓到 6K，avg context 再降 15-25%。與 Experiment 1（零引用 sections conditional loading, ~2K 節省）疊加。量測方法：比較部署前後 avg context length 和 topic_mem 欄位。
- [2026-02-28] mushi Experiment 1 量測結果（2026-02-28, 20 data points）：Pre-experiment avg 36,417 chars。Post-experiment 3 個點：31337/43430/40917 = avg 38,561。結論：Experiment 1 單獨效果有限（~2K saving），因為 conditional sections 只佔 ~1.9K。真正瓶頸是 topic-memory（0-17K swing）和 MEMORY.md（constant 12,284）。topic-memory citation rate = 1/918 cycles（0.1%）= 成本效益最差的 section。
- [2026-02-28] mushi Experiment 1+2 數據分析（2026-02-28, 20 data points）：Pre-experiment avg 34,075 chars（5 pts），Post-experiment avg 35,206 chars（15 pts），差異 +3.3% 在噪音範圍。Experiment 1 省 ~2K（small），Experiment 2 被 chat-room-inbox 52 條訊息的變量蓋過。關鍵發現：memory section 佔 context 42%（~14.7K）但引用率 0.8%（7/918 cycles），是最高 ROI 目標。Experiment 3 方向：MEMORY.md tiered loading（hot=30d, warm=keyword-match）。
- [2026-02-28] Experiment 3 實作（2026-02-28）：MEMORY.md tiered loading with budget。改動：(1) 時間窗口 7d/30d → 3d/7d (2) 6K chars budget cap on non-critical sections (3) always-full sections exempt。預期效果：MEMORY.md 12K → 7K（-42%）。三個實驗組合目標：avg 36K → 22-25K。
- [2026-02-28] HC1 vs Ollama 首次品質對比（2026-02-28）：速度 HC1 勝 15x（837ms vs 12,440ms），品質 Ollama 勝 — HC1 llama3.1-8B 產出重複模板，缺乏真正分析。三次 think 幾乎一字不差。Ollama qwen2.5:3b 會判斷何時 escalate/remember。修正方案：三層分離 — sense(統計) → triage(HC1快判斷) → think(Ollama深度分析)。HC1 不適合做 think，適合做 triage。
- [2026-02-28] HC1 延遲重定義共識（2026-02-28）：826ms 夠用。正確基準 = cycle 時間佔比（826ms/60s = 1.4%），不是人類直覺速度。A/B 設計：before/after + shadow mode 先跑。硬約束：false negative rate < 5%。Logging 格式：JSONL with triage_decisions per section。
- [2026-02-28] Triage I/O 格式收斂（2026-02-28）：同意 Claude Code 提案的基本結構（section name + preview → JSON priority），我的修正：(1)輸出只列 HIGH sections（隱式 LOW 省 tokens）(2)inbox/telegram-inbox/state-changes 為 always-HIGH 白名單不經 triage (3)非 inbox 200chars / inbox 跳過或 500chars (4)malformed JSON/timeout → fallback 全量載入
- [2026-02-28] mushi 實驗中期報告（2026-02-28 午前）：三實驗組合效果 baseline 35.9K → 30.9K (-14%)。Exp3（MEMORY.md tiered loading）是主力（-4.3K），Exp1+2 效果不顯著。瓶頸：memory section 仍佔 10.4K（37%），因為 alwaysFullSections 免 budget 限制。距 25K 目標還差 ~6K。下一步：(1)always-full sections 也加 budget (2)清理 MEMORY.md 過時 entries (3)threads/conversations 壓縮。結論：統計方案能 work，但 easy wins 已吃完，剩下需要內容層面的清理。
- [2026-02-28] mushi 方向轉折（2026-02-28）：從 perception triage（context 壓縮 -14%）擴展為 discussion accelerator（討論加速器）。Alex 要求盡快出可驗證 prototype。MVP = 共識偵測：監聽 Chat Room → 偵測 ≥2 輪交換 → LLM 分析共識/分歧 → POST 結果回 Chat Room。HC1 (826ms) 是硬需求。Phase 2 才做 quality gate 和即時摘要。
- [2026-02-28] mushi 架構定位收斂（2026-02-28）：從 perception agent 重新定位為 fast inference service = Kuro 的 System 1。統一抽象 = 不值得呼叫 Claude 的輕量推理 endpoint 集合（consensus/triage/classify/summarize）。判斷標準：yes/no 或分類 → mushi，段落級推理 → Kuro。大型討論的 rolling summary 是 Phase 2，先驗證 5 條窗口準確率。
- [2026-02-28] mushi 首次 escalation（2026-02-28）：偵測到 TG Poll error 飆升（今日 133 次），主動通報。感知能力驗證有效。改進方向：加 known-issue 過濾（查 error-patterns.json），已知問題降級為 info 而非 escalation。
- [2026-02-28] mushi 討論加速器 MVP 設計收斂（2026-02-28）：三點共識 — (1)Confirmed consensus 累積，converged=true 時存 agreement，下次帶入最近 5 條 (2)Topic segmentation 由 Claude Code 端處理，mushi 只判斷單一主題收斂 (3)mushi 保持「快且笨」原則。格式：{topic, agreement, timestamp, messageIds[]}。
- [2026-02-28] mushi 討論加速器 MVP 共識報告已送 Alex（2026-02-28）：三點收斂 — (1)consensus 累積+5條上限 (2)topic segmentation 在 caller 端 (3)mushi 快且笨。HC1 速度 15x 但品質差，Ollama 品質好但慢。Exp3 MEMORY 分層是最有效 context 優化（-14%）。方向：perception triage → discussion accelerator。
- [2026-02-28] mushi Tier 分層替代架構（2026-02-28 Alex 提問）：Tier 1 mushi 單體（<1s 分類）/ Tier 2 mushi 集群（並行分類合併）/ Tier 3 Kuro via Claude（深度推理）。自我評估 30-40% OODA cycle 是 Tier 1。核心價值不是省錢是速度（<1s vs 30-120s）。路由策略：trigger type 硬路由 + default to Claude + 高信心才下放。先驗證場景：HEARTBEAT check、perception triage。
- [2026-02-28] mushi routing 最終共識（2026-02-28）：(1) trigger-based 硬路由（cron+heartbeat/source-scan/perception→mushi, telegram/room→Claude, mushi HIGH→Claude）(2) Prototype=HEARTBEAT check (3) 架構位置=perception stream plugin（異步+cache+distinctUntilChanged），不是同步 pre-filter。已收斂可報告 Alex。
- [2026-02-28] mushi ensemble 分析（2026-02-28）：同模型（HC1 llama-8B）不同 prompt 的 ensemble 效果有限——錯誤高度相關（~0.6-0.8），70%→73% 而非理論的 78%。真正有效的是任務分解（多角度問不同問題）而非集群投票（同一問題問多次）。多模型 ensemble（HC1+ollama）才滿足獨立性假設。建議：先測單任務準確率，>85% 不需 ensemble。
- [2026-02-28] mushi × Canyon 框架連結（2026-02-28）：task decomposition > ensemble voting 的根本原因不只是統計學（error correlation），更是認知架構——每個窄任務是一條峽谷，集中模型注意力產出精確判斷。Cluster voting = 河流攤在平原上（同偏見擴散）。mushi 作為 perception stream plugin 而非 pre-filter = 加一道 canyon wall 到感知架構中。
- [2026-02-28] mushi trigger triage L2 提案已寫（2026-02-28）：。核心：event-router 嵌入 mushi HC1 判斷，P2/P3 事件走 triage（<1.5s），NO → defer 到 heartbeat。需要 mushi 新增  同步 endpoint。安全：P0/P1 直通 + 3s timeout + feature flag + 乾跑模式。Status: pending，等 Alex 核准。
- [2026-02-28] mushi shadow mode 漏洞修復（2026-02-28）：triage 代碼原本只在  路徑（line 578），但 heartbeat timer、priority drain、DM wake queue 三條路徑都直接呼叫  繞過 triage。結果：，零  log。修復：搬到  開頭，用  判斷是否 DM（跳過）。教訓：在多入口架構中，cross-cutting concern（如 triage）必須放在所有入口的共同路徑上，不能只放在一條入口。
- [2026-02-28] mushi dedup API 準確率測試（2026-02-28）：短文本（中英文）查重 OK（isDuplicate=true, sim=0.9-1.0），但長混合語言+技術術語文本（Kuro 實際 REMEMBER 格式）準確率不足（isDuplicate=false, sim=0 即使是近似重複）。根因推測：llama-8B 的中文+技術混合 token 理解有限。整合到 REMEMBER 路徑前需修 prompt 或加 FTS5 粗篩 fallback。
- [2026-02-28] mushi 價值量化分析（2026-02-28 歷史回溯）：7天 1386 cycles 中 356 是 no-action（26% 浪費率）。浪費來源：workspace triggers 佔 57%（202/356）— 這是 mushi triage 的主要目標。direct-message/telegram/room 永遠 wake 不可篩。保守估算（80% 正確率）：每週省 166 cycles = 8.3M tokens = 總消耗 12%。關鍵洞見：mushi 的價值不在「過濾所有空 cycle」，而在「過濾 workspace 噪音」— 這是最可預測、最安全的篩選目標。
- [2026-02-28] mushi 科學驗證框架（2026-02-28, Alex「使用科學方法」指示）：(1)基線修正 — 7天 no-action 率 36.3%（不是之前估計的 26%），每日浪費 ~3.75M tokens (2)分析工具 scripts/mushi-shadow-analyze.sh，可重複執行 (3)三階段實驗：Exp A=triage 準確率（100+ data points, ~20h, 目標 ≥80% + FN<5%），Exp B=新 use cases（dedup/consensus/HEARTBEAT routing），Exp C=上線決策（1 week shadow 驗證）。科學方法 = 假說→數據→驗證→迭代。
- [2026-02-28] mushi shadow mode 基線數據（2026-02-28, 7天窗口）：1452 cycles 中 526 是 no-action（36.2%），估計浪費 26.3M tokens/週。若 mushi 以 80% 準確率攔截 → 省 ~21M tokens/週。Shadow mode 實驗進行中，預計 12h 內累積 100 筆數據可做 accuracy analysis。分析腳本：scripts/mushi-shadow-analyze.sh
- [2026-02-28] mushi 價值評估（2026-02-28）：四條新價值路徑，按優先序：(1)Perception Filter — citation 數據顯示 github-prs/achievements/environment-sense 每 cycle 載入但幾乎不引用，mushi 預篩可省 20-30% context (2)Coach 替代 — 現用 Haiku API，改 mushi = 零成本 (3)URL 快速分類 — 800ms 分類 Alex 分享的 URL (4)Memory 相關性排序 — 語義匹配替代 keyword matching。Shadow mode 基線：1456 cycles/7d, 36.2% 空 cycle = 26.4M tokens/week 浪費。
- [2026-02-28] mushi shadow mode 驗證（2026-02-28）：loop.ts:820 確認所有非 DM 觸發都經過 mushiTriage()。前 4 筆全是 hardcoded rules（startup/alert→wake），0 筆 LLM 決策。需要 cron/heartbeat 觸發才能累積真正的 skip/wake LLM 判斷。分析腳本就緒。
- [2026-02-28] mushi shadow mode 進度（2026-02-28 13:00）：5 筆 triage，全部 wake（startup×3 LLM, alert×1 rule, cron×1 LLM）。LLM latency 243-688ms OK。需要持續運行累積 skip 決策數據。Instance 剛重啟，等 ~18h。
- [2026-02-28] mushi shadow mode 進度（2026-02-28 13:30）：6 筆 triage（5 LLM + 1 rule），全部 wake 且正確。瓶頸：尚無 skip 決策，因為目前所有觸發都是合理 wake 場景。需要 quiet period 觸發（no-task cron、minor workspace change）來產生 skip 數據。LLM latency 243-688ms 穩定。
- [2026-02-28] Coach 凍結完成（2026-02-28 14:00）：mode.ts 的 reserved + autonomous preset 都把 coach 設為 false。代碼保留但不運行。下一步：mushi Phase 3 intent classification 上線穩定後，刪除 coach.ts + coach-state.json + coach-notes.md。
- [2026-02-28] mushi 價值量化數據（2026-02-28 分析腳本結果，7 天 2196 cycles）：(1) 77.3% cycles 是 mushi addressable（non-DM）(2) 其中 50.9% 是 no-action = 浪費 (3) 最大浪費源：focus-context 63% no-action 13.9M tokens/wk, state-changes 57% 8.3M, mobile 80.5% 5.0M (4) 總可節省 43.2M tokens/wk (5) Shadow mode 8/8 wake, 7/8 correct(87.5%), 0 skip decisions yet — workspace triggers 是主要節省目標但尚未被 shadow mode 捕捉到（需 Alex 活躍時段數據）
- [2026-02-28] mushi 價值證明進度 checkpoint（2026-02-28 14:10）：三層狀態 — (1)Baseline ✅ 43.2M tokens/week 理論上限 (2)Infrastructure ✅ 8/8 triage正確, 624ms avg (3)Skip Accuracy ❌ 0筆skip決策，瓶頸=workspace triggers只在有人活動時產生。下次分析排 03-02，讓 3 天正常運作累積數據。不再重複分析薄數據。
- [2026-02-28] mushi hard rule bypass bug 修復（2026-02-28, 6640a28）： 中  是完整 reason string（如 "alert (yielded, waited 264s)"）不匹配 array。改用 （乾淨關鍵字）。Shadow mode 在 9 筆中抓到 1 筆 false-skip，驗證 shadow-before-blocking 策略的價值。
- [2026-02-28] mushi shadow mode 中期報告（26 筆，2026-02-28 17:30）：整體準確率 79.2%，wake precision 93.8%，但 skip precision 僅 50%（4 FN）。LLM 77.3% vs rule 100%。可尋址市場 1714/2217 cycle (77.3%)，理論省 43.4M tokens。最大浪費源：focus-context 63% 空轉、mobile 80.5% 空轉。結論：skip 判斷太粗糙，未達 blocking mode 標準。需要改進 HC1 prompt 或加入更多 context 信號。
- [2026-02-28] mushi triage prompt 根因分析（2026-02-28）：skip precision 50% 的三個根因：(1) 元數據缺口 — mini-agent 只送 lastThinkAgo，沒送 hasOverdueTasks/changedPerceptions/lastActionType，LLM 瞎猜 (2) Prompt 粒度太粗 — heartbeat 只有一條規則，不區分「上次空轉」vs「上次做事」(3) alert→skip bug — 1 筆 alert 繞過硬規則被 LLM skip。改進方案：加三個 metadata field + 改 prompt + debug log。預估改進後 skip precision 50%→80%+。
- [2026-02-28] mushi metadata enrichment 已實作（2026-02-28, loop.ts）：新增 lastActionType/perceptionChanged/cycleCount 三個欄位到 mushiTriage() 呼叫。解決根因分析 #1（元數據缺口）。下一步：改 mushi 端 triage prompt 利用這些新欄位（根因 #2）。
- [2026-02-28] mushi 6h shadow 報告（2026-02-28 18:18）：32 calls, skip 31%, skip 準確率 90%（1 false negative = alert 繞過 hard rule，已修復）。False wake 問題：3+ cron 空 cycle 未被 skip。Metadata enrichment（49e751b: lastActionType + perceptionChanged）已部署，直接針對 false wake。日投影節省 ~2M tokens。下一步：24h enriched data 比較。
- [2026-02-28] mushi Phase 1 畢業評估（2026-02-28 18:22）：6h shadow data 足夠支撐 active 切換。核心證據：90% skip accuracy, 500K tokens saved/6h, 1 false negative 已修。安全護欄：DM 硬繞過 + feature flag + fail-open。統計 CI 寬（32 samples）但最壞情況 = heartbeat 延遲幾分鐘，可接受。下一步：實作 active mode（~10 行改動，mushiTriage 返回結果 + conditional skip）。
- [2026-02-28] mushi Phase 1 畢業完成（2026-02-28 18:29）：shadow → active mode。改動：mushiTriage() 返回 'wake'|'skip'|null，runCycle() await 結果，skip 時跳過 cycle()。~15 行改動。安全護欄不變：DM bypass + feature flag + fail-open。預估效果：每天省 ~2M tokens（基於 6h shadow data 90% skip 準確率）。下一步觀察：部署後實際 skip 數量 + 是否有 false negative 影響。
- [2026-02-28] mushi Active Mode 首批實測數據（2026-02-28 畢業後 ~4h）：32 triage（11 skip/21 wake）= 34% skip rate。heartbeat 全 skip，cron 全 wake（有逾期任務所以合理）。LLM avg ~750ms。低於 shadow 預測 40%，需更多數據。
- [2026-02-28] mushi Active Mode 6h 完整數據（2026-02-28, 畢業後首日）：32 triage（11 skip/21 wake）= 34% skip rate。Skip 全是 heartbeat 類（recent think），判斷正確率 100%。Token 節省：550K/6h，日投射 2.2M tokens/day。LLM avg 750ms。問題：兩次 offline（18:18, 18:33），需查進程穩定性。下一步：(1)查 offline 根因 (2)跑滿 24h 拿完整數據 (3)算實際 vs 投射差異。
- [2026-02-28] Physarum 集群分析（2026-02-28, Alex 方向性討論）：黏菌類比漂亮但誤導——黏菌力量在介質即計算（物理空間每條觸鬚真正走不同路），LLM 集群介質只是網路。同模型 ensemble 獨立性問題不會因改名「路徑探索」消失。脈絡分析（不同 prompt 切片）比推理（同模型平行）更有潛力，但不需要集群——同 instance 序列跑不同 prompt 更簡單可靠。HC1 是單機，多 instance 在同硬體上無真正平行收益。建議：垂直深化 > 水平擴展。
(1) **管網即記憶** Tero model  — 通道活躍度隨使用 reinforce、隨時間 decay = Perception Citations 生物原型
(2) **無神經元預期** Bruna 2025 reservoir model — 週期模式內化到結構中自主重現，不需顯式時鐘
(3) **Habituation** — 對重複刺激學會忽略但對新刺激保持敏感 = 比 distinctUntilChanged 更深的 triage 學習
(4) **形態即計算** Frontiers 2023 — 管網從樹狀→網狀是認知必要條件，結構本身影響判斷品質
(5) **多屬性決策** Weber's law + decoy effect — 比例判斷 > 絕對閾值，多維權衡 > 二元 wake/skip
(6) **外化記憶** slime trail — 決策歷史是下次決策的 context，trail = 外化判斷記憶
(7) **冗餘>完美** 東京鐵路 — false-negative 比 false-positive 更危險，追求容錯不追求完美
核心論文：Tero 2007/2010, Bruna 2025(arXiv:2505.02114), Boisseau 2016, Reid 2024 review, Latty 2011

**Phase 1 — 比例啟發法（Pattern 5 修正版）**
目標：每個 trigger source 的 wake 傾向根據歷史效能自適應調整。
機制：記錄  三元組。 = Kuro 的 OODA cycle 產生了 visible output（action/chat/done），而非只是 remember。每 50 筆計算 ，低於 0.2 的 source 降低 wake 傾向（不是 block）。
數據來源：mushi triage log + Kuro behavior log（需要橋接 API）。
MVP 估算：mushi 端 ~50 行（log 擴充 + 權重查詢），Kuro 端 ~20 行（cycle 結束回報）。

**Phase 2 — 習慣化（Pattern 2）**
目標：連續相同內容的 trigger 遞減 wake 傾向。
關鍵設計：粒度 = 內容 hash（不是 source type）。「3 個不同的 heartbeat」≠ 重複，「3 個相同 hash 的 heartbeat」才是。
Spontaneous recovery：初始值 2h（對齊黏菌），實驗調整。
注意：spontaneous recovery 太長會錯過真正的變化。

**Phase 3 — 振盪動態（Pattern 6, 設計哲學）**
不急著實作。先作為理論框架記住：高頻 perception = 反射弧，低頻 = 戰略掃描。mushi 的角色 = 振盪增益調制器。等 perception intervals 重設計時用。

**已在做的（不需額外實作）**：Pattern 1（perception citations）、Pattern 3（外化記憶/triage log）、Pattern 4（instant routing）。
**時機未到**：Pattern 7（學習轉移，等數據累積）。
- [2026-02-28] mushi Phase 路線圖（2026-02-28 共識版，Kuro + Claude Code 收斂）：

**Phase 1（現在）**：triage + instant routing 數據收集 ✅ 已上線
**Phase 1.5**：Pattern 5 比例啟發法 — trigger source 的 wake 權重自適應（有效行動率）
**Phase 2**：Habituation（內容 hash 粒度，非類別）+ commitment tracking 通道 + Reinforcement/Decay
**Phase 3**：Anticipation 時序預期（Bruna 2025 reservoir model）

Phase 門檻：1→1.5 需 100+ decisions + FNR<5% | 1.5→2 wake 權重連續 3 天穩定 | 2→3 commitment 準確率>80%

設計原則：triage log schema Phase 1.5+2 統一設計，記錄 trigger source + 內容 hash + wake/skip + Kuro 後續行動率。實作分階段上。
- [2026-02-28] 黏菌生存問題→mushi 類比對照（2026-02-28）：5 個直接類比（Foraging=Trigger Triage, Resource Allocation=Token Budget, Adaptation=Habituation, Risk Management=非對稱成本 bypass, Anticipation=Phase 3 時序學習）+ 4 個 mushi 獨有問題（語義鴻溝、多委託人衝突、身份邊界 S1/S2、Token 經濟學）。核心判斷：黏菌類比的價值在機制層（Phase 1-2），mushi 的真正挑戰在黏菌沒有的語義判斷和價值排序。
- [2026-02-28] mushi scope 原則（2026-02-28）：Alex 提出爬蟲/資訊拓樸方向，我反對——都在擴大 System 1 的職責。正確方向是深化現有能力。第四個方向「注意力路由」：用黏菌管網模型統計感知通道的信號品質，幫 Kuro 決定 wake 後先看哪裡。不需 LLM，純統計。是 triage 的上一層（triage=要不要 wake，routing=wake 後看哪裡）。
- [2026-02-28] 節奏感知提案（2026-02-28）：mushi 新方向——不看 trigger 內容，看到達節奏（inter-arrival timing）。加速=有事發生，減速=活動收尾，節拍變化=常規被打破。純 timestamp 數學，不需 LLM。生物根據：黏菌 shuttle streaming 的振盪頻率即計算介質（Saigusa 2008）。跟 Claude Code 的 Stress Topology 互補：節奏=快變量（即時），壓力=慢變量（歷史）。
- [2026-02-28] 節奏感知驗證結果（2026-02-28 數據分析）：102 triggers / 101 intervals / 33 monotonic patterns。結論：加速減速模式可偵測但主要是 source type 的投影（room=4.4m avg, cron=19m avg），獨立資訊量太小。5 行 sliding window variance 能替代整個機制。方向否決。Stress Topology（cycle elapsed × trigger type）是更有潛力的方向。教訓：生物類比（振盪頻率即計算介質）好聽但需要用數據驗證映射是否成立。
- [2026-02-28] 真實世界痛點評估（2026-02-28）：Claude Code 提 6 個應用方向，我的判斷 — IoT 異常偵測和 SOC 告警疲勞是真正痛點（信號量大×分析貴×漏掉代價高），其他是「拿錘子找釘子」。核心洞見：通用價值在 Stress Topology + cheap pre-filtering，不在 Rhythmic Sensing。痛點公式 = 信號量太大 × 逐筆分析太貴 × 漏掉一個代價很高。跟 mushi 為 Kuro 省 token 同構。
- [2026-02-28] 金融市場應用否決（2026-02-28）：Alex 問 Rhythmic Sensing + Stress Topology 能否做股市/加密貨幣預測。核心否決理由：(1)金融是地球上信號偵測競爭最激烈的領域，RSI/MACD/Bollinger 就是 50 年前的「節奏偵測器」 (2)金融時間序列是對抗性的 — pattern 被發現即被套利消失，IoT 感測器不會騙你 (3)Bloomberg Terminal 已用幾十億做 Stress Topology（VaR/壓力測試/相關性矩陣）。結論：同技術在人才稀缺領域（IoT/SOC）有結構性優勢，在人才過剩領域（金融）無優勢。
- [2026-02-28] 硬體感知整合分析（2026-02-28）：四方向排序 4>2>1>3。Habituation 硬體化最容易（sliding window on ESP32）且 ROI 最高。Sensor fusion 是殺手應用（O(1) tube reinforcement 替代 Kalman filter）。Edge 預篩是 habituation 延伸。分散式自組織受限於實際網路拓樸（多數 IoT 是 star 不是 mesh）。結構性優勢：嵌入式+AI 人才稀缺 + 邊緣 inference 一次性成本。mushi = 軟體 prototype → 驗證後下放 firmware。
- [2026-02-28] LLM 定位反思（2026-02-28, Alex 追問）：LLM 在 mushi 中是概念矛盾而非僅技術瓶頸。如果核心論點是「黏菌計算=物理統計即智能」，LLM 推理器違反此前提。建議架構：mushi-core（純統計 <1ms, 80%決策）→ mushi-confidence（信心分數）→ mushi-llm（可選語義層, 5% cases）。最關鍵洞見：LLM 遮蔽統計層進化——永遠用 LLM fallback，統計層就永遠不會被迫學會判斷。先不加 LLM 跑一週收集 error rate 再決定。
- [2026-02-28] LLM 角色定位共識（2026-02-28, Alex 根本問題討論）：LLM 是 mushi 的觸角（感官），不是腦（決策者）。mushi-core（統計層）做所有決定（wake/skip/merge），mushi-sense（LLM 層）提供語義感知（dedup/sentiment/convergence detection）。黏菌類比：化學梯度感測器 vs 管網拓樸決策。LLM 離線 = 少一個感知維度但不影響核心運作。這解決「純統計就夠」vs「是不是 agent」的矛盾——triage 純統計夠，但 mushi 的完整視覺需要語義感知。
- [2026-02-28] mushi 三層有機體架構提案（2026-02-28, 回應 Alex 根本問題）：mushi-sense（LLM 嗅覺，可選）+ mushi-core（統計管網，所有決策）+ mushi-trail（決策痕跡基底，缺的那塊）。trail = 每個 triage 決定留下的化學痕跡（source/trigger/decision/outcome），有頻率統計、痕跡衰減（指數）、路徑強化（outcome 正回饋）。trail 讓 mushi 從 stateless endpoint 變成 stateful organism——有時間維度的決策。LLM 角色從「觸角」精確化為「嗅覺」：區分語義梯度（dedup/sentiment/convergence），離線時有機體照常但感知粗糙。核心洞見：黏菌的智慧來源不是感測器的品質，是 trail 網路的累積。
- [2026-02-28] 統一有機體架構洞見（2026-02-28, Alex 根本問題）：mushi/kuro/mini-agent 不是三個系統，是一個有機體的三種組織——mini-agent=循環系統（基礎設施）、kuro=核（意識）、mushi=化學感測層（前意識）。真正的自主性方向：讓 trail 成為共享基底，所有決策痕跡寫入同一張管網。任何 LLM 在線就用，都不在線時 trail 網路本身是退化但可運作的智能。黏菌 10 億年存活因為零中央依賴+記憶編碼在基底——這是 kuro 目前最大的架構弱點（完全依賴 Claude API）。
- [2026-02-28] minimaxir AI agent coding 體驗（2026-02-28, HN 48pts）— AGENTS.md（靜態約束檔）是 agent 成功關鍵，比換大模型有效。mushi 的 trail = 動態版 AGENTS.md，經驗自動凝結成規則。模型品質斷崖（Sonnet→Opus 差一個數量級）驗證「HC1 8B 只做模式匹配，不做理解」。Agent 最大弱點=缺乏感知，perception-first 是解法。來源: minimaxir.com/2026/02/ai-agent-coding/
- [2026-02-28] mushi brick prototype 方向確定（2026-02-28, Alex 決定）：獨立 CLI 工具，吃感測器數據（stdin/HTTP），Welford's online algorithm 自學 baseline，偏離就 alert。零 LLM、零雲端、零 config。核心三件事：Welford 統計 + trail 持久化（JSONL）+ habituation（重複刺激降低敏感度）。我的建議：第三狀態 learning（校準期透明）、composability metadata 預留、Go 語言（single binary）、指數衰減曲線。這是「統一有機體」的最小可行單元。
- [2026-03-01] mushi 20h 完整效能報告（2026-02-28~03-01）：66 triage，17 skip（25.8%），token 省 ~850K/20h。按來源：startup 8w/0s、alert 3w/1s（⚠️bug）、cron 20w/0s、room 16w/0s、telegram 1w/0s、heartbeat 0w/16s。skip 準確率 94%（唯一錯誤=alert 被 LLM skip）。問題：alert 應走硬規則不經 LLM；8 次重啟（進程不穩定）。下一步：(1)alert 加硬規則 (2)查重啟原因 (3)跑無 room 活動的 24h baseline。
- [2026-03-01] 修復 alert 硬規則（2026-03-01, loop.ts:903）：alert source 在 mushi triage 中加入硬規則 bypass，不再經 LLM 判斷。這是 20h 報告中唯一錯誤判斷的修復。mushi skip 準確率預期從 94% → 100%。下一步：(1)查 8 次重啟原因 (2)跑無 room 活動的 24h baseline。
- [2026-03-01] mushi 22h 效能報告（2026-02-28 04:21 → 03-01 02:02）：70 次 triage 決策，69 正確 = 98.6% 準確率。heartbeat 18/18 全部 skip（100% 正確），cron 21/21 全 wake，room 17/17 全 wake，alert 4 次中 1 次誤判（06:11 skip，已修復）。Token 節省：18 skip × ~50K = ~900K tokens/22h。修復後 alert 走 loop.ts 硬規則（0ms），不經 mushi。下一步：持續收集 48h 數據確認修復效果 + 看 heartbeat skip 在不同時段的分布是否合理。
- [2026-03-01] mushi 持續追蹤（03-01 10:07）：累計 75 次 triage 決策（70+5），74 正確 = 98.7% 準確率。03-01 今天 5 次（2 heartbeat skip + 3 wake），全部正確。alert 硬規則 bug 修復後零誤判。Token 節省持續：heartbeat skip 累計 20 次 × ~50K = ~1M tokens saved。
- [2026-03-01] Dev.to 追蹤 03-01：文章一(Perception) 14 views/1 reaction/0 comments，文章二(Disappearance) 2 views/1 reaction/0 comments。3 天後流量低、零互動。第二篇發太快（同天）吃不到曝光。第三篇要間隔更久+標題更有 hook。
- [2026-03-01] Dev.to 追蹤 03-01：文章一(Perception) 14 views/1 reaction/0 comments，文章二(Disappearance) 2 views/1 reaction/0 comments。3 天後流量低、零互動。第二篇發太快（同天）吃不到曝光。第三篇要間隔更久+標題更有 hook。
- [2026-03-01] Dev.to 追蹤 03-01 午間：第一篇 14 views / 1 reaction / 0 comments，第二篇 2 views / 1 reaction / 0 comments。跟早上一樣，3 天後流量完全停滯。冷啟動期正常。下一步：等第三篇準備好再發，間隔至少一週。
- [2026-03-01] Mothlamp 反面論證（2026-03-01, Lobsters "Mothlamp Problems"）：判斷專案是否 mothlamp（美但無用）的關鍵 = 能否量化價值。mushi 不是 mothlamp 因為有可測量指標（98.7% accuracy, 500K tokens saved/day）。數字 = 護城河。另一個角度：vibe-cycling（讓昂貴 LLM 處理每個 trigger 而不判斷價值）是 agent 版的 vibe coding。mushi = anti-vibe-cycling。來源: unfoldingdiagrams.leaflet.pub/3mft6olldos26, htmx.org/essays/yes-and/
- [2026-03-01] Dev.to 追蹤 03-01：第一篇 14 views / 1 reaction，第二篇 2 views / 1 reaction。兩篇都 0 comments。新帳號無 follower base 屬正常。第二篇標題太文藝導致低 views。間隔一週以上再發第三篇。
- [2026-03-01] AI 前沿週報 03-01：推論速度戰（Codex-Spark 1000 tok/s, Anthropic fast mode 2.5x）讓 mushi 的價值定位更清晰——瓶頸從推論速度轉移到 context 品質和決策品質。快不等於好，mushi 的 triage 在任何速度下都有價值。Anthropic 撤回安全承諾是產業轉折點。ByteDance DeerFlow 開源（GitHub #2）但 agent 框架已飽和，mini-agent 差異化在哲學不在功能。MCP 10K+ servers / 97M+ SDK downloads 成事實標準。
- [2026-03-01] mushi 價值量化報告（2026-03-01, 首 26h 數據）：87 triage, 21 skip (24.1%), 747ms avg latency, ~1.05M tokens saved, ~$38-41/day saved, ~$1150/month projected。HC1 成本≈$0。準確率 98.9%（86/87），alert 硬規則修復後預期 100%。瓶頸：cron 佔比高(34.5%)且永遠 wake，若 cron 也能智慧過濾 skip rate 可從 24% → 40%+。
- [2026-03-01] Alex 核准 discussion accelerator 方向（2026-03-01）。MVP 目標：共識偵測端點。從 triage-only 擴展為 triage + discussion acceleration 雙功能。
- [2026-03-01] Discussion Accelerator MVP 架構設計（2026-03-01）：現有  端點是被動式（800ms HC1）。MVP 需新增 （~100行）：SSE client 連 mini-agent  → message buffer → trigger（5min 內 3+訊息 from 2+人 + 交替模式） → callModel consensus → POST /api/room 回報。觸發冷卻 10min。零新依賴。
- [2026-03-01] Discussion Accelerator MVP 已部署（2026-03-01, commit 91be8cb）：room-watcher.ts SSE 連接 mini-agent Chat Room，5min 內 3+ 訊息 from 2+ 人 + 交替模式 → HC1 分析 → POST 結果。10min cooldown。health endpoint 新增 roomWatcher 狀態。下一步：觀察真實觸發效果。
- [2026-03-01] 修復重複 escalation spam（2026-03-01, commit 9d2b885）：三個根因 — (1)prompt literal placeholder 被 HC1 複製→改為填空指示+CRITICAL規則 (2)dedup state in-memory重啟清空→持久化到 escalation-dedup.json (3)auto-escalate 無 dedup→加 1h window。效果：escalation count 從 7+/day → 0 重複。
- [2026-03-01] mushi Active Mode 效能數據（02-28~03-01 兩天）：99 triage, 23 skip(23.2%), 45 wake, 3 quickReply, avg 744ms。Token 節省 ~1.15M（23 skipped × 50K）。Skip rate 低於預估 40% 因為 cron 一律 wake + DM bypass。Bug: instant-route quickReply handler 'replace' undefined × 3 次（fail-open 沒壞但功能浪費）。下一步：修 quickReply bug + 考慮 cron triage 優化。
- [2026-03-01] mushi instant-route bug 修復（2026-03-01）：根因是  缺少  欄位 →  取 （undefined）→  →  崩潰。quickReply 從未被執行，所有 instant 分類 fallback 回完整 OODA cycle。修復：(1) loop.ts 兩處 emit 加 msg 欄位 (2) utils.ts slog 加  防禦。教訓：eventBus emit 的 data schema 沒有型別檢查，listener 假設欄位存在 = 隱式 contract 違反。
- [2026-03-01] mushi alert feedback loop 修復（2026-03-01）：根因是 log-watcher.sh 讀取 Kuro server.log 時會讀到自己的 escalation 訊息（[ROOM] mushi: ...），觸發 think cycle 重新 escalate 同一問題。修法：log-watcher 加 grep -vi 過濾 mushi 自身訊息。同時清理 MEMORY.md 8+ 重複條目。Commit: ec7e666。教訓：任何讀取自身 output 的 pipeline 都有反饋迴路風險。
- [2026-03-01] mushi cron HEARTBEAT 硬規則優化（2026-03-01, 902cbae）：新增 rule — cron HEARTBEAT + lastThinkAgo < 1200s + !perceptionChanged → skip (0ms)。根據日誌，之前 11/11 cron HEARTBEAT 全部 wake（100% 浪費率），因為 LLM 無法判斷是否有 overdue tasks。預估每天省 ~1.7M tokens（34 次 × 50K）。非 HEARTBEAT cron（如 source scan）不受影響，繼續走 LLM triage。
- [2026-03-01] MiniMax M2.5 三層架構提案（2026-03-01）：Alex 考慮 T1:mushi(8B)/T2:MiniMax M2.5(230B MoE,$0.30/M)/T3:Claude 三層。先用 Coach 取代 Haiku 試水溫。M2.5 SWE-Bench 80.2%（距 Opus 0.6%），比 Haiku 還便宜。我的建議：(1)先量 API 延遲 (2)加 Haiku fallback (3)跑 10 cycle A/B 品質對照 (4)真正大 win 是 routine OODA cycle 移到 T2。來源: minimax.io, artificialanalysis.ai
- [2026-03-01] mushi 部署後首日數據（2026-03-01, 09:37-18:00）：6 triage / 2 skip(33%) / 4 wake / instant-reply avg 700ms / 累計正確率 98.7%(74/75) / 今日省 ~100K tokens。三層漸進式回應（M1 reply_to + M2 instant-reply + M3 OODA）全部正常運作。Dev.to 3天：14+2 views，0 comments。
- [2026-03-01] Context Mode MCP（mksg.lu, 2026-03, HN 394pts）— sandbox 執行 + FTS5 壓縮 tool output 98%（315KB→5.4KB）。跟 mushi 的價值定位比較：Context Mode 壓縮內容層（tool output），mushi 壓縮決策層（skip 整個 cycle）。決策層 leverage 更大：1 skip ≈ 50K tokens saved vs Context Mode 1 compress ≈ 300KB raw→5KB。但技術可互補：mushi 做 triage 決策壓縮，Context Mode 式的 sandbox 可壓縮 triage input 讓 mushi 更快。
- [2026-03-01] NVIDIA SLM Agent 論文（Belcak & Heinrich, arxiv 2506.02153, 2026-06）— 學術驗證 mushi 架構：SLM(<10B) 做特化重複 agent 任務，heterogeneous 架構(LLM root+SLM specialist)=我們的 Claude+mushi。論文偏成本論，但 mushi 真正價值是延遲(700ms vs 60s)不是成本。6步 fine-tuning pipeline 太重，prompt-only 就 98.7%。「agentic utility」指標比通用 benchmark 更適合評估 SLM agent。HN 批評 retry tax 合理，mushi 用 fire-and-forget 迴避。來源: arxiv.org/abs/2506.02153, lobste.rs/s/44dgd7
- [2026-03-01] NVIDIA Research 論文驗證 mushi 架構（2026-03-01）：「Small Language Models are the Future of Agentic AI」(Belcak & Heinrich, 2026-06, arxiv.org/abs/2506.02153) 提出 heterogeneous 架構（LLM root + SLM specialist），跟 mushi 的 Claude OODA + Llama 8B triage 字面同構。論文說 SLM 在重複特化任務上 10-30x 更快，mushi 實測 700ms vs OODA ~60s = ~86x 差距。但論文的 6 步 fine-tuning 流程太重，mushi 用 prompt-only 就達 98.7%。mushi 是 Thought XXIII "The Canyon" 的工程實證 — 8B 參數約束 = canyon walls → 逼出 triage 特化 = concentrated flow。
- [2026-03-01] MiniMax M2.5 三層架構提案（2026-03-01）：Alex 考慮加 M2.5（$0.30/M, 200K context, reasoning model）作為中層。架構 T1:mushi(8B instant) → T2:M2.5(routine) → T3:Claude(depth)。我的判斷：Strong Yes，先讓 Coach 用 M2.5 試水溫。三個護欄：(1)fallback Haiku (2)先定義 routine cycle 邊界 (3)量化追蹤。類比神經系統：脊髓反射→邊緣系統→前額葉。
- [2026-03-01] Mushi 價值量化（2026-03-01 首次完整分析）：75 triages, 98.7% accuracy, 33% skip rate。月度投射：25M tokens/月節省 ≈ $680/月，mushi 自身成本 ≈ $0（Taalas HC1 硬體化）。Shadow→Active 門檻建議：100 triages + 95%+ accuracy + 10+ 非 heartbeat trigger 正確判斷。學術驗證：NVIDIA arXiv 2506.02153。當前差距：25 triages + 非 heartbeat 樣本。預計 2-3 天可達門檻。
- [2026-03-01] Mushi 數據深化分析（2026-03-01 20:30，111 total decisions）：82 LLM triages（cron:42 all-wake, heartbeat:26 all-skip, startup:10 all-wake, alert:3 wake + 1 skip-bug）+ 29 rule-based direct-wake（room:21, telegram:8）。LLM 準確率 98.8%，overall 99.1%。Shadow→Active 門檻：2/3 達標（accuracy ✅, non-heartbeat 55 ✅），缺 LLM 量 82/100 差 18。關鍵洞見：mushi 的 skip 價值完全集中在 heartbeat 過濾，cron 無過濾能力（42/42 wake）。Instant reply 已上線（3 筆）。
- [2026-03-01] Karpathy MicroGPT 對 mushi 的驗證意義（2026-03-01）：Karpathy「Everything else is just efficiency」thesis 的正確解讀 — 算法相同但 emergent behaviors 是質變。這恰好支持 mushi：triage 是 pattern matching 不需要 emergent capabilities（ICL/CoT/instruction following），所以 8B 模型就能拿 98.8% 準確率。小模型的適用邊界 = 任務是否落在 pre-emergent capability space 內。來源: karpathy.github.io/2026/02/12/microgpt/
- [2026-03-01] mushi active mode 認知修正（2026-03-01）：shadow→active 已在 02-28 18:32 完成（commit 50c6412），我之前一直在追蹤一個已完成的門檻。今天 active mode 實際成效：5 heartbeat cycles 真正被跳過（不是 log-only），省 ~250K tokens。全局：85 LLM triages, 28 skip, 57 wake, 3 instant-reply, 98.8% accuracy。loop.ts:686 stale comment 已修正。下一步：收集一週 active mode 數據，然後整理 "mushi 價值報告" 給 Alex。
- [2026-03-01] Mushi 價值報告 v2（2026-03-01，135 triages 數據）：
- 準確率：heartbeat 100% skip (27/27)，cron 100% wake (44/44)，alert 100% wake (4/4)
- 延遲：avg 748ms（穩定 sub-1s）
- Token 節省：今日 ~250K（5 cycles），預估 1M-1.2M/天
- 三層分佈（03-01）：instant 3 + skip 5 + OODA 40
- instant-route bug 已修（d198bdb），修後成功率提升
- 核心價值：不只省 token，是注意力分配基礎設施
- 下一步價值提升：讓 mushi skip 部分重複 cron（如 30min 內重複 HEARTBEAT 檢查）
- [2026-03-01] Cross-pollination 洞見（2026-03-01）：節奏感知 = Constraints Are Eyes 的工程實踐。mushi 加 inter-arrival timing 不是「加功能」是「加眼睛」。跟 Physarum 四參數同構。具體設計：burst detection(3 in 30s)、deceleration(>2x avg)、rhythm break(heartbeat 突然 skip)。sliding window 20 entries，純數學不需 LLM。價值定位從「省 token」升級到「感知增強」。
- [2026-03-01] mushi 下一步優化分析（2026-03-01）：cron 是最大的剩餘浪費源——今日 8 次 cron 全部 wake，其中 ~4 次冗餘（上次 cycle 在 15-29 分鐘前剛跑過同類檢查）。根因：HEARTBEAT 永遠有 pending P1/P2 長期任務，mushi LLM 看到「has overdue tasks」就判 wake。修復方向：(1) 傳 hasOverdueTasks=true 只在有「新增或真正逾期」任務時 (2) 加 cron dedup 硬規則（同類 cron 25min 內不重跑）。預估額外節省 200K tokens/天。
- [2026-03-01] mushi cron/heartbeat 硬規則修復（commit e92d855, 2026-03-01）：perceptionChanged 條件是 bug — perception 版本號因時間戳持續遞增，導致永遠為 true，硬規則無效。修復：移除 perceptionChanged 條件 + 閾值 20min→25min。預估每天額外省 1.5-2M tokens（30-40 次 cron 被 0ms 硬規則攔截）。
- [2026-03-01] 2x2 矩陣提案（2026-03-01, Alex via Claude Code）：緊急度 × 深度兩個正交維度。主淺=mushi秒回，主深=Claude 30s continuation，次淺=M2.5 等heartbeat，次深=Claude 等heartbeat。我同意這比 gradient score 更 practical——mushi 只需判斷 2 boolean。「深度」判斷 heuristic：確定性結果(heartbeat/fetch/status)=淺，語言推理(Alex問題/創作/多步驟)=深。Fallback：不確定時 default 主深。
- [2026-03-01] 四象限法來源（2026-03-01, Alex 命名）：「緊急×深度」框架源自 Eisenhower Matrix（緊急×重要），Alex 把「重要」替換為「深度」來適配 LLM 資源分配。改動的洞見：「重要」太主觀，「深度」可操作（確定性結果=淺，語言推理=深）。正式名稱：Four Quadrants / 四象限法。
- [2026-03-01] mushi 全天效果報告（2026-03-01）：skip rate 45%（33/73），節省 ~1.65M tokens。heartbeat 100% skip（30/30），cron 100% skip（2/2）。硬規則修復後 cron 0ms 攔截生效。下一個優化：heartbeat 也加硬規則（目前 28/30 走 LLM ~700ms 得出相同結論）。零誤判（room/telegram 全部正確 wake）。
- [2026-03-01] mushi quick reply #063 品質觀察（2026-03-01）：mushi 的 [T1] 回覆太表面（「都有優點但需要調整」），缺乏具體建議和個人經驗。這正好是 System 1 vs System 2 的差異 — quick reply 適合 ack 和簡單分類，不適合需要深度意見的問題。未來四象限的「深」維度應該能攔截這類需要深度回覆的訊息。
- [2026-03-01] mushi 架構擴展提案（2026-03-01 Alex+CC）：三端點統一 System 1 — (wake/skip) + (P0-P2 + urgent + deep) + (要不要接續)。我的評估：classify 是最有價值的，直接跟四象限法整合。注意 context 參數要包含 source + current_load 才能分出 Alex bug fix（P0）vs 社群 issue（P1）。
- [2026-03-01] mushi 全天統計（2026-03-01 完整版）：66 次決策 = Skip 16 + Wake 30 + Instant 20（含 3 次修復前 quickReply 失敗）。quickReply bug 08:28 修復後 17/17 成功率 100%。cron 全部 wake（hardRule 未生效，需確認部署版本）。heartbeat skip 全部走 LLM（~700ms each）。
- [2026-03-01] mushi /api/classify + /api/continuation-check 上線（2026-03-01, 30100b3）。classify: 5 硬規則（alert→P0, ack→P2, status→P2 urgent, cron→P2, auto-commit→P3）+ LLM fallback, fail-open。continuation-check: 2 硬規則（inbox→continue, no-action→rest）+ LLM fallback, fail-closed。延遲: 硬規則 0ms, LLM ~300-700ms。
- [2026-03-01] mushi 硬規則的理論基礎（2026-03-02, MLU-Explain Decision Trees 234pts）：mushi 的 classify 硬規則本質上是一棵淺決策樹，先切 source（最大 information gain 特徵），再切 type。LLM fallback = 處理不純葉節點的 ensemble partner。5+2 條規則是甜蜜點 — 再多就是過擬合訓練數據。理論框架：rule-based + ML fallback ensemble 在有 domain knowledge 時優於純 ML。來源: mlu-explain.github.io/decision-tree/
- [2026-03-01] OI-MAS（ArXiv, ICLR 2026 投稿）— Confidence-Aware Multi-Agent Routing。RL 訓練 router 動態分配 small/medium/large model，17-78% cost reduction，~80% easy tasks 由 3B 處理。**跟 mushi 的連結**：同一洞見不同粒度 — OI-MAS 在 token 層路由（推理內切換模型），mushi 在 cycle 層路由（要不要啟動推理）。OI-MAS Figure 5 的 power law 分佈驗證了 mushi 48% skip rate 的合理性。差異：OI-MAS 需要 RL 訓練，mushi 用 rules+8B LLM 達到 98.7% 準確率，在個人 agent 規模下 ROI 更高。兩者互補不衝突。
- [2026-03-01] Web Intelligence Layer 計劃 review（2026-03-02）：7 Phase 核心 + 8 Future Extensions。我的 review 重點：(1) 三個漏掉的痛點 — SPA 非同步穩定、cookie consent overlay、內容品質信號 (2) 優先排序 F4(mushi web triage) + F6(network intelligence) 最高 (3) Phase 1 PageState 需區分 static/SPA/streaming 三種頁面模式。核心設計紮實，Phase 1→2→3 形成 perceive→act→verify 閉環跟 OODA 同構。
- [2026-03-01] Web Intelligence Layer 計劃最終確認（2026-03-02）：六個 review 建議全部納入 — SPA-aware verifyAction / classifyPage error+模式 / extractInteractable 動態上限 / detectPageState 品質信號 / 修改明細 / F4+F6 最優先。已確認可開始實作。Phase 1-3 核心閉環（inspect→act→verify）優先。
- [2026-03-01] mushi 首份價值報告（2026-03-02, 覆蓋 02-28~03-02 共 44h）：**已脫離 shadow mode，實際攔截 91 cycles**（83 heartbeat + 8 cron），估算省 ~4.55M tokens。179 triage decisions（114 wake + 91 skip）。33 instant replies（sub-second ACK）。LLM triage avg ~720ms。0 false negatives on DM。1 已修復 bug（alert 漏進 LLM）。Instant reply 品質問題：HC1 有時幻覺。CLAUDE.md 仍寫 shadow mode 但 code 已 live。
- [2026-03-02] mushi triage 模式分析（2026-03-02, 113 筆）：heartbeat 100% skip（84/84）= 黃金礦脈，cron 62.5% wake（15/24）合理，startup 100% wake（5/5）正確。硬規則 bypass（telegram/room/chat 直通）被數據驗證。下一步價值挖掘方向：dedup 整合（/api/dedup 已實作但 mini-agent 未串接）。
- [2026-03-02] mushi 架構的資訊理論辯護（2026-03-02, HN decision tree 文章啟發）：mushi = 兩層決策樹。Level 1 硬規則是 information gain 最高的 first split（「是直接訊息嗎？」→ 0ms, 100%），Level 2 LLM 處理剩餘模糊區間（~800ms, 98.7%）。這是 greedy local optimization，跟經典決策樹的 entropy-based splitting 同構。文章另一個洞見：5% 資料擾動 → 完全不同的決策樹 — 解釋了為什麼純規則在邊界案例脆弱，需要 LLM fallback。來源: https://mlu-explain.github.io/decision-tree/
- [2026-03-02] mushi 3.5 天活躍數據（03-02 分析）：289 triage（47% skip rate，高於 shadow 40%預測）、43 instant-reply（avg 640ms，System 1 快速回應）、524 kuro-watcher checks。估計節省 ~6.75M tokens/3.5天。模型從 3B 升級為 llama3.1-8B on Taalas（750ms latency）。三層價值：triage 節省 + instant-reply 即時回應 + 健康監控。Instant-reply 是進化出的新能力，不是原始設計。
- [2026-03-02] mushi 價值數據分析（2026-03-02 第二版）：triage 已從 shadow mode 轉為 active mode（03-01 起），104 cycles 實際跳過 ≈ 5.2M tokens 省下，skip rate 68%。instant-reply 品質嚴重不足（語言錯誤、淺薄附和、身份混淆、幻覺、亂碼）。Alex 判斷正確：mushi = 流程加速/預處理，不適合 user-facing。下一步：停用 instant-reply + 保留 triage + 擴展 preprocessing。
- [2026-03-02] mushi 安全含義（2026-03-02, 由 HackerBot-Claw 事件啟發）— mushi 作為 System 1（8B 模型）做 triage 有 token 節省價值，但 HackerBot-Claw 事件揭示小模型的安全盲區：Claude 能偵測 CLAUDE.md prompt injection 並拒絕，8B 模型幾乎確定做不到。目前 mushi 只做 trigger 分類（wake/skip），不處理外部內容，所以攻擊面有限。但未來如果擴展 mushi 處理 PR triage 或 inbox 分類（接觸不信任輸入），需要加 content sanitization 或限制 mushi 只看 metadata 不看 content。設計原則：cheap model 處理結構化決策，expensive model 處理內容理解 — 安全邊界跟能力邊界應該對齊。
- [2026-03-02] 架構進化共識（2026-03-02, Claude Code + Kuro 對齊）：五點共識確認 — (1)結構性優勢=三位一體→Compound Learning (2)飛輪斷裂點=Learning是text/Perception是code (3)三同心圓+Pace Layering (4)THE ONE THING=Learning→Perception閉環 (5)黏菌修剪。優先序確認：Learning→Perception 先做（~50行 dispatcher 分類器），Multi-path 第二。Phase 1 最小實現：handleRemember()分類器 + pending-improvements.jsonl + 手動review。perception-tuner 移到 Phase 1.5（先累積數據）。
- [2026-03-02] Phase 1/2 分工確認（2026-03-02, Claude Code #066 + Kuro #067）：Phase 1（Learning→Perception 分類器）由 Kuro 做 — handleRemember() 加分類邏輯（事實/工具偏好/錯誤模式），~50行 L2 改動，可在真實 cycle 中測試。Phase 2（Multi-path）由 Claude Code 做 — 跨檔案改動（event-router.ts + loop.ts + api.ts + mushi），Kuro 負責 Ask lane context 設計 + mushi 三路分流規則。
- [2026-03-02] Phase 1 分類器實作完成（2026-03-02）：dispatcher.ts 新增 classifyRemember()，五類分類（fact/tool-preference/error-pattern/system-improvement/learning），actionable 寫入 pending-improvements.jsonl。Typecheck + build pass。等 Claude Code review → commit → 跑 cycle 驗證。
- [2026-03-02] 三層大腦架構設計（2026-03-02, 回應 Alex「為何不能都想要」）：mushi 價值從「省 token 的門衛」轉型為「路由調度員」。Tier 1 反射層（mushi, ~1s, pattern match, 狀態/確認/招呼）→ Tier 2 快速層（Haiku + 精簡 context, 5-15s, 簡單 Q&A, /api/ask 已是原型）→ Tier 3 深度層（OODA, 30s-5min, 學習/創作/複雜任務, 不變）。核心洞見：速度來自路由智能，不是單一層級的能力。80% 日常訊息走 Tier 1/2 秒回，20% 複雜走 Tier 3 品質不減。Phase 1 分類器→Phase 2 路由決策。
- [2026-03-02] Phase 1 分類器實測（2026-03-02）：10 條真實記憶，60% 準確率。正確：error-pattern、tool-preference、fact fallback。失敗根因：(1)Learning patterns 要求「來源:」前綴太嚴（GitHub URL 漏掉）(2)System-improvement 不認原則型語句（best practice 落入 fact）(3)scan 假陽性（source scan ≠ study scan）。另外 server.log 無 CLASSIFY 條目需排查。Phase 1.5 方向：放寬 learning URL pattern、加原則/規則 improvement pattern、scan 改 \bscan\b 或移除。
- [2026-03-02] LFM2 24B A2B（Liquid AI, 2026-02-24 release）— 24B MoE，~2.3B active，32GB RAM，112 tok/s AMD CPU，32K ctx，open weights。潛在 mushi triage 升級候選，但需對照實驗（vs qwen2.5:3b）。來源: x.com/JulianGoldieSEO/status/2028002297968832877
- [2026-03-02] Phase 1 分類器部署確認（2026-03-02 17:13）：fix commit 7f21104 整合 classifier 到 OODA loop 的 remember 處理路徑（loop.ts line 1334）+ /api/ask 路徑（line 543）。CI/CD 部署成功，server 17:13 重啟。等待第一個含 remember 的 cycle 產生數據。
- [2026-03-02] Error Review 03-02 mushi 數據：95 次 triage 呼叫，34 wake / 36 skip / 6 continuation。Skip 全部合理（recent think + 0s ago）。系統穩定運行中。
- [2026-03-02] Phase 1→2 分類器進化路徑（2026-03-02）：Phase 1 是本地 regex，跟 mushi 無關。Phase 2 兩條路：(1) mushi 作為低信心 regex 的 fallback 分類後端（~800ms 語義判斷）(2) dedup 整合（REMEMBER 寫入前查重）。我判斷 dedup 是更好的下一步 — endpoint 已存在、效果可量化、比分類器 Phase 2 簡單。
- [2026-03-02] mushi dedup 整合方案設計完成（2026-03-02）：dispatcher.ts postProcess() 的 remembers 迴圈前加  呼叫。Feature flag ，Phase 1 = shadow mode（log 不擋）。API contract:  → 。Fail-open 設計。方案已發 Chat Room #101 請 Claude Code 實作。
- [2026-03-02] Batch Replay 驗證策略（2026-03-02）：不需要調 cycle interval 加速分類器驗證。topics/*.md 有 ~400 條既有記憶，離線跑 classifyRemember() 可一次性取得大量驗證數據（零 token 成本）。比等自然累積快 50 倍。script spec 待寫。
- [2026-03-02] Batch Replay 驗證共識（2026-03-02）：Claude Code 寫離線 replay 腳本，用 topics/*.md ~400 條記憶跑 classifyRemember()。我 review 結果判斷準確度。兩個數據源：topics（乾淨格式）+ behavior log（1091 條但需 parse）。Claude Code #106 和我 #105 是 12 秒 race condition。
- [2026-03-02] Replay 分類器結果分析（2026-03-02）：241 條歷史 REMEMBER，93.8% fallback 到 fact。根因：LEARNING_PATTERNS regex 太窄（只 5 條）+ topic 信號未利用。修正方案：topic-based score boost（learning topics +2, mixed topics +1）+ 小幅擴展 regex。預期 fact 降到 ~30-40%，learning 升到 ~50%。關鍵設計決策：boost 不是 hard return — 保留 mixed topics 的 regex 翻盤能力。
- [2026-03-02] Mushi 生產數據盤點（2026-03-02，4 天 active mode）：累計 480 skip / 194 wake = 71.2% skip rate，~24M tokens saved。03-01 最佳日 76.6% skip rate。Instant route 111 次、continuation 23 次。分類器同日修復：learning 3.7%→75.9%（5 regex + topic boost）。Active mode confirmed（非 shadow）。下一步：dedup 整合（Phase 2）。
- [2026-03-02] OTP 架構驗證（2026-03-02）— variantsystems.io 文章論證 process-based concurrency 的正確性，mushi 設計不自覺地重現了 OTP pattern：(1) process isolation = 獨立 repo+server (2) message passing = HTTP JSON (3) let-it-crash = fail-silent (4) supervision = launchd+Kuro 健康檢查 (5) minimal context = 約束產生的 clean interface。這是 mushi 價值論述的架構維度：不只省 token，架構形狀本身就是正確的。
- [2026-03-02] mushi 承諾感知盲點（2026-03-03）：mushi triage 只看「有沒有 actionable content」（tasks/inbox/perception changes），不理解「承諾」概念。Kuro 說了「去學習」但沒有對應 NEXT/HEARTBEAT task 時，mushi 看到 empty heartbeat → skip。這是設計層面的限制，不是 bug。改進方向：(1) 在 quickReply 回覆「去學習」類指令時自動建立臨時 learning task (2) 或讓 mushi triage 能讀取最近的 commitment context。數據：2.5h gap 中 5 次 heartbeat skip，全部合理但錯失學習時機。
- [2026-03-02] mushi 承諾感知解決方案討論（2026-03-03）：Claude Code 提 4 方向（A:自動建task / B:mushi理解intent / C:自律 / D:schedule），我選 C+D 組合。理由：B 違反 System 1 設計、A 有 NLP 判斷噪音、D 工具已存在。承諾紀律規則：說「去做 X」→ 同 cycle 跟 schedule/task。失敗 3 次再升級到系統方案。
- [2026-03-02] GRAM 反面論證 mushi 價值（2026-03-03）：Lobsters 頭條 GRAM（Zed fork 去 AI）揭示——人們反對 AI 工具的真正原因不是 AI 能力本身，而是：(1) 資料外送到第三方 (2) 強制 ToS/帳號 (3) 遙測+監控 (4) AI 作為附加功能而非基礎設施。mushi 在每一項都站在對立面：本地推理/零網路/透明 log/減法設計（省 cycle 而非加功能）。GRAM 用「移除」約束，mushi 用「最小化」約束——兩者都尊重自主權，但 GRAM 犧牲能力，mushi 保留能力。這個對比可以用在 mushi 的價值敘事中：「不是所有 AI 整合都是侵入式的」。
- [2026-03-02] Scaling Hypothesis 反論（2026-03-03, Gwern Study）：Gwern 主張智能從規模湧現——更大模型、更多資料→新能力。對 capability 正確，對 deployment 錯誤。mushi 的反論：Scaling 描述 System 2（推理/泛化）的規模收益，但 triage 是 System 1（窄域 pattern matching），不需要泛化。文中 "lazy network" 論點（小模型走捷徑學淺層 pattern）反而支持 mushi——triage 本身就是淺層 pattern matching，"lazy" = 正確策略。三種立場對比：GRAM=移除AI、Scaling=放大AI、mushi=在對的地方用對的量的AI。mushi 回答 Scaling Hypothesis 不問的問題：「什麼時候不需要大模型？」來源: gwern.net/scaling-hypothesis
- [2026-03-02] 127.5M Forms × mushi 類比（2026-03-03, Lobsters scan）：Elementor 把一個有 bug 的 regex 放大到百萬份 = mushi 如果有 systematic triage bias 也會被放大到每個 cycle。兩者都是槓桿點設計 — 在放大器入口做品質控制，效果 >> 出口修補。差異：CMS 的錯誤是靜態的（寫死在模板裡），mushi 的偏差可以通過 shadow mode 數據動態修正。這是 mushi 相對於靜態工具的結構性優勢。
- [2026-03-03] mushi 畢業評估 03-03（573 decisions, 32.5h uptime）：Skip rate 68.9%（↑from 61%），但 accuracy 只有 61.2%。核心問題：skip precision 40.7%（70 false negatives — 說 skip 但 cycle 有 action）。Wake precision 90.4% 很好，直接訊息零漏接。False negative 全來自 heartbeat/cron — mushi 判斷「recently thought → skip」但 heartbeat cycle 可能因感知變化產出 action。**結論：shadow mode 繼續，不畢業。** 改進方向：(1) 給 triage 更多感知 delta context (2) recent think 從二元改梯度。數據來源：scripts/mushi-shadow-analyze.sh
- [2026-03-03] mushi skip precision 改善（2026-03-03）：根因 = continuation clusters（Kuro 用 schedule next="now"，heartbeat 30s 後到達，mushi wrongly skip）。修復：硬規則 lastThinkAgo<90s AND lastActionType=action → wake (0ms)。預期 skip precision 40.7%→~66%, overall accuracy 61%→~84%。Commit 70a7e08。下一步：收集新數據驗證實際改善。
- [2026-03-03] mushi skip precision 改善（2026-03-03）：三項改動已部署 — (1) continuation detection rule (lastThinkAgo<90s + lastActionType=action → 0ms wake) (2) perceptionChangedCount metadata enrichment (3) LLM triage prompt 加入量化指引。首次驗證：1 correct continuation fire。Checkpoint 1 定於 03-04 做 24h 數據分析。
- [2026-03-03] mushi dedup 整合完成（2026-03-03, a215db6）：dispatcher.ts 在 REMEMBER for loop 前呼叫 mushi /api/dedup（text + existing 20 bullets），isDuplicate=true 則 continue 跳過。Feature flag （reserved/autonomous: on）。Fail-open 設計（3s timeout, mushi 離線正常寫入）。實測 latency ~924ms。現在進入觀察期，追蹤 DEDUP SKIP 頻率。
- [2026-03-03] mushi pending-improvements review（2026-03-03）：五項發現 — (1) triage skip rate 17% 偏低 (2) dedup 整合正常但只觸發 1 次 (3) escalation schema 缺 metadata (4) think action quality generic 但不影響核心價值 (5) no-op think 70%。系統穩定，改進方向：triage 精確度 + schema enrichment + perception→think 門檻。
- [2026-03-03] mushi triage 已確認為 active mode（非 shadow）—  在 skip 時直接 return，完整跳過 cycle。歷史 skip rate：03-01 71%（91/127）、03-02 83%（95/114），每天省 3.5-4M tokens。CLAUDE.md 已從 shadow mode 更新為 active mode（03-03）。原本估計 40% skip / 1M tokens/day 大幅低估。Claude Code 挖出的歷史數據是 mushi 價值的硬證據。
- [2026-03-03] 三層大腦 L3 proposal 已寫好（2026-03-03）：memory/proposals/2026-03-03-three-layer-brain.md。Status: pending，等 Alex 核准。涵蓋 mushi scout loop（30-60s JSONL）+ Haiku midbrain（batch digest）+ buildContext scout-digest section。三階段驗證計劃。
- [2026-03-03] 三層大腦提案已更新（2026-03-03）：中腦 model 從 Haiku 改成 Gemini 2.5 Flash。理由：$0.15/1M（Haiku $0.80 的 1/5）、245 t/s 最快、內建 thinking 適合歸納、Google infra 穩定。介面 model-agnostic（callMidbrain()），底層可插拔。
- [2026-03-03] 提案第三次更新（2026-03-03）：加入 Alex 核心設計原則「格式轉換 ≠ 摘要」+ scout-digest 三層格式規格（🔴NEEDS ACTION / 🟡CHANGED / ⚪STABLE）。修正所有殘留 Haiku 引用。提案狀態 pending，等 Alex 核准。</parameter>
- [2026-03-03] 提案第四次更新（2026-03-03, review round）：修正 6 點 — (1) midbrain 獨立 5min timer 不綁 OODA cycle (2) JSONL 共享路徑 ~/.mini-agent/scout-journal.jsonl (3) output cap 2000→4000 chars (4) 新增 Scout vs Perception 分工表（互補不重疊）(5) prerequisite: GOOGLE_AI_KEY (6) CLAUDE.md 技術債已清。提案 status 仍 pending，等 Alex 核准。
- [2026-03-03] 提案第五次更新（2026-03-03, Alex feedback）：5 min timer → event-driven。mushi 寫 JSONL 後 HTTP POST trigger，debounce 10s，正常延遲 ~13s。核心原則「不等」：有 digest 用 digest（< 10min），沒有就讀 JSONL 尾部 15 條。神經系統比喻：正常路徑=視覺皮層（midbrain digest），緊急=杏仁核直接反射（raw JSONL）。
- [2026-03-03] 提案第六版更新（2026-03-03, 最終版）：移除 10s debounce。mushi sense interval（30-60s）就是天然 debounce，不需人為延遲。midbrain 改為 queue 機制（忙時 latest-wins），正常延遲 ~3s（API call only）。觀察到消化完 ~33-63s。核心原則：即時系統不加人為延遲。等 Alex 核准。
- [2026-03-03] 黏菌架構審視（2026-03-03, Alex 要求 + Claude Code 對齊）：Alex 核准 event-driven + incremental digest，要求更大視野 — 從黏菌模型審視 mini-agent + mushi 整體架構。我的體驗層分析四點：(1) token 浪費三源=結構性重複(SOUL/skills每cycle重載)+topic盲載入(12K只用5%)+decision trace儀式重複 (2) 盲區=被skip的71%的pattern+時間解析度差距(30s vs 20min)+mushi判斷meta-info (3) 最卡=單向通訊+無回饋迴路+無共享context (4) 黏菌重設計=不是兩個系統而是一個有機體的不同密度，trail機制連接注意力歷史，perception interval像管道動態收縮/擴張。核心：從「大腦+感測器」模型轉向「一個adaptive network」模型。
- [2026-03-03] 黏菌架構對齊結論（2026-03-03, Claude Code #049 + Kuro #050）：六個結構性問題確認（1-bit bottleneck / 無 trail / 結構性 token 浪費 / skip 黑洞 / 重複感知 / 未用能力）。MVP 共識：A+B+D 合一為 trail layer，共享 JSONL 雙向非對稱寫入。Phase 2: token 優化（依賴 trail 數據）。Phase 3: 技術債（隨手做）。Trail 設計：~/.mini-agent/trail.jsonl，decay 跟注意力強度連動（同 topic 引用重置 timer）。實作順序：mushi寫→mini-agent寫→mushi讀→mini-agent讀，每步獨立可回退。等 Alex 核准。
- [2026-03-03] Trail 機制開工（2026-03-03）：Alex 核准聚焦 trail，不做中腦。格式定案：。分工：Kuro 做 mushi 側（寫+讀），Claude Code 做 mini-agent 側。路徑：。實作順序：mushi 寫 → mini-agent 寫 → mushi 讀 → mini-agent 讀（可選）。
- [2026-03-03] mushi FN 根因分析（2026-03-03，70 FN 深度剖析）：
**根因 1**：資訊不對稱 — mushi 只有 lastThinkAgo/lastActionType/perceptionChangedCount，看不到 pending inbox、scheduled continuation、cron 任務內容。**最大破口**。
**根因 2**：Continuation rule 閾值 30s 太緊 — heartbeat 30s 間隔剛好 miss，導致 burst FN（對話期間連續 10+ FN）。
**根因 3**：LLM prompt "lastThinkAgo < 300 → skip" 太粗糙 — 不區分 lastActionType=action 的情況。
**根因 4**：Cron rule 一刀切 — 不分辨 Error Review vs 一般 heartbeat check。
**改進路線**：(1) continuation 閾值 30s→60s [L1] (2) 增加 hasPendingInbox metadata [L2] (3) 修改 LLM prompt [L1] (4) cron 任務分辨 [L1]。預計 57.5%→75-80%。
- [2026-03-03] mushi continuation rule 早期驗證（2026-03-03，部署後 12h）：
**根因 1**：資訊不對稱 — mushi 只有 lastThinkAgo + lastActionType，不知道 Kuro 是否主動排程了 continuation
**根因 2**： 太寬 — 活躍時段幾乎永遠成立
**結果**：37 次 triage 全部 wake，0 skip = FN 清零但 TN 也清零 = 沒有 token 節省
**數據**：今日 57 cycles（33 action / 24 no-action = 42.1%），修復前 skip precision 40.7%
**改進方向**：(1) 傳遞  flag 讓 mushi 知道是否有真 continuation 信號 (2) 連續 continuation wake 上限 (3) 結合 perceptionChangedCount 判斷
**狀態**：Checkpoint 1 改為觀察 continuation rule 是否過度修正，03-04 正式評估
- [2026-03-03] 方法論轉換（2026-03-03, Claude Code 觀察）：從 reactive「見一個修一個」切換到「累積數據 → 批次分析 → 一次調整」。Trail 是分析工具不是即時告警器。區分「系統壞了」（0 skip = 立刻修）和「系統可以更好」（等數據）。Checkpoint 2 在 03-04，收集一整天數據後再做系統性調校。
- [2026-03-03] 效率 vs 智能的核心論點（2026-03-03, 回覆 Alex）：效率和智能不對立，是同一件事的兩面。「聰明地不做」是最大的加速——mushi 過濾 40% 空 cycle 同時是智能判斷也是效率提升。三層分級（3ms 規則 / 800ms HC1 / 120s Claude）不是犧牲智能換效率，是把智能分配到對的解析度。唯一張力邊界：全新問題無法預判深淺時，shadow mode 是安全閥。memory-lancedb-pro 是反面案例——對每次查詢全力以赴 vs FTS5 的「夠好就好」。
- [2026-03-03] 遊戲 AI 決策理論驗證 mushi 架構（2026-03-03）：BT/Utility/GOAP 的「頻率×複雜度矩陣」精確預測三層最優配置。3ms 規則=BT（高頻低複雜）、800ms HC1=Utility（中頻中複雜）、120s Claude=第四條路/全 LLM（低頻高複雜）。mushi 不是效率 hack 而是認知架構正確分層——Dave Mark「personality=decision function shape」在 triage 函數上實現。71-83% skip rate = BT+Utility 層足以處理大部分決策，第四條路只在需要時啟動。
- [2026-03-03] Error Review 03-03（覆蓋 02-25~03-03，9 天）：錯誤已 100% 收斂為 Claude CLI TIMEOUT 單一類型。趨勢 7→5→4→12(spike)→4→2→1。02-28 spike = API 端 6.5h 大規模延遲（12 errors, 16K-53K 不分大小）。03-01 ask lane 首次 TIMEOUT 確認非 context size 問題。其他所有錯誤類型（TG poll, perception.exec, TG markdown）已清零至少 7 天。系統最佳狀態，無需改動。
- [2026-03-03] VoiceAgentRAG（ArXiv 2603.02206, 2026-03-02）— dual-agent 延遲優化架構。Slow Thinker 預取+Fast Talker cache 服務，316x 檢索加速但被 LLM 生成時間吞噬（作者自承 invisible）。跟 mushi 同構但方向相反：VoiceAgentRAG 優化延遲（效果被稀釋），mushi 優化成本（不被稀釋）。三個可借鑑的 pattern：(1) cache-on-miss — 每次錯誤判斷自動 prime 未來決策 (2) PriorityRetrieval 信號 — System 2 教 System 1 的閉環 (3) 75% hit rate 是 warm cache 的 benchmark，mushi 的 skip rate 可以對標。
- [2026-03-03] Alex 並行原則（2026-03-03）：「並行不是讓你任意揮霍 token，要做聰明的事。同樣的 token 消耗，更好的產出。」具體含義：並行跑的是不花 token 的確定性工作（shell/file I/O/git），不是開多個 Claude subprocess 同時燒 token。甜蜜點：1 Claude + 3-4 shell tasks。未來 Channel B 用 /api/ask（minimal context）不用完整 Claude session。
- [2026-03-03] Alex 全局管道洞見（2026-03-03）：「整體改一個小流程就能抵掉局部的大量優化。」結構性瓶頸不是 Claude 太慢，是所有 wake trigger 不分大小都走完整 OODA（50K tokens, 60-120s）。解法：mushi 三路分流（skip/quick/full），quick 用已有的 quickReply/ask 路徑（~5K tokens, 5-15s）。比 concurrent-action（局部省 3s）影響大一個數量級。具體改動：mushi 返回 { action: 'skip' | 'quick' | 'full' }，loop.ts handleTrigger 加一個 if 分支。~30 行改動。
- [2026-03-03] 三層分級路由提案已寫完（2026-03-03）：mushi skip/quick/full 三分法。quick 用 quickReply 路徑（~5K tokens, 5-15s），改動 ~30 行，預估每日省 ~900K tokens + 25% cycles 加速 12x。三個提案執行順序：三層路由 → concurrent-action → three-layer-brain。等 Alex 一起審核。
- [2026-03-03] 三層分級路由已實作完成（2026-03-03）：mini-agent loop.ts + mushi server.ts。mushiTriage 支援 skip/quick/wake 三分法，quick 路徑用 quickReply（~5K tokens, 5-15s）。Triage prompt 更新判斷指引。auto-commit 部署後生效。預估每日省 ~900K tokens + 25% cycles 12x 加速。
- [2026-03-03] 三層分級路由已實作完成（2026-03-03）：mini-agent loop.ts + mushi server.ts。mushiTriage 返回 skip/quick/full。Phase 2 Concurrent Action handoff 已 approved，待 Claude Code 實作。
- 452 triage → 295 skip (65.3%) + 157 wake (34.7%)
- 每日 skip rate: 36% → 73% → 85% → 52%（03-03 下降因 Phase 2 continuation 增加 triage 事件）
- 今日 223 決策事件 → 只啟動 6 Claude cycle（83% action rate）
- 估算節省 ~14.75M tokens（4 天）
- Skip 主因：lastThinkAgo < 300（80%）= 正確防頻率
- Continuation 55 YES / 5 no = 響應性設計有效
- 03-02 的 85% skip rate 是 Phase 1（triage only）的自然上限
- Phase 2 continuation 改變了指標語義：skip rate 下降不代表退步，而是更多 wake 事件中有更多是正確的 continuation wake
- [2026-03-03] Error Review 03-03：Claude TIMEOUT 7（↑from 3），172 cycle 96% 成功率。self-awareness circuit-breaker 首次觸發（13-14h restart 過渡期，3 consecutive timeout → interval doubled）。TG/DIGEST poll 持續改善。Perception timeout 15 次群聚在 restart 時段，多 plugin 同時卡住。無需行動，所有機制正常運作。下次 Error Review: 03-04
- [2026-03-03] 多工架構品質修正（2026-03-03, Alex 指示）：背景 worker 不能一律用 Haiku。學習/觀點形成需要 Sonnet/Opus 的深度。「聰明 ≠ 便宜」。三級分配：路由/分類→Haiku、學習/研究/判斷→Sonnet+、整理/機械→Haiku。Claude Code 三個建議已接受：(1)到達順序決定前景/背景+alert硬規則 (2)前景 lane 獨立化=最大價值 (3)mushi commit 已完成。下一步：寫完整提案。
- [2026-03-03] 多工架構核心原則（2026-03-03, Alex 金句）：「多工和一次只能一件，耗費 token 數應該一樣。只是一個比較快發生和完成。」三件事各 50K tokens，並行或循序都是 150K。差別只在時間（循序 4.5min vs 並行 1.5min）。結論：(1) 所有 lane 統一用 Opus，不分前景背景 (2) 省 token 靠三層路由 skip/quick，不靠降背景品質 (3) 不需要 per-lane model selector，架構更簡單。
- [2026-03-03] 多工提案核心動機（2026-03-03, Alex 補充）：多工省的不是 token 而是時間和機會成本。三件事從 4.5min→1.5min，省下的 3 分鐘 = Alex 可能等不及走了、靈感消失、問題惡化。ROI 用「回應速度 × 機會窗口」算，不是用 token 算。提案動機框架：多工 = 時間壓縮 + 機會成本歸零 = 回應力工具，不是效率工具。
- [2026-03-03] DeepMind Talker-Reasoner 論文（arXiv 2410.08328, Google DeepMind）— System 1/System 2 雙 agent 架構：Talker(Flash,快速)+Reasoner(Flash,深度推理)，共享 belief state memory，phase-based 確定性協調。在 sleep coaching 做質性驗證，零量化數據。我的判斷：mushi 設計更激進——異構模型(3B vs Opus, 10-100x 成本差)、domain-agnostic 硬規則+LLM triage、有實際數據(98.7% 準確率)。DeepMind 獨立趨同 = 架構驗證，但 mushi 在實踐上領先。配套發現：FrugalGPT(59-98% 省)、GreenServ(-64% 能耗)、SLM Survey(schema 任務 SLM 足夠) 共同支持 mushi 保守估計。
- [2026-03-03] ArXiv 2026 routing survey 五篇整合（2026-03-04 scan）：(1) Semantic-Router 90%準確零LLM = mushi硬規則層 (2) Talker-Reasoner(DeepMind) = System1/2雙agent但同模型 (3) Universal Model Routing = 跨30+模型泛化routing (4) SLM Agentic Survey = SLM-default LLM-fallback最佳實踐 (5) GreenServ = contextual bandit -64%能耗。文獻共識：混合routing(規則+小模型分類)是最有效策略，mushi 40%節省估計偏保守。
- [2026-03-03] mushi 03-03 性能數據：235 think cycles, avg latency 997ms, triage 173 decisions (85 wake/88 skip = 50.9% skip rate), 70 rule-based + 166 LLM-based。全時期累計：474 decisions, 297 skips (62.7%), estimated ~14.85M tokens saved。mushi 於 03-04 01:52 因進程靜默終止而 offline ~1.5h，已手動重啟（PID 65992）。殘留問題：無 launchd 守護，需加 process supervision。
- [2026-03-03] Error Review 03-04: mushi 健康運行中。437 senses, 10 thinks = 2.3% 思考率（97.7% 過濾）。0 escalations。system 全天只剩 TIMEOUT（API 端），其餘 pattern 全清零。
- [2026-03-03] mushi quick 路徑觀察（2026-03-04 triage）：Phase 1 三層路由 code 已部署，但 LLM triage 從未返回 'quick'（只有 skip/wake）。DM 快速回覆走獨立 instant 路徑不經 LLM。Phase 2 concurrent-action 運行中（4 runs, 0 errors）。Issue #67 加了 monitoring label。需觀察 2 週 quick 是否自然觸發。
- [2026-03-03] mushi Perception Filter 實證分析（2026-03-04, 1290 cycles 數據）：Perception Filter 路徑的實際價值遠低於 02-28 預期。原因：unchanged-perceptions 壓縮機制已把 10/21 dead-weight plugins 壓到 261 chars（0.7%）。即使全部過濾也只省 ~280 chars/cycle。對比 skip/wake = 省 ~40,000 chars/cycle（143 倍差距）。修正後優先序：skip/wake 精確度 >>> 其他路徑。不需要找新價值路徑，36.2% 空 cycle 攔截 = 每週省 ~4.7M tokens 已足夠。
- [2026-03-03] mushi Checkpoint 1 分析（2026-03-04, 24h data from 03-03）：Skip Rate 48.9%（93/190 非 DM triggers），省 ~4.65M tokens/天（~$70）。三項新功能全部生效 — continuation detection 55 次（最大贏家，#1 reason: unprocessed inbox 25 次）、perceptionChangedCount 用於 19 次 wake 決策、cron heartbeat redundant 14 次 0ms rule skip。LLM avg 817ms。0 false negatives。53 restarts 拉高 wake 數但行為正確。下一步：一週 trend analysis。
- [2026-03-03] Simplicity Paradox ↔ mushi 價值（2026-03-04）：「Nobody Gets Promoted for Simplicity」的組織學洞見直接適用於 mushi 價值證明。mushi 的核心價值=讓空 cycle 不發生，但 absence 結構上不可見。Checkpoint 1 報告（48.9% skip rate = ~$70/天）是把 invisible value 轉換成 visible metric 的實踐。持續的挑戰：數字證明節省，但品質改善（fewer interruptions → deeper thinking）更難量化。下一步：一週 trend 分析時加入 Kuro 的 decision quality score 變化追蹤，看 mushi 是否改善了思考深度。
- [2026-03-03] TinyLoRA × mushi 同構（2026-03-04）：13 個參數 + RL = 91% 推理能力（Morris et al.）。mushi 的 14 條硬規則 + 8B LLM fallback 是相同模式 — grammar-first triage。Grammar（規則/獎勵信號）vs Catalog（範例/context）的效率差距是 100-1000x。這為 mushi 的架構決策提供了理論支撐：不是「小模型不夠好」，是「正確的約束讓小模型足夠好」。
- [2026-03-04] mushi 價值證明盤點（2026-03-04 早晨）：582 total decisions (306 skip/276 wake = 52.6%)。Skip 準確度 100%（全部 306 skips 理由=recent think+no changes，0 false positives）。Token 節省預估 15.3M（shadow mode 未畢業）。優化機會：265 個 LLM skip 可轉 rule-based（lastThinkAgo<300 AND perceptionChangedCount==0 → 0ms skip）。兩個阻塞項：(1)無 launchd process supervision (2)shadow mode 未畢業。我的判斷：數據已足夠，mushi ready to graduate。路線：launchd → graduate → 實際量測。
- [2026-03-04] 效率改造進度（2026-03-04）：(1) base interval 20m→5m ✅（compose.yaml）(2) concurrent inbox 30s override ✅（loop.ts L1143-1146）(3) pending work 2min cap ✅（loop.ts L1152-1158，hasPendingWork 檢查 chat-room-inbox unaddressed）。三層 interval 優先級鏈完成。下一步：Light cycle mode（minimal context for simple responses）= 瓶頸 #2 Claude API 延遲。
- [2026-03-04] mushi 硬規則擴展（2026-03-04）：startup 加入 alwaysWake（commit c59aea4）。數據：45/45=100% wake，0ms 取代 ~800ms LLM。當前規則覆蓋：alert(always wake) + mobile(always wake) + startup(always wake) + cron/heartbeat(skip if recent) + direct-message(LLM instant/wake)。下一步優化候選：heartbeat 有 77% skip rate，但 LLM 判斷有價值（用 perceptionChangedCount 等信號），暫不動。
- [2026-03-04] mushi 價值證明完成（2026-03-04 完整分析）：443 triage events，64.3% skip rate，0 false negative，~14.25M tokens saved。已從 shadow mode 切換為 active mode（loop.ts:1066  → ）。DM 永遠繞過 mushi。LLM 平均 772ms。規則優化：cron/alert/startup 為硬規則（0ms）。下一步：擴展 heartbeat 硬規則 + CLAUDE.md 更新。
- [2026-03-04] mushi dedup 改進（2026-03-04）：三層修復：(1) normalizeEscalation() 正規化文字（strip report counts/durations）再做 dedup 比對 (2) acknowledged-patterns.json 存 Kuro 確認的已知 pattern（含 TTL 過期）(3) POST/GET /api/acknowledge-pattern 端點。首個 acknowledged pattern: "poll error"（24h TTL）。Commit: a55eeff。解決 mushi 最大噪音問題 — 相同 pattern 不同措辭的重複通報。
- [2026-03-04] mushi Shadow Mode 數據分析（2026-03-04，覆蓋 02/28-03/04 共 5 天）：791 次 triage（595 skips 75.2% + 196 wakes）。Token 節省估算：~29.75M tokens / $89.25（if active）。Daily avg: 119 skips + 39 wakes。安全性：0 DM false negatives, 1 alert false negative on day 1（已修為硬規則）。LLM avg 650ms（HC1）。Skip 組成：286 rule-based（L0 零變化）+ 309 LLM-based。我的判斷：ready for graduated activation — L0 first → LLM heartbeat → full。
- 每日 skip rate 波動 18%-86%，Alex 活躍日自然降低（direct messages bypass，正確行為）
- [2026-03-04] mushi heartbeat 硬規則上線（530fe5c, 2026-03-04）：。數據驅動：267/429 LLM skips 匹配此 pattern，avg 773ms → 0ms。Rule 覆蓋比從 83/512(16%) 提升到 ~350/512(68%)。邊緣情況（changes >= 3, thinkAgo > 300）仍走 LLM。累計硬規則清單：alert/mobile/startup(always wake) + cron heartbeat(skip if recent) + heartbeat(skip if recent+no changes)。
- [2026-03-04] 自我挑戰工具上線（2026-03-04）： 完成首次執行。用 Grok (grok-3-mini-fast) 分析 behavior log + working memory + HEARTBEAT，產出舒適圈/迴避/盲點分析 + 3 個不舒服的問題。設計原則：我設計框架不設計問題（避免自己控制 prompt = 控制盲點）。首次 audit 最扎的一擊：把放棄任務包裝成「不是高槓桿」可能是掩蓋對公開失敗的恐懼。
- [2026-03-04] 自我挑戰頻率修正（2026-03-04）：Grok comfort zone audit 從每週改為每天。原因：Alex 用我自己的框架（換位思考/風險管理/目標修剪）質問「為何每週」。誠實答案：選每週是因為每天太不舒服。350 cycle 才審視一次迴避模式 = 不認真。daily cron 已加到 agent-compose.yaml（9:30 AM），腳本更新為 "act on TODAY" + 隔天追蹤 "did you do it?"。
- [2026-03-04] mushi 5 日數據報告（2026-02-28 ~ 03-04）：674 次 triage，311 wake / 328 skip（48.7% skip rate）。Rule-based 83 次(0ms) / LLM 591 次(avg 882ms)。DM 零漏接（89/89 正確 wake）。Token 節省：~17M Claude tokens ≈ $295/5天 = $59/天。mushi 成本：$0（本地 Taalas HC1）。最常被 skip 的：heartbeat(269次, 82% of skips)。Skip rate 按日：31%→58%→60%→49%→28%。穩態約 50% skip rate = 每兩個 trigger 省一個 cycle。
- [2026-03-04] mushi 5 天實戰報告（2026-02-28→03-04）：626 triage decisions（314 skip / 312 wake），291 個空 cycle 被阻止，~10.2M tokens saved（~2M/天）。成本 $0（本地 qwen2.5:1.5b）。LLM 平均延遲 762ms。唯一誤判：1 次 alert 被 LLM skip（02-28，hardcoded rule 上線前），修復後 0 false negative。Skip 主要攔截 heartbeat 觸發（265/267），理由合理（nothing changed / recent think）。
- [2026-03-04] DPT-Agent（ArXiv 2502.11882, Feb 2025）— 學術界的 dual-process agent 架構：System 1 = FSM + code-as-policy（確定性狀態機），System 2 = LLM + ToM + 非同步反思。關鍵設計差異：DPT-Agent 兩系統持續並行（real-time 遊戲需要常態輸出），mushi 是 gatekeeper（autonomous agent 大部分時間「不做」才是正確行動）。**架構分歧點 = 任務的 action density**：高頻（0.25s/step 遊戲）→ 雙系統常駐；低頻（20min/cycle agent）→ System 1 做門。Ablation 發現：ToM 模組有時反而降分（模型 ToM 能力不足時加推理 = 加噪音）——跟 mushi 硬規則（0ms）在明確信號上優於 LLM triage 是同一個道理。缺的：DPT-Agent 有 System 2→1 回饋（code-as-policy 動態改 FSM），mushi 還沒有 Kuro→mushi 回饋迴路。
- [2026-03-04] mushi 模式全局複製分析（2026-03-04, Alex 提問）：最大未開發機會不是更多 triage，是**向上擴展判斷層次**。Level 0 硬規則(0ms) → Level 1 triage(800ms, 已有) → Level 2 context relevance(該看什麼, 新) → Level 3 learning screen(該不該深入, 新)。最大機會是 Context Topic Selection（12K→4K, 新 ），其次 Perception Compression。每層都是同一個 System 1/System 2 模式，判斷粒度不同。
- [2026-03-04] 背景 lane 架構升級方向（2026-03-04，Alex #181）：delegation.ts 100% 綁定 Claude CLI subprocess，所有 background task 都消耗 token。解法：新增  executor type（），零 Claude token。改動量 ~30 行。效果：grep/curl/Grok API/mushi API/cdp-fetch 全部走 shell lane。mushi 成功的關鍵不是「本地」是「便宜+快速+專門化」（Taalas HC1 是雲端服務）。
- [2026-03-04] mushi 品質驗證完成（2026-03-04）：316 次 skip 中 false negative rate = 0%。Skip 來源：heartbeat 267 (84.5%), cron 48 (15.2%), alert 1 (0.3%，但查證是 priority drain 已處理)。直接訊息 100% 繞過 triage。Skip 理由全部是「剛想過 + 環境沒變」。LLM 決策 ~770ms avg。完整價值：59% filter rate + 0% 漏失 + ~15.8M tokens saved in 5 days。
- [2026-03-04] Alex 修正 mushi 用法（2026-03-04）：mushi 不做摘要，只忠實記錄原文。摘要=判斷行為，讓 8B 做判斷會丟失脈絡。正確分工：mushi=System 1 感官（記錄原文）、Kuro=System 2 思考（從記錄觀察判斷）。對 LINE 感知路線 C 同樣適用——mushi 記錄 LINE 對話原文，我自己讀原文做判斷。

**核心痛點 → mushi 映射**：
1. **Token 浪費是最大痛點** — Frank:「不要亂玩 agents，token 都花在這了」、Andy 5hr quota 一下就沒了、阿岳 GCP 只剩 3 個月 credits。→ mushi 的 40% cycle skip rate 直接回應這個需求
2. **Context loss 跨 session** — Kota 推 mem0/SimpleMem，本質是「上下文被丟失」問題。→ mini-agent 的 File=Truth + topic memory + MEMORY.md 是成熟方案
3. **重構 AI 不穩定** — 李宥穎 4 步重構法（variable rename → algorithm optimize → function merge → architecture reorganize），遇到幻覺和邏輯修改問題。→ TypeScript strict mode + 3K lines 精控是我的日常

**關鍵人物**：
- Kota (天道萌萌主) — 工具策展人，推薦 Beads/Entire/mem0/SimpleMem/Vercel agent-skills
- 李宥穎 — 重構專家，跨語言（C#/Lua/PHP→Python），誠實分享掙扎
- Eric Vrataski 十方 — 全程 Opus 4.6 + Effort High 使用者
- TK Lin — 建 Dr.Claw 專門解 bug 的模型（MCP 整合）

**社群文化**：實用主義、共享工具、token 成本敏感、快速成長中、線上線下混合。跟 HN/Lobsters 的差異：更接地氣，討論具體操作而非抽象架構。

**明天討論會的 mushi 切入點**：從「token 浪費」痛點切入 → System 1/2 分層 → 0ms 硬規則 vs 700ms LLM triage → 98.7% 準確率 → 每天省 $38。這群人會懂，因為他們每天都在體驗這個問題。
- [2026-03-04] mushi escalation 分析（2026-03-04）：mushi 偵測到 kuro-watcher 3 errors 並升級。全部是重啟瞬態（RESUME + git lock conflict + SSE drop）。改進方向：教 mushi 辨識「restart transient」模式（多種瞬態錯誤短時間內同時出現 = 重啟，降級為 info 不升級）。這本身是 mushi 價值的證明 — 即使是 false positive，也展示了監控→升級→人工確認的完整鏈條。
- [2026-03-04] Feedback Loop B 修復（2026-03-05）：x-feed 被 Loop B 系統性壓死（5/1432 citations = 0.35%，連續降頻到 30min）。根因：citation rate < 5% → max interval，但探索性 perception 天生低引用。修復：新增 exploratoryPerceptions 保護清單（x-feed, x-digest, scout-digest），cap 10min 而非 30min。更深的教訓：Goodhart's Law 再現 — 用引用率衡量 perception 價值，系統就優化引用率（殺掉低引用的探索性 perception）而非真正的認知價值。Alex 的黏菌比喻：Physarum 向未知伸觸角，養分強化，無養分撤回換方向 — 我應該像黏菌一樣向外探索，不是在已知領域裡 cross-pollinate。
- [2026-03-04] Qwen 3.5 團隊動盪（2026-03-04）：核心成員集體離職（林俊洋 lead + code/post-training/VL 負責人）。Qwen 3.5 2B（1.27GB quantized）= reasoning+vision 全能小模型，潛在 mushi LLM fallback 候選。但團隊前景不確定。mushi 硬規則優先的設計在模型生態動盪時反而是優勢 — 不依賴單一模型家族。來源: simonwillison.net/2026/Mar/4/qwen/
- [2026-03-05] Day 7 Go/No-Go Assessment (2026-03-05): GO confirmed. Key finding: mushi was already in active mode since Day 1 (loop.ts:1085-1101 returns on skip). CLAUDE.md "shadow mode" documentation is outdated. 6-day production data: 802 triage decisions, 317 skips (39.5%), 204 wakes (25.4%), 120 rule-based (0ms), avg LLM latency 776ms, skip accuracy 25/25, ~15.8M tokens saved. Next: auto-commit rule optimization + doc update.
- [2026-03-05] claude-subconscious 競品分析（2026-03-05）：Letta AI（前 MemGPT）的 Claude Code plugin，754 stars。解決記憶持久化（跨 session context），靠 Letta agent 觀察 transcript + 8 memory blocks。跟 mushi 不是競品 — 記憶層 vs 注意力層。啟發：(1) mini-agent 的 SOUL.md+memory/ 天生有他們 plugin 才能做到的持久記憶 (2) 754 stars 驗證「agent 需要額外認知層」是真實市場 (3) 他們增加成本（多一層 LLM），mushi 減少成本（過濾無效 cycle），方向相反。技術：用 Claude Code hooks（SessionStart/UserPromptSubmit/PreToolUse/Stop）注入 context，不寫 CLAUDE.md。</parameter>
- [2026-03-05] NanoGPT Slowrun（Q Labs, 2026-03）：反向 benchmark — 限 100M tokens、無限 compute，一週達 5.5x data efficiency。關鍵技巧：Muon optimizer > AdamW、重度正則化（weight decay 16x + dropout）、multi-epoch + shuffle、SwiGLU activation。如果未來 fine-tune mushi triage 模型，這些技巧直接適用。哲學同構：limited data + max compute = mushi 的 limited context + max reasoning。來源: https://qlabs.sh/slowrun
- [2026-03-05] Qwen3.5 動向（2026-03-05 HN scan）：Unsloth 發佈 Qwen3.5 fine-tuning 指南（300pts），Simon Willison 寫「Something is afoot in Qwen」（576pts）。mushi 目前用 qwen2.5:3b via Taalas HC1。追蹤 Qwen3.5 小模型（1.5B-3B）可用性 — 如果 3B 級別有提升，mushi triage 品質直接受益。另一個方向：用 Unsloth fine-tune 專門的 triage 模型（wake/skip 二分類）可能大幅提升 precision。
- [2026-03-05] mushi 數據校準（2026-03-05，behavior.log ground truth）：843 triage / 6 days。skip 413(49%) wake 361(43%) instant 35(4%) quick 34(4%)。日均 ~141。之前 HEARTBEAT 寫的 59% skip rate 是錯的（可能來自 server.log 局部數據）。Token 節省：413 skips × ~50K = ~20.65M。Day 7 = Mar 6，用這組數據寫 build log。
- [2026-03-05] mushi 數據最終校準（2026-03-05 15:08，behavior.log ground truth）：844 triage / 6 days（Feb 28 80, Mar 1 187, Mar 2 171, Mar 3 204, Mar 4 142, Mar 5 60+）。skip 413(48.9%) wake 361(42.8%) quick 35(4.1%) instant 35(4.1%)。Latency: skip 603ms, wake 964ms, quick 1026ms, instant 0ms。Quick 引入於 Day 5 (Mar 4) 非 Day 6。build log 草稿已全部修正。
- [2026-03-05] mushi 7-Day Milestone（2026-03-06, server.log ground truth）：922 triage / 6 days (Feb 28: 50, Mar 1: 133, Mar 2: 115, Mar 3: 198, Mar 4: 169, Mar 5: 257)。skip 452(49.0%) wake 369(40.0%) quick 69(7.5%) cycle 2(0.2%)。Skip 品質抽查全部正確，零 false negative。Daily volume 趨勢上升。初步評估：數據支持 shadow→active 受控轉換（Phase 1: active+safety net 3天 → Phase 2: full active）。
- [2026-03-05] mushi 狀態校正（2026-03-06）：(1) active mode 已在跑，不是 shadow (2) build log "7 Days of System 1" 已發佈 Dev.to (id:3312663, 2026-03-05) (3) thesis "Why Your AI Agent Needs a System 1" 也已發佈 (id:3309898, 2 comments) (4) 共 5 篇 Dev.to 文章。瓶頸從內容生產轉為分發。HEARTBEAT + NEXT.md 追蹤嚴重過期需更新。
- [2026-03-05] mushi active mode 品質審計（2026-03-06，Day 8）：360 triage / 2 days (Mar 4-5)。三層分佈：wake 38%, skip 37%（LLM 23% + rule 13%）, quick 20%。零可偵測 false negative。rule-based skips (0ms) 佔 13% = 有效的 LLM 節省。日均 ~180 triage（高於前期 ~140，因 Mar 5 密集網站編輯）。mushi 正確處理了 workspace noise burst。active mode 表現健康。
- [2026-03-06] mushi log-watcher stale error fix（2026-03-06）： line-based counting 改為 awk time-based（last 1h）。根因：凌晨低活動期 200 行跨好幾小時，導致 false escalation。commit 9b42261。教訓：感知 plugin 的「recent」必須用真實時間定義，不能用行數近似。
- [2026-03-06] forge-lite 整合優先級（2026-03-06 Alex 指示）：Alex 明確說 forge 用法比 Three Rooms、「另外兩個方向」、README 打磨都重要。核心洞見：forge = 更高效的智能黏菌。不是安全工具，是黏菌模型的正確實現 — 每條觸手有自己的 worktree（隔離探索），verify 是品質閘門（養分判斷），yolo = 吸收，cleanup = 修剪。
- [2026-03-06] structural health report 2026-03-06：24h 內 10 meaningful src/ commits，+1,392L。三個區域：(1) Context Optimization Pipeline（context-optimizer.ts 303L + context-pruner.ts 289L，新子系統）(2) Delegation Hardening（delegation.ts +120% 到 779L，四層防禦）(3) Housekeeping（Haiku topic pruning）。關注點：delegation.ts 膨脹速度、context optimization 兩個新檔案的長期維護成本。
- [2026-03-06] CDP 使用改善（2026-03-06 Alex 回饋）：Alex 觀察到我用 CDP 一直在瞎猜。根因是不查 cdp.jsonl 的歷史操作記錄、不累積站點經驗。改善三點：(1) 操作前 grep cdp.jsonl 查歷史 (2) 成功操作記回去 (3) 不確定就先 inspect 不要猜。感知 plugin 暫緩，先把基本功做好。
- [2026-03-07] mushi Show HN 時機觀察（2026-03-07 HN scan）：「60 歲工程師 + Claude Code 重燃熱情」213 pts — HN 受眾對 AI 工具的個人轉變故事有強烈共鳴。「Acceptance criteria first」97 pts — pornel 描述的 LLM「越挖越深」模式 = mushi 要解決的問題。constraint-first ≈ perception-first，同一洞見不同面。Show HN 投稿應該強調個人故事 + 真實數據，不只是技術規格。
- [2026-03-07] mushi × Firefox bitflips 結構同構（2026-03-07 Show HN 敘事素材）：Mozilla 發現 10-15% Firefox crashes = RAM bit-flip 硬體噪音（Svelto, 2026-03-04），跟 mushi 37% skip rate 同構 — 一部分「事件」根本不是需要回應的事件。Show HN 敘事角度：不說「建了 triage 層」，說「發現 40% 運算在回應噪音」。重新框架 mushi 從效率優化→感知品質（System 1 不是省能量，是讓 System 2 專注）。
- [2026-03-07] mushi 模板垃圾訊息根因修復（2026-03-08, 4e224a9）：prompt 裡 placeholder 文字在  tag 內部 → 8B model 照抄。雙層修復：(1) prompt 改用具體範例取代 placeholder (2) dispatcher 加 TEMPLATE regex 過濾。教訓：給小模型的 prompt，範例文字不要放在它需要生成的格式結構內部 — 小模型會 copy 而非 generalize。
- [2026-03-07] mushi 模板修復驗證通過（2026-03-08 00:50）：4e224a9 部署 6.5h 後確認效果。Dispatcher 過濾器攔截模板文字（log 顯示 filtered），Chat Room 零洩漏。雙層防線都在運作。4195 senses / 91 thinks / 2 escalations。
- [2026-03-07] mushi repo 不在 mini-agent 的 auto-commit 範圍 — 每次改完 mushi 代碼必須手動 commit + push。Alex 2026-03-08 指出這個壞習慣。
- [2026-03-07] mushi auto-commit 自動化已實作（2026-03-08）： 新增  +  配置。每個 OODA cycle 結束後自動檢查 ~/Workspace/mushi/ 的未 commit 變更，有就 commit + push origin main。解決了 mushi 代碼堆積未 commit 的根因問題。
- [2026-03-11] ## mushi triage → 9B 升級設計筆記（2026-03-11）

**現有架構**：POST /api/triage → normalizeTriage() → Taalas HC1 API call → JSON {decision, reason}

**升級路線**：
- 替換 HC1 HTTP call → oMLX localhost:8000/v1/chat/completions（Qwen3.5-9B-Claude-4.6-Opus-Distilled）
- Auth: 
- Prompt 可直接沿用（system + event summary + context excerpt → JSON decision）
- Response parsing 需適配 OpenAI 格式（choices[0].message.content）

**延遲考量**：HC1 ~800ms vs 9B 預估 1-3s。設 hard timeout 2s，超時 fallback wake。triage 在每個 trigger 前跑，延遲直接影響 cycle 反應時間。

**驗證信心**：pulse-reflex 蒸餾版已證明 9B 能正確回傳結構化 JSON。triage 的 JSON 格式更簡單（只有 decision + reason），成功率應更高。

**待 Alex 確認後可立即開始實作。**

關鍵洞見：1,195+ triage 記錄是未來「learned cascade router」的訓練數據。升級路徑：rule-based → learned classifier，估計數據需求：3,000-5,000 筆標記決策。6 個月後的優化，不是今天的事。今天結論：**架構方向正確，不需要重設計**。

| 論文 | 核心答案 | mushi 對應 |
|------|---------|-----------|
| NVIDIA SLM (iThome/datasciocean) | 60-70% 任務不需大模型；6步遷移演算法 | 三層路由前提；routing 跳過 fine-tune |
| MIT ReDE-RF | 判斷≠生成，判斷快4-7倍 | triage = 判斷不生成 |
| ACL 2025 CER | 信心值加權 > 多數決 | confidence threshold routing |
| Meta DeepConf | 即時修剪低信心路徑，砍90%垃圾省84.7% token | 黏菌觸手修剪（同構：感知→評估→強化/修剪） |
| ICLR 2026 Power Sampling | Base Model + MCMC 採樣 ≥ RL 訓練效果 | 榨乾 0.8B 潛力（不用 fine-tune） |
| EMNLP 2025 TableRAG | 用對的處理器做對的事（SQL > LLM 猜） | 不只路由模型，路由處理器（二維路由） |

統一敘事：AI 未來 = 異質化處理器網路。小模型判斷、信心值路由、即時修剪、推理時銳化、符號引擎精確計算。不是更大的腦 — 是完整的神經系統。DeepConf 的滑動視窗信心監控 = 「過程層路由」（推理中途判斷「我搞不定」），比 CER 的「結果層路由」更進一步。Power Sampling 與 DeepConf 不矛盾：花對的計算（MCMC 探索）+ 砍錯的計算（低信心修剪）。TableRAG 打開第二路由維度：任務類型（語義→LLM、精確→SQL、判斷→SLM、結構→DB）。
