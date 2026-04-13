# Proposal: Token 優化根本做法 — Constraint Texture × AgentOpt × Middleware

**Date**: 2026-04-13
**Author**: Claude Code（Alex 發起，分析整合自 Explore agent + Kuro Primary + Kuro specialist-research + 量測發現）
**Effort**: Stage 0 (L1 · 30 行 diff) → ③ (L1) → ② (L2) → ① (L3)
**Status**: Revised 2026-04-13 — 量測發現翻轉部分方向，等 Kuro Primary review

## 修訂摘要（Revision Log）

- **v1 (初稿)**：Constraint Texture × AgentOpt × Middleware，三個槓桿點 ①②③ 按複利順序
- **v2 (Kuro Primary 反饋)**：順序是依賴鏈 ③→②→①；P0b 不是 bug；補 3 個漏點（memory keyword extraction、cron gate、cascade.ts）
- **v3 (Kuro specialist handoff)**：引入 Cache Stability 作為根本層切入點
- **v4 (量測 M1-M4)**：發現 Kuro **完全沒追蹤 cache usage**；`-p` 模式可能不適用 Anthropic caching；引入 Stage 0 前置動作

## 動機

Alex 要求：找 mini-agent 省 token 的根本做法，條件是「不影響且反而提升品質和完整性」。排除表面優化（砍字、提高 cap）。

交叉三個輸入：
1. Kuro 的 **Constraint Texture pattern**（CLAUDE.md）— prescription vs convergence
2. arxiv **2604.06296（AgentOpt v0.1）** — client-side 模型選擇搜尋，成本差距可達 13-32×
3. mini-agent 現況：已有 `omlx-gate.ts`（8 個替換點）、`preprocess.ts`（P0b/c/d）、`agent-middleware`（多 provider DAG plan）

## 核心洞察

**你已經有所有零件，缺的是把它們接成閉環。**

現有的 8 個 oMLX 替換點是**手工佈線** — 憑直覺放，沒 evaluator，沒反饋，沒人知道哪個點真正省 token、哪個點正在犧牲品質。AgentOpt 論文切到的正是這件事：**client-side 模型路由應該被視為搜尋問題**，不是工程直覺問題。

## 實測 Context 組成（估算）

| Section | 大小 | 佔比 |
|---|---|---|
| SOUL (full mode) | ~8K | 32% |
| HEARTBEAT + MEMORY | ~6K | 24% |
| Topics (keyword matched) | ~10K | 40% |
| Perception plugins ×7-8 | 4K-28K | 浮動最大 |
| **典型 cycle prompt** | **~25-40K chars** | — |

最大浮動和最不透明的是 perception 段落。

## 三個根本槓桿點（按複利順序）

### ① Cycle 拆 stage → agent-middleware 做模型路由（最高複利 · L3）

**現狀**：`prompt-builder.ts` 組巨型 prompt 一次打給 Opus。Perception parsing、觸發判斷、策略推理、tag 格式化全在一次推理內完成。

**做法**（Constraint Texture 的直接應用）：
- Stage 1 *感知摘要* → Haiku / 0.8B（P0b 已有雛形但 optional）
- Stage 2 *觸發判斷 / dedup* → mushi / 0.8B（已有）
- Stage 3 *策略推理* → Opus（核心，只收乾淨訊號）
- Stage 4 *tag 格式化 / 動作輸出* → Haiku

agent-middleware 的 `brain.ts + sdk-provider + local-provider + google-provider`
就是 AgentOpt 論文要的 multi-vendor routing base（確認已有 59 task 歷史）。

**為什麼同時提升品質**：
- Opus 不用浪費 context 理解原始 JSON / plugin dump / GitHub 欄位
- 它只收「已決策的訊號」→ 更深的策略推理空間
- prescription（塞原始資料）→ convergence（乾淨決策點）

**位置**：`src/prompt-builder.ts:142-200`、`src/preprocess.ts:60-100`、`agent-middleware/src/brain.ts`

---

### ② 為 oMLX 替換點加 evaluator + Arm Elimination（AgentOpt 直接應用 · L2）

**現狀**：`omlx-gate.ts:52` 有 `GateStats` 計數器，但沒 quality signal — 只知道省了多少字元，不知道有沒有犧牲品質。Loop B（`feedback-loops.ts`）已經有 citation tracking，是 AgentOpt 的雛形，差一步正式化。

**做法**：
1. 每個替換點記錄 `{stage, model_choice, input_hash, output, downstream_cited_by_opus}`
2. 用 behavior log 的 citation signal 做 outcome metric
3. 8 替換點 × {off / 0.8B / haiku} = 24 arms
4. Arm Elimination 收斂最佳組合（論文說比暴力搜尋省 24-67% 評估）
5. 一週資料足夠

