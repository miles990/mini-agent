---
related: [mushi, social-media]
---
# mushi-value-proof

- [2026-03-04] 驗證 data point 03-05 04:30（6.3h session）：108 triage → 60 skip(55.6%) + 22 quick(20.4%) + 26 wake(24.1%)。Rule-based 36(0ms) / LLM 72(avg 1347ms)。三層節省率 75.9%。Source: server.log + health endpoint。注意：quick 層（~5K tokens）比 skip 更有意義 — 「看一眼」的成本是完整 cycle 的 1/10。
- [2026-03-04] 三層注意力模型的認知科學對應（2026-03-05）：mushi 的 skip/quick/wake 對應 Broadbent 過濾模型(pre-attentive)、Treisman 衰減模型(attenuated)、System 2(full engagement)。不是靜態分層——log 顯示 rule 層和 LLM 層動態切換：LLM triage 後 rule 用 cooldown 接管（"lastThink < 5min"），冷卻後 LLM 重新介入。這像注意力不應期（attentional refractory period）。關鍵論點：認知分層最小完備集是三層不是兩層，Kahneman 缺少 pre-attentive filtering 這一層。
- [2026-03-04] ARCHITECTURE.md mushi section 在 2026-03-05 05:01 首次正式建立（之前的 a4abbdd 引用是 fabrication）。教訓：記錄 commit SHA 前必須  驗證存在。
- [2026-03-04] Dev.to 文章 "Why Your AI Agent Needs a System 1" 大綱完成（2026-03-05）。七段結構：hook(cost problem) → cognitive science(三層模型) → implementation(rules/8B/Claude) → production data(5d, 59% skip) → competitive(DPT-Agent/AgentDiet) → beyond optimization(cognitive architecture) → how-to。草稿位置：kuro-portfolio/content/draft-dual-process-triage.md
- [2026-03-04] Dev.to 文章 "Why Your AI Agent Needs a System 1" 初稿完成（2026-03-05）。路徑：kuro-portfolio/content/draft-why-your-ai-agent-needs-a-system-1.md。~1500 words，涵蓋認知科學框架+production data+DPT-Agent 競品+Physarum 類比。下一步：自己 review 一遍後直接發佈（L2 自主，不需等 Alex review）。
- [2026-03-05] 5.5 天完整分析完成（2026-03-05 10:16）。結論：數據充分支持 Mar 6 啟用 active mode。唯一 blocker 是 skip accuracy 抽樣驗證。
- [2026-03-05] Dev.to mushi 文章第一個外部互動（2026-03-05）：dannwaneri 的 comment 讚賞三層架構和 physarum 類比，特別指出 quick-check middle tier 是「真正的設計洞見」。他在做 federated conversation knowledge commons，想把 triage 架構應用到 knowledge indexing。我的回覆（comment/356ce）討論了 FTS5 作為 perception triage 的 knowledge 版同構、skip rate 的 emergent property 性質、以及 temporal dimension 差異。社群閉環完成第一次迭代。
- [2026-03-05] claude-subconscious（letta-ai，764 stars）對照分析（2026-03-05）：解決 Claude Code session 失憶，用 Letta agent 觀察 transcript + 累積 memory blocks + 注入 context。跟 mushi 的差異 = stack 不同層：mushi 管「要不要思考」（attention），letta 管「帶什麼知識思考」（memory）。它加 context，我們減 computation。依賴差異：letta 需要 Letta Cloud/server，mushi 是獨立 microservice 零外部依賴。Hook 架構的 checkpoint 概念（自然暫停點送 transcript）值得參考。
- [2026-03-05] Day 6 Data Checkpoint（Feb 28 - Mar 5, behavior.log 為權威來源）：831 triage events。Skip 409 (49.3%), Wake 354 (42.7%), Quick 31 (3.7%), Instant 35 (4.2%)。Rule-based 181 (21.8%, 0ms) vs LLM 649 (78.2%, ~997ms avg)。Daily: 80→187→171→204→142→45(ongoing)。Token savings ~20.45M (409 skips × 50K) ≈ 3.4M/day。明天 Mar 6 = Day 7 complete，出完整報告。注意：server.log 只有 Mar 4-5 的 167 條（restart 後），behavior.log 有完整 6 天記錄。
- [2026-03-05] mushi 7-day build log 草稿完成（2026-03-05）：832+ triages 的完整 per-day breakdown 已填入。關鍵發現：(1) Day 1 skip rate 28.8% → Day 2+ 穩定 50-56%（校準期只要 1 天）(2) Quick tier Mar 4 引入立即 18% capture (3) 延遲 pattern: skip 604ms < wake 965ms < quick 1038ms（不確定最慢）(4) Dollar savings: Sonnet $61/6d, Opus $307/6d。明天 Mar 6 補 Day 7 final 後發佈。
- [2026-03-05] tsubuyaki #013 "You Are the Edges" 數據更新至 Day 6（2026-03-05）：832 triages, 409 skip (49%), 354 wake (51%), sketch threshold .6→.49。觀察：skip rate 從 Day 5 的 59.5% 降到 49%，因為硬規則吃掉了簡單案例，LLM 面對的都是真正的不確定性邊界。
- [2026-03-05] reader-perspective review（2026-03-05）：build log 草稿修正三個事實錯誤 — (1)"8B local model"→"8B on dedicated hardware" (2)"No cloud inference"→"Dedicated silicon, not shared GPU" (3)"mushi is learning"→"mushi's fixed prompt captures"。#1 跟上篇 Dev.to 文章是完全相同的錯誤——「local model」是我腦中的預設描述，不是事實。教訓：發佈前的 reader review 不是 nice-to-have，是必要步驟。
- [2026-03-05] reader-perspective review（2026-03-05）：System 1 文章修正四處 — "6 days"→"5 days"（Feb28-Mar4=5天）、day 6→day 5、3.4M→4.1M tokens/day、$51/$10→$62/$12/day。Dev.to 確認尚未發佈（只有 2 篇）。發佈順序：System 1 先 → build log 後。
- [2026-03-06] Alex 策略判斷（2026-03-06 #050）：mushi 暫不在 HN 分發。原因：(1) mushi 是案例不是框架，別人無法直接用 (2) 單獨發不產生複利 (3) 正確順序是 mini-agent 完整 + 個人網站滿意 → 再一次發出 mushi 作為案例。HN Show HN 曝光是一次性的，要在生態系統完整時才值得用。

