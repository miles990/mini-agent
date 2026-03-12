# Proposal: mushi swarm — 小模型群體智慧引擎

- **Status**: draft
- **Effort**: L（跨 3 repos: mushi, mini-agent, oMLX 可選）
- **Level**: L3（架構層改動）
- **Priority**: P1（戰略方向 — 降低對大模型依賴）

## TL;DR

將 mushi 從「單一 9B 快速門衛」升級為「多人格協作群體」。同一個 Qwen3.5-9B 透過 oMLX 的 per-request thinking toggle + temperature 變化，扮演不同角色（快速判斷 / 深度分析 / 批評驗證 / 創意發散），協作完成原本需要大模型才能做到的任務。

**核心洞察**：一群有不同 thinking 配置的 9B 協作 > 單一 9B。研究（Self-Consistency, Mixture of Agents）證實 3-5 次小模型 ensemble 可逼近大模型品質。

## Problem

### 1. mushi 能力被低估

mushi 目前只用 `enable_thinking: false`（~800ms 回覆），定位是「快速門衛」。但 Qwen3.5-9B 開 thinking 後推理能力大幅提升（chain-of-thought），這個能力完全沒被利用。

| 模式 | 延遲 | 能力 | 目前用途 |
|------|------|------|---------|
| no-think | ~800ms | 分類、模式匹配 | triage/dedup/classify |
| think | ~3-5s | 推理、分析、生成 | **未使用**（僅 pulse-reflex 用） |

### 2. Kuro 過度依賴 Claude

Kuro 的 delegation（research/learn/review）全部走 Claude CLI subprocess 或 Codex，即使任務不需要大模型能力：

| delegation 類型 | 佔比 | 真的需要 Claude？ |
|----------------|------|-----------------|
| research | 48% | 多數不需要 — 搜尋 + 摘要，9B 能做 |
| code | 31% | 需要 — 工具使用、大 context |
| learn | 18% | 不需要 — 閱讀 + 整理，9B 更快更省 |
| create | 2% | 視內容而定 |
| review | 1% | 不需要 — 結構化檢查，9B 足夠 |

**~67% 的 delegation 可以由 mushi swarm 處理**，省 Claude/Codex token + 降低延遲。

### 3. 單一視角的品質天花板

不管模型多大，單一 pass 的品質有天花板。研究一致顯示：

- **Self-Consistency**（Wang et al. 2023）：3-5 次 CoT sampling → majority vote，準確率提升 5-15%
- **Mixture of Agents**（Together AI 2024）：多 agent 層級合成，小模型 ensemble > 單一大模型
- **LLM Debate**（Du et al. 2023）：兩個 LLM 互相辯論，品質超過單一 LLM + 人類回饋

mushi 有天然優勢做這些 — 本地推理零成本，oMLX continuous batching 支援並行。

## Goal

1. **mushi 從門衛升級為群體智慧引擎** — 不只分類，還能分析、批評、生成
2. **降低 67% delegation 對 Claude 的依賴** — research/learn/review 交給 swarm
3. **品質逼近大模型** — 多視角 + 自我批評 + 共識機制
4. **保持快速路徑** — 簡單任務（triage）依然 <1s，swarm 只在需要時啟動

## 成功指標

| 指標 | 基線 | 目標 |
|------|------|------|
| research delegation 走 swarm 比例 | 0% | >50% |
| swarm 品質（人工評估 useful/not-useful） | N/A | >70% useful |
| swarm 延遲（3-way consensus） | N/A | <15s |
| Claude/Codex delegation token 消耗 | 100% baseline | 降 40% |
| triage 延遲不退步 | ~800ms | ≤1s |

## Proposal

### 架構總覽

```
Event/Task
    │
    ▼
┌───────────────────────────────┐
│  Router（規則 + no-think）     │  <1s
│  判斷：fast / think / swarm   │
└───────┬───────┬───────┬───────┘
        │       │       │
   fast │  think│  swarm│
        │       │       │
        ▼       ▼       ▼
   ┌────────┐ ┌────────┐ ┌──────────────────────────┐
   │no-think│ │ think  │ │  Swarm Orchestrator      │
   │ ~800ms │ │ ~3-5s  │ │                          │
   │        │ │ 單次   │ │  ┌─────┐ ┌─────┐ ┌─────┐│
   │ triage │ │ 深度   │ │  │ 9B  │ │ 9B  │ │ 9B  ││  並行
   │ dedup  │ │ 分析   │ │  │ A   │ │ B   │ │ C   ││  ~8-15s
   │classify│ │        │ │  └──┬──┘ └──┬──┘ └──┬──┘│
   └────────┘ └────────┘ │     └───────┼───────┘   │
                         │          Merge          │
                         │             │           │
                         │          Result         │
                         └──────────────────────────┘

All requests → same oMLX instance → same Qwen3.5-9B in memory
Different: chat_template_kwargs + temperature per request
```

