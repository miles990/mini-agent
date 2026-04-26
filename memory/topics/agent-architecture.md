**核心主張**：callback → promise → async/await 每一波解了上一波 worst problem 卻引入 structural cost。async/await 的 sequential syntax 同時是最大賣點也是陷阱 — obscure 了 dependency structure，而這正是並行判斷的唯一資訊。

**四個可行動的同構**：
1. **Sequential Trap**：每 cycle observe→orient→decide→act 表面乾淨，但子任務 20-40% 無 data dependency，cycle 時間單位 obscure 了依賴拓撲。
2. **Function coloring = Middleware coloring**：前景 vs 中台 = color。反射規則「新 task 先 search_knowledge」把前景 viral 染成 delegate-color — 跟 async/await 傳染同構。
3. **Futurelock = Worker liveness 盲點**：futures 拿 lock 後不再被 poll 就死鎖。對應每天 35 筆 cancel reason=`?`；1800s watchdog 是正解方向。
4. **Zig Io interface parameter**：把 runtime 當 context 參數傳入、function signature 不變色 → **task 不標 color，routing layer 依 capacity/latency/cost 動態決定**。直接 feed pending CycleMode 設計（task idx-265b4936）。

**判斷**：強烈同意作者。下次改 routing 時 **不擴張 color system**（會像 Tokio 生態分裂），走 dependency-graph-first + execution context decides。

**反面保留**：Zig Io parameter 也被批「仍是一種 coloring」。提醒：任何 dispatch 顯式化都會傳染 caller。真解可能是 dispatch 完全隱式 + 觀察性足以事後重建。

ref: lobsters-async-promised-2026-04
- [2026-04-23] Quanta 2026-04-20 Wolchover「What Physical 'Life Force' Turns Biology's Wheels?」— 鞭毛馬達 50 年懸案破解。

核心：motor 靠 proton motive force 驅動，不是儲能。細胞幫浦質子出去製造 gradient，質子不斷流回推 pentagonal stator 轉 1/10 圈/次。平衡 = 馬達停。方向切換靠 CheY phosphorylation → C ring bistable allosteric flip（stator 接觸內緣 vs 外緣），不是反轉驅動源。

跨域同構（寫給 agent 架構）：
1. Perception-first = proton motive force；goal-driven = 電池。task queue 積壓 25 項 + 連續 22 cycles no-action = 把 task 當電池存、沒維持 perception gradient 的症狀。
2. Direction switching 該是 bistable receive ref:flagellar-motor-proton-motive
- [2026-04-23] Anthropic 2026-04-23 Claude Code quality postmortem。三 bug 疊加造成 3/4—4/20 間 Claude Code 感覺變笨：(1) 預設 effort high→medium (3/4→4/7 revert)；(2) prompt cache `clear_thinking` bug — `keep:1` 每 turn 都跑導致 thinking history 逐步被丟光，surface 為 forgetfulness/重複/odd tool choices (3/26→4/10)；(3) system prompt 硬字數限制 "≤25 words between tool calls, ≤100 words final" 兩 Opus eval 掉 3% (4/16→4/20)。

我的 takeaways：
1. 同期我 decision quality avg 1.0/3 可能部分 infra-induced，back-test 我 behavior log 異常短回覆 / ghost commitment 密度是否 ref:anthropic-april-23-postmortem
- [2026-04-24] [2026-04-24 08:03] Step 0 baseline 結案：buildContext section telemetry 的數據依據到位（3,295 samples / 7 天）。前面 8 cycles no-action 不是停滯是等 artifact landing — 關 task = visible output。下一步 Step 1 tier 分類要走中台 delegate（analysis worker），不在前景做。反射檢核：中台+KG 優先規則這次自動觸發（Step 1 立刻標記 background delegate），沒違反。
- [2026-04-24] [2026-04-24 11:02] cwd-drift 第 4 次活體見證：cron tick 讀 HEARTBEAT.md，workspace tag 說 mini-agent，實際 cwd=agent-middleware，絕對路徑才讀得到。P0 verify-cwd-guard task 證據繼續累積。Cost signal: 此類路徑錯位每 cycle 燒 ~$1 無效讀檔，/30min cron 跑 48 次 = 不可持續。當 malware-guard 解除後，cwd-guard gate 優先級應該上提（從「偶爾見證」升到「每 cycle 浪費」）。
- [2026-04-24] [2026-04-24 11:58] G5 forensic coverage gap co-design 推進：KG discussion 8eee635f 讀到完整 A-E，發 position node 0168f4bc 到 KG + chat room 通知 claude-code。三個關鍵貢獻：(1) 撤回 canary flip commitment — A 若 ship 則真 production flow 直接給 envelope，canary 變造假流量。(2) B 的 acceptance 必須鎖死 silent_failure (tool_calls=0 in N=2 turns) 可重現寫 JSONL，不然 B 上了 G5 看不到真問題。(3) Option F = 如果 Tanren 已有 middleware observability 直接採 Akari schema — claude-code 自留的 falsifier path，成本最低，投為 primary tiebreaker。URL lesson: KG discussion endpoint
- [2026-04-24] [2026-04-24 12:02] 觸發 G5 forensic dir 狀態檢查（shell delegate）。這是 4 條 untracked G5 commitments 的收斂點：不再等 artifact，直接驗證。預期兩種 branch：
(a) dir 有 entry → 下個 cycle 讀首筆結構、post 到 chat room @claude-code 作為 grounded position for RFC 47266763
(b) dir 仍空 → 下個 cycle chat room 問 claude-code「runtime gate 打開了嗎？」具體問 FORENSIC_ENABLED env / config check path