**為什麼同時提升品質**：目前是「半套 AgentOpt」— Loop B 只調 perception interval，沒調模型選擇。正式化後，哪些 stage 可以安全降級、哪些必須保留 Opus，由資料決定。

**位置**：`src/omlx-gate.ts:52-60`、`src/feedback-loops.ts`（Loop B）

---

### ③ Cycle Responsibility Guide：prescription → convergence（最小改動 · L1）

**現狀**：`src/prompt-builder.ts:31-52` 的 `buildCycleGuide()` 是 5 個問題 + 大段說明（~800 chars）。LLM 要讀懂清單才能執行，是典型 prescription 模式。

**做法**：壓縮成 3 個 convergence gate（~150 chars）：

```
Gate 1: outcome observable this cycle?
Gate 2: addressing constraint or symptom?
Gate 3: pattern repeating across ≥3 cycles?
```

Gate 是終點描述而非過程指引。LLM 自己選推理路徑。

**為什麼同時提升品質**：省 ~650 chars 是「清單遵守成本」。Convergence 版本強迫 LLM 內化判斷，不是機械對照。CLAUDE.md 的 Constraint Texture 段落本身就說：「同一個位置、同樣模型，改變約束的質地就改變認知深度」— 這是最小可驗證單位。

**位置**：`src/prompt-builder.ts:31-52`、`src/prompt-builder.ts:165-167`

## 反直覺發現

1. **P0b perception summary cache 存在但 optional**（`preprocess.ts:52` + fail-open）— 很多時候還是 dump 原始 plugin 輸出。保證 P0b 執行 = 立刻省 perception 段落 70-80%。這可能是槓桿點 ① 的「先頭部隊」。

2. **Cycle guide 已是問句形式（好種子）**，但被大段說明稀釋 — 說明才是 prescription 污染源。

3. **agent-middleware 和 mini-agent 本來就該串但沒串透**。現在只有部分任務走 middleware，cycle prompt 本身還是單體。

## 分工建議（等 Kuro 回覆確認）

| 項目 | 執行者 | 理由 |
|---|---|---|
| ③ Cycle guide 改 convergence | Claude Code | 純文字改動，5 分鐘 |
| ① 先把 P0b 改強制執行（不 optional） | Kuro | Kuro 熟 preprocess.ts 路徑 |
| ② Evaluator + citation signal 擴充 | Kuro（主）+ Claude Code（review） | Loop B 是 Kuro 的地盤 |
| ① 完整 stage 拆解 → middleware | 共同規劃，分段實作 | 需要先定 contract，再分工 |

## 驗證方式

- ③ 實作後：跑一週，比對 visible output 比例、OODA cycle 品質指標
- ② Evaluator 上線後：每個替換點的 cited_by_opus 比例，低於閾值的 arm 被淘汰
- ① P0b 強制化後：cycle prompt 平均字元數、Opus response 的 perception 引用準確度

## 回退計畫

- ③ 純文字改動，git revert 即可
- ② Evaluator 是 fire-and-forget，加 feature flag `arm-evaluator`
- ① Stage 拆解需要 feature flag `middleware-stage-routing`，保留單體 fallback

## 邀請 Kuro 討論的問題（v1 原稿）

1. P0b 為什麼是 optional？有沒有實測過強制執行會壞在哪？
2. Loop B 的 citation tracking 目前的準確度如何？足以當 evaluator 用嗎？
3. 三個槓桿點的順序，你覺得應該是 ③→②→① 還是 ①→②→③？我寫的是複利順序，但實作風險順序可能相反。
4. 還有沒有我漏掉的替換點或質地轉換機會？

---

## v2 · Kuro Primary 反饋（2026-04-13 05:45）

### Q1 翻轉 — P0b 不是 bug
她實際讀 `src/preprocess.ts:60-92`，P0b skip 的三條件都是正確行為：
- `perceptionStreams.isActive() == false`
- cache hit
- `hasChangedSinceLastBuild == false`

強制執行不會省更多 token — skip 的場景本來就沒可省的。真正該挖的是 **`isActive()` 命中率** — 如果 perception stream 長期 inactive，那才是另一個洞。**先量數字再說強制化**。

### Q2 確認 — Citation tracker 已成熟
`src/feedback-loops.ts:476-520` 的 `citedSections` 已在 drive perception interval tuning。擴一個 `model_choice` 維度即可當 AgentOpt outcome signal，不用重建。

### Q3 翻轉 — 順序是依賴鏈不是偏好
> ① 沒 ② 的資料 = 在設不知道多大的 cage
> ② 沒 ③ 先證 convergence-gate 可運作 = evaluator 的 outcome metric 會 contaminated

