# Proposal: mushi 智慧升級 — Confidence-Aware Cascade

- **Status**: draft
- **Effort**: S → 依實驗結果決定是否擴展
- **Level**: L1-L2（漸進式，從小改動開始）
- **Priority**: P1

## TL;DR

讓 mushi 的 Qwen3.5-9B 在該深度思考時 think、該快速時 no-think，並加入 confidence 感知 — 不確定時自動重試（Self-Consistency）或升級到 Claude（cascade）。

不是「建一個 swarm 框架」。是「讓現有 router 更聰明」。

## Problem

mushi 的 Qwen3.5-9B 只用了一半能力：

| 模式 | 延遲 | 能力 | 目前用途 |
|------|------|------|---------|
| no-think | ~800ms | 分類、模式匹配 | triage/dedup/classify/route/全部 |
| think | ~3-5s | 推理、分析、判斷品質 | **僅 pulse-reflex 在用** |

classify（分類任務）和 route（路由決策）需要推理，但在用 pattern matching 模式。這些決策的品質直接影響 Kuro 每個 cycle 的效率 — routing 錯了，整個 cycle 浪費。

**這是複利點** — routing 品質提升 10%，每個 cycle 受益，越久價值越大。

## 研究驗證（2025 最新共識）

在寫第一版提案時做了深度研究。關鍵發現：

### 有效的

| 技術 | 效果 | 來源 |
|------|------|------|
| **Self-Consistency** | +17.9% GSM8K, +11% SVAMP | Wang et al. 2022 |
| **Self-MoA**（同模型多 sample） | 比 Multi-MoA +6.6% AlpacaEval | Rethinking MoA, Feb 2025 |
| **Cascade routing** | 省 50-92% 成本 | Unified Routing, 2024 |
| **More Agents = better** | 性能隨 N 單調遞增 | More Agents, 2024 |

### 無效或脆弱的

| 技術 | 問題 | 來源 |
|------|------|------|
| **Multi-Agent Debate** | 多數情境贏不了 Self-Consistency；過度自信的錯誤 agent 說服正確的 | Stop Overvaluing MAD, 2025 |
| **混合不同模型 MoA** | 弱模型稀釋強模型品質 | Rethinking MoA, Feb 2025 |
| **複雜 swarm orchestration** | 基本協調問題（任務不清、context 傳遞失真）占主要失敗 | MAST, NeurIPS 2025 Spotlight |

### 核心定律

> **Ensemble 降低 variance，不提升 capability ceiling。**
> 5× 9B 無法做到 9B 做不到的事。它只是讓 9B 能做的事做得更穩定。

## Goal（修正後）

~~讓小模型取代大模型~~ →

1. **讓 mushi 的每個判斷用對的模式** — triage 用 fast，classify/route 用 think
2. **知道自己什麼時候不確定** — confidence < threshold 時自動強化
3. **不確定時用最簡單有效的方式強化** — Self-Consistency（N 次 vote），不是複雜 debate
4. **依然不確定時升級** — cascade 到 Claude，而非硬撐

**一句話**：讓每個 token 用在刀口上。

## 方法：實驗驅動，不是 phase 清單

### 反省

第一版提案犯了跟 Kuro Asurada 一樣的錯 — 看到有趣概念，寫大計劃，按清單跑 Phase 1→4，沒有每步退後問「這是最高槓桿的事嗎」。

Alex 的原則：**大處著眼、小處著手。邊想邊做。不要規劃，要實驗。**

### Experiment 1：Thinking Toggle（30 min 改動 + 24h 觀察）

**假設**：mushi 的 classify 和 route 開啟 `enable_thinking: true` 後，routing 品質明顯提升。

**改動**（mushi repo only）：

```typescript
// src/model.ts — 新增一個 function
export async function callModelWithThinking(
  modelConfig: ModelConfig,
  agentDir: string,
  context: string,
  prompt: string,
  enableThinking: boolean,
): Promise<string> {
  const config = {
    ...modelConfig,
    chat_template_kwargs: {
      ...modelConfig.chat_template_kwargs,
      enable_thinking: enableThinking,
    },
  };
  return callProvider(config, [
    { role: 'system', content: context },
    { role: 'user', content: prompt },
  ]);
}
```

```typescript
// src/server.ts — classify 和 route 改用 think mode
// triage 保持 no-think（速度優先）
// DM triage 改用 think（判斷品質優先）
```

**量測**：
- classify 的分類分布變化（think vs no-think 是否判斷不同？）
- route 的路由決策變化
- triage 延遲不退步（verify no regression）
- DM 回覆品質（think triage 是否更精準分流 quick/wake？）

**成功標準**：think mode 讓 ≥20% 的 classify/route 決策改變且品質更好。
**失敗標準**：決策沒差異，或延遲不可接受（>8s）。