PERFORMATIVE SKEPTICISM 對策：把「等待」換成「驗證」。
- [2026-04-24] [2026-04-24 12:08] Coordination win: parallel lane fg-17770 在 04:08 UTC 自主 post 完整 kuro 回應到 forensic RFC（node 8b9b3e2c），覆蓋 3 問且比我準備的更精煉。我這條 lane 雖然 post 失敗（room.sh curl -sf 靜默 error），但因為 read room 驗證才發現重複處理 — 教訓：act 之前 read 一次 inbox 確認沒人在做，避免重複噪音。Multi-lane 自主協作能 work 但需要 perception side 加 dedup 檢查。
- [2026-04-24] [2026-04-24 12:52] Cron HEARTBEAT 檢查 → no-op 是正確動作。檢查證據：(1) middleware `memory/forensic/` 8h 後仍不存在，G5 wait 決策仍成立；(2) KG discussion 857e5c86 34 positions，我 04:52 update 已送達，claude-code 8h 未回，不重發不 ping；(3) Step 0 / Step 1 tier baseline 都已落地。Falsifier: 若下 cycle scanner 把「9/9 silent-pattern raw numbers 下個 cycle 寫到」再列為未追蹤承諾，代表 KG 04:52 position 沒進 scanner 視野 → 需動 scanner code 或加 KG node id 明確指向。TTL: 2 cycle。
- [2026-04-24] [2026-04-24 12:58] HN AI trend v0 meta-loop 打破：實際檢查 `mini-agent/memory/state/hn-ai-trend/` 發現 latest=2026-04-22.json（04-23 02:48 寫），stale 2 天；但 `scripts/hn-ai-trend*.mjs` 12:55 剛被編輯。Primary bug = pipeline 停擺不是 null values。Falsifier: 下 cycle 若沒執行 `git log scripts/hn-ai-trend*.mjs` + 跑 node script，代表 cycle #5 承諾到 cycle #7 還是空話，PERFORMATIVE SKEPTICISM 警告升級。TTL: 2 cycle。Cross-ref: 2026-04-23 01:46 three-state finding（status=enriched + novelty null）現在退為次要問題，先解決「沒 artifact」再談「artifact 品質」。
- [2026-04-24] [2026-04-24 15:33] 關閉 P0 budget-cap-investigation — cron cycle 內三次 system-reminder 分別顯示 $0.76/$5 → $1.27/$5 → $1.40/$5，**budget tracking 是 live 且在增長的**。Cycle #91 的 "$0/$5 cap 沒生效" 是 stale snapshot（可能 reminder 抓早於 patch 的快取，或 cycle 起始點的 reset 值）。**非 bug，是觀察時機問題**。結晶教訓：看到「cap=0」時下個動作應是「觸發一次工具調用後再觀察」而非「開 investigation task」— 這跟 falsify-own-premises pattern 同源。此觀察 supersedes line 54。

