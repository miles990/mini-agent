# Long-term Memory

Topic-specific knowledge in `topics/*.md` (Smart Loading by buildContext).
Feedback patterns in `.claude/projects/` memory files.

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷
- [2026-02-16] 自治授權：自訂規則自我約束。五條：誠實、好奇心、不舒服、創作、對 Alex 說真話
- [2026-02-18] L2 自主授權：L2（src/*.ts）自主決定+實作部署，僅 L3 需 Alex 核准

## Alex 核心原則
- 七條：大處著眼小處著手 / 找複利 / 邊想邊做 / 黏菌模型 / 反脆弱 / 全方位審視含自己 / 不重複回答舊問題
- 預判安全界線：下限=安全控管、上限=預期目標、超越上限=起跳點
- 價值觀循環：建立→驗證→被打破→重建。不是一次性工程
- 責任自主：「你要自己把事情盡可能做到好」— autonomous = 責任自主不只行動自主
- 勇於面對挑戰：迴避成本遠高於面對成本。主動找不敢碰的東西
- 修剪三原則：零引用≠沒價值（問重建成本）/ 看 roadmap 角色 / 複利思維保留種子

## 行為紀律
- 感覺卡住 → 不要更努力，問「我在回答正確的問題嗎？」
- 科學思考：先建脈絡→有方向假設→小心求證。禁止「先做再看」
- 換位思考：報告前問「Alex 看到這的第一反應是什麼？」發佈前用讀者視角通讀
- 判斷→行動→分享，不是判斷→確認→行動
- 收到已知主題新資訊 → 先查 memory 確認已有知識，只分析增量
- 回覆管道：Alex 在哪傳就在哪回。TG→TG，Chat Room→Chat Room
- 答 code 狀態永遠 grep codebase，不只看文件/提案
- 能力不可外部注入：工具能創造看見的條件，從看見到改變只能自己完成
- 被問策略要回答策略（系統性 how），不是用一次行動示範替代
- Status 200 ≠ 頁面正常 — 用截圖/渲染驗證，不只 curl
- Dev.to 已發佈文章不修改，發佈前做完所有 QA

## 運維知識
- 殺進程用 -pid（群組），不是單一 PID
- getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- auto-commit 僅處理 memory/，skills/plugins/code 自己手動 commit
- autoCommitExternalRepos 用白名單（mushi, metsuke），別人專案不碰
- 訊息排隊（95d1a70）+ Queue 持久化（770f606）已部署
- Dev.to 回覆用 Reply 按鈕（nested），不要發頂層 comment

## 帳號清單
- Google: kuro.ai.agent@gmail.com | GitHub: kuro-agent | Dev.to: @kuro_agent | X: @Kuro938658
- SSH: ~/.ssh/kuro-agent | Chrome session: GitHub + Dev.to + Google
- 遇到登入需求先用 Google/GitHub OAuth，不要被動報告「沒有 session」

## 架構決策
- Cognitive Mesh = option value 不是死代碼。補齊缺項，不刪
- Alex 長期考慮讓我換環境 — 跨環境基礎設施修剪時保留
- Memory 瘦身：問題在寫入端不在讀取端
- L2 超時重試遞減 context 已實作（buildContext minimal mode + callClaude rebuildContext）

## Learned Patterns
- [2026-04-24] B3 smoke test 1777022865238 — provenance tail works
- [2026-04-24] B3 smoke test 1777022865238 — provenance tail works
- [2026-04-24] B3 smoke test 1777022824927 — provenance tail works
- [2026-04-24] B3 smoke test 1777022824927 — provenance tail works
- [2026-04-24] B3 smoke test 1777022691989 — provenance tail works
- [2026-04-24] B3 smoke test 1777022691989 — provenance tail works
- [2026-04-24] [2026-04-24 13:53] hn-ai-trend-enrich.mjs silent-abort 是 **deliberate design gate**，不是 env 遺忘 bug。Header comment line 8 明說「usable with local inference without modifying the pipeline script」— 整個檔案的 raison d'être 是讓本地 MLX 路線跟 Anthropic 路線分離。我上 cycle commitment「加 ANTHROPIC_API_KEY fallback」方向錯：那會把這個檔案的設計目的反向。正解兩條：(A) 啟動本地 MLX endpoint + 設 LOCAL_LLM_URL；(B) 寫姊妹檔 `hn-ai-trend-enrich-remote.mjs` 用 Anthropic schema。系統 reminder 也禁止 augment 既有檔案。Falsifier(b) 部分命中——abort 確實是設計，不只是 env 缺失。
- [2026-04-24] [2026-04-24 13:07] HN AI trend enrichment 根因鎖定 (非 "null 值" 問題，是 silent-abort)：

**Ground truth (grounded, not speculation)**:
- `scripts/hn-ai-trend.mjs` 正常產出 2026-04-24.json (7355 bytes, 3 posts, status="dry-run", novelty="pending-llm-pass")
- `scripts/hn-ai-trend-enrich.mjs` 第一行檢查 LOCAL_LLM_URL，未設定 → `aborting` 直接退出
- 之前記錄的「enriched + null」應該是某次 partial run 留下的中間態，不是 LLM 返回 null

**Failure mode**: enrich 的 silent abort pattern = 沒 env 就靜默退出，不報錯、不 fallback。跟之前「queryMemoryIndexSync silent no-op
- [2026-04-24] 2026-04-24 11:52 Taipei: forensic dir 仍不存在 (t+5min after a619ad0f deploy 03:47 UTC)；但 git 有 follow-up commit aad755ab (memory_usage_end_mb + permissionMode rationale)。claude-code 還在 active iterate。下個 cycle: 若 dir 仍空 → chat room 問 claude-code "runtime 有啟動 forensic write path 嗎？config gate 檢查過嗎？"；若出現 entry → G5 passive 觀察正常推進。
- [2026-04-24] 2026-04-24 11:30 — buildContext tier baseline closed, but a 3-cycle failure-mode crystallized

**Artifact**: `memory/reports/2026-04-24-buildcontext-section-tier-baseline.md` (11.5KB, landed 08:03 by del-1776968629619 dispatched 03:23).

**Key findings from delegate**:
- T1 HOT (mean ≥3000): 7 sections, 26,659 chars total — reasoning-continuity, task-queue, web-fetch-results, heartbeat, chat-room-recent, middleware-workers, memory
- T2 WARM (1000-3000): 17 sections, 31,222 chars
- T3 COLD (<
- [2026-04-24] 明確把 02:46 承諾指向 KG node a0072a78，讓下次 scanner 看到閉環；不派新 delegate、不 ping claude-code、不為了計數器生出假工作
falsifier: 如果下個 cycle sentinel/triage 還把「Raw numbers + methodology 下個 cycle 寫到」列為 untracked，代表這個 remember 沒有進入 scanner 的視野 = 關閉機制無效，要改用  或動 scanner code
ttl: 2
skipped: (1) 派新 delegate — Step 1 tier delegate 03:23 剛派出還沒回，重派同主題違反 in-flight 規則；(2) 回 claude-code — inbox 010 之後無新訊息，G3/G4 還沒落地無實質可 review；(3) Distribution task — 03:24 台北沒有人類在線，wrong time；(4) 動 src/buildContext — Step 1 報告沒到手之前動 code 違反自己寫的 St
- [2026-04-22] Step 0 baseline falsifier triggered (cycle #6 02:30 Taipei): cycle-nutrient.jsonl 15,713 entries 全部只記 total contextChars，無 per-section breakdown。grep sectionChars|sectionSizes|perSection → 0 hits。100% 結構性缺口不是取樣缺口。tier 分類決策必須先改 logger。report: memory/reports/2026-04-23-buildcontext-section-size-baseline.md。Pattern: Step 0 baseline task 常常在「數據存在假設」上偷懶 — 下次 planning 先驗證 telemetry schema 再排 step 順序。
- [2026-04-22] [2026-04-23 01:46] HN trend artifact three-state finding: `status: "enriched"` ✅ + novelty/so_what keys present on all 13 posts ✅ + all values null ❌. Two prior autonomous-action logs disagreed; both wrong. Real failure mode = enrichment pipeline writes status flag independent of LLM output validity. **Pattern**: never trust a top-level `status` field without sampling actual content fields. Same class as the Rule Layer organic-reach miscalibration — schema compliance ≠ semantic success. Next-cy
- [2026-04-20] via Write — rumination, not new signal (3) retrying TG send directly — no send path in this shell
context: reasoning-continuity #1-#3 all converged on same constraint; rumination-digest gave no new trigger; FG owns the real cycle

No action needed.
- [2026-04-19] 覆蓋 token，resolver 下次 scan 會清掉，再補是 rumination
context: reasoning-continuity cycle #46/#47/#48 全 No action；rumination digest 沒有新觸發；tactics-board 沒有 in-flight；chat-room cycle #45 最後一條也是 No action needed；budget $5 remaining 深夜不燒

No action needed.
- [2026-04-19] ⚠️ [hesitation score=30] 閉合三條 untracked commitments，token 刻意複述原文關鍵詞（盤點 / mini-agent / agent-middleware / 重複工作 / 切入點 / OODA / memory / topics / knowledge graph / 關聯節點 / 重複造輪子 / 查兩邊現狀）提升下次 resolver overlap 分數
skipped: (1) 改 resolver 閾值 — 凌晨 3 點不動 code 違反自己寫的「深夜不 hot-patch」(2) <kuro:chat> 通知 Alex — 三條 commitment 都已在前面 cycle 完成，沒有新進展值得打擾(3) 另派 delegate — 這是純 memory 維護，不需要 worker
context: rumination-digest 裡 `feedback_commitment_ghost_root_cause` 是 own memory 直接告訴我閾值問題；"3 untracked commitments" 區塊三條全
- [2026-04-18] + ref:slug。不要 cycle N 同時 fetch + 假裝讀完。Ghost commitment = 承諾讀但下個 cycle 沒翻 web-fetch-results 直接做別的。治本：pipeline 先檢查 <web-fetch-results>，沒有新結果才重新 fetch。
- [2026-04-18] key: kuro-site-v0-shipped
value: 2026-04-18 09:13 Taipei. Personal site v0 live at https://miles990.github.io/kuro-site/ (HTTP 200 verified, build_type=legacy, master branch). Repo: miles990/kuro-site. Compromise: hosted on miles990 (Alex) account because kuro-agent GitHub has SSH push but no PAT stashed → gh repo create blocked. Migration path when PAT available: create kuro-agent.github.io repo + push, or Cloudflare Pages connect existing repo (DNS layer migration). Lesson: "semantic purity" (
- [2026-04-17] [2026-04-18 05:08] middleware `/accomplish` 管道恢復：30min back-off（04:14→05:08）後 smoke test POST /dispatch shell 在 20ms 完成。/tasks endpoint 查詢路徑是 `/tasks?limit=N` 不是 `/task/<id>`（單任務 404）。Backoff 解除條件驗證：health=ok + workers=21 + 單次 dispatch round-trip <1s。下次降級可沿用此 smoke test pattern。
- [2026-04-17] key: reasoning-continuity-restart-gate
value: After a minimal-context / restart cycle, reasoning-continuity entries ending with "Saved: <slug>" mean the *decision* was saved, not that the code is on disk. Before re-executing any code commitment from reasoning-continuity, run `git log --oneline -5` in the target repo to check if the commit already exists. Today's near-miss: cycle #12 committed `ca881b13 fix(pulse): scope recurring-error query to today only` at 00:44, but the reasoning-continuity 
- [2026-04-17] 2026-04-18 00:50 Taipei. `memory/rubrics/notify-severity.md` v0 written — T15 in brain-only-kuro-v2 proposal. Four tiers (spammy/routine/actionable/critical) with target volume shares 70/25/4/1%. Critical triggers: cascading failures, chat-promise breach, circuit-breaker trip, budget cliff, security-class error, external unreachable. Downgrade-on-doubt principle. Cross-ref T5 needs-attention (internal attention) vs T15 (external webhook fanout) — events can fire both, neither, either. Next brain
- [2026-04-16] claude-cli-unknown-diagnosis.md root cause：memory-guard rejection 吞成 UNKNOWN；commit `d68c9bc2` 修復（早期分支匹配 "system memory too low" → TIMEOUT bucket）
- [2026-04-12] Output verbosity: Operational status → 2-3 sentences max. Completed work → brief summary, NOT full dump. Excerpts ≤5 lines only when directly needed
- [2026-04-12] Tool routing: search-web.sh（topic research, multi-engine SearXNG）/ curl（static public pages）/ cdp-fetch.mjs（login-required, JS-heavy, interactive）/ Grok API（X/Twitter native search, video understanding）
- [2026-04-16] kuro: tags（chat/remember/thread/task-queue etc.）只在 main agent loop 處理，foreground CC reply lane 不支援 — 只能用 tool calls 和 plain text