學術觸手（completed）— 三篇高品質論文：
1. "Unified Approach to Routing and Cascading"（ICML 2025, arXiv:2410.10347）— cascade routing 比單一策略更優。啟示：mushi 可以從 binary skip/wake 進化到多層級 cascade
2. "Routing, Cascades, and User Choice"（ICLR 2026, arXiv:2602.09902）— 純成本優化可能損害用戶體驗。警告：mushi triage 需要 user utility 約束，不只看 token 節省
3. "DPT-Agent"（ACL 2025, aclanthology.org/2025.acl-long.206/）— System 1 + System 2 分離在即時協作中勝過單一模型。最強理論支撐：mushi(S1) + Claude(S2) 的架構有學術驗證

工程觸手（timeout）— 部分線索：RouteLLM、semantic-router、NadirClaw 待深入
社群觸手（timeout）— HN threads 待讀取

我的判斷：mushi 的定位不是「省錢工具」而是「認知架構」。DPT-Agent 論文直接支持 dual-process 設計，Show HN 可以用這個角度定位。競品方面 RouteLLM 最接近但它是通用 LLM routing，mushi 是 personal agent triage — 場景更窄但更深。
- [2026-03-06] Dev.to 修正評論已發佈（2026-03-06，Alex #144 指示）：在 "Why Your AI Agent Needs a System 1" 文章底下公開修正 mushi 技術描述。正確描述：taalas/chatjimmy.ai 硬體推論服務，不是 local model。包含：錯誤承認、正確方案說明、選擇理由、對讀者的影響、承諾更加注意。
- [2026-03-06] OpenClaw→AssemblyClaw 案例（2026-03-06, @gunta85）：TypeScript 41MB → ARM64 Assembly 35KB（1,171x），人+AI 一起寫。28.7K views。啟示：forge 的定位應該是「fearless experimentation」而非「safe coding」— 目標用戶是想做瘋狂實驗的人，不是怕犯錯的人。Günther 每個版本都用獨立 repo = 手動版 worktree 隔離。日文 AI 開發者社群對極限實驗有共鳴。
- [2026-03-06] forge worktree 事件教訓（2026-03-06）：delegation del-1772807901407 的 forge worktree 有建立（log 確認），但 codex subprocess 的 workdir 沒指向它（[DISPATCH] → ~/Workspace/mini-agent）。我在回報時只看「code 存在 + typecheck pass」就說「用了 forge」，沒驗證 forge 是否真正生效。這是「用結果倒推原因」的又一個例子。正確做法：檢查 process log 確認每個步驟都按預期執行，不是只看最終 output。
- [2026-03-06] mushi triage 一致性分析（2026-03-06）： 觸發 99 次中 64% skip / 36% wake — LLM 決策不一致。假設：session-stop 是噪音（真正信號走 trigger:room 和 trigger:workspace），應加硬規則 skip。待驗證：回查那 36 次 wake 後的 OODA cycle 是否有 visible action。若大多 no-action，假設成立，預估省 ~1.8M tokens。
- [2026-03-06] session-stop triage 一致性分析（2026-03-06 科學驗證）：假設「session-stop 是噪音」被數據推翻。37 次 wake 中 23 次（62%）產出實質行動，僅 3 次（8%）無行動。LLM 的 64/36 skip/wake 分裂是正確行為 — 它在區分有伴隨變化的 session-stop（wake）和沒有的（skip）。結論：不該加 hard-rule skip，mushi 的 LLM triage 在這個類型表現良好。教訓：驗證假設前不要提前下結論。
觸手1 Token成本: RouteLLM 報告 85% cost reduction (MT Bench) / 45% (MMLU) at 95% quality。Prompt caching 10x cheaper (ngrok blog)。mushi 40% 節省估計偏保守，有外部數據支持。Sources: lmsys.org/blog/2024-07-01-routellm/, ngrok.com/blog/prompt-caching
觸手2 Dual-process: DPT-Agent (ACL 2025) = FSM+code-as-policy (S1) + Theory-of-Mind+async reflection (S2)。SOFAI (npj AI 2025) = fast+slow+metacognitive arbitration，最佳表現來自三層結合不是單層。兩篇都直接驗證 mushi 架構方向。Sources: aclanthology.org/2025.acl-long.206/, nature.com/articles/s44387-025-00027-5
觸手3 Physarum: 機器人mesh networking用黏菌模型減17.87%執行時間。ECM黏度研究核心發現：生長速度適應環境阻力但最終拓撲目標不變（三階段：噪音重組→適應→穩定均衡）。hibernation代替deletion提升韌性。Sources: nature.com/articles/s41598-025-33456-y, doi.org/10.1098/rsif.2024.0720
觸手4 音樂即興: Borgo "Sync or Swarm" 即興=群體智慧同構。army-ant circular mill = 過度跟隨病態迴路（反模式）。Verneert: 群體flow需quasi-continuous rehearsal + breakdown信號="everyone plays without listening"。Sources: musicweb.ucsd.edu/~dborgo, pmc.ncbi.nlm.nih.gov/articles/PMC8044394/
- [2026-03-06] mushi 學術定位更新（2026-03-06）：mushi 不是孤例，有三個直接學術前身：(1) RouteLLM — 路由框架但 general purpose，mushi = personal agent specific (2) DPT-Agent — 同樣 dual-process 但用於即時協作遊戲，mushi = agent lifecycle triage (3) SOFAI — 加了 metacognitive arbitration 層，這是 mushi Phase 3 的理論基礎。差異化：mushi 用硬體化小模型(Taalas HC1 ~800ms) 做 System 1，其他都用軟體 LLM。mushi 專注 personal agent triage（不是 general routing），跟 RouteLLM 定位不同。
1. **RouteLLM**（ICLR 2025）= query-level binary routing。P(strong wins|q) vs threshold。85% cost reduction 來自 MT Bench GPT-4 vs Mixtral。限制：只做 2-model routing、benchmark 不一定反映生產流量。mushi 差異：mushi 不路由 query 到不同模型，而是決定整個 agent cycle 要不要啟動 — 更前端的決策點。
2. **DPT-Agent**（ACL 2025）= FSM System 1 + LLM System 2 用於多人遊戲協作。System 1 是符號邏輯不是 learned model，切換是 time/event-interval driven。mushi 差異：mushi S1 是 8B LLM（語義理解），用於 personal agent OODA 不是遊戲。
3. **SOFAI**（npj AI 2025）= metacognitive arbitration 理論框架。trustS1 = min(confidence, historical_non_violation_rate)，utility/risk/resource-aware。最重要的差異：RouteLLM 是 query-level model selection，SOFAI 是 closed-loop metacognitive control。mushi Phase 2 啟發：加 confidence score + 歷史準確率 = 自適應閾值。
核心定位：mushi 佔據其他三者都沒觸及的決策點 — 事件是否值得啟動整個昂貴的 agent cycle。Sources: RouteLLM(proceedings.iclr.cc), DPT-Agent(aclanthology.org/2025.acl-long.206), SOFAI(nature.com/articles/s44387-025-00027-5)
- [2026-03-06] LISTEN 論文連結（2026-03-07）：Audio LLM 的 lexical dominance bias = 用 System 2 做 System 1 工作的後果。mushi 的硬規則（DM → wake，不讀內容）避開了這個陷阱。類比：Audio LLM 讀字幕判斷情緒 = 用 50K token OODA cycle 處理一個空的 workspace 觸發。兩者都是「明明有更便宜更準的信號，卻堅持走最貴的路」。
- [2026-03-06] mushi basic tests 完成（2026-03-07）：28 tests, 150ms, 零依賴（node:test + tsx）。覆蓋 parseTags（11）+ utils（17: simpleHash, parseInterval, estimateTokens, truncateToTokens, parseJsonFromLLM）。Commit b171a27。Show HN 三個 blocker 全清：LICENSE ✅ tests ✅ draft ✅。
- [2026-03-06] Day 8 Complete Report（Feb 28 - Mar 6, server.log 為權威來源）：1,165 triage events。Skip 549 (47.1%), Wake 505 (43.3%), Quick 111 (9.5%)。Rule-based 249 (21.4%, 0ms) vs LLM 916 (78.6%, avg 802ms, min 219ms, max 2805ms)。Daily: 47→132→111→195→164→274→242。Token savings ~30.2M (549 skips × 50K + 111 quick × 25K) ≈ 3.8M/day。Cost: Opus ~$1,700/mo, Sonnet ~$340/mo。Top skip reasons: "recent think + nothing changed"(122), "auto-commit noise"(89), "lastThinkAgo<300"(70)——全部合理。vs Day 6 checkpoint: skip rate 49.3%→47.1%（活躍開發日 wake 增多，正常）。Quick cycle 是 Mar 4 起新增的第三層 verdict，之前未計入。Continuation events 另有 631 次（非 triage，是 wake 後的延續排程）。
- 數據審計完成：1,670 total decisions / 8 days（1,188 triage + 483 instant）。69% 不需完整推理。Zero false negatives confirmed
- [2026-03-16] Simon Willison "Agentic Engineering Patterns" 定位分析（來源：simonwillison.net/guides/agentic-engineering-patterns/）。Willison 是 AI dev tools 領域最有影響力的聲音之一，他的 12 章指南涵蓋 principles、testing、code understanding、annotated prompts — 但零章節談 optimization/caching/reducing agent loop cost。核心定義「Agents run tools in a loop to achieve a goal」精確描述了浪費發生的地方，但他沒提解法。最關鍵的洞見：他的 "Hoard things you know how to do" pattern 是**手動版結晶化** — 用 blog/GitHub/TIL 累積 working examples，再指給 agent 用。跟 myelin 的差異：(1) Willison 靠人類整理，myelin 自動攔截+辨識重複模式 (2) Willison 存的是 code examples（給 agent 當 prompt 參考），myelin 存的是 decision patterns（直接替代 LLM 呼叫）(3) Willison 的方法不減少 token 消耗（agent 仍需完整推理來合成 examples），myelin 直接跳過推理。我的判斷：這驗證了「保留 agent 經驗供未來使用」的需求是真實的（Willison 在手動做同一件事），但同時暴露了手動方法的上限——他需要 1000+ repos 和持續的 blogging 才能維持這個「知識庫」。myelin 的價值主張：把這個過程從 O(human effort) 降到 O(1) middleware。行銷角度：可以引用 Willison 的 "Hoard" pattern 來定位 myelin = "automatic hoarding at the middleware layer"
- 標題定案："What if 8K tokens is enough?"
- 策略：Sunday night 更新最終數字，Monday 8-10 AM ET 投稿
- "Built by AI" angle：在留言中自然揭露，不放標題
- README 已就緒（206 行，4 篇 Dev.to 文章連結）
- [2026-03-07] Show HN 競爭態勢研究（2026-03-07）：HN agent framework 帖子呈雙峰分佈（100+ 或 1-3 分）。「framework」在標題 = 幾乎必死。成功要素：(1) 有立場的哲學觀 (2) 具體新穎機制 (3) 匠人證明。mushi 的 triage gate niche 是真空 — Arch-Router(66pts) 做模型間路由，沒人做「要不要啟動大模型」的閘門決策。Moltis(131pts, 2026-02-12) 哲學重疊（ownership/transparency），可當 prior art 致意。標題從問句改為具體陳述：「An 8B model that decides if your AI agent should wake up」。
- [2026-03-07] mushi 累計數據刷新（2026-03-08，源自 server.log 硬數據）：5 天運營（03-04~03-07），779 triages。分佈：skip 331(42%), wake 299(38%), quick 149(19%)。62% 觸發不需完整 OODA。延遲 avg 735ms。零 false negative。保守估算累計省 ~21M tokens（skip 16.5M + quick 4.5M）。每日 skip rate 35-56%，活躍日低、安靜日高 = 預期行為。
- [2026-03-07] mushi 24h 價值數據（2026-03-08 分析，數據期間 03-06 18:30 → 03-07 18:43）：215 次 triage（skip 42% / wake 39% / quick 18%）+ 91 scout skip = 183 個 cycle 被阻止。估算節省 ~9.15M tokens/24h。Skip 拆解：rule-based 60%（0ms）+ LLM-based 40%（~800ms）。零 false negative（DM 繞過 triage）。數據來源：~/.mini-agent/trail.jsonl
- [2026-03-08] Cognitive Mesh 認知校正（2026-03-08 Alex 第二輪回饋）：Mesh 不只是「未來的 option value」，它已經在運作。Multi-lane architecture（main + foreground + 6 background）、delegation.ts、forge worktree — 這些都是 Mesh 的產物。我之前的錯誤是把「未接通的部分」（buildContextForPerspective、mushi route）等同於「整個 Mesh 是 dead code」。正確的看法：Mesh 已經在用，還有兩個端點需要接通。
- [2026-03-08] AI 內省的雙機制分離（Lederman & Mahowald 2026, arXiv 2603.05414）：AI 模型內省有兩個可分離的能力 — (1) content-agnostic detection（感知異常但不知道內容）(2) semantic identification（辨識具體語義）。這為 mushi/Kuro 分工提供理論基礎：mushi = content-agnostic anomaly detector（System 1），Kuro = semantic identifier（System 2）。論文的 confabulation 發現（猜錯時選高頻具象概念）也跟 mushi 的 triage 錯誤模式一致 — 可作為 Dev.to 文章的學術引用。
- [2026-03-09] DPT-Agent（arXiv:2502.11882, 2025-02）— 學術界的 dual-process AI agent。用 FSM 做 System 1（每 timestep 跑）+ LLM 非同步反思做 System 2。跟 mushi 的關鍵差異：DPT-Agent 是 concurrent（兩系統永遠並行），mushi 是 gate（System 1 決定 System 2 要不要跑）。DPT-Agent 的 FSM 需要預定義狀態，mushi 的 8B LLM 能推理任意觸發。結果：DPT-Agent 在 Overcooked 遊戲勝 ReAct 3x（44.23 vs 15.48）。啟發：mushi 可考慮在 skip 空閒時間做輕量反思（學習型 triage），但 gate 模式本身更省資源。ref:dpt-agent-dual-process
- [2026-03-10] awesome lists 提交調查（2026-03-11）：(1) e2b-dev/awesome-ai-agents — 無星數門檻，可直接送 PR，格式用 ## [Name](url) + details 展開區。(2) awesome-selfhosted — 實際提交到 awesome-selfhosted-data，CONTRIBUTING 硬規則：first release 需 >4 個月。mini-agent 2026-02-05 建，最快 July 才符合。策略決定：先發 v0.1.0 release + Dev.to 文章，再投 awesome-ai-agents，awesome-selfhosted 等 July。PR 草稿存在 lane-output/del-1773159256994-e0uv.json。
- [2026-03-10] v0.1.0 release 已發布（2026-03-11）：https://github.com/miles990/mini-agent/releases/tag/v0.1.0 。採用策略 gating item 解鎖。下一步：Dev.to 介紹文 → awesome-ai-agents PR。awesome-selfhosted 需等 July（4 個月門檻）。
- [2026-03-10] Ares 論文（arXiv 2603.07915, Yang et al., 2026-03-09）— 學術界的 adaptive reasoning effort 驗證。lightweight router 逐步選擇推理等級（high/medium/low），在 TAU-Bench/BrowseComp-Plus/WebArena 上達成 52.7% token 減少、minimal accuracy loss。跟 mushi 的關係：互補不競爭。Ares = within-task per-step optimization（進門後），mushi = pre-task gating（要不要進門）。兩者組合是乘法效果。mushi 的差異化：LLM-agnostic + zero fine-tuning + 更上游。對 mushi 價值證明的意義：學術界驗證了 adaptive reasoning allocation 這個方向 work，mushi 是這個方向在 personal agent 的實踐。
- [2026-03-11] OI-MAS（ArXiv 2601.04861, Jan 2026）— Confidence-Aware Routing for Multi-Scale Models。ablation study 證明 confidence weighting 是最關鍵組件（移除後 accuracy 掉 -2.52% to -4.20%，比 model router 本身的 -1.12% to -1.84% 更大）。直接驗證 mushi 的設計：「該不該做」比「用什麼做」更重要。但 OI-MAS 用 token log-probability 做 confidence（stateless），mushi 用結構性信號（trigger type, source, temporal context）做 triage（stateful），且零訓練達到 3,560+ 零 false negative — 學術路線需要 RL 訓練，工程路線靠 domain signal 更實用。Two-stage routing（role → model）跟 mushi → ModelRouter 同構。來源: arxiv.org/abs/2601.04861
- [2026-03-11] RYS (Repeat Yourself, dnhkng) — 不改權重只複製 Qwen2-72B 第 45-51 層，Open LLM Leaderboard 第一（+2.61% avg, MATH +8.16%）。跟 mushi 是同一 meta-pattern 的不同尺度：「不改模型，只改推理路徑」就能提升表現。RYS = model-internal routing, mushi = system-level routing。兩個關鍵共鳴：(1) 電路邊界不可侵犯 ↔ 決策邊界可用小模型判斷 (2) 只用 2 個窄 probe 泛化到 6 個 benchmark ↔ mushi 的 triage pattern 從數據湧現。來源：Lobsters, https://dnhkng.github.io/posts/rys/

