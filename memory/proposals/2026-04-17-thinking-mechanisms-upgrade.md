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
| A3 | Canary：單一非 critical path 先開 flag（例：`side-query.ts`） | CC | A2 | behavior log 對比、無 regression |
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
| B3 | Approval flow：`<kuro:ask>` 含 cost estimate + rationale + budget | Kuro | B0, B1 | `<kuro:ask>` 可觸發 Telegram + room，binding 到原 call |
| B4 | Approval response handler：Alex "yes/no" → route correct client | CC | B3 | yes 走 API, no 走 sub，預設 no |
| B5 | Thinking trace 持久化：API mode 時 log 到 `memory/thinking-traces/YYYY-MM-DD/task-XXX.md` | CC | B4 | trace 檔 chmod 600，可後續 review |
| B6 | Auto-revert：task 完成立刻切回 sub；API key scope 結束失效 | CC | B4 | 下一 call 走 sub，verify by log |
| B7 | Cost ceiling hard cap（rubric 定）：單次 $5、日累計 $50，超過直接拒絕（不問） | CC | B0 | 超 cap 時返回 `rubric_rejected`，記 log |
| B8 | `maxThinkingTokens` dynamic assignment by task type（rubric 決定） | Kuro | B0, A4 | 簡單 reply 0 tokens / review 4k / strategy 16k |
| B9 | Observability：cycle log 含 `{mode, budget, duration, cost, trace_saved}` | CC | B4 | 每 cycle 可查 thinking mode stats |

### Rubric 範例（Kuro 寫到 B0）

| 場景 | 需 trace？ | 自動/問 |
|------|----------|---------|
| Proposal review | ✅ 強 | 問（cost >$0.50） |
| Debug cycle（reasoning 疑病態） | ✅ 強 | 問 |
| Strategy decision（3+ options） | ✅ 中 | 問 |
| Normal reply to Alex | ❌ | 不切 |
| Routine delegation | ❌ | 不切 |
| Error recovery diagnostic | ✅ 中 | **自主切（免問，post-hoc 通知）** |

### Approval message 固定格式

```
🔬 場景: {scenario_name}
  Budget: {N} tokens
  預估 cost: ${Y} ({model} rate)
  Trace 會存到: memory/thinking-traces/...
  切 API mode 嗎？[yes / no]
```

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

## 6. Cost 估算（初版，需實測校準）

### Phase B 動態切換模式下，預期月 cost

**假設**（保守）：
- Kuro daily cycles ≈ 200（估 autonomous + foreground 合計）
- Proposal review / debug / strategy 觸發 thinking-trace 需求 ≈ 每日 3 次
- 每次 Alex 同意機率 50%
- 每次 API mode call budget 4k tokens，Opus 4.5 rate ≈ $0.15 per call

**月 cost delta**：
- API mode calls: 200 days × 3 × 50% × $0.15 = **~$45/月**
- 加上 Phase A 遷移後訂閱仍為主 = **月增 ~$45**

Daily hard cap $50 → worst case $1500/月（不太可能）

**Cost ceiling 設計**（B7）：
- 單次上限 $5
- 日累計 $50（rubric 拒絕）
- 週累計 $200 → Kuro ping Alex warning
- 月累計 > $100 → 自動降級為「所有場景 subscription」一週

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

1. API key 存哪？macOS Keychain（安全但跨平台難）vs `~/.anthropic/api-key` 檔 `chmod 600`（簡單）— 建議 Keychain 優先
2. Focus Mode (C2) 該用 `continue` vs `resume` session？需實測兩者在 mini-agent cycle boundary 的互動
3. Structured Output (Phase D) 是否值得做？`<kuro:*>` 現 regex parser 穩定，D 是 nice-to-have — 可 defer
4. POC 用 `claude-opus-4-5-20251101`，但 Kuro 現用 `claude-opus-4-7[1m]`（CLI 回報的 model id）— API mode 下 4.7 是否 public？需確認
5. Thinking trace 的 semantic search？未來若有 100+ traces，需搜尋介面（可納入 FTS5 或獨立 KG）
6. Mode 切換的 session boundary — 是 per-call 還是 per-cycle？Alex 說「當下場景」= 單次 call 合理，但若一個 cycle 內有 3 次 deep reasoning call，要各自 ask 嗎？還是一次 ask 綁整個 cycle？建議單次 ask 綁該 task 所有 sub-call

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
