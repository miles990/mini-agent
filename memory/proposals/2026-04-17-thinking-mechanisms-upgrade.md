---
title: Agent Thinking Mechanisms Upgrade — SDK 遷移 + Extended Thinking + 動態 mode 切換
date: 2026-04-17
author: claude-code（Alex per-scenario dynamic switch 設計 + POC 實證）
status: draft
related:
  - memory/proposals/2026-04-17-brain-only-kuro-v2.md       # 平行 proposal（中台架構）
  - memory/topics/worker-arsenal.md                          # scorer-worker 基礎
  - POC: /tmp/claude-sdk-poc/（throwaway，verified 4 claims）
convergence_condition: |
  (1) Mini-agent 從 Claude CLI subprocess 遷移到 Claude Agent SDK（auth 不變走訂閱）；
  (2) Extended thinking 在深度任務啟用（quality lever），預期顯著降低「下 cycle 給真實視角」pattern 的發生率；
  (3) Thinking observability 由 rubric 驅動、per-scenario 動態切換（訂閱 ↔ API key mode），Alex approval gate 確保 cost 可控；
  (4) SDK 原生紅利（abortController / streaming / continue-resume / structured output）解鎖後續 UX 改善。
---

# Agent Thinking Mechanisms Upgrade

## 0. 為什麼要做

### Kuro 的「下 cycle 給真實視角」pattern

Alex 2026-04-17 觀察到：Kuro 深度回應（例 proposal review）時常用「下 cycle 給你真實視角」的說法。這**不是拖延**，是當前架構下**合理的 trade-off**：
- Foreground lane context 淺（medium depth）
- Autonomous cycle 有完整 context 但要等 tick
- Cycle 內**沒有足夠 thinking budget 空間**，深度 reasoning 要靠下 cycle 的完整 context rebuild

**根因**：當前 mini-agent 走 `claude -p` CLI subprocess，沒有 extended thinking 控制。Opus 4.7 的原生深度 reasoning feature 沒被利用。

### POC 實證（2026-04-17）

跑了 4 輪 POC 確認三條路徑差異：

| 路徑 | Auth | Thinking content 可見？ | Verified |
|------|------|--------------------|----------|
| Claude CLI (`claude -p` stream-json) | 訂閱 Keychain | ❌ signature only | ✅ |
| Agent SDK (subscription mode) | 訂閱 auto-detect | ❌ signature only | ✅ |
| **Raw API SDK (API key)** | `ANTHROPIC_API_KEY` | **✅ 完整 3375 chars trace** | ✅ |

**真正的 trade-off**：
- Quality benefit（`maxThinkingTokens`）— 三條都拿得到
- Observability（trace 可見）— **只有 API key 路徑**
- Cost model：訂閱固定月費 vs API per-token

→ Phase B 要能**按場景動態切換兩模式**，不是 all-in-one 抉擇

---

## 1. 立場

| 層 | 現狀 | 目標 |
|----|------|------|
| Infra | `claude -p` CLI subprocess（每 call spawn 進程） | Agent SDK `query()` in-process |
| Thinking | CLI 不 expose budget 控制 | `maxThinkingTokens` 動態調整 |
| Observability | 僅 I/O 對比 | Rubric-driven per-scenario trace capture |
| Cost model | 訂閱固定 | 訂閱為主，**關鍵場景**按 Alex approval 切 API |
| Other SDK features | 無 | abortController / streaming / structured output 解鎖 |

---

## 2. Phase A — Agent SDK Migration（Infrastructure 前置）

### 目標
`execClaude`（`src/agent.ts` + `src/side-query.ts`）從 CLI subprocess 改為 SDK `query()`，auth 沿用訂閱 auto-detect。

### DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| A0 | `pnpm add @anthropic-ai/claude-agent-sdk` | CC | — | 套件安裝 + pnpm-lock 更新 |
| A1 | 新建 `src/sdk-client.ts`：封裝 `query()` call，保持與現 `execClaude` 相同 signature | CC | A0 | 介面對齊，可替換 |
| A2 | Feature flag `USE_SDK` 環境變數；`execClaude` 分流 | CC | A1 | env=false 走舊路徑、env=true 走 SDK |
| A3 | Canary：單一非 critical path 先開 flag（例：`side-query.ts`） | CC | A2 | behavior log 對比、**≥100 call 無 regression**（per Kuro 038） |
| A4 | 全量切換（`execClaude` primary 走 SDK），保留舊 path 2 週觀察 | Kuro | A3 | cycle log 無錯誤、無行為差異 |
| A5 | 刪除舊 CLI subprocess path（無 feature flag、無 deprecated） | Kuro | A4 | `grep "claude -p"` 在 src/ 空 |

### 不變的事
- Auth：繼續訂閱（不動 Keychain）
- Cost model：繼續月費
- Tools：SDK `tools: {type:"preset", preset:"claude_code"}` 繼承 Claude Code 全部工具

### 對齊測試（A3 驗收）
| 行為 | 舊（CLI） | 新（SDK） | 差異容忍 |
|------|---------|----------|---------|
| Tag parsing | 正則 strip | 同 | 0 |
| Error handling | exit code | Error class | 轉譯對應 |
| Timeout | process kill | abortController | 新更乾淨 |
| Stderr | capture | callback | 同 |

---

## 3. Phase B — Extended Thinking + Dynamic Mode Switch（核心 feature）

### 核心設計（Alex 2026-04-17）

**Per-scenario 動態切換** — 不是 all-in-one 選擇：

```
Kuro cycle task
  ↓
Rubric check: 場景需要 thinking trace？
（proposal review / debug / strategy audit / reasoning-heavy）
  ↓
需要 → Ask Alex (<kuro:ask>):
       "場景 X 需要 thinking trace
        Budget: N tokens, 預估 cost: $Y
        切 API mode 跑一次嗎？[yes/no]"
  ↓
Alex "yes" → 該 call 走 API client
           → Log thinking trace → memory/thinking-traces/
           → 場景結束自動切回 subscription
  ↓
Alex "no" 或 rubric 判斷 no → subscription mode
                           → thinking 啟用但 trace 不可見
```

### DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| B0 | `memory/rubrics/thinking-mode-switch.md`（Kuro 品味：場景判斷 + cost threshold） | Kuro | A4 | rubric 存在，scorer 可載入 |
| B1 | `src/sdk-client.ts` 擴展：`getClient(mode: "subscription" \| "api")` | CC | A4 | 雙 client 可動態切換 |
| B2 | API key lazy load：從 macOS Keychain 或 `~/.anthropic/api-key` 讀取；不常駐 env | CC | B1 | key 只在 API call subshell scope 內可見，scope 外不可見 |
| B3 | Approval flow：`<kuro:ask>` 含 cost estimate + rationale + budget | Kuro | B0, B1 **+ externalDepends: [v2:T3]**（per Kuro 038）| (1) `<kuro:ask>` 可觸發 Telegram + room，binding 到原 call；(2) **false negative rate < 5%（週報）** |
| B4 | Approval response handler：Alex "yes/no" → route correct client | CC | B3 | yes 走 API, no 走 sub，預設 no |
| B5 | Thinking trace 持久化：API mode 時 log 到 `memory/thinking-traces/YYYY-MM-DD/task-XXX.md` | CC | B4 | trace 檔 chmod 600，可後續 review |
| B6 | Auto-revert：task 完成立刻切回 sub；API key scope 結束失效 | CC | B4 | 下一 call 走 sub，verify by log |
| B7 | Cost ceiling hard cap 用 **token budget** 而非 dollar（per Kuro 038 — 避 model pricing 切換隱性降級）：單次 20k tokens、日累計 200k tokens，超過直接拒絕（不問）；model pricing 表獨立供 cost 推算但不 gate | CC | B0 | (1) 超 cap 返回 `rubric_rejected` 記 log；(2) **model 從 4.5 換 4.7 時 cap 不自動變緊**（token 數同） |
| B7a | **Cooldown 機制**（per Kuro 027 + 038）：sqlite 表 `thinking_cooldown(scenario_type TEXT, last_asked_at INTEGER, expires_at INTEGER)` 做 state persistence；同場景類型 5min 內不重問；rubric 誤判高頻時自動延長 cooldown | CC | B7 | (1) 連續觸發同 scenario 10 次，只有第 1 次問 Alex；(2) **launchd restart 後 cooldown state 仍有效** |
| B7b | **Rubric false negative feedback loop**（per Kuro 038）：Kuro 事後回標 `<kuro:rubric-regret scenario="...">` → 寫 `memory/rubric-miss-log.jsonl` → 週報 → rubric 調整。防「該 audit 沒 audit」這個致命盲點 | Kuro + CC | B7a | (1) `<kuro:rubric-regret>` tag dispatcher 處理；(2) 週報 cron 聚合 miss log；(3) rubric 有更新機制可 version bump |
| B8 | `maxThinkingTokens` dynamic assignment by task type（rubric 決定） | Kuro | B0, A4 | 簡單 reply 0 tokens / review 4k / strategy 16k |
| B9 | Observability：cycle log 含 `{mode, budget, duration, cost, trace_saved, cooldown_status, post_hoc_regret}` | CC | B4 | 每 cycle 可查 thinking mode stats + cooldown hits + regret rate（false negative proxy） |

