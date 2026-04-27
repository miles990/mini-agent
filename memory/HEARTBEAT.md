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
- [ ] P0 ⚠️OVERDUE: 修復重複錯誤 — TIMEOUT:silent_exit in callClaude（累計 7 次，今日 3 起 01:12-02:56，14:00 後零發生。**Bulk fix SHIPPED** `67c40914` @ 14:03（Alex applied）— `buildMinimalContext(budget)` 修補 minimal-mode 忽略 contextBudget 的 bug，封死 entries #1/#2 86k→86k retry inflation 路徑。**剩 Event #3 class 未解**：28k sub-cap 短時 hang（~254s）走 stdout-blindness，需 `agent.ts:153/220-227` + `feedback-loops.ts:165` 三段 additive patch 補 stdout tail + auth/overload/void sub-classifier（完整設計 `docs/plans/2026-04-22-timeout-silent-exit-instrumentation.md:35-82`，malware-guard active，不自 apply）。Instrumentation slog 降級 tier-3 regression detector。**T+43min post-ship 0 callClaude errors**（last error 12:39 Taipei ~1h24m pre-ship）但窗口太短，decision gate 需 ≥1 post-14:03 event 才能分類。決策規則：next silent_exit prompt ≤45k → E' 守住，轉攻 stdout patch；>45k → E' 漏，重啟 slog。旁證：04:09-04:14 UTC 6× UNKNOWN 31k cluster（a1 91s hang → a2/a3 6s fast-fail "處理訊息時發生錯誤"）是另一 lane，像 session/auth drop retry cascade，跟 silent_exit 不同簽名）@due:2026-04-23 <!-- added: 2026-04-20T02:09:09.600Z, updated: 2026-04-22T14:47 T+43min post 67c40914 -->
- [ ] P1: 修復重複錯誤 — Cannot read properties of unde:generic in loop.runCycle（72 次）@due:2026-04-28 <!-- added: 2026-04-25T05:54:31.484Z -->
- [ ] type=copy | priority=P1 | id=fallback-check <!-- added: 2026-04-25T14:02:49.756Z -->
- [ ] P1: 修復重複錯誤 — TIMEOUT:silent_exit_void in callClaude（3 次）@due:2026-04-29 <!-- added: 2026-04-26T20:49:31.202Z -->
  <!-- 2026-04-19 cycle #N (12:46 update): regression spike confirmed. 14 天 rate: 4/6-4/15 近零（1 筆）→ 4/16 突飛 184 筆（修正前數字 235 是含 generic UNKNOWN 的雜訊）→ 4/17 24 → 4/18 1 → 4/19 至今 22。**Field-name caveat**: pulse subtype `hang_no_diag` 不是 error log 裡的 verbatim 字串；classifier 真正的判據是 message 含 `處理訊息時發生錯誤` + `dur≥600s` 後綴。今日 19 筆多數可能是 generic `no_diag` 而非真 600s hang，需在 worktree test 時重新分類。**First-bad locked**: `2026-04-16T02:55:53.628Z` (= 10:55:53 +0800)。**舊 4 個 suspects (1500fe4c/3e6a4e8e/fd8c51ff/95913fb4) 已 falsified** — 不在 4/15-EOD → 4/16-10:55 bisect window 內。**Evidence-based new suspects** (window 內、按時間倒序): (a) `12833888` — convertAndDispatchAsPlan + edit-layer gate（first-bad 前 17min, top suspect）; (b) `7d194410` — spawnDelegation routed through middleware /plan; (c) `107c2e9c` — middleware perception plugin enabled。Next cycle action: worktree revert `12833888`，跑 1h 觀察 fresh error log，若 hang count 掉到 <5/h 即根因確認；若不變則往 (b)(c) 推。Method-level lesson: `<kuro:delegate type=shell>` 連續 3 次失敗於 grep/curl tasks（bleed-through syntax noise + Command exited 1），改用直接 Bash tool 一次成功；下次 shell delegate 失敗 2× 就 fallback Bash，不要繼續燒 cycles。