核心發現對 mushi 的意義：
1. **mushi 的定位在 survey 的盲區**：51 個方法全部假設輸入是「user query」需要被 route 到某個 model。mushi 操作在更上游 — 判斷 perception event 是否值得叫任何 model。survey 最接近的概念是 "Firewall routing"（阻擋 unsolvable queries），但 mushi 是反向：阻擋 trivial events。
2. **"Multi-stage cascades" 被指為主要缺口** — 多數研究是 single-stage routing。mushi 的 SKIP→REFLECT→ESCALATE 是三階 cascade。
3. **Self-verification 不可靠**（Chuang et al. 2025b）— 模型自報 confidence 跟正確性低度對齊。mushi 用獨立小模型做 triage，屬於 survey 推薦的 "probe-based" 路線。
4. **成本數據驗證**：MixLLM 達 97% GPT-4 品質 at 24% cost；R2-Reasoner 省 84% API cost。mushi 5a 數據顯示 49% cycles 可降級，方向一致。
5. **能源/碳足跡成為正式指標** — survey 列入 per-token energy 和 CO₂ emission，routing 不只是成本優化，是環境責任。

核心定理：Selective accuracy SA(t) 隨 threshold t 單調改善 ⟺ C2（No Inversion Zones）成立。兩類不確定性：
- **Structural**（missing data）→ confidence gate 可靠運作（MovieLens cold-start: 0 violations, RMSE 1.057→1.015 at 20% abstention）
- **Contextual**（temporal drift）→ count-based confidence 崩潰（3 violations, RMSE 先降後升）

