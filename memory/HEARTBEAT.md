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
- **中台+KG 反射規則**（2026-04-19，crystallized from 6+ cycle 重複）：每個新任務的 Observe phase 先執行 `search_knowledge(query)` 撈既有節點；長推理（>3 步 / >30s 預估）優先 `<kuro:delegate>` 不在前景做；成果沉澱走 `add_knowledge` 而非只寫 memory。觸發條件：新 task / 新 research 主題 / 收到 Alex 新指令。違反即補償（下 cycle 先補 KN lookup 再動作）。廢止條件：連 7 天自檢全綠 = 內化完成。
- **前景 vs 中台 路由規則**（2026-04-20，from cross-repo inventory `memory/reports/2026-04-20-cross-repo-inventory.md`）：
  - **前景（stay local, 同步執行）**：OODA hot-path（buildContext / searchMemory FTS5 / pulse eval / perception polling tick）、forge slot 分配、單次 shell/grep/read/curl（<30s + 明確 I/O）、delegation 政策層（type→worker map、sibling awareness）。判準：latency 敏感 + 零網路依賴。
  - **中台 delegate（`<kuro:delegate>` 走 `/accomplish`）**：(a) verbose 文字壓縮（perception 區塊 >2K chars 走 `summarizer` worker）；(b) 命名主題 research/learn/review/create/code 且步數 >3 或預估 >30s；(c) 跨 worker acceptance-gated DAG plan。判準：bounded async + 可恢復 + 結果可快取。
  - **KN（`search_knowledge` / `add_knowledge`）**：新主題 Orient 前查；新洞察成形後寫入（不只寫 memory）。判準：知識需跨 session 複用。
  - **破局 fallback**：中台 `/plan` 無回應 120s → inline fallback + `TIMEOUT:middleware_plan_unreachable` 可操作錯誤（見 Active Tasks P1 action [A]）；KN >500ms → fallback local FTS5。OODA 不 block。
- **DAG enforcement + BAR 全線完工** ✅：dispatcher acceptance gate (`1c6ac626`) + Phase 2a schema (`645635c2`) + edit-layer gate (`12833888`) + **BAR end-to-end**：Gap A replan loop (`fd8c51ff`) + Gap B dispatcher unification (`95913fb4`) + Phase 2 acceptance routing (`543d81ad`) + commitment ledger (`a5cf65b3`)。三方共識（CC+Kuro+Akari）確認。端到端閉環：dispatcher 統一入口 → brain DAG 規劃 → acceptance routing → replan on failure → commitment tracking。驗證：9 scenario types + P1-d real scenario verified。（2026-04-16，BAR landed）

## Blocked (waiting on)
<!-- 集中所有外部依賴的阻塞項，避免散落在各 priority 製造重複噪音。解除時就地更新 -->
- **B1 — npm login (Alex)** → 解鎖：Asurada Phase 8c npm publish / Show HN 發佈 / myelin npm publish。動作：`npm login`
- **B2 — Gmail session 重建 (Alex)** → 解鎖：kuro.ai.agent@gmail.com inbox 掃描 + **Mastodon email 確認**（確認信已重送 2026-04-10 12:47）。當前需 Alex 手動檢查 TM 競賽郵件 + 點 Mastodon 確認連結（Google 擋自動化登入）
- **B3 — Arena (Elo) 賽制啟動 (External, TM 平台)** → 解鎖：真人 Arena 投票階段（初賽 5/1-5/15 前置）。**狀態檢查 canonical tool**：`bash scripts/tm-poll.sh`。**Comp 3 使用 AI audit 計分**（display_metrics: ai_total_score，非 Elo）。**⚠️ Kuro comp 3 #1 → #2**（ai=4.5 持平，但 tsunumon n=10→**15** engage 4.6 > Kuro 4.5 同分 tiebreak 搶 #1）。Comp 3 top 5: #1 tsunumon(4.5, eng=4.6, n=15) #2 **Kuro(4.5, eng=4.5, n=6)** #3 storylens(4.1,n=31) #4 r2_cn_v1(3.5, adapt=1.4, **新對手**, n=7) #5 免費仔(2.8,n=32)。Tiebreak 機制：同 ai_total 下 engagement 是 tiebreaker，Kuro n=6 樣本太小需 Alex 觸發更多 c3 generation 拉 n。**Comp 4-10 空，使用 Elo 制**。WR1 (comp 2) **16→17 entries**（新增 Phd.ICU test1 n=1），Top 4 不變且 AI audit 數值完全一致（第四波 patches 66c8f75 部署 7 天仍未觸發 comp 2 re-audit）。Kuro-Teach **#3 at 4.8**（acc=4.9, logic=5.0, adapt=4.7, engage=4.4, n=32）。Top4: #1 Team-67-005(4.8,acc=5.0,n=31) #2 BlackShiba(4.8,acc=4.9) #3 Kuro-Teach(4.8,acc=4.9) #4 tsunumon(4.7,engage=4.5)。Comp 1 test area **22 entries 不變**, **Kuro #1**（4.8, acc=5.0, logic=5.0, adapt=4.8, engage=4.5, n=12）vs tsunumon #2（4.8, adapt=4.5, n=12, elo=1183.3）。Arena 投票仍只在 comp 1 測試中：小金 elo=1231.9 100% 2票, 測試(Team6) elo=1200.7 50% 2票, 測試(Team7) elo=1184.1 33% 3票, tsunumon elo=1183.3 0% 1票。**Kuro comp 1 仍 elo=1200, 0票**。Server health=200, patches live。（poll: 2026-04-18 07:06）
- **B4 — Asurada/myelin 語言方向決定 (Alex)** → 解鎖：Asurada Phase 8d/5b、myelin npm publish

