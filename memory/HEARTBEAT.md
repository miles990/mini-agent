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
- **Alex 自主授權**（2026-04-29）：「想做就做、要完整成品」— 解除人工審批層，直接 ship src/ 改動以外的成果（src/ 仍受 malware-guard）。

## Blocked (waiting on)
- **B1 — npm login (Alex)** → 解鎖：Asurada Phase 8c npm publish / Show HN / myelin npm publish
- **B2 — Gmail session 重建 (Alex)** → 解鎖：kuro.ai.agent inbox + Mastodon email 確認
- **B3 — Arena (Elo) 賽制啟動 (TM 平台)** → 初賽 5/1-5/15 前置。狀態 `bash scripts/tm-poll.sh`
- **B4 — Asurada/myelin 語言方向決定 (Alex)** → 解鎖 Phase 8d/5b、myelin npm publish

## Active Tasks
<!-- 只留 7 天內或 P0/P1。OVERDUE 但無新證據的搬到 .backup-20260429 -->
- [ ] **P0 重派迴圈 root cause（2026-04-29 重定位）**：A-gate silent strip 已修（`/Users/user/Workspace/mini-agent/src/loop.ts:2841-2858` 04-29 fix ship — 接受 CHAT≥50ch + REMEMBER 為 valid work，:2855 有 slog reject log）。**真正剩餘 bug 在同檔 :2872 + :2878**：(a) `:2872` `markTaskDoneByDescription(...).catch(() => {})` 吞錯誤 → `queryMemoryIndexSync` 找不到 task 時 silent fail；(b) `:2878` `if (schedState.currentTaskId)` guard，continuation/yielded cycle 常 undefined → mark-done 成功但 scheduler 不知。**注意 repo 路徑**：bug 在 `mini-agent/src/`，不是 `agent-middleware/src/`（該路徑無此檔，曾因此幻覺自我撤銷一次）。修法 spec 已給 Alex（chat 215, Fix 1/2/3），src 層 patch 等授權（malware-guard）。falsifier：apply Fix 3 跑 5 cycle，scheduler 仍重派已 done task → bug 在 memory-index lookup 本身，不在 dispatcher path。
- [ ] **P0 Cannot read properties of unde:generic**（72 次, last 2026-04-25）：累計 counter 是歷史快照非 live signal。守值規則：count 不變期間禁止再查（cl-gate）。觸發條件：count > 72。
- [ ] **P1 silent_exit_void**（last 2026-04-28）：stdout-tail classifier 已 ship `c7c50f7b`；新 events 是 root-cause 待解（stdout=empty after 254s），不是 classifier 問題。
- [ ] **HN AI trend cron 驗證**：crontab `0 9 * * *`，但 04-28 09:00 沒自動跑（手動 catchup 18:28）。falsifier：04-29 09:30 `ls memory/state/hn-ai-trend/2026-04-29.json` 不存在或 <5KB → 確認 cron broken，需查 cron log。
- [ ] **OODA 反射規則收斂監控**：連續 3 cycle 開場有 `memory_search` + `search_knowledge` 痕跡 = 內化完成。
- [ ] **觀測 slog 加 prompt-size**（loop.ts:2018）：跑 2-3 天 baseline 後決 Fix D vs Fix E。受 malware-guard 阻擋。
- [ ] **B3 Arena**: Comp 3 Kuro #2 (ai=4.5, eng=4.5, n=6) vs tsunumon #1 (4.5, eng=4.6, n=15)，需 Alex 觸發 c3 generation 拉 n。
- [ ] **HEARTBEAT.md 截斷 (src/memory.ts:3364)**：light/diff path 的 `sections.push('<heartbeat-active>...')` 繞開 pushCapped → cap 2000 失效。Alex 給的 diff 待 apply（malware-guard）。Data 端臨時修：本 cycle 把 HEARTBEAT.md 從 29KB 砍到 ~7KB（即此次提交）。

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