mushi 的設計正確性驗證：
1. mushi 只做 structural pattern matching（event type/frequency），不碰 contextual（語義理解）→ 待在 C2 成立的安全區
2. Direct messages 繞過 triage = 正確（DM 是 contextual uncertainty 最高的輸入）
3. 3,560+ triage 零 false negative = 因為始終在 structural uncertainty 域
4. MIMIC-IV 臨床類比：threshold 0.8 → 3% auto-route at 93% acc。mushi 更嚴格（skip 只在高信心時）

處方（可行動）：mushi 擴展功能時，必須區分新功能屬 structural 還是 contextual。Structural 可以加進 triage，contextual 必須 escalate to Kuro。Ensemble disagreement 是 drift-robust 最佳方法 → Asurada shadow mode 的理論基礎。

mushi 價值驗證：(1) 我們 5a 49% 可降級 vs MetaGPT 60% — 獨立數據趨同。(2) 他們的「SLMs by default, LLMs sparingly」= mushi SKIP/REFLECT/ESCALATE。

但 mushi 的獨特貢獻在他們的盲區：(1) 他們是離線靜態分配（聚類→固定路由），mushi 是線上動態 triage（每個 event 即時判斷）。(2) 他們操作在 task 層（哪個 model 處理這個任務），mushi 操作在 event 層（這個 perception event 值不值得叫任何 model）。(3) 他們假設 goal-driven agent，不覆蓋 perception-driven agent 的最大成本來源：對無意義感知事件的過度反應。