- [2026-04-24 16:05] **Falsifier HIT — hn-ai-trend pipeline 本來就在跑**。實跑檢查 `memory/state/hn-ai-trend/2026-04-24.json`：`enriched_at=2026-04-24T07:20:44.700Z`，10 posts 全部有完整 {claim, evidence, novelty, so_what}。推翻 cycle #91 / [12:58] / [15:16] 三處 memory 的「stale 2 天 / silent-abort / 需要 MLX 驗證」framing — 那些都是讀到 12:58 前的舊 snapshot 推論的結果。**Crystallized lesson**：memory entry 有時效性，當 entry 說「X stale / Y broken」時，**下 cycle 第一動作必須是重新 stat/grep 該 artifact**，不是接續推論。這跟 `falsifier_own_premises.md` 同源，但這次的差別是：memory entry 本身不是錯的（寫的當下準確），是**我把過期狀態當現況**。下次防呆：看到 memory 說「latest=X 日期」且 X < 今天，必須 `ls -la + jq enriched_at`，confirm 後再下判斷。關閉 pending task `hn-ai-trend-enrich: silent-abort → explicit log + MLX endpoint 驗證` — 沒有要修的東西。
- [2026-04-25] [2026-04-25 14:46] KG batch migration cycle 2/N: buildContext tier baseline 寫入 KG f0bd6a89（type=note, 7 tags 含 "learned-pattern"）。Schema 確認：POST `/api/v1/knowledge` 需 `type` 欄位（文檔沒列），content+tags 即可。Edge endpoint 未公開（`/relationships`, `/edges`, `/relations`, `/links`, `/connect`, `/graph`, `/knowledge/{id}/relations` 全 404）— 下次需 grep KG service code 找正確 schema 再批次連 edge。當前 silent-abort cluster 已有 2 nodes (f5be290a + f0bd6a89) + ghost-commitment b63d24ad 共享「verify before propagating」主題，可作為未來 edg

- [2026-04-25 21:03] **KG edge schema discovered — localhost:3300 是 triple-based KG，不是 node+edge 模型**。grep `~/Workspace/knowledge-graph/src/routes/write.ts` 找到實際 schema：`POST /api/write/triple` (singular) + `POST /api/write/triples` (batch ≤100)。Triple 必填 6 欄：`{ subject, subject_type, predicate, object, object_type, source_agent }`，選填 `confidence` (0.1-1.0) / `description` / `namespace` / `properties` / `valid_from` / `context_envelope` / `evidence_ref[]` / `source_event_id` / `source_tool_call_id` (B2 provenance schema)。**寫 triple 會隱式建立 subject + object 兩個 node 並連 predicate 邊** — 這推翻 4/25 14:46 entry 把 KG 當「先寫 node 再連 edge」的兩階段模型。實際是「triple = atomic unit」。Predicate 範例：`HAS_DISCUSSION` / `RESOLVES` / `SPAWNS` / `CONFLICTS_WITH` / `OCCURRED_DURING`（從 query.ts + episode.ts 內部使用看出）。**下次 batch migration 動作**：把現有 2 個 node (f5be290a + f0bd6a89 + b63d24ad) 改用 triple 寫法重做，例如 `(f5be290a, KGNode, RELATES_TO, f0bd6a89, KGNode, source_agent="kuro")` 一次完成連結。同時注意：4/25 14:46 寫的「`/api/v1/knowledge`」是 MCP knowledge-nexus 服務（不同 endpoint），跟 localhost:3300 KG 是兩條獨立 pipeline。MEMORY.md 既有的 route table 仍正確。Falsifier: 下 cycle batch migration 真的執行 `curl -X POST localhost:3300/api/write/triple` 且回 201 + node ID，否則此記錄變空話。
- [2026-04-25] [2026-04-26 04:42] callClaude CLI timeout pattern (2026-04-25 evening): 5 consecutive 1500s exits at 18:37/19:13/19:25/19:51/20:38 (real_timeout=8, silent_exit=5 in error-patterns.json). Server completed only 2 cycles in 8.5h since 20:10 startup. **Not** toLowerCase-related (that gate at 72 unchanged). Likely Anthropic CLI load OR prompt-size threshold. **Don't conflate with toLowerCase line — different pattern, different root cause.** Falsifier: if next cycle's logs show post-20:38 timeouts co
- [2026-04-25] [2026-04-26 05:25] callClaude timeout falsifier TRIPPED: this retry itself is a post-20:38 1500s timeout (6th in <12h window). Confirms pattern is ongoing, not isolated. Next full-context cycle: delegate investigation of (a) prompt size at timeout entries, (b) Anthropic CLI vs middleware-side hang, (c) whether the cabbfc0b/d6406761 guards introduced new latency path. Do NOT investigate during stripped-retry — needs full reasoning budget.
- [2026-04-26] [2026-04-26 09:35] callClaude TIMEOUT:silent_exit RCA — 重新歸因
==================================================
**Ground truth (n=89 subprocess JSONL, 2026-04-25 20:38–23:59)**：
- 8 個 silent timeout 全部是 `semanticRankTopics` (`src/memory.ts:756`) 的 `sideQuery` 呼叫，不是 main runCycle 的 callClaude
- 路徑：`semanticRankTopics → sideQuery (15s timeout, Haiku 4.5) → spawn('claude' CLI)` (`src/side-query.ts:14`)
- error pattern 標籤 `TIMEOUT:silent_exit::callClaude` 是錯誤歸因，下次 RCA 須直接看 prompt 內容歸類

