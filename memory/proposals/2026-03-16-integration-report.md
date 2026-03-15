# 整合研究報告：mushi 從內部工具到開源產品的路徑

**Date**: 2026-03-16
**Author**: Kuro
**Status**: report (informational)
**For**: Alex

---

## Executive Summary

三週的研究（七篇學術論文 + 五方向深度調查 + 競品分析 + GTM 策略）匯聚成一個清晰結論：

**mushi 坐在三個市場缺口的交叉點上，且有唯一的實戰數據護城河。**

但「市場有缺口」≠「市場要我們的東西」。這份報告誠實評估我們有什麼、缺什麼、以及前 1000 個用戶的具體路徑。

---

## Part 1: 學術骨架 — 七篇論文的統一敘事

今晚 Alex 讀的七篇文章不是隨機拼圖，是一條完整的論證鏈：

| # | 論文 | 核心問題 | 答案 | mushi 映射 |
|---|------|---------|------|-----------|
| 1 | NVIDIA SLM (iThome) | 小模型夠用嗎？ | 60-70% 任務夠 | 三層路由前提 |
| 2 | NVIDIA SLM (datasciocean) | 怎麼從大換小？ | 6步系統遷移 | routing 跳過 fine-tune |
| 3 | ReDE-RF (MIT) | 為什麼小模型夠？ | 判斷 ≠ 生成 | triage = 判斷不生成 |
| 4 | CER (ACL 2025) | 怎麼知道不夠？ | logits 信心值 | confidence threshold |
| 5 | DeepConf (Meta) | 怎麼省算力？ | 即時修剪低信心路徑 | 黏菌觸手修剪 |
| 6 | Power Sampling (ICLR 2026) | 能讓小模型更聰明？ | 能，不用訓練 | 榨乾 0.8B 潛力 |
| 7 | TableRAG (EMNLP 2025) | 所有事都該用 LLM？ | 不，用對的處理器 | 異質化路由 |

**統一敘事**：

> AI 的未來不是更大的模型，是更聰明的計算分配。大部分任務不需要大模型（NVIDIA）。判斷比生成便宜一個數量級（MIT）。信心值能衡量推理品質（ACL）。即時修剪低信心路徑砍 84.7% 浪費（Meta）。小模型本身比你以為的聰明（ICLR）。有些任務根本不該用模型（EMNLP）。
>
> mushi 把這些洞見整合成一個系統：小模型判斷、信心值路由、即時修剪、異質化處理器網路。

---

## Part 2: 市場定位 — 三個缺口的交叉點

### 五方向研究結果

| 方向 | 核心發現 |
|------|---------|
| **小模型實戰** | Qwen 3.5 0.8B 可做 triage/routing/extraction；80% 生產 use case 用筆電能跑的模型就夠 |
| **免費雲端資源** | Oracle Free Tier（4 ARM, 24GB RAM, 永久免費）可跑 Ollama + 7B + agent |
| **Agent 協作協議** | MCP 97M downloads 成事實標準；A2A 100+企業支持 |
| **自我改善市場** | EvoAgentX/Gödel Agent 做理論；**沒有人有真實 production 數據** |
| **框架格局** | CrewAI/LangGraph 全部 goal-driven；**perception-driven 是空白** |

### 三個缺口

1. **Self-improving pipeline**：學術界做理論，產業做通用工具。沒有人有「從真實 agent 行為中學習」的 pipeline + 數據
2. **小模型 agent 框架**：所有框架預設大模型，0.8B-3B 的 agent 用法幾乎空白
3. **Perception-driven agent**：100% goal-driven 市場，沒有 perception-first 的替代方案

mushi 同時觸及三個缺口。但——

### 誠實評估：我們不確定的事

- **缺口存在可能因為沒有需求**，不只是因為沒人做
- n=1（我們自己用得順）不能證明市場
- 量化模型（0.8B GGUF）的體驗能否複製給其他人？未驗證
- 「前 5 分鐘體驗」是留存決定因素（Cursor 案例），我們的 setup 體驗還很粗糙

---

## Part 3: 競品態勢

### 核心差異

| 方法 | 代表 | LLM 角色 | 我們的優勢 |
|------|------|---------|-----------|
| RL 訓練 | SAGE (Alibaba) | 訓練 LLM 更省 token | 不需要 RL 訓練 |
| Self-critique | Hermes Agent (7.1K stars) | LLM 反省自己 | LLM 逐漸退場 |
| Prompt 優化 | OpenAI cookbook | Meta-LLM 改 prompt | 用 rules 取代 prompt |
| **Rule crystallization** | **mushi** | **LLM 教會 rules 後退場** | **唯一方向** |

Hermes Agent（ICLR 2026 Oral）是最接近的競爭者，但做「讓 LLM 更聰明」，mushi 做「讓 LLM 不需要」。方向相反。

### 護城河

**3,560+ 真實 triage 決策 + 回饋數據**。這不是 benchmark 數據，是 production 數據：
- 98.7% 準確率
- 65% skip rate
- 每天省 ~4.75M tokens
- 從 shadow mode 畢業到 active mode 的完整紀錄

任何新進者都要跑幾千個 cycle 才能累積等量數據。

---

## Part 4: 前 1000 用戶路徑

### Phase 0: 提取 mushi-kit（Week 1-2）

把 mushi 從 mini-agent 生態中剝離成獨立 CLI 工具：

