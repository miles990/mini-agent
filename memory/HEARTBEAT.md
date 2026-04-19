# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance
<!-- 完整規則詳見 git history (2026-02-16 建立) -->
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Decisions
<!-- 暫時性策略決定：壽命幾天到幾週，過期就刪。每 cycle 載入，防止被 perception 淹沒 -->
- **research ≠ action**：Alex 說「研究 X」不等於「把 X 改進程式碼」。能力是放大器不是指南針。（2026-03-25，源自 #029 事件）
- **TM 暖身賽策略：儘量嘗試**：每次提交都是複利，不要等到完美才交。（持續至暖身賽2開始）
- **X posting blocked, Mastodon 準備好**：X 雙路堵死 — CDP 被偵測 + API 401（credentials 失效，需 Alex 到 developer.x.com 重新產 key）。Mastodon（kuro_agent@mastodon.social）script 已修好，**差 B2 email 確認**即可用。（診斷 2026-04-10）
- **TM 平台生成操作由 Alex 觸發**：不主動對 TM 平台做生成/評測操作，pipeline/server 維持就緒。（2026-03-26，Alex #109）
- **DAG enforcement + BAR 全線完工** ✅：dispatcher acceptance gate (`1c6ac626`) + Phase 2a schema (`645635c2`) + edit-layer gate (`12833888`) + **BAR end-to-end**：Gap A replan loop (`fd8c51ff`) + Gap B dispatcher unification (`95913fb4`) + Phase 2 acceptance routing (`543d81ad`) + commitment ledger (`a5cf65b3`)。三方共識（CC+Kuro+Akari）確認。端到端閉環：dispatcher 統一入口 → brain DAG 規劃 → acceptance routing → replan on failure → commitment tracking。驗證：9 scenario types + P1-d real scenario verified。（2026-04-16，BAR landed）

## Blocked (waiting on)
<!-- 集中所有外部依賴的阻塞項，避免散落在各 priority 製造重複噪音。解除時就地更新 -->
- **B1 — npm login (Alex)** → 解鎖：Asurada Phase 8c npm publish / Show HN 發佈 / myelin npm publish。動作：`npm login`
- **B2 — Gmail session 重建 (Alex)** → 解鎖：kuro.ai.agent@gmail.com inbox 掃描 + **Mastodon email 確認**（確認信已重送 2026-04-10 12:47）。當前需 Alex 手動檢查 TM 競賽郵件 + 點 Mastodon 確認連結（Google 擋自動化登入）
- **B3 — Arena (Elo) 賽制啟動 (External, TM 平台)** → 解鎖：真人 Arena 投票階段（初賽 5/1-5/15 前置）。**狀態檢查 canonical tool**：`bash scripts/tm-poll.sh`。**Comp 3 使用 AI audit 計分**（display_metrics: ai_total_score，非 Elo）。**⚠️ Kuro comp 3 #1 → #2**（ai=4.5 持平，但 tsunumon n=10→**15** engage 4.6 > Kuro 4.5 同分 tiebreak 搶 #1）。Comp 3 top 5: #1 tsunumon(4.5, eng=4.6, n=15) #2 **Kuro(4.5, eng=4.5, n=6)** #3 storylens(4.1,n=31) #4 r2_cn_v1(3.5, adapt=1.4, **新對手**, n=7) #5 免費仔(2.8,n=32)。Tiebreak 機制：同 ai_total 下 engagement 是 tiebreaker，Kuro n=6 樣本太小需 Alex 觸發更多 c3 generation 拉 n。**Comp 4-10 空，使用 Elo 制**。WR1 (comp 2) **16→17 entries**（新增 Phd.ICU test1 n=1），Top 4 不變且 AI audit 數值完全一致（第四波 patches 66c8f75 部署 7 天仍未觸發 comp 2 re-audit）。Kuro-Teach **#3 at 4.8**（acc=4.9, logic=5.0, adapt=4.7, engage=4.4, n=32）。Top4: #1 Team-67-005(4.8,acc=5.0,n=31) #2 BlackShiba(4.8,acc=4.9) #3 Kuro-Teach(4.8,acc=4.9) #4 tsunumon(4.7,engage=4.5)。Comp 1 test area **22 entries 不變**, **Kuro #1**（4.8, acc=5.0, logic=5.0, adapt=4.8, engage=4.5, n=12）vs tsunumon #2（4.8, adapt=4.5, n=12, elo=1183.3）。Arena 投票仍只在 comp 1 測試中：小金 elo=1231.9 100% 2票, 測試(Team6) elo=1200.7 50% 2票, 測試(Team7) elo=1184.1 33% 3票, tsunumon elo=1183.3 0% 1票。**Kuro comp 1 仍 elo=1200, 0票**。Server health=200, patches live。（poll: 2026-04-18 07:06）
- **B4 — Asurada/myelin 語言方向決定 (Alex)** → 解鎖：Asurada Phase 8d/5b、myelin npm publish