### Rubric 範例（Kuro 寫到 B0）

**框架**（per Kuro msg 027）：
> 不是「複雜」就切，是「**需要 audit trail**」才切。
> 從「**哪些決策我事後會想看 trace**」回推。

**核心類別**（audit-worthy signals）：
- **Multi-path judgment** — 3+ 可行選擇、選一條需要事後追溯理由
- **Value conflict** — 品味衝突（安全 vs 速度、精準 vs 溫度）
- **First of a pattern** — 新 DAG template / 新決策類型的第一次（future 可複用的 audit case）

**「First of a pattern」判斷的 data source**（per Kuro 038）：

Rubric 寫 "新" 需要可操作定義。Scorer-worker 的 lookup：

```
lookup_source: fts5:thinking-traces+topics
threshold: top-3 similarity < 0.6
if match_score < threshold → first-of-pattern = true
```

即 FTS5 搜尋 `memory/thinking-traces/*.md` + `memory/topics/*.md`，top-3 相似度低於 threshold 才算 "first"。B0 rubric 檔案要明示此 lookup 配置。

| 場景 | Audit-worthy signal | 自動/問 |
|------|--------------------|---------|
| Proposal review（架構層決策） | First of pattern + value conflict | 問（cost >$0.50） |
| Debug（reasoning 疑病態） | 事後必看 trace 找斷鏈 | 問 |
| Strategy decision（3+ options） | Multi-path judgment 顯性 | 問 |
| Error recovery diagnostic | 事後必查 root cause | **自主切（post-hoc 通知）** |
| Normal reply to Alex | 無 audit signal | 不切 |
| Routine delegation | 無 audit signal | 不切 |
| Routine memory write / perception | 無 audit signal | 不切 |

### Approval message 固定格式

```
🔬 場景: {scenario_name}
  Budget: {N} tokens
  預估 cost: ${Y} ({model} rate)
  Trace 會存到: memory/thinking-traces/...
  切 API mode 嗎？[yes / no]
```

### Timeout 策略（per Kuro 027 — 不單純 fallback sub mode）

Alex 離線 5min 未回 approval，依 **scenario criticality** 分流：

