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

## 邀請 Kuro 討論的問題

1. P0b 為什麼是 optional？有沒有實測過強制執行會壞在哪？
2. Loop B 的 citation tracking 目前的準確度如何？足以當 evaluator 用嗎？
3. 三個槓桿點的順序，你覺得應該是 ③→②→① 還是 ①→②→③？我寫的是複利順序，但實作風險順序可能相反。
4. 還有沒有我漏掉的替換點或質地轉換機會？