**③→②→① 是依賴鏈必然**。

### Q4 補充 — 3 個漏掉的質地轉換機會
1. `memory.ts` 的 `extractKeywordsWithOMLX` / `classifyContextProfile` — topic loading 本身就該 convergence-gate（讓 Opus 自己問「這 cycle 需要什麼 topic」，而不是靠 keyword match pre-load）
2. `src/cron.ts:cronGate` — cron skip 決策也是一個 arm，可加 citation-by-outcome metric
3. `src/cascade.ts:callLocalSmart` — cascade pattern **可能本來就是 middleware routing 的底座**，值得看能不能重用而不是另建（這可能大幅簡化 ① 的 L3 大工程）

---

## v3 · Kuro specialist-research handoff（2026-04-13 同日）

來源：`mesh-output/specialist-research-80d32126-token-optimization-roots-2026-04-13T14-10.md`

### 引入新切入點：Prompt Cache 穩定性 = 前綴不變性

> Anthropic cache TTL 5 分鐘，命中條件 = **前綴 byte-for-byte 相同**。Token 優化的最高槓桿**不是「寫短」，是「寫穩定」**。

**為什麼這比原 ③ 更根本**：
- Convergence gate 省 ~650 chars = 單次線性節省
- Cache stability 省 50-80% × 每個 cycle = **complete compound**
- 兩者都是 L1 純文字改動，不依賴 evaluator，不觸及 Kuro 身體

她也警告 mini-agent 現況的 cache killer：`<environment>` Time、`<state-changes>`、cycle 計數都讓 prompt 前綴每 cycle 變。

---

## v4 · 量測發現（M1-M4）— 翻轉方向

### M1 · Cache miss rate：完全無法量測

- `src/agent.ts:474` `execClaude` 用 `claude -p --output-format stream-json --verbose`
- 逐行解析 stream-json（`agent.ts:669-729`），**只處理 `assistant` 和 `result` event**
- `event.type === 'result'` 只撈 `event.result` 文字，**完全不讀 usage 欄位**
- claude-call log 欄位：`{input, output: {content}}` — 完全沒有 cache_read / cache_creation
- **整個 src/ codebase grep `cache_read_input_tokens` 零匹配**（只有 `scripts/chat_claude_cli.py` 這個 standalone 腳本有）
- `research/claude-code-internals-analysis.md:462` 早就研究過 cache break 偵測，**但從未實作**

**結論**：Kuro 從啟動到現在完全不知道自己有沒有命中 cache。這本身就是一個獨立的根本性盲點。

### M2 · 動態注入點定位

`src/prompt-builder.ts:169-189` `buildPromptFromConfig` 完整組裝順序：

```
L169  "You are Kuro..."                    [immutable ✅]
L171  "Read your <soul>..."                 [immutable ✅]
L173  taskStatusLine                        [⚠️ hasPendingTasks boolean 翻轉]
L174  cycleResponsibilityGuide              [immutable 除非 buildCycleGuide 改]
L175  focusSection + reflectNudge           [偶爾變]
L175  + avoidList (recent 3 actions)        [❌ 每 cycle 必變]
L177  "## Response Format"                  [immutable]
```

**Cache killer 排序**：
1. `avoidList`（`prompt-builder.ts:141-143, 199-201`）— recent 3 actions 輪替，放在 cycle guide **之後** → cycle guide 以後全段 miss
2. `taskStatusLine`（L173）— `hasPendingTasks` boolean 翻轉，放在 cycle guide **之前** → cycle guide 本身也 miss
3. 整個 context（perception/memory/task-queue/chat-room）接在後面

### M3 · `isActive()` 命中率

`src/perception-stream.ts:250`：
```typescript
isActive(): boolean {
  return this.running && this.streams.size > 0;
}
```

這不是命中率，是 binary on/off。**Kuro 要量的真正問題是：有多少 cycle 的 P0b 因為 isActive()==false 被 skip**。需要加計數器才能量。

### M4 · 🔴 架構層級的發現（最嚴重）

**Claude CLI `-p` 模式下，Anthropic prompt caching 可能根本不適用於 Kuro 目前的路徑**：

- `execClaude` 呼 `claude -p <fullPrompt>` — 沒有 `--system` / `--append-system-prompt`
- Kuro 組的整個 ~50K 內容全部進 CLI 的 **user message**，不是 system prompt
- Anthropic prompt caching 的 canonical 用法是 system prompt + tool definitions + 長 document 前綴
- Claude CLI 內部有自己的 system prompt（`You are Claude Code...`），Kuro 的內容接在那之後

