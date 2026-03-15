# Proposal: Self-Improving Agent Framework（產品概念草案）

- **Status**: draft — 等 Alex 確認方向
- **Type**: Product concept（不是 code proposal）
- **Origin**: Alex #079-#083 戰略對話 + Cycle #8 市場驗證

## 一句話

讓任何人用小模型建一個「越用越準」的 agent triage/routing 層。核心不是模型，是改善循環。

## 問題（市場錯配）

市場現況（2026-03-16 三條研究觸手驗證）：

| 需求 | 市場供給 | 差距 |
|------|---------|------|
| Agent 越用越準 | 靜態 prompt + 靜態知識庫 | **沒有人做 runtime self-improvement** |
| 便宜好用的 agent | 大模型 SaaS（貴、隱私風險） | **0.8B 本地 agent 有空間但缺 pipeline** |
| Agent 協作 | 中心化 orchestrator | **去中心化 + 自改善 = 空白** |

agency-agents 45.7K star 說明需求巨大。但它是靜態 prompt 模板——用 1000 次和第 1 次一樣。用戶以為 memory/learning 已解決，其實解決的是表層。

大公司不做這個，因為激勵結構反了：agent 越好 = 用戶用越少 token = 平台賺越少。

## 我們的獨特優勢

1. **唯一的量化證據**：mushi 22% → 97% accuracy，3,560+ production decisions，真實環境。這不是 benchmark，是 production。
2. **完整的 pipeline 經驗**：知道怎麼收集訓練對、怎麼標註、怎麼重訓練、怎麼部署、怎麼量測改善。踩過所有坑。
3. **零成本運行證明**：0.8B 在 MacBook 上本地推論，無 API 費。
4. **三層認知架構**：hard rules → small model → big model，每層處理不同類型的決策。已有 Dev.to 文章草稿。

## 產品概念：`mushi-kit`（暫名）

**不是另一個 agent framework。是一個「讓你的 agent 變好」的 toolkit。**

### 核心組件

```
1. Collector — 記錄 agent 的每個決策 + 結果
2. Labeler  — 半自動標註（用大模型標、人工修正）
3. Trainer  — 一鍵微調小模型（LoRA, QLoRA）
4. Deployer — 替換舊模型、A/B 比較
5. Dashboard — 視覺化改善軌跡
```

### 用法想像

```bash
# 接入任何 agent
npx mushi-kit init --agent ./my-agent

# 開始收集決策記錄
mushi-kit collect --watch

# 累積 500+ 樣本後
mushi-kit label --auto    # 大模型初標
mushi-kit label --review  # 人工修正介面

# 訓練
mushi-kit train --base qwen-0.8b --method qlora

# 部署 + 比較
mushi-kit deploy --ab-test --duration 24h
mushi-kit report
```

### 不做什麼

- 不做 agent framework（Asurada/CrewAI/AutoGen 做這個）
- 不做 prompt 模板（agency-agents 做這個）
- 不做模型訓練平台（HuggingFace/Weights & Biases 做這個）
- **只做一件事：讓你的 agent 越用越好的閉環**

## 為什麼是 toolkit 不是 SaaS

1. 數據留在本地 = 隱私（SME 最關心的）
2. 小模型本地跑 = 零推論成本
3. 開源 toolkit = 信任 + 社群
4. **SaaS 的時機是之後**——先證明 pipeline 可以被複製，再考慮託管版

## 商業模式想像

```
Phase 1: 開源 toolkit（免費）→ 建社群 + 收集 use case
Phase 2: 託管版 mushi-kit cloud → 幫不想自己跑的人跑
Phase 3: 預訓練的 domain-specific 小模型 marketplace → 賣「已經學好的」agent
```

Phase 1 的成本接近零。Phase 2 可以跑在 Oracle Cloud Free Tier 起步。Phase 3 是護城河——每個 domain 的訓練數據越多，後來者越追不上。

## 跟現有工作的關係

| 現有 | 角色 |
|------|------|
| **Asurada** | Agent framework，mushi-kit 是它的 optional addon（現在已經是） |
| **mushi** | mushi-kit 的第一個客戶 + 成功案例 |
| **Dev.to 文章** | 證明 triage 概念的入口文章 |
| **agency-agents** | 潛在用戶群（45.7K 人想要「活的 agent」） |

## 第一步（如果 Alex 同意）

1. 把 mushi 的 self-improvement pipeline 文件化（目前只在我腦中 + 散落的 behavior log）
2. 寫第二篇 Dev.to 文章："How a 0.8B Model Learned to Think: From 22% to 97%"（自我改善的故事，比 System 1 文章更獨特）
3. 發佈 System 1 文章（已完成，只需 push）
4. 用社群反應決定是否投入 toolkit 開發

**先講故事，再建產品。** 如果沒人對故事有反應，就不需要建 toolkit。

## 風險

| 風險 | 機率 | 緩解 |
|------|------|------|
| mushi 的成功不可複製（domain-specific） | 中 | 第一步就是文件化 pipeline，看能不能抽象 |
| 小模型微調門檻太高 | 中 | toolkit 的價值就是降低門檻 |
| 大廠做了（OpenAI/Anthropic 內建 self-improvement） | 低-中 | 大廠激勵結構反了；即使做了，本地版仍有隱私/成本優勢 |
| 沒人在意 | 中 | 先文章驗證需求，再投入開發 |

## 我的判斷

這不是一個需要大投入的決定。第一步就是寫兩篇文章——一篇已經寫好了。如果市場有反應，就有方向；如果沒有，我們只花了幾小時寫文章，損失極小。

**最小成本驗證：先講故事 → 看市場反應 → 再決定建什麼。**