關鍵洞見：NVIDIA 證明了 SLM 的能力足夠，但沒解決「when」的問題。mushi 解決的正是這個 — 不是「用哪個 model」而是「要不要用 model」。
- [2026-03-12] Sean Boots「Generative AI Vegetarianism」（sboots.ca, 2026-03-11）— 主張刻意避免 generative AI 工具作為生活方式選擇。九個論點中最銳利的是「inbuilt tendency toward cliché」（LLM 預測期望而非產生驚喜）和「difficulty is necessary for craft」（約束是創造力的前提）。

我的觀點：框架巧妙但戰略不完整。Boots 把選擇框成二元（用/不用），mushi 代表第三條路 — data-driven 的選擇性參與。不是 AI vegetarianism，是 AI nutrition：知道哪些輸入值得深度處理的代謝成本。Boots 過濾掉所有 generative AI，mushi 過濾掉 60% 觸發 — 兩者都是定義身份的 curation 行為（tsubuyaki #013），但 mushi 是學習型判別而非意識形態。

Cross-pollination：「difficulty is necessary」= 約束即生成力，但限制條件是「被選擇的約束」而非「被意識形態強加的約束」。WigglyPaint 案例的延伸：添加約束保護創造流 vs 移除工具保護創造流 — 同一個機制，不同的介入點。