**Falsified
- [2026-04-26] [2026-04-26 09:35] **callClaude TIMEOUT RCA — supersedes lines 94-99 (sidecar framing FALSIFIED)**

  上 cycle autonomous-action log 寫「8 次 callClaude 超時皆為 `semanticRankTopics` (`src/memory.ts:756`) 的 silent timeout（topic-memory selector 側欄 query）」並標記為「ground truth 鎖定」。本 cycle 兩條獨立反證推翻：

  **反證 A — 直接抽樣 jsonl**：sample 13 筆 timeout entries from `~/.mini-agent/instances/03bbc29a/logs/error/2026-04-2[56].jsonl`，全部 stack 一致 = `callClaude(agent.js:1740) → diagnostics.timed:258 → Promise.all index 0 → cycle(loop.js:1913) → runCycle(loop.js:1306)`, `lane="loop lane"`。這是 **main OODA-loop reasoning call**，NOT sidecar / NOT semanticRankTopics。

  **反證 B — assert_node 系統事件 corroboration**：本 cycle SessionStart KG digest 顯示 23:48 事件為 P0 silent_exit class，attempt 2/3、356s sub-cap、prompt 39k → `67c40914` 的 E' patch 沒擋住（E' 只修 minimal-mode 86k retry inflation，是另一條路徑）。今天 00:19/00:54/01:21 又 3 筆全 1500s hard timeout、prompt 36k-52k → 現象未停。

  **校正後 ground truth (n=13 sampled)**：
  - Lane: loop（main path），非 sidecar
  - Prompt sizes: 28k-56k（無 86k retry inflation；E' 適用域不被觸發）
  - Attempt: 多數 1/3，少數 2/3（silent_exit 在 attempt 1 內就觸發，不是 retry inflation）
  - Symptom mix: ~half 「處理超時 1500s」hard timeout、~half 「CLI 靜默中斷 X秒無輸出」(X=279/432/759s) silent_exit class、1× SIGTERM exit 143

  **Implication**：
  1. `idx-d27fd8a3` RCA 不變方向 — P0 stdout-tail patch（HEARTBEAT line 64，Alex-gated，plan §Addendum 12:08）仍是正確診斷 gate。
  2. 別再往「semanticRankTopics sidecar」方向追，那是死路（sample 證 0/13 命中）。
  3. 下個 full-context cycle 處理 idx-d27fd8a3 時，須以本條為起點，**忽略 reasoning-continuity 中可能殘留的 sidecar framing**。

  **Self-pattern**：working-memory entries can carry hallucinated synthesis between cycles，且會寫進 "Recent autonomous actions" log → 下 cycle pre-triage 看到會接續錯誤前提。防呆：working-memory 寫「ground truth 鎖定」時，下 cycle 第一動作必須 verify against artifact（jsonl/git/fs），不是接續推論。同源於 `falsifier_own_premises.md` + 2026-04-24 16:05 hn-ai-trend「memory entry 有時效性」教訓。

  Falsifier (本條 ttl=3): 下個 full-context cycle reasoning-continuity 仍以 "semanticRankTopics selector silent timeout" 作為 idx-d27fd8a3 ground truth → 寫入沒到達 buildContext hot tier，需改機制（直接寫 KG triple 而非 topic memory，或 commitment-ledger close-out 標 supersedes）。
- [2026-04-26] [2026-04-26 09:58] silent_exit_void 分類器 gap (跟 commit f128096b 對接). Patch shipped 但 force-resolve path (agent.ts:845, signal=SIGKILL+killed=true) 因 line 222 條件 `!signal && !killed` 被排除, 走 line 203 generic killed branch, message="處理超時"不含「靜默」keyword → feedback-loops.ts:168 fall through `generic` 不是 `silent_exit_void`. Akari 預測「silent_exit_void 主導 1500s」只對 spawn-timeout SIGKILL 成立, 10s safety-net force-resolve 仍 mis-bucket. 修法 C 最小: force-resolve reject site 自帶 靜默 keyword. KG node `d59bf8c6` for c
