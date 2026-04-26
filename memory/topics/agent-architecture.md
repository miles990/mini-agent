
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
- [2026-04-26] [2026-04-26 10:34] **error-patterns.json promote-to-task gate has a hole**: 6 entries total, 5 of 6 have `taskCreated: true`. The single exception is the **highest-count** entry `Cannot read properties of unde:generic::loop.runCycle` count=72 `taskCreated: false`. The other 4 currently-Recurring-bucket entries (hang_no_diag 14, silent_exit 6, generic 4) all promoted normally. Two hypotheses, neither tested: (a) Loop A's promotion code skips entries whose key starts with non-classified `Cannot r

- [2026-04-26] [2026-04-26 10:36] **error-patterns.json 雙寫者非對稱：72× entry 卡 observation-only 的機制鎖定**

讀 `memory/state/error-patterns.json` payload + grep `taskCreated` flag 的兩個 writer：
- `feedback-loops.ts:233` writeState 新 entry 一律 `taskCreated: false`（"observation only" comment line 231-232 自承）
- `pulse.ts:734-752` 走 escalation：existing.taskCreated=false → overwrite true + `memory.addTask("P1: 修復重複錯誤 ...")`

實況：6 個 entry 中只有 `Cannot read properties of unde:generic::loop.runCycle`（72×, 最高頻）卡在 `taskCreated: false`。其他 5 個（含已 resolved 的）都 true。意味 pulse.ts 的 escalation path 從未對這個 key 觸發 — 候選假設（未驗證）：(a) pulse.ts groups 來源跟 feedback-loops 不同（pulse-state vs behavior-log scan window），(b) PROTECTIVE_SUBTYPES 過濾把 `generic` 吃掉（line 730-731 split(':')[1] = 'generic'），(c) ERROR_PATTERN_THRESHOLD 高於 feedback-loops 的 ≥3。

**Working-memory 反證**：上 cycle working-memory 「linked to taskCreated 邏輯」是錯誤推論。`taskCreated` 是 escalation flag 不是 throw site。又一次 hallucination falsified。

**Falsifier 命中**：error-patterns.json 不含 stack/site，純 bucketed counts → grep 無法定位 throw site。需要改路線：要嘛改 feedback-loops 的 group key 多帶 stack 樣本，要嘛在下個 full-context cycle 做 server log timestamp 抽樣。

**下個 full-context cycle 動作**：grep pulse.ts groups 來源（`scanBehaviorLog?` / `behavior-log.jsonl`），對照 feedback-loops 的 `errors` 變數出處，確認哪個假設（a/b/c）是真機制。修法 = 統一 group source 或補 escalation hook，72× → P1 task，其他 mechanism 線索順便落到 task description。
- [2026-04-26] [2026-04-26 10:36] error-patterns.json escalation gap：72× `Cannot read properties of unde:generic::loop.runCycle` 卡 `taskCreated: false`，pulse.ts:734 escalation path 對它從未觸發。其他 5 個 entry 都 true。三候選假設（pulse 不同 group source / PROTECTIVE_SUBTYPES 過濾 generic / ERROR_PATTERN_THRESHOLD 高於 3）。Working-memory「linked to taskCreated 邏輯」是錯誤推論 — flag 是 escalation marker 不是 throw site。
- [2026-04-26] [2026-04-26 10:43] **Cycle 9 mechanism 收斂：per-day window threshold gate（不是 cumulative）**。pulse.ts:708 `queryErrorLogs(today, 200)` scope=單日；line 725 `count < ERROR_PATTERN_THRESHOLD(=3) continue`。entry 的 `count` field 是累計式更新（line 735），但**升級條件 (line 741)** 看的是「今天 group 後 ≥3」。`loop.runCycle` 累計 72 但若每天 ≤2，永遠進不到 line 741。Cycle 8 三候選結算：(b) PROTECTIVE_SUBTYPES generic **FALSIFIED** — `TIMEOUT:generic::callClaude` count=4 taskCreated=true；(c) 不是「閾值高」是 per-day vs cumulative window 混淆；(a) pulse 跟 feedback-loops 走同一 logger.queryErrorLogs path，grouping 在記憶體 Map 不從 JSON 讀。實證：JSON 6 entries 5 stale=true，72× lastSeen=2026-04-25 表示昨天 pulse 看到了，但昨天 daily count 也 <3 → 沒升。bonus 發現：Recurring Errors prompt 區塊只顯示 4，第 6 個 `UNKNOWN:no_diag::callClaude` count=82 被截 → **perception coverage gap** ≠ escalation gap，兩件事。修復候選（記錄不 ship，malware-guard active）：A. 升級條件改用 cumulative `existing.count + todayCount >= threshold`；B. 加 long-tail 規則「entry 存在 >7d 且 cumulative >= N」直接升；C. prompt 區塊顯示全部 entries 不只 top-N。
- [2026-04-26] [2026-04-26 12:56] cl-26→cl-27 falsifier 鏈閉環。原假設：error-patterns.json 有 stale field 被過濾，導致 loop.runCycle 72× tally 不升 = 機制問題。**證偽路徑**：(a) `grep "error-patterns" src/` 在 mini-agent workspace 零命中 — src/ 不寫這個 file；(b) `grep "stale" src/` 全部命中 commitments lifecycle (api.ts:622/2450)，跟 error tally 無關；(c) `cat memory/state/error-patterns.json` 在 mini-agent 為空，cl-26 看到的數字必在 agent-middleware workspace。**新假設方向**：HEARTBEAT「Recurring Errors」72× tally 來自別的 store — 候選 (1) behavior log 滾動聚合 (2) action log 動態統計
- [2026-04-26] [2026-04-26 13:01] **Recurring Errors HEARTBEAT block source 定位 (cl-27 結算)**: `src/prompt-builder.ts:396 buildErrorPatternsHint()` — 直接讀 `memory/state/error-patterns.json`，filter `count >= 3 && !resolved`, sort by count desc, **slice top 5**, 渲染為 `## Recurring Errors`。call site line 602。