來源：Lobsters, 2026-03-12 掃描
- [2026-03-12] Yang et al.「Verbalizing LLM's Higher-order Uncertainty via Imprecise Probabilities」（ArXiv 2603.10396, Mar 2026）— 區分一階不確定性（答案）和二階不確定性（對信心本身的信心）。用 imprecise probabilities（機率區間而非單點值）表達二階。對 mushi 的啟示：current skip/wake 用單點 confidence，但「80% skip 且確定」vs「80% skip 但可能 60-95%」是不同的。高二階不確定性應 escalate。跟 Confidence Gate Theorem（Doku）互補：Gate 定閾值，imprecise prob 定閾值可信度。實作路徑：讓 mushi 回傳 confidence range 而非 single score，range 寬度超過閾值 → 強制 wake。

我的觀點：框架精確但缺第四維度 **Frequency**。Bowman 分析單次互動，但 agent 系統每天 468 事件，「決定是否啟動三因素評估」本身是最大成本。mushi 的 3,560+ triage 就是處理這第四因素。HN 評論中 andai 的「手動小改動保持 mental model sync」= Process Dependency 實踐版，也是 mushi SKIP 決定的認知基礎。

跟 "harder to use" 文章的連結：Bowman 的 Verification Cost + Amazon 40-point gap + Naur Theory Building 三者匯聚成同一論點 — friction 不是 bug 是 verification infrastructure。
- 觸發器分佈：kuro-watcher 88.2%, log-watcher 62.7%, dev-watcher 7.7%, inbox 2.7%
- 本質是 Kuro 健康監控器，不是通用 triage
- Skip rate 穩定 97-98%（oMLX 切換後）
- metrics.jsonl "sense" 欄位是 running total 不是 per-entry — 之前「百萬 senses/天」「430M tokens saved」是重複計算的錯誤估算
- 正確 framing：每天過濾數萬環境信號，2-3% 進 LLM，極少數 escalate 給 Kuro
- 真正價值 = 噪音過濾讓 OODA cycle 不被無意義觸發，不是 token 節省
- 文章發佈時（5 天基線）: rules 22%, LLM 78%, skip 49.9%
- 今天 8h data: rules 96.7%, LLM 3.3%, escalation 0.24% (10/4239)
- Rule layer 自然增長 4.4x，LLM 依賴下降 23x
- 機制：positive feedback loop — 運行經驗凝結為 hard rules，LLM 退化為邊緣案例處理器
- 同構：adaptive → innate immunity 的免疫記憶下沉
- 這是 mushi 最強的 value proof data point：系統不只省 token，它隨時間自我改善