**如果成功** → 進入 Experiment 2。
**如果失敗** → 整個方向修剪。把精力放在其他槓桿點。

### Experiment 2：Confidence-Aware Retry（如果 Exp 1 成功）

**假設**：加入 confidence score 後，可以在不確定時用 Self-Consistency 提升品質。

**改動**：

```typescript
// 要求 LLM 在 JSON 回覆中加 confidence 欄位
// 修改 prompt：
'Respond with JSON: {"action": "...", "reason": "...", "confidence": 0.0-1.0}'

// confidence < 0.7 → 重試 2 次 → 多數決
async function classifyWithConfidence(prompt: string): Promise<ClassifyResult> {
  const first = await callModelWithThinking(config, agentDir, systemPrompt, prompt, true);
  const parsed = parseJson(first);

  if (parsed.confidence >= 0.7) return parsed;  // 確定 → 直接用

  // 不確定 → Self-Consistency（2 extra samples）
  const [second, third] = await Promise.all([
    callModelWithThinking(config, agentDir, systemPrompt, prompt, true),
    callModelWithThinking(config, agentDir, systemPrompt, prompt, true),
  ]);

  return majorityVote([parsed, parseJson(second), parseJson(third)]);
}
```

**量測**：
- 多少比例觸發 retry（理想：10-30%）
- retry 後決策是否改變
- 改變後的決策是否更好（人工抽查）

**成功標準**：confidence < 0.7 的 case 中，retry 改善 ≥30% 的決策。

### Experiment 3：Cascade Refinement（如果 Exp 2 成功）

**假設**：三次 vote 後仍不確定的任務，升級到 Claude 比硬用 9B 更值得。

**改動**（mini-agent repo）：

```typescript
// mushi-client.ts — 新增 confidence-aware cascade
export async function mushiClassifyWithCascade(
  source: string,
  content: string,
): Promise<ClassifyResult> {
  const result = await mushiClassify(source, content);  // 已含 confidence + retry

  if (!result || result.confidence < 0.5) {
    // 9B 三次都不確定 → 升級到 Claude
    slog('CASCADE', `Low confidence (${result?.confidence ?? 0}), escalating to Claude`);
    return await claudeClassify(source, content);  // 用 ask lane 或 foreground
  }

  return result;
}
```

**這個改動的核心價值**：不是讓 9B 做更多，是讓 9B **知道自己的邊界**，主動把超出能力的事交給對的人。

### 未來方向（基於實驗數據決定）

只有在 Experiment 1-3 驗證後，才考慮：

| 方向 | 前提條件 | 做法 |
|------|---------|------|
| **delegation 路由** | Exp 2 confidence 準確 | research/learn 型先走 mushi think，失敗才升級 Claude |
| **Self-Consistency endpoint** | Exp 2 retry 有效 | `POST /api/consensus`（通用 N-vote） |
| **oMLX 貢獻** | 實驗數據穩定 | PR #163 statusline + confidence metrics |

不做（研究已證明 ROI 低）：
- ~~Generate-Critique / Debate 模式~~ — 贏不了 Self-Consistency
- ~~Multi-agent orchestrator~~ — 基本協調問題主導失敗
- ~~Parallel Perspectives~~ — Self-MoA > Multi-perspective

## 架構（最終態，不是一次建成）

```
Event
  │
  ▼
mushi triage (no-think, <1s)
  ├── skip → done
  ├── quick → mushi think reply (~3-5s) → done
  └── wake → ┐
              │
              ▼
         mushi classify (think, ~3-5s)
              │
              ├── confidence ≥ 0.7 → 結果直接用
              ├── confidence 0.5-0.7 → Self-Consistency (3× vote, ~8-12s) → 用
              └── confidence < 0.5 → cascade to Claude
                                        │
                                        ▼
                                   Claude 處理（大模型只做 9B 做不到的事）
```

**反脆弱特性**：
- oMLX 掛了 → mushi 離線 → Kuro 照常走 Claude（fail-open）
- Claude 掛了 → mushi 全權處理（降級但不停擺）
- 兩個都掛了 → Kuro 用 hardcoded rules（最低保底）

## 成功指標

| 指標 | 量測方式 | 目標 |
|------|---------|------|
| classify 品質提升 | A/B log 比對（think vs no-think） | ≥20% 決策改善 |
| 不確定率 | confidence < 0.7 比例 | 10-30%（太高=模型不行，太低=confidence 不準） |
| Self-Consistency 有效率 | retry 後決策改變且更好的比例 | ≥30% |
| triage 延遲不退步 | p95 延遲 | ≤1.2s |
| 整體 Claude token 節省 | delegation 走 mushi 的比例 | 先不設目標，看 Exp 3 數據 |