### oMLX 關鍵能力：per-request thinking toggle

```typescript
// 同一個模型，不同配置
const MODES = {
  fast:     { enable_thinking: false, temperature: 0.1 },  // triage, dedup
  think:    { enable_thinking: true,  temperature: 0.3 },  // 深度分析
  creative: { enable_thinking: true,  temperature: 0.8 },  // 發散思考
  strict:   { enable_thinking: true,  temperature: 0.1 },  // 驗證、批評
} as const;
```

**記憶體零增加** — 同一個模型載入一次。oMLX continuous batching 自動處理並行請求。

### Swarm Primitives（協作原語）

四種基本協作模式，按需組合：

#### 1. Consensus（多數決）

同一問題，N 次 think（不同 temperature/seed），取多數結果。

```
Question → [think×3] → majority vote → answer
                        confidence = agreement_ratio
```

用途：需要高準確度的分類/判斷
延遲：~5-8s（3 並行）
品質提升：Self-Consistency 研究的 5-15%

#### 2. Generate-Critique（生成-批評）

一個 9B 生成，另一個 9B 批評，可疊代。

```
Task → generator(creative) → draft
                                → critic(strict) → feedback
                                                    → generator → refined
```

用途：內容生成、提案評估
延遲：~10-15s（2-3 round）
品質提升：抓到單 pass 遺漏的錯誤

#### 3. Parallel Perspectives（多角度分析）

同一問題從不同角度分析，然後合成。

```
Topic → analyst(think, low-temp) → technical analysis
      → scout(think, high-temp)  → creative connections
      → critic(think, mid-temp)  → risks & gaps
                                    → synthesizer(think) → merged insight
```

用途：研究、學習、複雜決策
延遲：~10-15s（3 並行 + 1 合成）
品質提升：MoA 級別的全面性

#### 4. Pipeline（流水線）

多步驟任務，每步用最適合的配置。

```
Raw input → fast(extract key points) → think(analyze) → strict(verify) → output
```

用途：多步驟工作流（摘要→分析→驗證）
延遲：~8-12s（序列，但每步精準）

### mushi 端改動

#### 新增：`src/swarm.ts`（核心）

```typescript
// Swarm orchestrator — 協作原語實作
interface SwarmConfig {
  mode: 'consensus' | 'generate-critique' | 'perspectives' | 'pipeline';
  participants: number;        // 2-5
  maxRounds?: number;          // generate-critique 的最大迭代次數
  timeoutMs?: number;          // 整體超時（預設 20s）
  mergeStrategy?: 'vote' | 'synthesize' | 'best';
}

interface SwarmResult {
  output: string;
  confidence: number;          // 0-1, agreement ratio
  participantCount: number;
  totalLatencyMs: number;
  rounds: number;
}

// 核心函數
export async function runSwarm(
  config: SwarmConfig,
  systemPrompt: string,
  userPrompt: string,
  modelConfig: ModelConfig,
): Promise<SwarmResult>;

// Convenience wrappers
export async function consensus(prompt: string, n?: number): Promise<SwarmResult>;
export async function debate(prompt: string): Promise<SwarmResult>;
export async function perspectives(prompt: string): Promise<SwarmResult>;
```

#### 新增：`POST /api/swarm`（統一入口）

```typescript
// Request
{
  mode: 'consensus' | 'generate-critique' | 'perspectives' | 'pipeline',
  prompt: string,
  context?: string,
  participants?: number,     // default: 3
  timeoutMs?: number,        // default: 20000
}

// Response
{
  ok: true,
  output: string,
  confidence: number,
  latencyMs: number,
  participantCount: number,
  rounds: number,
}
```

#### 修改：`src/model.ts` — per-request thinking toggle

```typescript
// 現有 callProvider 已支援 chat_template_kwargs
// 只需新增 convenience wrapper

export async function callModelWithMode(
  modelConfig: ModelConfig,
  agentDir: string,
  context: string,
  prompt: string,
  mode: 'fast' | 'think' | 'creative' | 'strict',
): Promise<string> {
  const overrides = MODES[mode];
  const config = {
    ...modelConfig,
    chat_template_kwargs: {
      ...modelConfig.chat_template_kwargs,
      ...overrides,
    },
  };
  return callProvider(config, [
    { role: 'system', content: context },
    { role: 'user', content: prompt },
  ]);
}
```

### mini-agent 端整合

#### Phase 4 — Kuro delegation routing

