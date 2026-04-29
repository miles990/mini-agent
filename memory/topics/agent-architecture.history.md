
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