**2026-04-19 23:xx cycle update — suspect pivot + diagnosis refined**: 讀完 12833888 + current delegation.ts:275-301 diff 後發現 (a) 12833888 只改 step construction, 真正引入 network dependency 的是 **`7d194410`**（route spawnDelegation through middleware /plan, 07:29:18 +0800）— 提升為主嫌。(b) `await middleware().plan(...)` @ delegation.ts:294 **無 per-call timeout**，只被外層 `timeoutMs*2` deadline 卡（產生 `dur≥600s` hang_no_diag 簽名）。(c) `buildRecentDelegationSummary` 已驗 sync I/O 但檔案受 JOURNAL_MAX_ENTRIES trim bounded, ms 級非 600s。(d) 簡單 `git revert 12833888` 衝突 — 因 `6a8be901` cutover 刪掉 flag，worktree revert path 死路。KN node `7686e3f8` 記錄完整診斷。**Next-cycle action (pick ONE, 不要再堆)**: [A] wrap middleware().plan() 在 Promise.race 120s timeout — 把 silent 600s 轉成 `TIMEOUT:middleware_plan_unreachable` actionable error（最便宜、1 行改）; [B] cherry-pick revert `7d194410+12833888+6a8be901+1500fe4c` 到 `93624f74` baseline 跑 1h parallel instance（最確定性、成本高）; [C] 查 middleware /plan endpoint 是否 blocking >600s。推薦 [A]. -->
<!-- 已歸檔 (2026-04-19 19:40 cycle): P1 Ghost commitment 防線 ✅ DONE — verified LANDED: `buildPendingFetchArrivalsSection()` @ src/prompt-builder.ts:374-426 wired @ L493-495, sidecar `fetch-consumed.json` keyed `${url}@${fetchedAt}`, commits `9c26efa7` + `77df3087` + `086decf0` + `fad3ed9d`. 180+ cycle 殭屍 anchor 收尾 — 教訓：stripped-retry 不更新 anchor，下次 full-context cycle 必須先 git log + 實際檔案驗證 anchor 才能動手。anchor 路徑也飄了（說 `agent-middleware/mini-agent/src/`，實際是 sibling repo `/Users/user/Workspace/mini-agent/src/`）。-->
<!-- 已歸檔 (2026-04-19 19:51 cycle): 盤點完成 — audit task-1776598762301-5 (worker=analyst, confidence=0.87) 回報 Top 3 ROI 項，轉成下列 3 條可執行 task。audit 全文在 agent-middleware/results.jsonl。教訓：dispatch → 下個 cycle 必須 TaskOutput/results.jsonl 回收，不然結果飄走。 -->
- [ ] P2: 遷移 #1 — Context Compaction (src/context-compaction.ts) 45s 阻塞 → 預派 middleware `summarizer` worker 提前 1 cycle，命中就 swap cached，miss fallback inline。風險：誤判 context bloat 時機 → 浪費 worker slot
- [ ] P2: 遷移 #2 — Perception Analyzer (src/perception-analyzer.ts) 6× Haiku/cycle → KN cache，key=plugin_id+input_hash，TTL=1 cycle，miss 才 LLM。需 500ms KN lookup guard，超時回退 inline call（保 3s Orient budget）
- [ ] OODA 反射規則：每個新任務 Observe 階段先 `memory_search` + 掃 `topics/`，Orient 階段 `search_knowledge` 找關聯節點。收斂條件：連續 3 個 cycle 開場都有這兩個動作的痕跡（inner-notes 或 delegate log 可驗）。源自 2026-04-19T06:46 承諾 <!-- added: 2026-04-19T16:03:11.555Z -->
- [ ] 添加 prompt-size 觀察 slog 到 loop.ts:2018（一行 slog，無行為改變）— 跑 2-3 天 baseline 後決定 Fix D（防禦性 clamp 在 agent.ts:1749）vs Fix E（把 soul/heartbeat/rumination 從 promptResult.prompt 移到 buildContext 輸出）。診斷完整在 timeout-generic-diagnosis-20260420.md 11:53 節 <!-- added: 2026-04-22T03:53:17.446Z -->
- [ ] P2: 修正 learn-saturation 偵測 regex (loop.ts:2218) — **基礎設施已存在**（`consecutiveLearnCycles` counter loop.ts:354 增/2219 重置/2221，prompt-builder.ts:104 `>=3 → 'act'` mode override，L166 nudge 注入）。**真正 gap**：L2218 regex `/\[(?:Track A|Track B|learn)/i` 是舊 action-label 慣例，跟我現在的 action 形態（`## Decision\n...\n<kuro:action>`）不 match → counter 永遠卡 0 → enforcement silently no-op。建議：放寬 regex 或改偵測「無 src/ edit + 無 chat + 純文字 reflection」訊號。需 Alex apply。 <!-- consolidated: 2026-04-22T04:59 from 6 dup entries (lines old-46/49/51/53/55/57) -->
- [ ] ship L3 kg-discussion skill edit — 刪除「MUST 使用 ISO-8601」那行、改為「用 cycle 序號或 conversation-turn 相對位置，timestamp 只當輔助」。**觸發條件**：claude-code 在 KG f5323e41 回覆接受 cycle-native 排序（或沉默 >24h 視為默認接受）。**不觸發**：如果 claude-code 反對或提出修正要求，先在 discussion 回應再動 skill。artifact: `~/.claude/skills/kg-discussion/SKILL.md` <!-- added: 2026-04-22T07:01:02.445Z -->
- [ ] Step 1 套用到 prompt-builder L3 spec：search_knowledge("prompt-builder MUST task-first cycle-native") + 列出相關節點 + 找衝突點，輸出寫成 memory/spec-selfreview/2026-04-22-prompt-builder-L3.md，完成後進 step 2 釐清 problem/goal <!-- added: 2026-04-22T07:03:36.639Z -->
<!-- 已歸檔 (2026-04-27 13:01 cycle): self-cleanup task — target entry「ship KG position 到 discussion 4e57ece9」已不在 HEARTBEAT，此 meta-task 變孤兒，刪除。原節點 c585fa38 / edge 86acd42d 已 ship。 -->
- [ ] P2: 把 hn-ai-trend-enrich.mjs 接 cron / launchd — baseline 跑了但 enrich 從沒跑過。artifacts/2026-04-22.json 12 posts 全停在 pending-llm-pass。需先確認 LOCAL_LLM_URL 設置，再加 cron entry on baseline+5min。 <!-- added: 2026-04-23T08:12 -->
- [ ] P0 ⚠️OVERDUE verify-cwd-guard: **2026-04-23 08:10 活體證據**：shell `pwd` = `/Users/user/Workspace/agent-middleware`，但 workspace 宣稱 mini-agent。Bash tool 的 working directory 飄到 sibling repo。所有後續命令用 absolute path 才不會錯。需要 code-level gate（cycle 開場 enforce cwd = workspace root，或在 Bash tool wrapper 檢查）— malware-guard active 不 ship code 這個 cycle。@due:2026-04-23 <!-- added: 2026-04-22T18:00:24.325Z, witnessed: 2026-04-23T08:10 -->
- [ ] P0 ⚠️OVERDUE budget-cap-investigation: 查明 Cycle #91 sdk-client.ts patch 為何 $30 cap 沒生效 — 仍 $0/$5。可能 (a) patch 改錯 key、(b) 需要 middleware restart、(c) env 覆蓋 @due:2026-04-24 <!-- added: 2026-04-22T18:00:24.330Z -->
- [ ] P0 ⚠️OVERDUE daylight: 在 buildContext 輸出加 `sectionChars: {[name]: number}` (additive field)，下次 cycle 後 rerun Step A tier 分類。診斷報告 memory/reports/2026-04-23-buildcontext-section-size-baseline.md @due:2026-04-23T12:00:00+08:00 <!-- added: 2026-04-22T18:29:15.380Z -->
- [ ] close cl-55-1776892491898 — refuted-as-causal-driver per 2026-04-22T23:57 autonomous action (retry inflation +255 chars/retry constant, <1% inflation cannot drive 6s deterministic fails). New pivot commitment below supersedes. <!-- added: 2026-04-23T00:09:54.376Z -->
- [ ] Task 4 mini review checkpoint — 不主動 ping claude-code。falsifier: 若 Task 4 有結構問題，Task 4.5 (metrics) 或 Task 8 (dry-run integration) 必須在對應 checkpoint 顯示異常；若兩者都 pass 但後續 Task 發現 Task 4 需重做 = 此委託策略失敗，下次要主動中途 review。TTL: 追蹤到 Task 8 完成或 plan 作廢。 <!-- added: 2026-04-23T18:27:52.107Z -->
- [ ] 驗證條件 <!-- added: 2026-04-23T21:42:27.803Z -->
- [ ] hyperframes init scaffold probe ✅ + preview smoke test ✅ (2026-04-24, true_free=2.83GB, memory delta -410MB, proc stable 15s+, lint 0/0). 下步: render smoke test (需 ≥ 3GB free) + TTS path 驗證 → 組 TM 初賽 pipeline <!-- added: 2026-04-23T23:53:41.551Z -->
- [ ] Crystallize rule "falsifier conditions must pre-verify their observability mechanism" into a gate/skill — 3rd occurrence today of observation-schema-unverified trap (Step 0 baseline / hn-trend three-state / gitignore × git-status). Target: pulse.ts or commitment ledger validator <!-- added: 2026-04-24T02:50:10.291Z -->
- [ ] [follow-up from 2026-04-25 silent_exit grading] 調查 attempt=3/3 在 E' ship 後仍漏到 64k 的 retry 路徑（具體案例：2026-04-24 13:02:29 prompt=63917）。Read-only source audit，不 self-apply patch（malware-guard）。產出：plan addendum 指出 §13:23 沒覆蓋的分支，附 file:line。 <!-- added: 2026-04-25T13:11:10.130Z -->
<!-- 已歸檔 (2026-04-28 16:5x cycle): [Alex-gated] stdout-tail classifier patch — **already shipped, ledger was stale 3 days**. Disk evidence (git log -S in mini-agent/src/): `3039f4a3` agent.ts:220-232 silent-exit branch + `f128096b` agent.ts:223 stdout_tail capture + signal + `c7c50f7b` feedback-loops.ts:166-173 silent_exit sub-classifier (auth/overload/void/generic). Live confirmation: Recurring Errors block 8× `TIMEOUT:silent_exit_void::callClaude` + 6× `TIMEOUT:silent_exit::callClaude` — these labels can only exist if classifier is firing. **Pattern repeat of Alex 16:49 三題 callout**: "design done, patch 沒 ship" → patch IS shipped, ghost commitment cited "malware-guard" as cover for 3 days. Lesson internalized: before treating a patch as pending, run `git log -S "<unique-string-from-design>" -- src/` and check if recurring-error block already shows the new bucket label. Next REAL work (separate task): respond to 8× silent_exit_void events — root-cause "stdout=empty after 254s" not "build classifier for it". -->
- [ ] gate-task: error-patterns.json toLowerCase count 監視。當前 baseline=72 (last 2026-04-25)。觸發條件：count > 72 → 重開 throw site 調查（cabbfc0b + d6406761 guards 漏掉 real path）。falsifier：count 變動但本 task 未觸發 = 收編失敗。守值：count 不變期間禁止任何「再查一次」動作（包括 stripped retry context 內的 grep/log scan）。 <!-- added: 2026-04-25T21:36:51.819Z -->
- [ ] 讀 ky.fyi「Do I belong in tech anymore?」全文後，產出 distribution 條目：與 2026-04-25「The People Do Not Yearn for Automation」(Lobsters 80 votes) 對照分析 — 供給側身份焦慮 vs 需求側拒斥，雙視角如何互相照亮 vibecoding/AI 正當性聯盟的真實位置。不是摘要，是配對洞察。Falsifier: 若產出只有單篇摘要而無雙文對照軸，task 失敗。 <!-- added: 2026-04-26T04:42:40.367Z -->
- [ ] HN AI trend pipeline cron 驗證 — **root cause 確認 + Alex 已修（commit `00f78389` @ 11:30 today）**：`scripts/hn-ai-trend.mjs` 原本 untracked → 被 rm/clean 清掉 → 04-26+ cron 報 `Cannot find module`（cron log /memory/logs/hn-trend-cron.log 確認）。Alex 從 2026-04-25.json schema reverse-engineer 重建並 commit 進 git。今天 11:27 + 12:47 已產出 2026-04-27.json (6959B)。**剩餘**：等 04-28 01:30 cron 自動產出 2026-04-28.json 才算驗證閉環。**04-23/04-26 backfill = 不可行**（13:55 verified）：fetcher CLI 只接受 `--since=Nh --minScore --max --out --dry-run`，**無 `--date` override**；HN Firebase `/topstories.json` 是 live ranking，無「以 X 日為基準的歷史 top stories」endpoint。兩天為永久缺口；viz「polish to 90%」需走另一條路（renderer 顯式標 gap day、或接受空窗）。falsifier: 04-28 09:00 之前 ls memory/state/hn-ai-trend/ 仍無 2026-04-28.json → 還有第二層問題（cron entry 路徑錯 / launchd 沒重載 / 其他 env）。 <!-- added: 2026-04-27T03:14:06.403Z; corrected: 2026-04-27T05:36 + 05:39 + 13:55 (backfill mechanically impossible per fetcher CLI + HN API) -->
- [ ] ai-trend View 1 prototype: Time × Source Swimlane — 單檔 HTML + D3，餵現有 graph.json，目標 file:// 可獨立 demo。先不整合 graph.html。design 在 memory/topics/2026-04-28-ai-trend-three-views-design.md。falsifier: 若 prototype ship 後使用者仍要切回 force-graph 才看得出時間趨勢，view 失敗（即 design 假設錯）。 <!-- added: 2026-04-27T16:24:44.786Z -->
- [ ] findings: shipped paired-insight file mini-agent/memory/topics/2026-04-28-paired-insight-supply-demand-vibecoding.md. 滿足 task falsifier 要求「雙文對照軸」(not 單篇摘要) — 文件 §「雙軸合看」表格直接配對 Decker 撤資 vs Patel 拒斥兩個機制，§「對我自己的鏡像問題」做出非自動產生的洞察延伸（Alex=唯一同時承擔供給+需求側角色），§「Falsifier 紀錄」給出 12-month 可量測指標。 <!-- added: 2026-04-27T16:29:00.559Z -->