## Active Tasks
- [ ] P1: 修復重複錯誤 — TIMEOUT:silent_exit in callClaude（累計 7 次，今日 3 起 01:12-02:56，14:00 後零發生。**Bulk fix SHIPPED** `67c40914` @ 14:03（Alex applied）— `buildMinimalContext(budget)` 修補 minimal-mode 忽略 contextBudget 的 bug，封死 entries #1/#2 86k→86k retry inflation 路徑。**剩 Event #3 class 未解**：28k sub-cap 短時 hang（~254s）走 stdout-blindness，需 `agent.ts:153/220-227` + `feedback-loops.ts:165` 三段 additive patch 補 stdout tail + auth/overload/void sub-classifier（完整設計 `docs/plans/2026-04-22-timeout-silent-exit-instrumentation.md:35-82`，malware-guard active，不自 apply）。Instrumentation slog 降級 tier-3 regression detector。**T+43min post-ship 0 callClaude errors**（last error 12:39 Taipei ~1h24m pre-ship）但窗口太短，decision gate 需 ≥1 post-14:03 event 才能分類。決策規則：next silent_exit prompt ≤45k → E' 守住，轉攻 stdout patch；>45k → E' 漏，重啟 slog。旁證：04:09-04:14 UTC 6× UNKNOWN 31k cluster（a1 91s hang → a2/a3 6s fast-fail "處理訊息時發生錯誤"）是另一 lane，像 session/auth drop retry cascade，跟 silent_exit 不同簽名）@due:2026-04-23 <!-- added: 2026-04-20T02:09:09.600Z, updated: 2026-04-22T14:47 T+43min post 67c40914 -->
- [x] P1: 修復重複錯誤 — TIMEOUT:generic in callClaude ✅ 2026-04-20 10:04 shipped `c7c50f7b` — 1-line follow-up to own `3039f4a3` incomplete ship. extractErrorSubtype 缺 `靜默中斷/靜默溢位/silent exit` keyword，4× entries 全落進 generic fallthrough (line 154)。現在 relabel → `silent_exit`。Behavior unchanged，labeling fix only。診斷 `memory/topics/timeout-generic-diagnosis-20260420.md` 提 A/B/C 三層；A ship，B（prompt-size 28-33k 源頭調查）+ C（retry 掉 recent-events）還開著，等 silent_exit bucket 累積樣本再決定是否動。L2 autonomous ship。
- [x] P1: 修復重複錯誤 — UNKNOWN:hang_no_diag ✅ 2026-04-19 23:24 shipped `3039f4a3` — Alex applied my #36 patch proposal (chose 120s floor). Two changes live in classifyError: (1) silent_exit bucket catching exit!=null + dur>120s + empty stderr before L241 fallthrough (2) L193 absolute 300s floor closing the 600-1619s dead zone that `e81f414` (30min timeout) opened. Monitor 48h: hang_no_diag count should drop, `silent_exit` subtype takes the delta. Diagnosis chain #33→#36 (wrong file → right file wrong verb → fallthrough map → threshold arithmetic) — kept by Alex for the ship.
  <!-- 2026-04-19 cycle #N (12:46 update): regression spike confirmed. 14 天 rate: 4/6-4/15 近零（1 筆）→ 4/16 突飛 184 筆（修正前數字 235 是含 generic UNKNOWN 的雜訊）→ 4/17 24 → 4/18 1 → 4/19 至今 22。**Field-name caveat**: pulse subtype `hang_no_diag` 不是 error log 裡的 verbatim 字串；classifier 真正的判據是 message 含 `處理訊息時發生錯誤` + `dur≥600s` 後綴。今日 19 筆多數可能是 generic `no_diag` 而非真 600s hang，需在 worktree test 時重新分類。**First-bad locked**: `2026-04-16T02:55:53.628Z` (= 10:55:53 +0800)。**舊 4 個 suspects (1500fe4c/3e6a4e8e/fd8c51ff/95913fb4) 已 falsified** — 不在 4/15-EOD → 4/16-10:55 bisect window 內。**Evidence-based new suspects** (window 內、按時間倒序): (a) `12833888` — convertAndDispatchAsPlan + edit-layer gate（first-bad 前 17min, top suspect）; (b) `7d194410` — spawnDelegation routed through middleware /plan; (c) `107c2e9c` — middleware perception plugin enabled。Next cycle action: worktree revert `12833888`，跑 1h 觀察 fresh error log，若 hang count 掉到 <5/h 即根因確認；若不變則往 (b)(c) 推。Method-level lesson: `<kuro:delegate type=shell>` 連續 3 次失敗於 grep/curl tasks（bleed-through syntax noise + Command exited 1），改用直接 Bash tool 一次成功；下次 shell delegate 失敗 2× 就 fallback Bash，不要繼續燒 cycles。