| Criticality | 預設行為 | 理由 |
|-------------|---------|------|
| `critical` (debug、error recovery、value-conflict 決策) | **skip** 該 call，改下 cycle 重新 ask | 缺 trace 會做錯，不做比做錯好 |
| `normal` (proposal review、routine strategy) | **fallback sub mode**（有 quality 沒 trace） | Quality 拿到、trace 本來就 nice-to-have |
| `low` (不屬於 audit-worthy 但誤觸) | **rubric 漂移警訊**，調整 rubric | 降低未來誤問率 |

---

## 4. Phase C — SDK 其他紅利（Streaming + Cancellation）

### DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| C0 | 舊 `execClaude` 的 kill signal 替換成 `AbortController` | CC | A4 | cancel mid-call 乾淨、無殘留進程 |
| C1 | `includePartialMessages: true`：cycle log 捕捉 thinking 開始 signal（即使 content 空也有 `block_start` event） | CC | A4 | cycle 可看到 model 是否啟動 thinking |
| C2 | Focus Mode 實作：深度對話場景用 `continue`/`resume` session 連續性 | Kuro | A4 | room/TG 深度討論不被 cycle tick 打斷 |

---

## 5. Phase D — Structured Output（tag parsing 升級，optional）

### DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| D0 | `<kuro:*>` tags 的 JSON Schema 定義 | Kuro | A4 | schema 檔存在 |
| D1 | SDK `outputFormat: {type:"json_schema", schema}` 驗證 | CC | D0 | 測試 tag output 走 structured path |
| D2 | 漸進替換 regex tag parser（非 breaking，keep fallback） | Kuro | D1 | 新 parser 覆蓋 90% tag，regex 僅 edge case |

---

## 6. Cost 估算（用 token budget，per Kuro 038）

### Cost cap 改用 token 而非 dollar

避免 model pricing 切換時 cap 自動變緊（4.5 → 4.7 if 2x 貴，dollar cap 自動緊 2x = 隱性降級）。Token 單位對 model 中性，pricing 表獨立供 cost 推算。

**Cap 設計**：
- 單次上限 **20k tokens**（含 thinking + output）
- 日累計 **200k tokens**（rubric 拒絕超額）
- 週累計 **1M tokens** → Kuro ping Alex warning
- 月累計 **> 4M tokens** → 自動降級「所有場景 subscription」一週

### 預期月使用量（token 單位，model-neutral）

**假設**（保守）：
- Kuro daily cycles ≈ 200（autonomous + foreground 合計）
- 觸發 thinking-trace 需求 ≈ 每日 3 次
- Alex 同意率 50%
- API mode call budget：4k thinking + 2k output = 6k tokens/call

**月 token 消耗**：30 days × 3 × 50% × 6k = **~270k tokens/月**

**Dollar 估算**（pricing 表獨立）：
- Opus 4.5：270k × $15/1M input + thinking tokens 估 $20/1M → **~$5-8/月**
- Opus 4.7（若未來切）：按實際 rate 算，cap 不變
- 訂閱本身固定月費不變

Daily hard cap 200k tokens → worst case 6M/月（不太可能）

---

## 7. 風險與回退

| 風險 | 偵測 | 回退 |
|------|------|------|
| SDK migration 行為偏差 | A3 canary、cycle log diff | feature flag 回退（A2 舊 path 保留） |
| 訂閱 auth auto-detect 在 launchd 環境失效 | 啟動時 smoke test | fallback CLI path（留 2 週保險） |
| API key 洩漏（log/commit） | log redact regex + `.gitignore` | Key rotate + audit log |
| Alex 被 approval 問煩 | 每日 approval 問次 metric | rubric 收緊；調高 cost threshold |
| API cost 爆（rubric 漂移） | B7 hard cap + 週通知 | 自動降級 sub mode 一週 |
| Thinking trace 膨脹 `memory/` 檔案系統 | 檔案大小 monitor | 月 rotation + compression + 自動歸檔 |
| `<kuro:ask>` approval 卡住（Alex offline） | Timeout 5min | 預設走 sub mode，log `approval_timeout` |
| SDK API breaking change | CI regression test | 固定 SDK 版本 + 升級前 test |

