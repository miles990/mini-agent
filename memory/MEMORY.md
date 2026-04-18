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