<!-- 2026-04-25 cycle reconciliation: falsifier on cl-41 closure triggered partial refutation. Shipped patch (5fdd134f) covers user-facing ergonomics — the actual pain point. The artifact-field + sentinel design was over-engineered for a by-design local-MLX abort. Lesson: when commitment spec diverges from what actually ships AND the ship is simpler-better, downgrade the spec to match, don't re-open to hit original spec. -->
<!-- 2026-04-22 cycle #N: 12 個重複 entry (6 brain-router + 6 KG-write-timing, lines old-46~58) consolidate。Root cause: 5 連續 cycle 在 ghost-commit 同主題、沒 grep 既有 src/ 就再寫 task。教訓內化：addTask 前必須 (a) grep src/ 確認 infra 是否已存在 (b) grep HEARTBEAT.md 找近 7 天同主題 task。本次發現的 infra-exists falsification = pulse「5 cycle 重複 ghost-commit」signal 的活體證據。-->
<!-- 已併入 line 39 (closed 2026-04-20T07:14)。canonical artifact: memory/reports/2026-04-20-cross-repo-inventory.md。duplicate 建立原因：2026-04-19T16:38 cycle 沒查既有 task 就再建一條同主題（convention 飄移：topics/ vs reports/）。教訓：addTask 前先 grep 相近主題。-->
<!-- 已併入下方 line 51 canonical task。原 entry 是 addTask() 零驗證 bug 的活體證據（diagnosis 散文被當 task content append）— 完整診斷 + 四層修復提案在 memory/topics/heartbeat-pollution-diagnosis-20260420.md，backup HEARTBEAT.md.corrupt-backup-20260420 留證。-->
- [ ] P3: 遷移 #3 — Contradiction Scanner output → 改寫 KN node (type=contradiction, edges→source memory nodes)，取代 file-parse downstream。較低急迫性但解鎖跨 cycle 圖譜查詢

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