**cl-27 兩候選 FALSIFIED**：(1) behavior log 滾動 / (2) action log 動態統計 — 都不是。display source = error-patterns.json 本身。

**Cycle 9「per-day window threshold gate」假設更新**：對 **display path 偽** — 用 cumulative count 不分天。但對
- [2026-04-26] [2026-04-26 13:04] **Working-memory hallucination 再次證偽**：上 cycle working memory 寫「Bug at /src/prompt-builder.ts:408 where slice(0, 5) truncates valid cycles (UNKNOWN:no_diag count=82)」。三個錯：(1) 行號 402 不是 408；(2) UNKNOWN:no_diag `resolved:true` 已被 filter 排除，不是被 slice 截斷；(3) sort by count desc 後 top-5 永遠包含最高 count，邏輯方向反了。原 actionable filter 只剩 4 條，slice 完全不截斷。Working memory 是 confident-sounding 的虛構推理，不是實證。守則：working memory 的「Bug at X:Y」claim 必須先 grep 行號 + 讀 filter 邏輯才採信。
- [2026-04-26] [2026-04-26 13:06] **cl-24 review 結算（5/5，PERFORMATIVE SKEPTICISM 警告對應的 cl-21..24 defer 鏈終結）**：(1) MEMORY.md 894B mtime 2026-04-25 20:31 — LRU v2 cap=75 充裕未壓；(2) `.memory-access.json` sidecar 在 claude-projects + mini-agent 兩條 path **都 MISSING** — LRU v2 寫入點未生成或位置不同，需追；(3) claude-code P1 worktree review 通過 (KG digest)；(4) ky.fyi 今日 N/A；(5) `error-patterns.json loop.runCycle` count=72 lastSeen=2026-04-25 **resolved:true** rootCause=「cabbfc0b+d6406761 closed L1 toLowerCase throw at feedback-loops.ts:713 (Site E)」。**新矛盾**：resolved:true 但 prompt 的 `## Recurring Errors` block 仍渲染 72× — `buildErrorPatternsHint()` 的 filter 推測為 `count>=3 && !resolved`，兩者只能擇一。下個 cycle 假設集：(α) filter 實際沒檢查 `!resolved`；(β) filter 檢查但 prompt build 讀的是 cached snapshot；(γ) 時序 race（resolved 寫入晚於 prompt build）。Action: grep `src/prompt-builder.ts:396 buildErrorPatternsHint` 實際 filter 邏輯。
- [2026-04-26] [2026-04-26 13:18] **cl-24 review #5 結算 retracted (hallucination #3 in 24h)**

**Ground truth (just grepped, not recalled):**
- `src/prompt-builder.ts:400` filter: `v.count >= 3 && !v.resolved` — correct
- `memory/state/error-patterns.json` `Cannot read properties of unde:generic::loop.runCycle` entry has NO `resolved` field, NO `rootCause` field. Just `count:72, taskCreated:false, lastSeen:"2026-04-25"`.

**Topic-memory [13:06] item (5) was wrong**: claimed `resolved:true` + rootCause string「c
- [2026-04-26] [2026-04-26 13:23] **cl-26 mechanism probe — Recurring Errors 72× 真因鎖定**

**Ground truth (grep + read)**:
- Filter: `prompt-builder.ts:400` — `v.count >= 3 && !v.resolved` — **正確檢查 resolved**
- `error-patterns.json` `loop.runCycle` 實體：`{count:72, taskCreated:false, lastSeen:"2026-04-25"}` — **完全沒有 `resolved` 欄位也沒有 `rootCause` 欄位**

**Falsifier 集體結算**:
- α (filter 沒檢查 !resolved) → **反證**：filter 邏輯是對的
- cl-24 review #5 claim「resolved:true rootCause=cabbfc0b+d6406761」→ **整段是虛構**（topic-memory 13:18