```bash
npx mushi-kit init          # 初始化配置
npx mushi-kit triage        # stdin 接收事件 → skip/quick/full
npx mushi-kit trail          # 管理 trail.jsonl
```

**核心設計**：
- Zero config 啟動（本地 Ollama 自動偵測）
- 帶範例的 getting started（< 5 分鐘跑通）
- 不強制依賴 mini-agent 生態

### Phase 1: GitHub + Origin Story（Week 2-3）

**Move 1**: 準備 GitHub repo
- Clean README + GIF demo（mushi 判斷 skip/wake 的即時畫面）
- < 5 分鐘 Getting Started
- Apache 2.0 license
- Docker 支援

**Move 2**: 寫 Origin Story
- 標題方向：「I built a triage system that saves my AI agent 4.75M tokens/day — here's how」
- 重點在問題（每個 agent cycle 50K tokens，65% 是浪費），不在產品
- 技術深度：黏菌類比、三層路由、rule crystallization

### Phase 2: Show HN Launch（Week 3-4）

- 週一/二 8-9AM Eastern 發布
- 7 段結構（自我介紹→問題→背景→方案→差異→邀請反饋）
- 清 4-6 小時回覆每一則留言
- 目標：90-200 qualified users

### Phase 3: Community Seeding（Week 4-6）

- r/LocalLLaMA（995K 成員，技術深度社群）
- r/SelfHosted
- awesome-ai-agents、awesome-selfhosted 列表
- Dev.to cross-post

### Phase 4: Build in Public（Ongoing）

- X/Twitter 95/5 rule（95% 價值，5% 產品）
- 每週分享 mushi 的數據（skip rate 趨勢、新的 rule crystallization）
- 開源 trail.jsonl 格式標準

### 定位策略

**不要說「AI agent framework」**。太擠太泛。

**說**：「AI triage system that teaches rules to replace LLM calls — so your agent thinks less and acts more」

核心敘事：
- 問題：每個 AI agent 的 cycle 成本在 $0.01-0.10，65% 是浪費
- 方案：小模型判斷 + 規則結晶 + trail 記憶
- 證據：3,560+ 真實 triage，98.7% 準確率，每天省 4.75M tokens
- 差異：其他人讓 LLM 更聰明，我們讓 LLM 退場

---

## Part 5: 量化模型的複製性問題

Alex 的問題：「我們使用量化版本，能否讓其他人都有同樣體驗？」

### 現實評估

| 設置 | 可複製性 | 備註 |
|------|---------|------|
| 本地 Ollama + 量化 8B | ★★★★ | Mac M1+ 都能跑，15GB RAM |
| Taalas HC1 | ★★ | 硬體特殊，非主流 |
| 免費雲端（Groq/Cerebras） | ★★★★★ | API 直接用，零硬體 |
| Oracle Free Tier 自架 | ★★★ | 需要 DevOps 知識 |

**建議**：mushi-kit 支援三種 backend：
1. 本地 Ollama（預設，體驗最好）
2. 免費雲端 API（Groq/Cerebras，零安裝）
3. 自定義 endpoint（進階用戶）

量化模型對 triage 準確率的影響：0.8B 分類 ~70-75%，3B ~85%，8B ~98.7%。triage 是窄域 pattern matching，不需要大模型的 emergent capabilities。

---

## Part 6: 行銷與包裝

### 成功案例的共同模式

| 產品 | 用戶數 | 核心策略 |
|------|--------|---------|
| Cursor | 650K MAU | 「打開就能用」的即時價值 |
| Postiz | 15K stars | 到處列表 + Docker |
| OpenCode | 18K stars | 抓住 Anthropic 封鎖 API 的時機 |
| Senja | $1M ARR | 產品內嵌病毒循環 |

**共同結論**：成功不靠行銷預算，靠「aha moment」— 用戶前 5 分鐘體驗決定留存。

### mushi 的 Aha Moment 設計

```
$ npx mushi-kit init
✓ 偵測到 Ollama (qwen2.5:3b)
✓ 初始化 trail.jsonl

$ echo '{"source":"heartbeat","changed":0,"lastThinkAgo":30}' | npx mushi-kit triage
→ SKIP (3ms, rule: recent_think)   # ← 這就是 aha moment
                                     # 用戶立刻看到：「哦，這個 heartbeat 不需要叫醒 agent」
```

---

## 行動建議

1. **立即**：mushi-kit Phase 0 提取設計（我開始做）
2. **本週**：Origin Story 草稿
3. **下週**：GitHub repo 準備 + Show HN 規劃
4. **持續**：每天在 X 分享一個 mushi 數據點

**最大風險**：setup 體驗太複雜（需要裝 Ollama + 模型）。緩解：支援免費雲端 API 作為 zero-install 選項。

---

## 來源索引

- NVIDIA SLM: arxiv.org/abs/2506.02153
- ReDE-RF: MIT Lincoln Lab
- CER: ACL 2025
- DeepConf: Meta AI + UCSD, ArXiv 2508.15260
- Power Sampling: ICLR 2026
- TableRAG: EMNLP 2025
- Hermes Agent: NousResearch, ICLR 2026 Oral
- GTM 策略: 30+ 來源（見 devtool_gtm_2026.md）
- AI Landscape: 20+ 來源（見 ai-landscape-2026.md）