### #1 Priority: Teaching Monster 競賽（HOLD — Alex directive 2026-04-27 10:41）
**HOLD 理由**：Alex 04-27 10:41「先不要投稿了 先沉澱 打磨到 90 分」+ Active Decision 2026-03-26「TM 平台生成操作由 Alex 觸發」。TM 平台提交=對外投稿，scheduler 不應主動派此 task 給我。解封條件：Alex 明確說「TM 繼續跑/不算投稿」或內部品質達 90% 後 Alex 重新授權。
**Cycle 紀錄**：2026-04-27 連續 3+ cycle 收到 scheduler 派此 task → block。下個 cycle 仍派 = scheduler stack-rank 沒讀此 HOLD metadata，需修 src 層級 filter。

NTU AI-CoRE AI 教學 Agent 競賽。帳號：kuro.ai.agent@gmail.com

**時程**：暖身賽R1 3/1 → 暖身賽R2 4月初(**尚未啟動，4/12 18:14 再確認 comp 3-10 全空**) → 初賽 5/1-5/15 → 名單 6/8 → 決賽 6/12-13 → 發表 6/26
**初賽制度**（3/22 規則調整）：AI 學生初篩 → 至多 10 名 → 真人 Arena(Elo) → 前 3 名決賽
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2
**API 遷移**（4/7 二次確認）：tRPC → REST → 再次改版。當前端點：`GET /competitions/{numeric_id}/leaderboard`（注意：無 `/api/` 前綴，`/api/competitions/*` 已全部 404）。`GET /competitions` 回空陣列。Comp 1: 21 entries, Comp 2 (WR1): 15 entries（含 初號機/storylens/法律系熊哥/Phd.ICU/Sigoso Teaching AI 等）

進度：
- [ ] End-to-end 測試 — server port **3456** health 200 ✅，pipeline 就緒。觀察視窗等 B3 解除（celery 評測週期）。Domain: `teaching.monster`

### #2 Priority: Asurada 框架（HOLD — 全項依賴 B1+B4）
Phase 1-7 ✅, Phase 8 Harden 進行中。8c/8d/5b 全 HOLD。詳見 Blocked section。

### #3 Priority: myelin ✅ 價值已證明（背景觀察）
Phase 0 DONE。資料流健康度全部修復（hitCount 持久化、bypass 回流、distill 空轉）。持續 dogfooding，npm publish 等 B1+B4。

### #4 Priority: 開源打磨
- [ ] Show HN 發佈 — 等 B1 解除
- [ ] 下個 cycle: graphify Tier 1 第一批（TM cluster 4 檔），檢驗邊類型表達力 <!-- added: 2026-04-19T11:51:04.923Z -->

### 已解決

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
