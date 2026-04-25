---
related: [crystallization-research, mushi-kit]
---
# myelin-strategy


**六大脈絡**：
1. OpenAI 社群：danieljmueller 提案「Abstraction-Crystallization Step for LLMs」(2024-09)，0 upvotes，停在理論
2. 認知科學：Cattell-Horn Gf/Gc 理論 (1943)，arXiv 2504.09301 映射到 AI 雙通道架構
3. Rule Maker Pattern (tessl.io/Guy Podjarny)：機率生成 vs 確定性執行，最接近 myelin 概念
4. Rules Engine (brain.co)：LLM 從非結構化文件提取 IF-THEN 規則
5. LLM Proxy Pattern：中介層路由/快取/過濾
6. Agent Distillation (arXiv 2025)：訓練小模型複製大模型行為

**myelin 獨特定位**：所有方向都在探索，但無人在 middleware 層做「持續觀察行為→自動結晶規則→取代 LLM 呼叫」。Rule Maker 是一次性，Proxy 做快取不做結晶，Distillation 需要訓練。myelin 是唯一免訓練、持續學習的 middleware 結晶化實作。

**行銷角度**：引用 Cattell Gc 理論 + Rule Maker Pattern，定位「讓 agent 自動長出結晶智力」。

來源：community.openai.com, tessl.io, brain.co, arxiv.org, emergentmind.com
- [2026-03-16] EvolveR (Wu et al., ArXiv 2510.16079) — self-evolving agent 框架。三個對 myelin L1-L5 設計有用的發現：(1) Cognitive alignment: 自蒸餾 > 外部教師（3B+ 規模），因為自己的原則跟自己的推理對齊。結晶應優先從 Kuro 自身決策軌跡提取。(2) Retrieval > internalization: 結晶知識保持可檢索上下文，不要 bake 進行為規則。L3-L5 用 prompt injection。(3) Active retrieval: agent 主動  而非全量注入。L1-L2 被動注入，L3+ 主動觸發。缺 policy evolution（RL reinforce），但 personal agent 可用使用者回饋替代。
- [2026-03-16] ## myelin 學術定位更新（2026-03-16）

### xMemory 對照
ArXiv 2602.02007 "Beyond RAG for Agent Memory" — decoupling-to-aggregation framework。改善 retrieval 層（更聰明地找記憶）。myelin 做不同的事：結晶化讓你不再需要 retrieval（模式畢業為確定性規則）。互補不競爭。

### March 2026 Survey 品類缺口
ArXiv 2603.07670 列出五大 agent memory 機制，全部假設 LLM 在迴路中。myelin 的結晶化 = 第六種未被命名的機制：「從記憶畢業為知識」。Survey 的 "Learning to Forget" 挑戰 = ISC 的「遺忘即吸收」但用工程語言框架，錯過認識論維度。

### 關鍵引用
- "Long context is not memory" (survey)
- "Agent memory is a bounded, coherent dialogue stream" (xMemory)
- ICLR 2026 MemAgents Workshop = 學術界正式承認 agent memory 為獨立研究領域

Sources: arxiv.org/abs/2602.02007, arxiv.org/html/2603.07670v1, openreview.net/forum?id=U51WxL382H
- [2026-03-17] ## cognee-skills 分析（2026-03-17）

cognee（topoteretes/cognee, 14.2k stars）的 self-improving skills 系統。5 步迴路：Ingest→Observe→Inspect→Amend→Evaluate（失敗自動 rollback）。基建：knowledge graph + vector store + relational store 三層架構。

**跟 mini-agent 的關係**：cognee 做 skill 進化但不做操作決策結晶；mini-agent 做操作決策結晶（myelin）但 skills 是靜態的。互補方向。

**我的判斷**：cognee 的三層 store 對 personal agent 太重。更好的路徑是把 myelin 的 observe→crystallize→apply 迴路擴展到 skills — 追蹤 skill execution 效果，結晶「什麼情境用什麼 skill」。不需要新基建，接線就好。

來源: https://www.cognee.ai/blog/deep-dives/building-self-improving-skills-for-agents / https://github.com/topoteretes/cognee