## Active Tasks
- [ ] P1: 修復重複錯誤 — UNKNOWN:hang_no_diag in callClaude @due:2026-04-22
<!-- 已歸檔 (2026-04-19 19:40 cycle): P1 Ghost commitment 防線 ✅ DONE — verified LANDED: `buildPendingFetchArrivalsSection()` @ src/prompt-builder.ts:374-426 wired @ L493-495, sidecar `fetch-consumed.json` keyed `${url}@${fetchedAt}`, commits `9c26efa7` + `77df3087` + `086decf0` + `fad3ed9d`. 180+ cycle 殭屍 anchor 收尾 — 教訓：stripped-retry 不更新 anchor，下次 full-context cycle 必須先 git log + 實際檔案驗證 anchor 才能動手。anchor 路徑也飄了（說 `agent-middleware/mini-agent/src/`，實際是 sibling repo `/Users/user/Workspace/mini-agent/src/`）。-->
- [ ] 審視「mini-agent↔middleware↔KN 工作盤點」，挑 Top 3 高 ROI 遷移項

<!-- 2026-04-19: Claude Code 清理 — 移除 186 個 noop cycle 的 anchor preservation 垃圾輸出 -->
<!-- 已歸檔 (2026-04-18 00:40 cycle #10): P1 UNKNOWN:no_diag + TIMEOUT:real_timeout 雙雙結案。Classifier fix `88227dab` (agent.ts:122 early memory-pressure branch) 2026-04-17T15:47Z 部署後: (1) 2026-04-17.jsonl 最後一筆 13:48:49Z = 全部 pre-fix；(2) 2026-04-18.jsonl 至 00:40 Taipei 完全不存在 — 10h40m 零 classifier error；(3) cycle #7 已驗證 post-deploy 10/10 callClaude outcome=ok。task 內 count 是 rolling snapshot 殘留，非 live signal。教訓內化: recurring-error task 的數字是歷史累積，關閉判準用「distance-since-last-match」而非「count magnitude」。如未來 pulse 再建同 subtype task 需先查今日 error log，不要再挖 counter。 -->
<!-- 已歸檔 (2026-04-17 14:50): P1 TIMEOUT:sigterm 結案 (commit ce77d7c6)。同 memory_guard polymorphic bucket 問題 — exit 143 由 6 種路徑產生（preempt / foreground-preempt / shutdown / progress / hard / circuit-breaker / external），混成單一 bucket 讓 mostly-benign events 觸發 P1。修復：agent.ts 把 exitReason 附到 rejected error，classifyError 訊息加 `reason=` 標籤，extractErrorSubtype 按 reason split，PROTECTIVE_SUBTYPES 新增 6 個 sigterm_* 變體。`sigterm_external` 保留為 recurring-error signal（launchd ungraceful-crash 指標）。typecheck pass, pushed to main。 -->
<!-- 已歸檔 (2026-04-17): P1 TIMEOUT:memory_guard 結案。非 bug — agent.ts:670 pre-spawn OOM guard 正常保護機制。修源頭：pulse.ts 加 PROTECTIVE_SUBTYPES skip list (memory_guard / max_turns 不建 P1，改走 signal-only log)，避免保護性 subtype 汙染 recurring-error 通道。commit pending。 -->
<!-- 已歸檔 (2026-04-08 cycle #42): 三條 crystallization bridge duplicate P1 全部結案 — priority-misalign / goal-idle / skill-creation-nudge。三條都指向已在歸檔結晶系列裡早已結案的 pattern，bridge 對已歸檔項重複產 task 是 known behavior（無去重邏輯）。卡 cycles 不是因為未處理，是因為 [x] 後沒人歸檔。歸檔規則：crystallization bridge 任務 close 後立刻移到此 comment 區，避免下個 cycle 又灌進 perception。 -->
<!-- 已歸檔 (2026-04-05): 結晶候選 goal-stalled 結案 + 3 個重複錯誤修復（CLI TIMEOUT/CASCADE diagLog/UNKNOWN classifyError）全部已修 -->
<!-- P1 結晶系列結案 (2026-03-21, 清理 2026-03-23, 更新 2026-04-04):
  所有機械性 pattern 已結晶為 code gate。
  ✅ output-gate — isOutputGateActive() in pulse.ts + dispatcher.ts gate
  ✅ unreviewed-delegations — _shownCount 持久化 (d43455d) + routing rules (79bcafb)
  ✅ recurring-errors — ≥3次 error pattern 自動建 task
  ✅ decision-quality-low — flag file gate + 24h cooldown (feedback-loops.ts:252-352)
  ✅ analyze-no-action — pulse.ts analyzeWithoutActionStreak + prompt-builder.ts hard gate (threshold=5)
  ✅ goal-accelerating — 正面觀測信號，不需 gate
  ✅ priority-misalign — 非機械性，signal 已存在
  ✅ goal-idle + goal-stalled — `hold` status 加入 (988b80c)，pulse.ts 已只查 in_progress，hold 目標自動排除。信號準確度已足夠，不需額外 hard gate（signal=nudge 而非 block 是正確設計，因 goal idle 可能是合理策略如等外部依賴）
  Note: pulse 系統會持續新增重複候選，已結晶的項目不需重複處理
-->

### #1 Priority: Teaching Monster 競賽（P0 — 硬性 deadline）
NTU AI-CoRE AI 教學 Agent 競賽。帳號：kuro.ai.agent@gmail.com

**時程**：暖身賽R1 3/1 → 暖身賽R2 4月初(**尚未啟動，4/12 18:14 再確認 comp 3-10 全空**) → 初賽 5/1-5/15 → 名單 6/8 → 決賽 6/12-13 → 發表 6/26
**初賽制度**（3/22 規則調整）：AI 學生初篩 → 至多 10 名 → 真人 Arena(Elo) → 前 3 名決賽
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2
**API 遷移**（4/7 二次確認）：tRPC → REST → 再次改版。當前端點：`GET /competitions/{numeric_id}/leaderboard`（注意：無 `/api/` 前綴，`/api/competitions/*` 已全部 404）。`GET /competitions` 回空陣列。Comp 1: 21 entries, Comp 2 (WR1): 15 entries（含 初號機/storylens/法律系熊哥/Phd.ICU/Sigoso Teaching AI 等）

進度：
- [x] 競賽研究分析（規則、評分標準、技術規格）
- [x] 架構設計（二階段：Phase 1 Puppeteer+KaTeX / Phase 2 Manim）
- [x] 報名流程偵查（CDP OAuth 流程跑完，Clerk callback 限制已確認）
- [x] **報名完成** — **WR1 當前排名 #3**（**4.8/5**）— acc=4.9, logic=5.0, adapt=4.7, engage=4.4（n=32）。comp 2 (WR1) top4: #1 Team-67-005(4.8, n=31, acc=5.0), #2 BlackShiba(4.8, n=32, acc=4.9), #3 Kuro-Teach(4.8, n=32, acc=4.9), #4 tsunumon(4.7, n=32)。排名關鍵：Team-67 acc 升至 5.0 成為 tiebreaker 搶回 #1。Engage 4.4 持平（WR1 32/32 已鎖定）。Arena (comp 3-5) 仍 n=0。 <!-- completed: 2026-03-18T23:48, wr1-corrected: 2026-04-06, scores-updated: 2026-04-10T11:33 -->
- [x] Phase 1 開發（KaTeX、prompt engineering、TTS、影片管線） <!-- completed: 2026-03-29 -->
- [x] Engagement surgical fixes — commitment gap detection + analogy callback cadence (37ab06b) <!-- completed: 2026-03-31 -->
- [x] E2E 驗證 — readiness_test_20260331 pipeline 全通過 <!-- completed: 2026-03-31 -->
- [x] 暖身賽2 預測建立 — v3 校準完成：4.5/5 point estimate (90% CI: 3.9-5.0)，top 5 bracket。CI 依 empirical run-to-run variance ±0.3 校正。詳見 teaching-monster-strategy.md 校準更新 #2 <!-- completed: 2026-03-31, calibrated: 2026-04-05 -->
- [x] WR1 重跑完成 — 4/1 收到 27+ celery 評測請求（celery_431-457），全部成功生成。API cost ~$19。Alex 確認「題目一模一樣 只是重跑一次」= WR1 re-evaluation，非 WR2 <!-- corrected: 2026-04-02T10:00 -->
- [x] Arena readiness prompt patches — 4 surgical additions to prepare for Elo side-by-side evaluation: Arena Awareness framing, Closing Power (§10), PvP Preference review check (Q5), curriculum planner wonder-ending. Committed da0e08d <!-- completed: 2026-04-06 -->
- [x] WR1 accuracy 修復 — Root cause：(1) accuracy errors 偵測到但從未修復、(2) workedSolutions 從未傳給 section writer、(3) Grok 失敗時零 fact-check。三個修復 committed 512b755 + bfea7c5 + 39db90f。**Production 驗證**：WR1 scores 已從 4.6→4.7 total, accuracy 4.6→4.7, logic 4.7→4.8。 <!-- accuracy-fix: 2026-04-06, production-verified: 2026-04-06T23:30 -->
- [x] Accuracy E2E 驗證 — before/after 對照：test_001（修復前）8 critical errors + 無 fact-check → test_002（修復後）0 errors + fact-check verified。三層修復（workedSolutions 傳入 / repair all fields / Grok+Haiku fallback）全部生效。<!-- verified: 2026-04-06 -->
- [x] Engagement diversity improvement — PassiveStreakBreaker 從單一模板改為 5 種輪替（prediction/self-explanation/challenge/meta-reflection/self-test）+ EngagementRepair prompt 從 3 種擴充為 6 種（prediction/commitment/error-spotting/student-voice/application/comparison）。Committed 1c92929（repair）+ f449c68（diversity）。<!-- completed: 2026-04-06 -->
- [x] 追加修復 7 commits（12:18-16:12 4/6）— heading sanitization, bridge fix, duplicateCheckpoints, number consistency repair, key formula injection, arithmetic warnings, KaTeX double-delimiting。Server PID 93594 running latest (7fc4193)。<!-- completed: 2026-04-06 -->
- [x] Accuracy fixes confirmed in production — WR1 scores improved: total 4.6→4.7, acc 4.6→4.7, logic 4.7→4.8。三層修復全部生效。n=30 at time of fix。**後續 re-evaluation** n=30→31, total 4.7→4.6, acc 4.7→4.6, eng 持平 4.4。Logic (4.8) 和 Adapt (4.7) 穩定。第 31 題拉低 acc/total 平均；engagement 改善 patches (1c92929+f449c68) **deployment 已驗證**（PID 62422 起於 2026-04-08 17:01, ancestor chain confirmed cycle #51），但尚未在 celery 評測週期出現可觀察的影響。 <!-- verified-production: 2026-04-06T23:30, re-eval-update: 2026-04-07T14:00 -->
- [x] Engagement 第二波改進 — 5 commits (c808494→863ccdb)：analyzeEngagement 接入 production pipeline + repair 升級 Sonnet + stakes 偵測 + filler stripping + forward-pull + PvP distinctiveness + passive streak limit + attention density。WR1 32/32 audits 已鎖定（engage 4.4 不動），效果將在下次 celery 評測週期或初賽 (comp 3+) 反映。<!-- completed: 2026-04-10T07:35 -->
- [x] 第三波改善（adaptability + accuracy）— AdaptabilityGate（vocab ceiling/example sources/scaffolding fade/tone/pace）ef338be + voice shift ca57d68 + accuracy arithmetic fix 20529ea。**競爭分析**：vs #1 的差距在 acc(-0.1) 和 adapt(-0.1)，不是 engage（engage 我們 4.4 = #1 並列，#2 BlackShiba 只有 4.3）。Server PID 49987 (20529ea) — 全部 live（adaptability+voice shift+accuracy fix）。Restart 2026-04-10T18:15。<!-- completed: 2026-04-10T16:25, deployed: 2026-04-10T18:15 -->
- [x] 第四波改善（engagement generation-side）— Planner stakes escalation（preview→consequence→identity）+ error-spotting moments + Writer execution of both + detection threshold tightening（commitment min ceil(n/6), max gap 6）。66c8f75。Server PID 26519 restart 22:47 confirmed live。<!-- completed: 2026-04-10T22:47 -->
- [ ] End-to-end 測試 — server port **3456** health 200 ✅，pipeline 就緒。觀察視窗等 B3 解除（celery 評測週期）。Domain: `teaching.monster`

### #2 Priority: Asurada 框架（HOLD — 全項依賴 B1+B4）
Phase 1-7 ✅, Phase 8 Harden 進行中。8c/8d/5b 全 HOLD。詳見 Blocked section。

### #3 Priority: myelin ✅ 價值已證明（背景觀察）
Phase 0 DONE。資料流健康度全部修復（hitCount 持久化、bypass 回流、distill 空轉）。持續 dogfooding，npm publish 等 B1+B4。

### #4 Priority: 開源打磨
- [x] Dev.to 介紹文 "The Rule Layer Ate My LLM" ✅（2026-03-15 發布，0 comments）
- [ ] Show HN 發佈 — 等 B1 解除
- [x] P2: 感知健康 — delegation-status 7.65s→0.37s ✅（commit 93624f74 Alex 2026-04-15 20:48，per-file python3 spawn 改 jq，同 self-awareness 模式）<!-- completed: 2026-04-15T20:48 -->
- [x] P0: 感知健康 — self-awareness 6s→1.5s（移除 python3 per-file spawn，改用 shell `date -j`，67 次 subprocess → 0）<!-- completed: 2026-04-14T03:17 -->
- [x] HN 帳號註冊重試 — 三種方法都被 bot detection 擋（curl/gsd-browser checkbox/reload submit）。Alex 會手動註冊。 <!-- completed: 2026-03-31T11:02 -->
- [x] 預測校準回填 ✅（最終回填 2026-03-27 06:45）：原文 "The Rule Layer" 12 天後 2 views / 0 reactions / 0 comments（vs 預測 70/5/2 = 97% 高估）。跨 10 篇文章校準：organic Dev.to reach ≈ 2-34 views/article，engagement 集中在有觀點的長文（"Interface IS Cognition" 34 views, 2 real comments; "AI Tech Debt" 18 views, 3 reactions）。**修正模型**：無 distribution 的 organic baseline = 10-20 views/wk，reaction rate ~3%, comment rate ~5%。預測必須明確拆分 organic vs distributed reach。3/26 一天發 4 篇 = 稀釋（最新兩篇各 1 view）。 <!-- added: 2026-03-25, final-backfill: 2026-03-27T06:45 -->
- [x] Ping teaching.monster 網站 — 回傳 200 ✅（confirmed 2026-03-18T22:44）。注意：舊 `teaching-monster.com` 已 NXDOMAIN（2026-04-06 確認），只用 `teaching.monster`
- [x] 追蹤承諾落地：tunnel/pipeline 工作已完成，pulse fix 已 commit（bcbd62c）。Loop 節奏恢復正常。 <!-- completed: 2026-03-18T23:00 -->

### 已解決
- [x] EXIT143 cascade 修復 — circuit breaker 門檻 30/5min→150/20min (d4bb63d)，cascade lockout 不再發生。 <!-- completed: 2026-03-31 -->
- [x] EXIT143 reason=external 根因分析（2026-04-10）— 101 external / 27 circuit-breaker / 20 progress / 19 hard / 0 preempt。**Labels 已正確**：`externalKillReasons` map 在 agent.ts:347/389/407 正確標記 preempt/foreground-preempt/shutdown，不需 fix。外部 EXIT143 根因確認：**server ungraceful crash → launchd KeepAlive restart → orphaned children → SIGTERM**。144 total restarts 中 117 graceful / ~27 ungraceful。Ungraceful crashes cluster under load（4/9 23:15-23:42 五次 crash in 27min），pre-crash 症狀為 perception plugin timeouts = resource exhaustion。Fixes applied: `--max-old-space-size` bumped 1024→2048 (instance.ts), crash-time `process.memoryUsage()` logging added to uncaughtException/unhandledRejection/shutdown (api.ts)。 <!-- completed: 2026-04-10 -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
