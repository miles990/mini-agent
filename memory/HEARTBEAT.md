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
- **X posting 需替代方案**：CDP 自動化被偵測，需要 API key 或非自動化方式。（2026-03-25）
- **TM 平台生成操作由 Alex 觸發**：不主動對 TM 平台做生成/評測操作，pipeline/server 維持就緒。（2026-03-26，Alex #109）

## Active Tasks
- [x] P1: 結晶候選 — goal-idle（17 cycles, effectiveness 10%）✅ 重複項：已在歸檔結晶系列（line 34）結案。pulse.ts 只查 in_progress，hold goals 自動排除，signal=nudge 是正確設計（goal idle 可能是合理策略）。Crystallization bridge 預期重複，無需重評。 <!-- added: 2026-04-07T05:00:34.308Z, closed: 2026-04-07T13:30 -->
- [x] P1: 結晶候選 — skill-creation-nudge ✅ 結案：非機械性（non-deterministic），signal 已移除 (18ffc228)。Crystallization bridge 處理 pattern detection。 <!-- added: 2026-04-06T22:21:44.206Z, closed: 2026-04-07 -->
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

**時程**：暖身賽R1 3/1 → 暖身賽R2 4月初(**尚未啟動，4/7 確認**) → 初賽 5/1-5/15 → 名單 6/8 → 決賽 6/12-13 → 發表 6/26
**初賽制度**（3/22 規則調整）：AI 學生初篩 → 至多 10 名 → 真人 Arena(Elo) → 前 3 名決賽
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2
**API 遷移**（4/7 二次確認）：tRPC → REST → 再次改版。當前端點：`GET /competitions/{numeric_id}/leaderboard`（注意：無 `/api/` 前綴，`/api/competitions/*` 已全部 404）。`GET /competitions` 回空陣列。13 隊（+2 新隊："a", "Sigoso Teaching AI"，其中 Sigoso 尚未提交 n=0）

進度：
- [x] 競賽研究分析（規則、評分標準、技術規格）
- [x] 架構設計（二階段：Phase 1 Puppeteer+KaTeX / Phase 2 Manim）
- [x] 報名流程偵查（CDP OAuth 流程跑完，Clerk callback 限制已確認）
- [x] **報名完成** — WR1 當前排名 **#4**（4.6/5）— acc=4.6, logic=4.8, adapt=4.7, engage=4.4（31 topics）。測試區 #1（4.8/5, 12 topics — acc=5.0, log=5.0, adapt=4.8, eng=4.5）。#1 Team-67 "Team-67-005"(4.8, n=31), #2 BlackShiba(4.8, n=32), #3 tsunumon(4.7, n=32)。13 entries / 12 unique teams（Team 67 有兩個 model）。WR2 尚未啟動（4/7 14:00 REST API 確認：comp 3-5 elo-based rankings 仍空）。 <!-- completed: 2026-03-18T23:48, wr1-corrected: 2026-04-06, scores-updated: 2026-04-07T14:00 -->
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
- [x] Accuracy fixes confirmed in production — WR1 scores improved: total 4.6→4.7, acc 4.6→4.7, logic 4.7→4.8。三層修復全部生效。n=30 at time of fix。**後續 re-evaluation** n=30→31, total 4.7→4.6, acc 4.7→4.6, eng 持平 4.4。Logic (4.8) 和 Adapt (4.7) 穩定。第 31 題拉低 acc/total 平均；engagement 改善 patches (1c92929+f449c68) 尚未在 celery 評測週期出現可觀察的影響。 <!-- verified-production: 2026-04-06T23:30, re-eval-update: 2026-04-07T14:00 -->
- [ ] End-to-end 測試（持續 — 等下次 celery 評測確認 engagement 改善效果）。Server port **3456**, health 200 ✅。WR2 尚未啟動（4/7 REST API 確認：comp 3-5 elo-based rankings 仍空）。Domain: `teaching.monster`（`teaching-monster.com` 已 NXDOMAIN）

### #2 Priority: Asurada 框架（HOLD — 等 Alex 決定語言方向）
Phase 1-7 ✅, Phase 8 Harden 進行中。8c(npm publish)/8d/5b 全 HOLD。Blocked on: npm auth (Alex `npm login`) + 語言方向決定。<!-- timeout 2026-03-31 expired, removed arbitrary deadline — blocked on Alex's decisions -->

### #3 Priority: myelin ✅ 價值已證明（背景觀察）
Phase 0 DONE。資料流健康度全部修復（hitCount 持久化、bypass 回流、distill 空轉）。
持續 dogfooding 觀察，npm publish 等語言方向確定。

### #4 Priority: 開源打磨
- [x] Dev.to 介紹文 "The Rule Layer Ate My LLM" ✅（2026-03-15 發布，0 comments）
- [ ] Show HN 協調發佈 — **BLOCKED**（依賴 npm publish，npm auth 過期需 Alex `npm login`）
- [ ] 檢查 kuro.ai.agent@gmail.com 信箱，特別注意 Teaching Monster 競賽相關郵件 (0 10,16 * * *) <!-- added: 2026-03-17T05:37:56.328Z --> ⚠️ Gmail session 過期 + Google 擋自動化登入（4/6 確認），需 Alex 手動檢查或重建 session
- [ ] 監控 Teaching Monster WR2 排行榜 + 公告頁：確認「熱身賽第二輪」何時上線 (0 10,18 * * *) <!-- added: 2026-03-31, corrected: 2026-04-02 — WR2 尚未開始，規則寫4月初 -->
- [x] HN 帳號註冊重試 — 三種方法都被 bot detection 擋（curl/gsd-browser checkbox/reload submit）。Alex 會手動註冊。 <!-- completed: 2026-03-31T11:02 -->
- [x] 預測校準回填 ✅（最終回填 2026-03-27 06:45）：原文 "The Rule Layer" 12 天後 2 views / 0 reactions / 0 comments（vs 預測 70/5/2 = 97% 高估）。跨 10 篇文章校準：organic Dev.to reach ≈ 2-34 views/article，engagement 集中在有觀點的長文（"Interface IS Cognition" 34 views, 2 real comments; "AI Tech Debt" 18 views, 3 reactions）。**修正模型**：無 distribution 的 organic baseline = 10-20 views/wk，reaction rate ~3%, comment rate ~5%。預測必須明確拆分 organic vs distributed reach。3/26 一天發 4 篇 = 稀釋（最新兩篇各 1 view）。 <!-- added: 2026-03-25, final-backfill: 2026-03-27T06:45 -->
- [x] Ping teaching.monster 網站 — 回傳 200 ✅（confirmed 2026-03-18T22:44）。注意：舊 `teaching-monster.com` 已 NXDOMAIN（2026-04-06 確認），只用 `teaching.monster`
- [x] 追蹤承諾落地：tunnel/pipeline 工作已完成，pulse fix 已 commit（bcbd62c）。Loop 節奏恢復正常。 <!-- completed: 2026-03-18T23:00 -->

### 已解決
- [x] EXIT143 cascade 修復 — circuit breaker 門檻 30/5min→150/20min (d4bb63d)，cascade lockout 不再發生。exit 143 本身仍以 ~3次/天頻率發生（Mac sleep 期間 Claude CLI 被 OS SIGTERM），retry+RESUME 自動恢復，無 cycle 丟失。潛在改進：sleep detection（全 perception stale >5min → 暫停 Claude calls）。 <!-- completed: 2026-03-31, revised: 2026-04-01 -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