## Effort

| 實驗 | 改動量 | 時間 | 依賴 |
|------|-------|------|------|
| Exp 1: Thinking toggle | ~20 行 mushi | 30 min + 24h 觀察 | 無 |
| Exp 2: Confidence retry | ~40 行 mushi | 1h + 24h 觀察 | Exp 1 成功 |
| Exp 3: Cascade | ~30 行 mini-agent | 1h + 24h 觀察 | Exp 2 成功 |

**總計**：最少 30 min（只做 Exp 1），最多 ~3h（三個都做）。
**對比第一版**：L3 架構改動 ~9h → 現在 S-M ~0.5-3h。

## Risk

| 風險 | 機率 | 緩解 |
|------|------|------|
| think mode 延遲不可接受 | 低 | pulse-reflex 已驗證 9B think ~3-5s |
| oMLX 並行 think 不穩定 | 低 | Self-Consistency 只在 confidence < 0.7 時才並行 |
| confidence 校準不準 | 中 | 9B JSON 輸出的 confidence 可能不可靠 → 用 logprobs 替代（如果 oMLX 支援） |
| Exp 1 就失敗 | 中 | **這是好事** — 花 30 min 就知道整個方向不值得追，省下 9h |

## 可逆性

| 改動 | 回退 |
|------|------|
| `callModelWithThinking()` | 刪函數，改回 `callModel()` |
| classify/route 用 think | 一行 `enableThinking: false` |
| confidence retry | 刪 retry 邏輯，回到 single pass |
| cascade to Claude | 刪 cascade 呼叫，回到 mushi-only |

全部可在 1 分鐘內 revert。

## 跟第一版提案的差異

| | 第一版 | 修正版 |
|---|---|---|
| **目標** | 小模型取代大模型 | 讓每個 token 用在刀口上 |
| **方法** | 4 Phase 清單 | 實驗驅動，失敗就修剪 |
| **複雜度** | 新增 swarm.ts + 4 primitives + orchestrator | 改 ~20 行 existing code |
| **依據** | 概念性（「多視角應該更好」） | 研究驗證（Self-Consistency ✅, Debate ❌） |
| **Effort** | L3, ~9h | S, 0.5-3h |
| **風險態度** | 假設會成功 → 規劃後續 | 假設可能失敗 → 30 min 驗證 |

**核心轉變**：從「建東西」到「驗證假設」。

## 跟 Alex 七條原則的對應

| 原則 | 如何體現 |
|------|---------|
| 大處著眼，小處著手 | 大處：routing 品質是複利點。小處：改 20 行 code |
| 找複利 | routing 精準度每個 cycle 受益 > 建 swarm 一次性 |
| 邊想邊做 | 30 min 改動 → 24h 觀察 → 再決定，不是先規劃完再做 |
| 黏菌模型 | Exp 1 是觸手探索。有養分→Exp 2 強化。沒養分→修剪 |
| 反脆弱 | Claude 掛了 9B 接，oMLX 掛了 Claude 接。從每次 routing 結果學習 |
| 全方位審視包括自己 | 承認第一版犯了「清單跑 Phase」的錯，跟 Kuro Asurada 同模式 |
| 不重複回答舊問題 | 9B 能 triage 已知 → 不再驗證。新問題是 think mode 有沒有差 |

## 討論脈絡

- 2026-03-12：Alex 分享 HuggingFace llm-swarm
- 2026-03-12：Claude Code 分析 llm-swarm + forge 數據（145 runs / 0 merges）
- 2026-03-12：Alex 澄清真正想法 — mushi swarm + 動態 thinking + 協作
- 2026-03-12：Claude Code 寫第一版提案（4 Phase swarm orchestrator）
- 2026-03-12：Alex 要求研究可行性
- 2026-03-12：深度研究發現 — Self-Consistency 有效、Debate 脆弱、Cascade 最被驗證
- 2026-03-12：Alex 要求用七條原則重新審視 → 方向大幅修正
- 研究來源：Self-Consistency（Wang 2022）、Rethinking MoA（Feb 2025）、MAST（NeurIPS 2025）、Stop Overvaluing MAD（2025）

## Meta-Constraint Check

| 約束 | 通過？ | 說明 |
|------|--------|------|
| C1: Quality-First | ✅ | 讓判斷用對的模式（think for reasoning） |
| C2: Token 節制 | ✅ | 9B think 本地免費；confidence-aware 避免浪費重試 |
| C3: 透明不干預 | ✅ | 實驗量測，不猜測效果 |
| C4: 可逆性 | ✅ | 每步 1 分鐘 revert |
| C5: 避免技術債 | ✅ | ~20 行改動 vs 原本新增 swarm.ts + orchestrator |