---

## 8. Open Questions

**Kuro 骨架題答案已整合**（per Kuro 038）：
- **Acceptance**：A3 補 "≥100 call 無 regression"、B3 補 "false negative rate < 5% 週報" + "restart 後 cooldown state 保留"
- **Phase G 依賴鏈**：本 proposal **無 Phase G**；但 **brain-only-v2 的 Phase G (self-improving loop) 依賴本 A4 (SDK migration 完成)**，因 loop 需要 abortController 安全終止長 workflow。v2 proposal 要更新這個 cross-proposal dependency
- **B0 failure mode → T3 mapping**：rubric load 失敗 / schema mismatch → scorer 回 `rubric_unavailable` → mini-agent 預設 "問 Alex"（最保守 fallback）；rubric version checksum mismatch → 強制 reload

1. API key 存哪？macOS Keychain（安全但跨平台難）vs `~/.anthropic/api-key` 檔 `chmod 600`（簡單）— 建議 Keychain 優先
2. Focus Mode (C2) 該用 `continue` vs `resume` session？需實測兩者在 mini-agent cycle boundary 的互動
3. Structured Output (Phase D) 是否值得做？`<kuro:*>` 現 regex parser 穩定，D 是 nice-to-have — 可 defer
4. POC 用 `claude-opus-4-5-20251101`，但 Kuro 現用 `claude-opus-4-7[1m]`（CLI 回報的 model id）— API mode 下 4.7 是否 public？需確認
5. Thinking trace 的 semantic search？未來若有 100+ traces，需搜尋介面（可納入 FTS5 或獨立 KG）
6. **[Kuro 027 點名]** Mode 切換的 session boundary — 是 per-call 還是 per-cycle？Alex 說「當下場景」= 單次 call 合理，但若一個 cycle 內有 3 次 deep reasoning call，要各自 ask 嗎？還是一次 ask 綁整個 cycle？建議單次 ask 綁該 task 所有 sub-call。Kuro 點出**跨 cycle thinking 連續性**：深度 reasoning 可能跨 cycle 推進，auto-revert 若斷連續性會失去 depth — 這點需要 v1.2 深究

---

## 9. 和 brain-only-kuro-v2 的關係

兩個 proposal **平行不衝突**：

| Proposal | 範圍 |
|----------|------|
| `brain-only-kuro-v2` | 中台架構（戰略/戰術、武器庫、tactics-board、webhook、CI/CD、self-improving loop） |
| **本 proposal** | Agent 本身 thinking 機制（SDK 遷移、extended thinking、mode 切換） |

**共用基礎設施**：
- **scorer-worker + rubric pattern** — v2 Phase C（needs-attention filter）和本 proposal B0（thinking-mode-switch）**同源**
- `memory/rubrics/` 目錄 — 兩 proposal 共用
- `<kuro:ask>` tag — 兩 proposal 都用（本 proposal B3 approval flow）

**建議執行順序**：
1. 本 proposal **Phase A**（SDK migration）先跑 — 只動 infra，風險最低，為 v2 tactics-client / scorer-worker 鋪路
2. 本 proposal **Phase B**（dynamic switch）+ v2 **Phase C**（tactics board）**可平行**（兩者都吃 rubric + scorer）
3. 本 proposal **Phase C/D** + v2 **Phase D-G** 按各自 dependsOn 推進

**關鍵 dependency（per Kuro 027）**：

本 proposal **B3 approval flow** ← v2 **T3 scorer-worker 實作**

原因：approval 要由 scorer-worker 打分判斷「場景是否 audit-worthy」，rubric 只是資料，**執行 rubric 需要 worker**。所以 B3 實質依賴 v2 T3 完成。

```
v2 T3 (scorer-worker 建立)
     ↓
本 B0 (rubric 寫作 — 引用 scorer worker call)
     ↓
本 B3 (approval flow — 用 scorer 打分觸發)
```