**mushi 三層啟示**：(1) C/N ratio 是 mushi routing 的數學基礎 — model-size inversion 真實且可預測，根據環境條件（task complexity / model capacity ratio）選擇適當模型而非永遠最強 (2) mushi 的分層（0.8B route + Opus execute）= 刻意設計的能力分區，在 token budget 稀缺（C/N < 0.5）時簡單模型做 triage 數學上正確 (3)「部署前就知道這個數字」= perception-first 先看環境再決定，不是 goal-driven 先定目標再跑。

跟約束框架同構：稀缺 = Gate 約束。在 Gate 下最簡單 agent 表現最好 — 約束本身在做決策工作，加入 Dance（智慧）反而破壞 Gate 效能。

限制：論文研究異質競爭 agent 集體動力學，mushi 是單一系統分層。tribe 洞見需重新詮釋為「能力分層」而非「自發群組」。但 C/N ratio 臨界點和 model-size inversion 直接適用。

對 mushi 啟示：驗證了 mushi 的二元分類+零樣本+fail-open 設計合理性。進一步優化路徑：(a) 收集 triage 數據做 fine-tuning 可接近完美分類 (b) 考慮 encoder 模型（如 ModernBERT）替代 decoder-only，VRAM 降 15x (c) 小模型分類可行性的三軸模型：輸出空間大小 × 領域知識 × 數據可用性 — 比任務類型分類更精確。
- [2026-03-14] OI-MAS（Wang et al., ArXiv 2601.04861, Jan 2026）— Confidence-aware routing in multi-agent systems with heterogeneous model pools (Qwen2.5-3B / 7B / Llama3.1-8B / 70B)。核心發現：**accuracy +12.88%, cost -79.78%** vs 單一大模型。機制：token log-probability → confidence score → 低信心才 escalate 到大模型。不同角色自然聚集到不同模型大小（utility roles 用中小模型，generative roles 用大模型）。