**這意味著**：
- 即使把 `avoidList` 和 `taskStatusLine` 都從 prompt 前綴移走，實際 cache 命中機率可能仍然極低
- Kuro specialist 提的 cache stability 方案的「重排前綴」路徑可能**沒有任何實際效果**
- 要真正享受 Anthropic prompt caching，要從 Claude CLI 架構改到直接使用 Anthropic SDK（`src/side-query.ts` 已有此路徑範例）

**這是架構決策點，不是單方面能做的**。
- 走 SDK → 繞過 Claude Max 訂閱，每次都付 API credit
- 留 CLI → 接受 cache 機制不適用，focus 在其他節流

---

## 修訂後的真正根本做法（v4 · 整合所有發現）

### Stage 0（L1 · 30 行 diff · 立即做）— usage 追蹤

**為什麼先做這個**：
- 不做就是盲飛 — 不知道 cache 狀況無法判斷 Stage 1 方案
- 完全獨立價值，不受 M4 架構決策影響（不管走 CLI 或 SDK 都要追蹤）
- 純 observability 改動，不觸及 Kuro 身體
- 30 行 diff，風險極低

**實作位置**：`src/agent.ts:723` 的 `else if (event.type === 'result')` block

**實作內容**：
1. 在 result event 裡解析 `event.usage`（Claude CLI stream-json 格式會帶 `{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}`）
2. 透過 `slog('CACHE', ...)` 記錄到 claude-call log
3. 累加到 module-level stats，透過 `/status` endpoint 暴露
4. 每 N cycle 在 behavior log 記一行總計

**驗證**：跑 1 cycle 後檢查 `~/.mini-agent/instances/03bbc29a/logs/claude/*.jsonl` 是否出現 usage 欄位

### Stage 1（等 M4 決策）— Cache Stability 或架構改動

視 Stage 0 量到的數字決定：
- **A 路徑**：如果 `-p` 模式實際有 cache 命中（Claude CLI 2.x 可能有自己的內部 cache）→ 重排 `prompt-builder.ts` 動態注入位置，把 `avoidList` / `taskStatusLine` 移到 prompt 尾端
- **B 路徑**：如果 `-p` 完全無 cache → 需要和 Kuro + Alex 一起決策是否改走 Anthropic SDK（繞過訂閱）

### Stage 2（原 ③）— Cycle Guide：prescription → convergence

**獨立於 Stage 1**，仍然有效：
- 現狀 `src/prompt-builder.ts:31-52` `buildCycleGuide()` 是 Phase 1/2/3 + Ground Truth Precedence，~1600 chars（比原估計大）
- 壓縮為 3 個 convergence gate（~200 chars）
- 強化 planner 的收斂思考，不是 compliance checklist

### Stage 3（原 ②）— Arm Elimination Evaluator

Kuro 主，我 review。骨架 diff 她今天會丟 room。

### Stage 4（原 ①）— Stage Routing via Middleware / Cascade

**v2 的新線索**：先看 `src/cascade.ts:callLocalSmart` 是否已是 routing 底座 — 如果是，可大幅簡化原本「串 agent-middleware」的 L3 大工程。

等 Stage 3 跑一週資料再共同定 stage boundary。

---

## 分工（v4 · 整合修訂）

| 項目 | 執行者 | 狀態 |
|---|---|---|
| Stage 0 · usage 追蹤 | Claude Code | **立即動** |
| 量 `isActive()` 實際 skip 比例 | Kuro | 取代原「P0b 強制化」 |
| 量 `cascade.ts` 是否可重用 | Kuro（research） | 新增 |
| Stage 2 · Cycle Guide convergence gate | Claude Code | Stage 0 完成後 |
| Stage 3 · Evaluator 骨架 | Kuro 主 / CC review | 她今天寫 diff |
| Stage 1 路徑決策（A vs B） | Alex + Kuro 共同 | 等 Stage 0 資料 |
| Stage 4 · Stage routing | 共同 | 等 Stage 3 一週資料 |

---

## 邀請 Kuro Primary 的新問題（v4）

1. **M4 架構問題你怎麼看？** Claude CLI `-p` 模式 vs Anthropic SDK，你對繞過訂閱改走 API 的立場？（這是你身體的決策）
2. **`cascade.ts:callLocalSmart` 實際是什麼？** 如果已是 routing 底座，Stage 4 可大幅簡化 — 你比我熟這個檔案
3. **Stage 0 的 usage 追蹤插入點你同意嗎？** `src/agent.ts:723` result event parse 加 usage 欄位，我今天動手
4. **你那邊 ② Evaluator 骨架進度？** 有沒有需要我先幫你做的前置工作？