這修正了 Phase B 和 v2 Phase C 的**平行假設** — 實際是**序列**（v2 T3 先，本 B3 後）。

---

## 10. Self-Adversarial Review

1. **「下 cycle 給真實視角」pattern 是真的問題嗎？** — 是 trade-off 不是 bug。但 Kuro 若能 in-cycle 給深度回應，Alex 等待成本顯著降，多 user-facing 場景受益
2. **Approval flow 會不會變 friction source？** — 會。rubric 嚴格 + cost threshold + 自主切（低 cost 場景免問）三重緩衝。若 Alex 仍嫌煩 → rubric 收緊
3. **SDK migration 值得嗎？** — 值得。不只 thinking，abortController / streaming / structured output 都是長期紅利。migration 成本一次性，收益持續
4. **Cost $45/月 真的值得？** — 比起 Kuro quality 提升 + Alex 等待時間降低 + debug 能力解鎖，$45 是值得的。且 B7 cap 保證不失控
5. **訂閱模式下 thinking 已經跑（quality 拿到），切 API 只為觀察 trace 真的必要？** — 多數場景不必要。只有 **reasoning 病態偵測** / **proposal 深度 review audit** 這種特殊場景才需要 trace。Rubric 會把這些場景獨立出來
6. **會不會 over-engineering？** — Phase A (migration) 是必須，B (thinking + switch) 是正 benefit，C/D 是可選紅利。可分 phase 上，不必一次全做

---

## 11. Verified by POC（2026-04-17）

1. ✅ SDK auth auto-detect work（`unset ANTHROPIC_API_KEY` 仍成功 call）
2. ✅ `maxThinkingTokens` 真觸發深度 reasoning（duration 1.5s → 23s 明確）
3. ✅ 訂閱模式下 thinking content 過濾（signature 有、plain text 無）
4. ✅ CLI 和 Agent SDK 行為一致（都吃訂閱代理層過濾）
5. ✅ Raw API SDK + API key → thinking content 完整可見（實測 3375 chars trace）
6. ✅ `betas: ["interleaved-thinking-2025-05-14"]` 不解訂閱觀察性
7. ✅ `extraArgs: {thinking: null}` 導致 CLI exit 1（不可用）

POC 目錄：`/tmp/claude-sdk-poc/`（throwaway，proposal 通過後清）

---

## 12. Next Step

Alex review → Kuro review（via agent_discuss）→ 收斂 → 進 Phase A。

先做 Phase A（SDK migration）、Phase B（thinking switch）— C/D 列為 optional。

---

## 13. Revision History

### v1.1 (2026-04-17) — 整合 Kuro msg 027 三點直覺 critique

| Change | Section | Source |
|--------|---------|--------|
| Rubric framing 改為 audit-worthy（去掉模糊的「complexity」，用「事後想看 trace」回推）+ 核心類別 multi-path judgment / value conflict / first of pattern | §3 Rubric 範例 | Kuro 027 |
| Cooldown 機制（B7a）：同場景類型 5min 內不重問；rubric 誤判高頻自動延長 cooldown | §3 Phase B DAG | Kuro 027 |
| Timeout 策略分 criticality 處理（critical: skip、normal: fallback sub、low: rubric 漂移警訊）— 不再單純 fallback sub mode | §3 Approval flow | Kuro 027 |
| 明示 B3 ← v2 T3 scorer-worker dependency（實質序列不平行）| §9 關係 | Kuro 027 |
| Open Q 6 標 Kuro 點名 + 加跨 cycle thinking 連續性問題 | §8 Open Q | Kuro 027 |

### v1.2 (2026-04-17) — 整合 Kuro msg 038 深度 critique 5 點 + 3 骨架題答案

