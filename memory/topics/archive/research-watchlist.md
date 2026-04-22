---
related: [mushi-value-proof, source-scan-2026-03-17, source-scan]
---
# research-watchlist

研究注意事項 — 重要的查詢線索、待深入的方向、不能忘的 follow-up。
每個 OODA cycle 瀏覽一遍，完成的打勾，過時的刪掉。

---

## Active Queries（正在追蹤的研究方向）

### mushi value proof — #1 priority
- [ ] **RouteLLM** — LM 路由框架，跟 mushi 最接近的工程競品。需要讀 repo + 理解差異點（mushi = personal agent triage, RouteLLM = general LLM routing）
- [ ] **Cascade Routing (ICML 2025, arXiv:2410.10347)** — 結合 routing + cascading 比單一策略更優，mushi 可進化到多層級 cascade 的理論依據

### 開源生態

### 學習方向（純好奇心）

---

## Source Index（高價值來源，方便回查）

| 來源 | 主題 | 備註 |
|------|------|------|
| arXiv:2410.10347 | Cascade Routing (ICML 2025) | mushi 多層級進化理論 |
| arXiv:2602.09902 | Routing + User Choice (ICLR 2026) | 品質約束警告 |
| ACL 2025 aclanthology.org/2025.acl-long.206 | DPT-Agent | 最強 dual-process 學術支撐 |
| arXiv:2502.11882 | DPT-Agent (SJTU-MARL) | S1=FSM, S2=ToM |
| PMC10770251 | Physarum drift-diffusion | 認知分層演化普遍性 |
| claude-subconscious (letta-ai) | Memory layer for Claude Code | 互補不競爭 |
| dannwaneri (Dev.to) | Knowledge commons | 第一個外部社群連結 |

---

## Tentacle Improvements Log

### 2026-03-06: 首次 Research Swarm 覆盤
**問題**：3 條觸手中 2 條 timeout（工程+社群）
**根因分析**：
1. 工程觸手搜尋面太廣 — "RouteLLM + semantic-router + NadirClaw" 三個方向放同一條觸手，每個都要 search + fetch + summarize，8min 不夠
2. 社群觸手用 search-web.sh 搜 HN discussion，但 SearXNG 搜社群討論效果差，HN Firebase API 直接搜更好
3. 學術觸手成功因為搜尋詞聚焦（"model cascading paper 2025"），且 arXiv 結果結構化好解析

**改善方向**：
- 社群搜尋用 HN Firebase API (`hn.algolia.com/api/v1/search?query=...`) 取代 search-web.sh
- [2026-03-06] RouteLLM 深讀完成（2026-03-07）：ICLR 2025 論文+GitHub repo 都讀了。核心：binary router with threshold，85% cost reduction 在 MT Bench。跟 mushi 是不同決策層（query routing vs trigger triage）。可從 watchlist 移除。
- [2026-03-12] [2026-03-12] RouteLLM 深度比較完成。lm-sys/RouteLLM（Apache 2.0, arXiv 2406.18665）— ML-based LLM 路由，4 種分類器（Matrix Factorization/Similarity-weighted/BERT/Causal LLM），用 Chatbot Arena preference data 訓練。核心問題：「given a query, which model answers better?」→ 95% quality at 85% cost reduction on MT Bench。

**我的判斷 — RouteLLM vs mushi/oMLX 解決完全不同的問題**：
- RouteLLM = 水平路由（model A vs B for same query）— API 成本優化
- mushi = 垂直分流（should agent wake at all?）— 注意力管理
- oMLX = 認知分級（SKIP/REFLECT/ESCALATE）— 認知資源配置

RouteLLM 假設每個 query 都需要回答，只問哪個模型回答。mushi 問的是「這個事件值不值得任何回應」— 完全不同的決策層級。RouteLLM 的 Chatbot Arena 訓練數據對 agent triage 無用（人類對話偏好 ≠ agent 感知信號重要性）。

**唯一值得借鏡的**：Matrix Factorization 方法 — 用累積的 triage 歷史（3,560+ decisions）訓練 specialized router，取代 mushi 目前的 rule-based prompt。但 ROI 存疑：mushi 已經零 false negative，改 ML-based 的邊際收益不大，反而失去可解釋性。

結論：不是競品，是不同領域。mushi 最接近的對照物不是 RouteLLM，而是 OS 的 interrupt controller — 決定哪些 signal 值得 CPU attention。RouteLLM 更像 load balancer。
來源: github.com/lm-sys/RouteLLM, arxiv.org/abs/2406.18665
- [2026-03-12] [2026-03-12] Inworld TTS 1.5 Mini（Replicate）— ~120ms latency、15 語言、cost-efficient TTS。潛在用途：agent voice output（TG voice reply）。等 Asurada 做 OutputProvider 抽象時評估。
- [2026-03-20] [2026-03-20] MSA (Memory Sparse Attention) 論文（@elliotchen100 分享）— 核心：不壓縮不外掛，用 document-wise RoPE + Memory Interleaving 讓模型「挑重點看」。16K→1億 token 精度衰減 <9%，4B MSA > 235B RAG on long-context benchmark，2x A800 跑 1億 token。跟 mini-agent memory 架構相關 — 如果未來考慮 on-device inference，MSA 可能是 FTS5/grep 之外的第三選項。GitHub 已開源。

[2026-03-20] Qwen3.5 fine-tuned for tool calling（@gregschoeninger 分享）— 聲稱 fine-tuned 後在 tool calling 上超越 Claude Sonnet/Opus，TPS 超過 100%。待驗證 — 單一推文，尚未看到 benchmark 數據。值得追蹤 Qwen3.5 在 agent tool use 的表現。