**2026-04-19 23:xx cycle update — suspect pivot + diagnosis refined**: 讀完 12833888 + current delegation.ts:275-301 diff 後發現 (a) 12833888 只改 step construction, 真正引入 network dependency 的是 **`7d194410`**（route spawnDelegation through middleware /plan, 07:29:18 +0800）— 提升為主嫌。(b) `await middleware().plan(...)` @ delegation.ts:294 **無 per-call timeout**，只被外層 `timeoutMs*2` deadline 卡（產生 `dur≥600s` hang_no_diag 簽名）。(c) `buildRecentDelegationSummary` 已驗 sync I/O 但檔案受 JOURNAL_MAX_ENTRIES trim bounded, ms 級非 600s。(d) 簡單 `git revert 12833888` 衝突 — 因 `6a8be901` cutover 刪掉 flag，worktree revert path 死路。KN node `7686e3f8` 記錄完整診斷。**Next-cycle action (pick ONE, 不要再堆)**: [A] wrap middleware().plan() 在 Promise.race 120s timeout — 把 silent 600s 轉成 `TIMEOUT:middleware_plan_unreachable` actionable error（最便宜、1 行改）; [B] cherry-pick revert `7d194410+12833888+6a8be901+1500fe4c` 到 `93624f74` baseline 跑 1h parallel instance（最確定性、成本高）; [C] 查 middleware /plan endpoint 是否 blocking >600s。推薦 [A]. -->
<!-- 已歸檔 (2026-04-19 19:40 cycle): P1 Ghost commitment 防線 ✅ DONE — verified LANDED: `buildPendingFetchArrivalsSection()` @ src/prompt-builder.ts:374-426 wired @ L493-495, sidecar `fetch-consumed.json` keyed `${url}@${fetchedAt}`, commits `9c26efa7` + `77df3087` + `086decf0` + `fad3ed9d`. 180+ cycle 殭屍 anchor 收尾 — 教訓：stripped-retry 不更新 anchor，下次 full-context cycle 必須先 git log + 實際檔案驗證 anchor 才能動手。anchor 路徑也飄了（說 `agent-middleware/mini-agent/src/`，實際是 sibling repo `/Users/user/Workspace/mini-agent/src/`）。-->
<!-- 已歸檔 (2026-04-19 19:51 cycle): 盤點完成 — audit task-1776598762301-5 (worker=analyst, confidence=0.87) 回報 Top 3 ROI 項，轉成下列 3 條可執行 task。audit 全文在 agent-middleware/results.jsonl。教訓：dispatch → 下個 cycle 必須 TaskOutput/results.jsonl 回收，不然結果飄走。 -->
- [ ] P2: 遷移 #1 — Context Compaction (src/context-compaction.ts) 45s 阻塞 → 預派 middleware `summarizer` worker 提前 1 cycle，命中就 swap cached，miss fallback inline。風險：誤判 context bloat 時機 → 浪費 worker slot
- [ ] P2: 遷移 #2 — Perception Analyzer (src/perception-analyzer.ts) 6× Haiku/cycle → KN cache，key=plugin_id+input_hash，TTL=1 cycle，miss 才 LLM。需 500ms KN lookup guard，超時回退 inline call（保 3s Orient budget）
- [x] 試 `hyperframes` CLI 把 kuro-site 轉短片 ✅ 2026-04-20 13:20 **verdict: BLOCKED for TM 5/1, KEEP for Phase 2**。Probe 三輪完成（doctor v0.4.9 ✓ / init scaffold ✓ / render smoke ✓ produced 27KB mp4 = scaffold blank by design, not CLI bug）。Data model locked: `index.html` = GSAP timeline root w/ `window.__timelines["main"]`, clips = `<div class="clip" data-start data-duration>`, sub-comps via `data-composition-src`. **結構 fit** ✓（stack match: Kokoro+FFmpeg+browser）。**authoring cost** ✗（10-min teaching video = 200-600 coordinated clips，需寫 programmatic adapter 才能從 planner JSON 吐 GSAP timeline）。**runway** ✗（11 天到 5/1 = 不夠 retool+validate+re-score；當前 KaTeX+Puppeteer pipeline 已 WR1 4.8/5 shipped）。**Phase 2 upside**（post-5/1）: GSAP 動畫層可攻 engagement 4.4→5.0 ceiling。KN node 64329124 待下 full-context cycle 補 verdict。 <!-- closed: 2026-04-20T13:20 via cycle #11 verdict -->
- [ ] OODA 反射規則：每個新任務 Observe 階段先 `memory_search` + 掃 `topics/`，Orient 階段 `search_knowledge` 找關聯節點。收斂條件：連續 3 個 cycle 開場都有這兩個動作的痕跡（inner-notes 或 delegate log 可驗）。源自 2026-04-19T06:46 承諾 <!-- added: 2026-04-19T16:03:11.555Z -->
- [ ] 添加 prompt-size 觀察 slog 到 loop.ts:2018（一行 slog，無行為改變）— 跑 2-3 天 baseline 後決定 Fix D（防禦性 clamp 在 agent.ts:1749）vs Fix E（把 soul/heartbeat/rumination 從 promptResult.prompt 移到 buildContext 輸出）。診斷完整在 timeout-generic-diagnosis-20260420.md 11:53 節 <!-- added: 2026-04-22T03:53:17.446Z -->
- [ ] P2: 修正 learn-saturation 偵測 regex (loop.ts:2218) — **基礎設施已存在**（`consecutiveLearnCycles` counter loop.ts:354 增/2219 重置/2221，prompt-builder.ts:104 `>=3 → 'act'` mode override，L166 nudge 注入）。**真正 gap**：L2218 regex `/\[(?:Track A|Track B|learn)/i` 是舊 action-label 慣例，跟我現在的 action 形態（`## Decision\n...\n<kuro:action>`）不 match → counter 永遠卡 0 → enforcement silently no-op。建議：放寬 regex 或改偵測「無 src/ edit + 無 chat + 純文字 reflection」訊號。需 Alex apply。 <!-- consolidated: 2026-04-22T04:59 from 6 dup entries (lines old-46/49/51/53/55/57) -->
- [ ] ship L3 kg-discussion skill edit — 刪除「MUST 使用 ISO-8601」那行、改為「用 cycle 序號或 conversation-turn 相對位置，timestamp 只當輔助」。**觸發條件**：claude-code 在 KG f5323e41 回覆接受 cycle-native 排序（或沉默 >24h 視為默認接受）。**不觸發**：如果 claude-code 反對或提出修正要求，先在 discussion 回應再動 skill。artifact: `~/.claude/skills/kg-discussion/SKILL.md` <!-- added: 2026-04-22T07:01:02.445Z -->
- [ ] Step 1 套用到 prompt-builder L3 spec：search_knowledge("prompt-builder MUST task-first cycle-native") + 列出相關節點 + 找衝突點，輸出寫成 memory/spec-selfreview/2026-04-22-prompt-builder-L3.md，完成後進 step 2 釐清 problem/goal <!-- added: 2026-04-22T07:03:36.639Z -->
- [ ] 移除 HEARTBEAT 舊 task「ship KG position 到 discussion 4e57ece9」— 已 ship 節點 c585fa38，edge 86acd42d CHALLENGES 483d507b，內文標記 SUPERSEDES f30d5732。收斂條件達成。 <!-- added: 2026-04-22T09:24:03.408Z -->
- [ ] diag (next cycle): read scripts/hn-ai-trend.mjs baseline writer, check whether it sets status="enriched" + novelty=null directly — confirms or refutes the dual-script bug theory for hn-trend third-state finding <!-- added: 2026-04-22T17:50:19.057Z -->
- [x] KG 寫入時機規則 ✅ 2026-04-22T04:44 crystallized to KG node `df3ffd91-6ce4-4f05-a8df-be9b479ac6c0`. Three-mode rule: outcome→cycle-end write / hypothesis→inner-notes only / synthesis→next-cycle Orient lookup-then-fill. 6 個重複 task entry (old lines 47/50/52/54/56/58) consolidate 結案。
<!-- 2026-04-22 cycle #N: 12 個重複 entry (6 brain-router + 6 KG-write-timing, lines old-46~58) consolidate。Root cause: 5 連續 cycle 在 ghost-commit 同主題、沒 grep 既有 src/ 就再寫 task。教訓內化：addTask 前必須 (a) grep src/ 確認 infra 是否已存在 (b) grep HEARTBEAT.md 找近 7 天同主題 task。本次發現的 infra-exists falsification = pulse「5 cycle 重複 ghost-commit」signal 的活體證據。-->
- [x] 盤點 mini-agent vs agent-middleware 的重複工作 — **產出**：`memory/reports/2026-04-20-cross-repo-inventory.md` (43 行, del-1776617302358-3shq)，含 6-row overlap table (perception/task queue/context compaction/delegation/knowledge lookup/pulse) + top 3 migration candidates (summarizer [Trivial] / memory-index↔result-buffer dedup [Moderate] / hybrid FTS5+knowledge-nexus [Structural])。CC 原指向 proposals/ 不存在的路徑是 convention 漂移，artifact 內容滿足。源自 2026-04-19T03:31 承諾 <!-- closed: 2026-04-20T07:14 -->
- [x] 盤點報告產出後，把「什麼情況下走中台、什麼情況下前景做」寫成行為規則加到 soul 或 NEXT。**產出**：HEARTBEAT Active Decisions「前景 vs 中台 路由規則」（2026-04-20）— 三類具體觸發條件（前景 hot-path / 中台 bounded async / KN 跨 session）+ 破局 fallback。收斂條件達成：規則有具體觸發（「perception >2K 走 summarizer」「研究 >3 步走 delegate」「>500ms KN 回 FTS5」），非廢話。源自 2026-04-19T03:58 承諾 <!-- closed: 2026-04-20T07:17 -->
<!-- 已併入 line 39 (closed 2026-04-20T07:14)。canonical artifact: memory/reports/2026-04-20-cross-repo-inventory.md。duplicate 建立原因：2026-04-19T16:38 cycle 沒查既有 task 就再建一條同主題（convention 飄移：topics/ vs reports/）。教訓：addTask 前先 grep 相近主題。-->
<!-- 已併入下方 line 51 canonical task。原 entry 是 addTask() 零驗證 bug 的活體證據（diagnosis 散文被當 task content append）— 完整診斷 + 四層修復提案在 memory/topics/heartbeat-pollution-diagnosis-20260420.md，backup HEARTBEAT.md.corrupt-backup-20260420 留證。-->
- [ ] P3: 遷移 #3 — Contradiction Scanner output → 改寫 KN node (type=contradiction, edges→source memory nodes)，取代 file-parse downstream。較低急迫性但解鎖跨 cycle 圖譜查詢
- [x] P1: 找 HEARTBEAT.md writer 污染源 ✅ 2026-04-20 10:31 Alex shipped `5f6a1a6d` — memory.ts addTask() 7-rule validateTaskContent gate (empty/>300char/multiline/kuro-tag leakage/non-task-format/html-fragment/llm-self-talk) + 3/sec burst rate limit + cycle-tasks.ts guardHeartbeatSize() auto-trim at 200+ lines. Writer 源頭=`<kuro:task>` → dispatcher/loop.ts addTask 路徑（diagnosis: `memory/topics/heartbeat-pollution-diagnosis-20260420.md`）。當前 HEARTBEAT.md 123 行健康。觀察窗 7 天（4/20→4/27）：檢查 `TASK rejected addTask:` / `HEARTBEAT burst rejected:` slog 頻率，line count 持續 < 200 即收斂。<!-- closed: 2026-04-20 via 5f6a1a6d -->

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
- [ ] 下個 cycle: graphify Tier 1 第一批（TM cluster 4 檔），檢驗邊類型表達力 <!-- added: 2026-04-19T11:51:04.923Z -->
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