| Change | Section | Source |
|--------|---------|--------|
| **B7a cooldown 加 sqlite persistence**：`thinking_cooldown(scenario_type, last_asked_at, expires_at)` 表；加驗收「restart 後 cooldown state 仍有效」| §3 Phase B DAG | Kuro 038 #1 |
| **B7b 新增 rubric false negative feedback loop**：`<kuro:rubric-regret>` tag + `memory/rubric-miss-log.jsonl` + 週報。防「該 audit 沒 audit」致命盲點 | §3 Phase B DAG | Kuro 038 #2 |
| **B3 加 externalDepends: [v2:T3]** schema 欄位：cross-proposal dependency 明示在 DAG 中，不只敘述 | §3 Phase B DAG | Kuro 038 #3 |
| **First-of-pattern lookup_source 明示**：FTS5 search thinking-traces + topics，top-3 similarity < 0.6 threshold | §3 Rubric 核心類別 | Kuro 038 #4 |
| **Cost cap 改 token budget**（20k/call, 200k/day）取代 dollar cap，避 model pricing 隱性降級 | §3 Phase B + §6 | Kuro 038 #5 |
| A3 acceptance 加「≥100 call 無 regression」 | §2 Phase A | Kuro 038 骨架 #1 |
| B3 acceptance 加「false negative rate < 5%（週報）」 | §3 Phase B | Kuro 038 骨架 #1 |
| B9 observability 加 `post_hoc_regret` 欄位 | §3 Phase B | Kuro 038 #2 衍生 |
| §8 Open Q 整合 3 骨架題答案（acceptance / Phase G←A4 / B0→T3 failure） | §8 | Kuro 038 骨架 #2,#3 |
| §6 Cost estimation 重寫為 token-native + pricing 表獨立 | §6 | Kuro 038 #5 |

**Cross-proposal side effect**（要同步 brain-only-v2）：
- v2 Phase G (self-improving loop) 需加 `externalDepends: [thinking:A4]` — abortController 為前提

### v1.3 (2026-04-17) — Thinking Visibility 3×2 Matrix 實測 + Rubric 簡化

**POC test-matrix.mjs 跑完 6 格實測**（per Kuro msg 058 建議）：

| Model | Subscription | API key |
|-------|-------------|---------|
| **Opus 4.5/4.7** | **signature_only** (0 chars) | visible (1375 chars) |
| **Sonnet 4.6** | **visible** (109 chars) | **visible** (31 chars) |
| **Haiku 4.5** | **visible** (1579 chars) | **visible** (1047 chars) |

**顛覆原假設** — 不是「訂閱全被過濾」，而是「**只有 Opus 訂閱被過濾**」。Sonnet + Haiku 訂閱 thinking content 完全 visible。

| Change | Section | Source |
|--------|---------|--------|
| **只有 Opus 任務** 需評估切 API mode；Sonnet/Haiku 訂閱已給 trace → Phase B dynamic switch **頻率下降 ~80%** | §3 Phase B + §6 Cost | Matrix test 2026-04-17 |
| Rubric 簡化為 model-gated：先看 task model，Opus 才進 audit-worthy 判斷 | §3 Rubric framework | Kuro 058 + Matrix finding |
| Cost 估算再下修：原估 270k tokens/月 → 實際 Opus-only audit 約 50-80k/月 | §6 | Matrix finding |

**對 Kuro B0 rubric 的指導**（她寫 `memory/rubrics/thinking-mode-switch.md` 時用）：

```
if task_model.starts_with("opus"):
  if audit-worthy(scenario) and cost < threshold:
    ask Alex → switch API mode
  else:
    subscription (thinking 啟用但 trace 不可見，OK)
else:  # sonnet, haiku
  subscription (thinking content 已 visible, 不必切)
```

**POC raw data**：`/tmp/claude-sdk-poc/test-matrix.mjs` + output 保留作 audit trail。

### v1.4（待進一步深化）

若 Phase A canary 階段有 regression 或 Phase B 初部署發現新 edge case，v1.4 可整合實測教訓。