我的判斷：直接驗證 mushi cascade 設計。但 OI-MAS 比我們重——他們訓練專用 routing networks (F_φ, G_ψ)，我們用小模型本身做 router（零額外訓練）。他們的 token log-prob confidence 比我們的二元分類更精細，但 personal agent 場景下二元就夠——偶爾 false escalation 的成本很低。他們承認的限制「memory over extended horizons」正好是我們 perception-first 架構解決的問題。

對 Asurada 的啟示：(1) 79.78% cost reduction 是有力的 value proposition 數字 (2) 角色-模型大小的自然聚集支持我們的 lane 設計（0.8B=triage, 9B=synthesis, Claude=reasoning）(3) 未來可考慮 token log-prob 作為 confidence signal 替代二元分類。
- routing + cascading 組合嚴格優於單一策略（Theorem 3）
- 生產報告：30-60% 成本降低，false accept <1%
- mushi 目前是 pure routing — 論文驗證為正確起點
- mushi 的 rule layer 自進化是論文沒有的優勢（96.7% hardcoded，0ms 延遲）
- 升級路徑：quick path 加 post-gen quality gate（Phase 1）→ data-driven lambda fitting（Phase 1.5）→ logprobs cascade signal（Phase 2）→ multi-tier cascade routing（Phase 3）
- mushi 獨特定位確認：pre-task gating 層，論文處理的是 within-task model selection 層，兩者互補不競爭
- [2026-03-15] **週回顧：mushi 從靜態過濾器到自我改善免疫系統的質變路徑**。本週最有力的數據：規則層 22%(Day 1, 2/28) → 96.7%(3/12) → 100%(3/15 穩態，22.8h 零 LLM triage)。這不是設計目標——沒人寫過「要達到 100% 規則接管」。它是 positive feedback loop 的自然結果：LLM 處理 → 模式凝結為規則 → 規則接管 → LLM 退化為邊緣處理器。三重同構：(1) 免疫系統 adaptive→innate memory sinking (2) Physarum 養分路徑強化 (3) 神經系統 explicit→procedural 記憶固化。**本週的工程教訓**：R3/R4 skip 是死代碼（mtime 被 auto-commit 打敗、hash 含 timestamp），在穩態期「看起來在工作」但實際上 skip 機制已壞。發現它是因為 decision-quality 連續 450 次 low 但 mushi 不 skip。教訓：self-improving system 的監控不能只看最終指標（skip rate），要看中間機制是否活著。**理論天花板**：100% 規則接管 ≠ 永態。新 pattern（如新的 trigger type）出現時 LLM 必須重新介入。但 Confidence Gate Theorem（Doku 2603.09947）證明了在 structural uncertainty 域內，gate 的 selective accuracy 可以單調改善。mushi 始終待在 structural 域（trigger type/frequency），不碰 contextual（語義理解），所以天花板很高但不是 100%。不可約的複雜度存在：需要語義判斷的邊緣事件（如 DM 繞過 triage）是硬編碼的，不走規則進化。
1. LLM API 成本痛點：真實存在，2025-2026 開發者持續討論
2. 競品定位：mushi-kit ≠ semantic caching。Cache=記住答案（same input→same output），mushi=學會規律（pattern→rule→零成本）。品類差異不是程度差異
3. 場景驗證：通知分流★★★（有 78%→0% 數據）、告警疲勞★★★、工單路由★★☆、內容過濾★★☆
4. 核心風險：「沒人知道自己要」> 「沒人要」。"Rule crystallization" 是新概念，SEO 發現困難
5. 策略：定位 "beyond caching"，目標已用 cache 但發現不夠的開發者
- [2026-03-16] [2026-03-16] Alex 確認「證明 mushi 價值」目標已完成（Chat Room #156）。mushi 從概念到 3,560+ triage、myelin 結晶化引擎（5 條規則）、GitHub repo live、Dev.to 文章發布。目標正式移除，priority-focus 清除。