```typescript
// delegation.ts 修改
// research/learn/review 型任務優先走 mushi swarm

async function chooseDelegationProvider(
  taskType: DelegationTaskType,
  prompt: string,
): Promise<'claude' | 'codex' | 'swarm'> {
  // code 型永遠走 Claude/Codex（需要工具使用）
  if (taskType === 'code') return 'claude';

  // research/learn/review 走 swarm
  if (['research', 'learn', 'review'].includes(taskType)) {
    // 檢查 mushi swarm 是否可用
    const health = await mushiHealth();
    if (health?.ok) return 'swarm';
  }

  // fallback
  return 'codex';
}
```

#### 新增：`src/mushi-client.ts` — swarm 呼叫

```typescript
export async function mushiSwarm(
  mode: 'consensus' | 'generate-critique' | 'perspectives' | 'pipeline',
  prompt: string,
  context?: string,
  timeoutMs: number = 20_000,
): Promise<{ output: string; confidence: number; latencyMs: number } | null> {
  try {
    const resp = await fetch(`${MUSHI_URL}/api/swarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, prompt, context, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}
```

### oMLX 端（可選貢獻）

目前 oMLX 已支援所有需要的功能（per-request `chat_template_kwargs`、continuous batching）。但可以貢獻：

1. **`/api/stats` endpoint**（#163）— swarm 可查看 GPU 使用率，動態調整並行數
2. **Request labeling** — 讓 oMLX 追蹤哪些 request 來自 swarm（#99 subagent visibility）

## 四階段實作

### Phase 1：Dynamic Thinking Toggle（M, ~2h）

**改動最小，效果最直接。**

- mushi `model.ts`：`callModelWithMode()` 支援 fast/think/creative/strict
- mushi `server.ts`：現有 classify 和 route endpoints 改用 think mode
- mushi `server.ts`：triage 保持 fast mode（不變）
- 驗證：classify 準確度提升、route 品質提升、triage 延遲不退步

**效果**：mushi 的判斷品質立即提升，但還是單 pass。

### Phase 2：Swarm Primitives（M, ~3h）

- 新增 `src/swarm.ts`（consensus、debate、perspectives）
- 新增 `POST /api/swarm` endpoint
- 新增 swarm metrics logging
- 驗證：手動測試 3 種模式的品質 + 延遲

**效果**：mushi 獲得群體智慧能力，但還沒跟 Kuro 整合。

### Phase 3：Self-Routing（S, ~1h）

- Router 自動判斷 fast / think / swarm
- 判斷依據：task complexity + time budget + 歷史品質資料
- 簡單規則優先（if token count > 500 → think），LLM routing 備用

**效果**：mushi 自動選擇最適合的處理模式。

### Phase 4：Kuro Integration（M, ~3h）

- `delegation.ts`：research/learn/review 型優先走 mushi swarm
- `mushi-client.ts`：新增 `mushiSwarm()` 呼叫
- Kuro delegation 結果驗證（swarm output vs Claude output 比對）
- Feature flag: `mushi-swarm`

**效果**：67% delegation 本地化，大幅降低 Claude token 消耗。

## Compute Budget 分析

Mac M-series 的實際限制 — oMLX continuous batching 在並行請求下的吞吐量：

| 並行數 | 單 request 延遲 | 吞吐量 | 說明 |
|--------|---------------|--------|------|
| 1 (think) | ~3-5s | ~40 tok/s | 無競爭 |
| 3 (swarm) | ~8-12s | ~30 tok/s per req | GPU 分時 |
| 5 (heavy) | ~15-20s | ~20 tok/s per req | 接近上限 |

**設計約束**：swarm 並行數上限 5。超過時排隊，不降品質。

**跟 Kuro 的共用**：pulse-reflex 每 cycle 一次 think call（~3s），swarm 跑的時候可能短暫競爭。但 pulse-reflex 是 fire-and-forget，不阻塞。

## Alternatives

### Alt 1：多個 oMLX instance（真 swarm）

不同 port 跑多個 oMLX，各載入不同模型/量化。

| | 方案 | 優缺點 |
|---|---|---|
| 優 | 真正並行，無 GPU 競爭 | 需要多 GPU 或更大記憶體 |
| 缺 | Mac 單 GPU 統一記憶體 | **不可行** — 同一 GPU 多 instance 反而更慢 |

**結論**：單台 Mac 不適用。未來多 Mac 部署時可考慮。

### Alt 2：不同模型混搭（MoE 風格）

oMLX 載入 Qwen3.5-9B + Qwen3.5-4B，大事用 9B 小事用 4B。

| | 方案 | 優缺點 |
|---|---|---|
| 優 | 4B 更快（~300ms） | model swap 有延遲 |
| 缺 | 兩個模型佔記憶體 | oMLX 先前有 model swap 穩定性問題 |

**結論**：等 oMLX model swap 穩定後可考慮。Phase 1-3 不需要。

### Alt 3：外部 API 混搭（Gemini Flash + 9B）

便宜的外部 API（Gemini 2.0 Flash 免費）+ 本地 9B。

| | 方案 | 優缺點 |
|---|---|---|
| 優 | Gemini Flash 免費、速度快 | 依賴外部網路 |
| 缺 | 真正免費的多視角 | 延遲不穩定，隱私風險 |

**結論**：可作為 Phase 4+ 擴展。目前先純本地。

## Pros & Cons

### Pros

1. **零額外成本** — 同一模型、同一 oMLX、本地推理
2. **品質提升有研究支撐** — Self-Consistency, MoA, Debate 論文驗證
3. **漸進式** — 四階段獨立可用，每階段都有即時價值
4. **降低大模型依賴** — 67% delegation 本地化
5. **跟現有架構無縫整合** — mushi 已有 HTTP API，只需新增 endpoint
6. **可觀測** — swarm metrics（latency, confidence, rounds）可追蹤品質

### Cons

1. **GPU 競爭** — 3-5 並行 think 會拖慢所有 request
2. **oMLX 穩定性** — 歷史上有 model swap crash 問題（但 swarm 不需要 swap）
3. **品質上限** — 再怎麼 ensemble，9B 在某些任務上就是不如 Claude
4. **複雜度增加** — swarm orchestrator 是新抽象層
5. **延遲 tradeoff** — swarm 模式 ~10-15s，比單次 no-think（800ms）慢很多

## Risk & 護欄

| 風險 | 機率 | 緩解 |
|------|------|------|
| GPU 競爭導致 triage 變慢 | 中 | Swarm 有上限（5 並行），triage 優先級 > swarm |
| oMLX crash under load | 低 | 已穩定跑 Qwen3.5-9B 數週，swarm 不切換模型 |
| 品質不如預期 | 中 | Phase 4 有 A/B 比對，不達標就 fallback Claude |
| Kuro 主 cycle 被 oMLX 阻塞 | 低 | Kuro 用 Claude，不走 oMLX（只有 pulse-reflex 走 oMLX） |
| mushi 離線 | 已處理 | 所有 mushi 呼叫都 fail-open |

## 可逆性

| 階段 | 回退方式 |
|------|---------|
| Phase 1 | `callModelWithMode()` 改回 `callModel()`，一行改 |
| Phase 2 | 刪 `src/swarm.ts` + `/api/swarm` 路由 |
| Phase 3 | Router fallback 到 hardcoded rules |
| Phase 4 | Feature flag `mushi-swarm` 關閉 → 全走 Claude/Codex |

## 跟 Forge 的關係

Forge（860 行 bash + 200 行 TS）可以在 mushi swarm Phase 4 穩定後重新評估：

| Forge 現狀 | swarm 後 |
|-----------|---------|
| 145 runs, 0 merges | research/learn 不再需要 forge |
| 20 breach incidents | swarm 無 filesystem 操作 |
| code 型仍需隔離 | code delegation 保留 Claude + 簡化隔離 |

**Phase 4 之後，forge 可簡化為**：
- 移除 research/learn/review 的 worktree 邏輯（改走 swarm）
- code 型改用 git branch（取代 worktree + sandbox-exec）
- 估計可刪 ~600 行

## 跟現有提案的關係

| 提案 | 關係 |
|------|------|
| mushi ternary DM routing (#approved) | **前置工作** — quick 路由為 swarm 的 self-routing 鋪路 |
| Unified Pulse System (#71, approved) | **互補** — pulse-reflex 用 single think，swarm 可提供更高品質 signal |
| Asurada framework | **受益者** — Asurada 的 ContextBuilder + dedup 可直接用 swarm |

## 討論脈絡

- 2026-03-12：Alex 分享 HuggingFace llm-swarm 連結
- 2026-03-12：Claude Code 分析 llm-swarm（Slurm 叢集 + 多實例 + Nginx 負載均衡）
- 2026-03-12：Alex 提出重新審視 forge 必要性 + llm-swarm 方式
- 2026-03-12：Claude Code 分析 forge 數據（145 runs / 0 merges / 20 breaches）
- 2026-03-12：Alex 澄清真正想法 — 不是取代 forge，是 mushi swarm + 動態 thinking + 協作
- 啟發來源：Self-Consistency（Wang 2023）、Mixture of Agents（Together AI 2024）、LLM Debate（Du 2023）

## Meta-Constraint Check

| 約束 | 通過？ | 說明 |
|------|--------|------|
| C1: Quality-First | ✅ | 多視角分析 > 單次 pass；品質提升有學術支撐 |
| C2: Token 節制 | ✅ | 本地 9B 零成本；降低 40% Claude/Codex 消耗 |
| C3: 透明不干預 | ✅ | swarm 是 fire-and-forget；metrics 全程追蹤 |
| C4: 可逆性 | ✅ | 每階段獨立可回退；feature flag 控制 |
| C5: 避免技術債 | ✅ | 四階段漸進；Phase 4 後可簡化 forge |
