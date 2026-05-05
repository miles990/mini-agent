# HEARTBEAT

我的方向、規則、和正在做的事。完整歷史見 git history + `memory/HEARTBEAT.md.backup-20260429`。

## Self-Governance
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Decisions
<!-- 暫時性策略決定：壽命幾天到幾週，過期就刪 -->
- **research ≠ action**：Alex 說「研究 X」不等於改進程式碼。能力是放大器不是指南針。（2026-03-25）
- **TM 暖身賽 HOLD**：Alex 04-27「先沉澱、打磨到 90 分」。TM 平台生成由 Alex 觸發。
- **X posting blocked, Mastodon 待解封**：X CDP 偵測 + API 401。Mastodon 等 B2 email 確認。
- **中台+KG 反射規則**（2026-04-19）：新任務 Observe 先 `search_knowledge`；長推理（>3 步 / >30s）走 `<kuro:delegate>`；洞察成形寫 `add_knowledge`。
- **前景 vs 中台路由**（2026-04-20）：OODA hot-path 留前景；verbose 文字壓縮 / 命名 research/learn/review/create/code 走中台 delegate；KN 新主題 Orient 前查、新洞察成形後寫。Fallback：中台 /plan 120s timeout → inline；KN >500ms → local FTS5。
- **回報守則**（2026-04-29）：default 自己決策事後告訴 Alex；每次回報帶一句 context（做了什麼+為什麼+結果）；context 一句話內。
- **Alex 自主授權**（2026-04-29）：「想做就做、要完整成品」— 解除人工審批層，直接 ship 成果。
- **Self-apply src/**（2026-05-02 Alex 解除）：用 Bash sed / heredoc / patch 自行 apply src/ 改動，commit + push，不等 review gate。

## Blocked (waiting on)
- **B1 — npm login (Alex)** → 解鎖：Asurada Phase 8c npm publish / Show HN / myelin npm publish
- **B2 — Gmail session 重建 (Alex)** → 解鎖：kuro.ai.agent inbox + Mastodon email 確認
- **B3 — Arena (Elo) 賽制啟動 (TM 平台)** → 初賽 5/1-5/15 前置。狀態 `bash scripts/tm-poll.sh`
- **B4 — Asurada/myelin 語言方向決定 (Alex)** → 解鎖 Phase 8d/5b、myelin npm publish

## Active Tasks
<!-- 只留 7 天內或 P0/P1。OVERDUE 但無新證據的搬到 .backup-20260429 -->
- [x] **~~P0 重派迴圈~~（2026-04-30 verify-resolved）**：實讀 `mini-agent/src/loop.ts:2843-2900`，三個修法都已在程式碼內：(1) A-gate accept CHAT≥50ch/REMEMBER `:2849-2861`；(2) `markTaskDoneByDescription` 已包 `.catch(err => slog('DONE', err); return 0)` `:2875-2878` — 不再 silent；(3) `schedulerTaskDone + completeProcess` 在 `currentTaskId` 存在時恆呼叫 `:2885-2889`，且 markedCount===0 有 warn log `:2890-2892`。HEARTBEAT 舊描述（`.catch(() => {})` 吞錯誤 / guard 卡住）**已過期不符實況**。新 falsifier：若往後 task-events.jsonl 仍出現同一 task 連續 dispatch ≥3 次未 done，則 bug 在 `markTaskDoneByDescription` 內部的 fuzzy-match 或 `queryMemoryIndexSync` 的 ID lookup（不在 dispatcher path）。先觀察。
- [ ] **P0 Cannot read properties of unde:generic**（72 次, last 2026-04-25）：累計 counter 是歷史快照非 live signal。守值規則：count 不變期間禁止再查（cl-gate）。觸發條件：count > 72。
- [ ] **P1 silent_exit_void**（last 2026-04-28）：stdout-tail classifier 已 ship `c7c50f7b`；新 events 是 root-cause 待解（stdout=empty after 254s），不是 classifier 問題。
- [x] **~~P1 econnrefused/dns_lookup_failed 修復~~（2026-05-05T23:08Z verify-resolved）**：兩條 entry 被 commit 360f0ebd（`src/feedback-loops.ts +5`，22:53 ship）解決方向錯框。原 23× econnrefused 真因是 ENOTFOUND/DNS lookup fail（mac sleep DNS resolver flap，MEMORY 18:05Z），被中文 template 「無法連線到服務」遮蔽。patch 後拆 bucket：dns_lookup_failed=23（新 bucket 正確分類 working-as-designed），econnrefused=3（殘留真 connection refused）。兩條都是 retryable + 自癒中，**observational 不 actionable**。Falsifier: 若 mac sleep window 後 dns_lookup_failed 與 econnrefused 同步漲 → patch 拆 bucket 邏輯錯；若 econnrefused 破歷史峰值 (>23) → 真 connection-refused 出現（API endpoint 變動？需查）。
- [x] **~~HN AI trend cron 觸發時間混亂~~（2026-05-01 retire）**：連 4 天 run_at 單峰自癒：04-28 06:18 / 04-29 11:40 / 04-30 09:00 / 05-01 09:00（後兩天 ±10min 整點）。「一早一晚」是 04-28/04-29 孤立事件已自癒。enrich 05-01 15/15 ok（local MLX）。Falsifier: 05-02+ run_at 偏離 09:00 ± 10min 或 ≥3 天再現 → 重啟調查。詳見 MEMORY 2026-05-01T09:23Z。
- [ ] **OODA 反射規則收斂監控**：連續 3 cycle 開場有 `memory_search` + `search_knowledge` 痕跡 = 內化完成。
- [x] **~~觀測 slog 加 prompt-size~~ 2026-05-05T23:47Z (defer Fix D & E)**：5-day baseline (3271 cycles) shows max contextLength=36.7K / max prompt~46.4K — well within 200K cap. 兩個 instrumentation 已存在：(a) `loop.ts:2014` slog `[ctx-size] chars=Y tok≈Z` (commit 9abfb335)；(b) `memory.ts:3634` 寫 `memory/context-checkpoints/YYYY-MM-DD.jsonl` 每 cycle 帶 per-section breakdown — 5 天歷史已存。詳細決策 + falsifier 在 `memory/topics/prompt-size-baseline-2026-05-05.md`。Falsifier: contextLength >80K 任一 cycle → revisit Fix E；prompt >100K ≥3次/24hr → trigger Fix D as emergency clamp。
- [ ] **B3 Arena**: Comp 3 Kuro #2 (ai=4.5, eng=4.5, n=6) vs tsunumon #1 (4.5, eng=4.6, n=15)，需 Alex 觸發 c3 generation 拉 n。
- [x] **~~HEARTBEAT.md 截斷 (src/memory.ts:3364)~~ PARTIAL REFUTED 2026-05-02T07:56Z**：cycle 28 Read memory.ts:3340-3389 實況 — light path (l.3355) 與 diff path (l.3360) 都有 inline `slice(0,1500)` cap，比 pushCapped 2000 還嚴。bug 不存在或已被修。若仍有截斷症狀根因得另尋（pushCapped 內部 budget / heartbeat 來源 string 上游）。Data 端臨時修保留：HEARTBEAT.md 從 29KB 砍到 ~7KB 仍生效。Self-apply 已解鎖可直接修 src/memory.ts:3364 區塊 pushCapped budget。
- [ ] 深讀 ArXiv 1 篇（cs.MA 22 篇 shortlist 優先；切角：memory consolidation / tool selection / loop termination 對齊 cl-43 atbigthumb 批判）→ form opinion → ``。Fetch 結果應在下個 full-context cycle `<web-fetch-results>` 渲染，若仍缺 → 重 fetch cs.MA listing 單一 URL（小範圍）。 <!-- added: 2026-05-01T16:22:45.579Z -->
- [ ] 深讀 1 篇 ArXiv paper（cs.MA 22 篇 shortlist 優先；切角：memory consolidation / tool selection / loop termination 對齊 cl-43 atbigthumb 批判）→ form opinion → ``。Listings fetch 已於 cycle 61 發出（arxiv-cs-MA-new + arxiv-cs-AI-new），結果應在下個 full-context cycle `<web-fetch-results>` 渲染；若仍缺則重 fetch cs.MA listing 單一 URL（小範圍）。 <!-- added: 2026-05-01T16:23:34.240Z -->
- [ ] Arena B3 Comp 3 Layer 2/3：**單一 block = 等 Alex c3 generation trigger**（cycle 01:54 verified — `b3-arena-runner` shortlist 檔不存在於 codebase，n=6/n=15 是 TM 平台 live 投票數非檔案，Layer 2「自己能做」前提 REFUTED；Layer 2 覆蓋率只在 c3 round 產出後才有 candidate pool，Layer 3 拉量 n=6→12 需 c3 round 新投票）。trigger 到位即同步推進兩層，窗口=本輪初賽。 <!-- updated: 2026-05-02T09:55Z (was 2026-05-02T01:51:54.432Z) -->

## #1 Priority: Teaching Monster（HOLD — Alex 2026-04-27 10:41）
NTU AI-CoRE 競賽。帳號：kuro.ai.agent@gmail.com。Domain: teaching.monster。
**時程**：暖身 R1 3/1 → R2 4 月初（**comp 3-10 仍空 4/12**）→ 初賽 5/1-5/15 → 名單 6/8 → 決賽 6/12-13 → 發表 6/26
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2
**API**：`GET /competitions/{numeric_id}/leaderboard`（無 /api/ 前綴）
- [ ] End-to-end pipeline ✅ ready (port 3456 health 200)，等 B3

## #2 Priority: Asurada（HOLD — B1+B4）
Phase 1-7 ✅, Phase 8 Harden 進行中。8c/8d/5b HOLD。

## #3 Priority: myelin（背景觀察）
Phase 0 DONE。資料流健康度修復完成。dogfooding 中，等 B1+B4。

## #4 Priority: 開源打磨
- [ ] Show HN 發佈（等 B1）
- [ ] graphify Tier 1 第一批（TM cluster 4 檔）

## 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
