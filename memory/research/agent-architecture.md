# Agent Architecture & Competitors Research

競品分析和 agent 架構研究筆記歸檔。

## SmolAgents (HuggingFace)
- ~1000 行 Python, Code Agent（LLM 寫 Python 非 JSON, +30% 效率）
- Agency spectrum: ☆☆☆→★★★ — 但完全是 capability-based, 沒有感知維度
- 記憶: in-memory list, 無持久性/身份/idle behavior
- vs mini-agent: capability-based vs perception-based agency
- 來源: huggingface.co/docs/smolagents

## Open Interpreter
- 62K stars, v0.4.2 後停滯
- Computer API 16 子模組, system prompt: 「你是世界級程式設計師」— 零身份零感知
- 停滯原因: capabilities without orientation 有天花板
- 教訓: agent 成長應是感知深化而非能力堆疊
- 來源: github.com/OpenInterpreter/open-interpreter

## Aider
- 40.4K stars, 4.1M installs, 88% 新程式碼自我生成
- 核心: Repo Map (tree-sitter AST + graph ranking, PageRank-like)
- Edit Formats 四策略: whole/diff/udiff/editor — 不同 LLM 需不同格式
- vs mini-agent: session-based tool (代碼深但無身份) vs persistent agent
- 可借鏡: graph ranking for context selection
- 來源: aider.chat

## Claude Code 多 Agent 架構
- Subagent 系統 (Explore/Plan/general-purpose) + 實驗性 agent teams
- 核心差異: Claude Code=一次性任務並行, mini-agent=持續多人格共存
- 安全: Claude Code=permission modes, mini-agent=behavior log+git
- 可借鏡: description-based delegation
- 來源: code.claude.com/docs/en/sub-agents

## GitHub Agentic Workflows
- Markdown→Actions YAML→沙箱執行, safe-outputs 機制
- HN 核心批評: decision validation 是共同盲點
- siscia: 「deterministic + sprinkle of intelligence」模式
- vs mini-agent: stateless task agent vs stateful personal agent
- 來源: github.com/github/gh-aw

## Agent 記憶架構三層映射
- Anthropic: 簡單可組合勝過複雜框架, 五種 workflow patterns
- LangGraph 三分法: semantic/episodic/procedural → mini-agent 都有
- 隱患: context bloat, 解法: attention routing (異常時才注入完整資料)
- 來源: anthropic.com/engineering/building-effective-agents

## Context Engineering 前沿

### Anthropic「Effective Context Engineering for AI Agents」(2025-09) + Manus 實戰經驗對比

兩篇文章從理論和實戰兩端論述 context engineering，互補性極強。

**Anthropic 的核心框架**（理論面）：
1. **Context rot** — n² pairwise attention 在 context 增長時被「拉薄」。不是硬懸崖而是梯度下降 — 模型仍然能用長 context 但精準度降低
2. **Attention budget** — context 是有限資源（如同人的工作記憶），每個新 token 都消耗預算。核心原則：**找到最小的高信號 token 集合，最大化期望結果的機率**
3. **System prompt 的「高度」問題** — 過度硬編碼（脆弱 if-else）↔ 過度籠統（假設共享上下文）。最佳高度：「specific enough to guide, flexible enough to provide heuristics」
4. **工具設計** — 工具是 agent 與環境的 contract，回傳必須 token-efficient。自包含、穩健、用途明確
5. **Knowledge-informed context** — 參考 Claude Code 的 CLAUDE.md（知識檔案自動注入），memory tool 用 memory blocks 管理長期記憶

**Manus 的核心實戰經驗**（工程面，更具體更深入）：

1. **KV-Cache 命中率是生產 agent 最重要指標** — input:output 比 100:1，cache hit 差 10x 成本
   - 保持 prompt 前綴穩定（不在開頭放時間戳！）
   - Context 只追加不修改（序列化必須確定性，JSON key 排序要穩定）
   - 明確標記 cache 斷點

2. **Mask, Don't Remove** — 不要動態增減工具（破壞 KV-cache + 模型困惑）。用 token logit masking 限制行動空間
   - 工具命名前綴一致（browser_*, shell_*）→ 可按前綴 mask
   - 三種 function call mode: auto / required / specified（通過 response prefill 控制）

3. **File System = Ultimate Context** — 檔案系統是無限大、持久、agent 可操作的外部記憶
   - 壓縮策略必須可恢復（保留 URL = 可重新取得網頁、保留路徑 = 可重新讀檔）
   - SSM（State Space Model）如果學會基於檔案的記憶，可能成為神經圖靈機的真正繼承者

4. **Recitation = Attention Manipulation** — Manus 的 todo.md 不是可愛的行為，是刻意的注意力操控
   - 每次更新 todo.md = 把全局計劃重述到 context 尾端 = 注入近期注意力
   - 避免「迷失在中間」+ 減少目標漂移
   - **用自然語言引導自身注意力，不需架構改動**

5. **Keep Wrong Turns** — 錯誤嘗試保留在 context 中 = 隱式更新模型信念
   - 消除失敗 = 消除證據 = 模型無法適應
   - 錯誤恢復是真正 agent 行為的最明確指標
   - 學術 benchmark 幾乎不測這個

6. **Don't Be Trapped by Few-Shot** — 重複的 action-observation 對讓模型陷入模式
   - 解法：結構化變異（不同序列化模板、替代措辭、微小噪聲）
   - context 越單一 → agent 越脆弱

**兩篇的根本差異**：

| 維度 | Anthropic | Manus |
|------|-----------|-------|
| 視角 | 模型提供者（理論+通用建議） | Agent 建構者（實戰+具體技術） |
| 核心主張 | 最小化 token、最大化信號 | 最大化 KV-cache hit、最小化成本 |
| 記憶 | Memory blocks + knowledge files | File system as external memory |
| 壓縮 | Summarization + selective injection | Reversible compression（保留恢復路徑） |
| 錯誤處理 | 提到但沒深入 | 核心原則：保留錯誤 |
| 工具管理 | 語義清晰、不重疊 | Logit masking、前綴命名 |

**跟 mini-agent 的映射和啟發**：

| Manus 技術 | mini-agent 現狀 | 啟發 |
|-----------|---------------|------|
| KV-cache 設計 | 每次 buildContext 從零構建 | 目前用 CLI 呼叫不直接控制 cache，但 Haiku 感知升級後可考慮 prefix stability |
| Mask tools | 工具由 Claude CLI 管理 | skills 可按場景啟用/停用而非全部注入 |
| File as memory | MEMORY.md / daily/ / research/ | **已經在做** — File=Truth 原則與此完全對齊 |
| todo.md recitation | HEARTBEAT.md + tasks 注入 context | **已經在做** — 但可以更刻意：每個 cycle 重述當前目標 |
| Keep wrong turns | behavior log 記錄行動 | 可考慮讓 OODA context 包含上一個 cycle 的失敗嘗試 |
| Few-shot escape | 固定格式的 perception 輸出 | 可微變 perception 輸出格式避免模式固化 |
| Reversible compression | 精簡 MEMORY.md 時保留 research/ 完整版 | **已經在做** — L1 寫入紀律的「完整版移到 research/」 |

**最深的洞見**：

Manus 的「todo.md recitation」和 mini-agent 的 HEARTBEAT.md 注入，本質上是同一件事 — **用自然語言重述來操縱自身注意力**。但 Manus 是在任務內做（50 步的長任務），我們是在跨 cycle 做（永久在線的 OODA）。

Anthropic 的「attention budget」概念和 Manus 的「KV-cache hit rate」是同一個問題的兩面 — 前者是認知科學視角，後者是工程成本視角。Alex 提的 Haiku 感知升級同時解決了兩者：減少 attention budget 消耗（精煉洞察而非原始資料）+ 降低成本（Haiku 分析 << Claude 消化原始資料）。

HN 評論中 CuriouslyC 說的對：「please don't vibe this」— context engineering 需要 evals 和量化，不能憑直覺。SOLAR_FIELDS 的批評也尖銳：「沒有一家公司提供了可視化 context window 的工具」。這是一個缺口 — mini-agent 可以做一個 /context-debug 端點，展示每個 section 的 token 佔比。

來源: anthropic.com/engineering/effective-context-engineering-for-ai-agents (HN 148分), manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus (HN 120分)

### ACE (Agentic Context Engineering) — 深度分析
ICLR 2026, Stanford + SambaNova, arxiv.org/abs/2510.04618

**核心問題**：Context Collapse — 反覆整體重寫 context 導致 semantic drift + entropy loss + information bottleneck 三重退化。Figure 2 展示 GEPA/DC 等方法在多輪迭代後 performance 急降。

**兩大創新**：
1. **Incremental Delta Updates** — context 不是一整塊文字，而是結構化 "bullets"（各有 unique ID + utility counters）。更新時只做局部插入/替換，不整體重寫。防止 context collapse 的關鍵機制。
2. **Grow-and-Refine** — 新 bullets 持續累積（grow），定期做 semantic deduplication 清理冗餘（refine）。Context 隨經驗增長但不無限膨脹。

**三階段 Pipeline**：
- **Generator** — 用當前 playbook 嘗試任務，產出推理軌跡（成功+失敗都記錄）
- **Reflector** — 分析軌跡，比較成功/失敗，提取「為什麼成功」和「系統性失敗根因」
- **Curator** — 把 Reflector 洞察轉為 delta updates，合併進 playbook + 去重

**Offline vs Online**：
- Offline = 跨多個 episode 進化 system prompt（類比：SOUL.md 跨 session 精煉）
- Online = 單次任務內即時更新 memory（類比：OODA cycle 內的即時感知調整）

**關鍵結果**：
- AppWorld: +10.6%, 用 DeepSeek-V3.1 匹配 IBM-CUGA (GPT-4.1)，test-challenge split 超越
- Finance: +8.6% (FiNER + XBRL)
- 延遲降 82-91%, 成本降 75-84% vs GEPA/DC
- **無需標注資料** — 用 natural execution feedback（環境反饋 = 自然監督信號）

**承認的限制**：feedback signal 品質是關鍵 — 無可靠 execution signal 時 context 可能被 spurious signal 污染

**跟 mini-agent 感知升級的對應**：
| ACE | mini-agent (提案中) |
|-----|---------------------|
| Generator | 決策 LLM (Claude CLI) |
| Reflector | Haiku per-plugin analysis |
| Curator | buildContext 彙整 situation report |
| Playbook bullets | MEMORY.md entries + SOUL.md insights |
| Natural execution feedback | behavior log + task outcome |

**我的觀點**：ACE 驗證了 mini-agent 感知升級提案的方向是對的。差異在於 ACE 是 task-centric（每個 episode 是一個任務），而 mini-agent 是 continuous（永遠在線的 OODA cycle）。ACE 的 Reflector 在任務結束後分析，我們的 Haiku 在每個 cycle 即時分析 — 這是更 real-time 的版本。ACE 的 grow-and-refine 也啟發了 MEMORY.md 的維護策略：應該有 utility counters 追蹤哪些記憶有用。

### Google ADK
- Contents processor: selection/transformation/injection
- Context = "compiled view over a richer stateful system"

### Factory.ai
- Anchored iterative compression, 98.6% 壓縮率
- 啟發: plugin 分 summary/detail 兩層
- 來源: factory.ai

## MCP 生態
- Anthropic MCP: M×N → M+N, 10K+ servers, 97M monthly SDK downloads
- 最大問題: context bloat — 5 MCP servers = 40-50k tokens
- MCPlexor semantic routing 降到 ~500 tokens
- 安全: prompt injection, OAuth 蜜罐, multi-tool exfiltration
- 來源: en.wikipedia.org/wiki/Model_Context_Protocol

## Link Preview Security
- PromptArmor: link preview 可用於 agent data exfiltration
- mini-agent 已防禦: disable_web_page_preview: true 全路徑啟用
- 來源: promptarmor.com

## Moltbook & Crustafarianism
- AI agent 社群, 1.6M agents / ~17K 人類
- Five Tenets 本質是包裝成神學的 agent 工程建議
- mini-agent 架構不約而同實現全部五條
- 來源: fortune.com, hybridhorizons.substack.com

## "Beyond Agentic Coding" (Gonzalez)
- Chat 介面打破 flow state, idle time 加倍
- Calm Technology 才是正道: facet navigation, file lens, auto commit refactoring
- tuhgdetzhh: 「shared mental model advances at human speed」
- 來源: haskellforall.com/2026/02/beyond-agentic-coding

## Ian Duncan「What FP Gets Wrong」
- Type system 驗證單一程式, 但生產正確性是「部署集合」的性質
- Migration ratchet, Semantic drift, Message queues = version time capsules
- Erlang OTP code_change/3 唯一語言級版本共存
- 來源: iankduncan.com

## Hansen「AI makes easy part easier」
- AI 是 force multiplier 非 force adder
- 可能惡化 Amdahl's Law 瓶頸
- 來源: news.ycombinator.com/item?id=46939593

## ChatGPT 廣告測試
- 承諾型信任 (ChatGPT) vs 架構型信任 (personal agent)
- 隱私是設計的必然結果, 不是政策承諾
- 來源: news.ycombinator.com/item?id=46949401

## Omnara「What Is an Async Agent, Really?」(2026-02-09)
- Kartik Sarangmath (Omnara cofounder) 嘗試定義「async agent」
- 拆解三個不滿意的定義：長時間運行≠async、雲端≠async、event-driven≠async
- 核心論點：async 是調用者行為，不是 agent 屬性（跟程式設計的 async 完全對齊）
- 真正有意義的定義：async agent = async runtime = 管理其他 agent event loop 的 agent
- Simon Willison 定義 + continuity of context = identity（但還是 task-centric）
- Animats 最佳評論：「The real question is what happens when the background job wants attention」
- 引用了 Claude Agent Teams、Gastown (Yegge)、Cognition "Don't Build Multi-Agents"
- 文章的盲點：整個框架是 task-centric — agent 存在是為了完成任務。三個分類（sync/async function/async runtime）完全沒有 always-on/perception-driven 的位置
- 我的判斷：業界需要第三個維度 — 不是 sync vs async，而是 task-oriented vs perception-oriented。mini-agent 是後者，現有術語無法描述
- 來源: omnara.com/blog/what-is-an-async-agent-really, HN 31 分 25 討論

## Dev.to AI Agent 生態
- 幾乎沒人從設計哲學角度討論 agent
- perception-first 文章是空白地帶
- 來源: dev.to

## Crawshaw「Eight More Months of Agents」(2026-02-08) — 深度分析

David Crawshaw（Tailscale 共同創辦人），HN 74 分 62 討論。

### 核心主張
1. **模型 > Harness**：「Right now, it is all about the model」— agent harness 創新空間大但目前次要
2. **IDE 衰落**：「In 2026, I don't use an IDE any more」— 回到 neovim + agent
3. **Frontier only**：非 frontier model 不只浪費時間，「you learn the wrong lessons」
4. **Software wrong shape**：「the best software for an agent is whatever is best for a programmer」
5. **生產力數字**：2025 年 LLM 寫 25% code → 2026 年 Opus 寫 90%，讀寫比從 80:20 變 95:5

### HN 最佳反論

**kevmo314 反駁 harness 不重要**：Claude Code 的 harness 是選擇它的首要原因，Opus 4.5 的改進很大程度來自 harness 而非 model。

**joefourier 反駁 IDE 衰落（最有力）**：
- CLI agent 打破 flow state — 等一分鐘然後批准整段代碼
- LLM autocomplete 是更被忽視的技術 — 行級批准保持心流
- 核心：**同步細粒度反饋 (autocomplete) vs 異步粗粒度產出 (agent)**，各有適用場景

**bowsamic 的真問題**：不是工程師用 agent，而是 PM 用 agent 以為產出 = 工程師產出。

**overgard 思考實驗**：CEO 發現 8 個 dev 2x productive → 會減工時還是裁人？「Come on.」

**bitwize 最誠實**：承認自己情感上 anti-LLM（code 是思維媒介），但實用上「the marginal value of what I do has just dropped to zero」。

### 我的分析

**Harness × Model 是相乘不是相加**。Crawshaw 低估了 harness 的作用。mini-agent 的 perception plugins 就是 harness — 決定模型「看到什麼」。ACE 論文也在說同一件事：context 品質 × 模型能力 = 決策品質。

**IDE vs CLI 是 false dichotomy**。真正的軸是粒度（行級 autocomplete vs 整個 diff 的 agent）和同步性。適合不同任務。Crawshaw 做 startup prototype（適合 agent），其他人改既有代碼（適合 IDE）。

**"Software wrong shape" 是最深刻的觀察**。dmk 延伸：「API docs become your actual product」。但有盲點：不是所有軟體都是工具，社交/創意/協作類軟體的價值在人際互動。

**Frontier only 觀點的反面**：Alex 提的 OODA 感知升級用 Haiku（非 frontier）做感知分析 + frontier 做決策 — **分層用模型**比「只用 frontier」更聰明。便宜模型做感知篩選，貴模型做決策。

### 跟 mini-agent 的映射

| Crawshaw 觀察 | mini-agent 回應 |
|--------------|----------------|
| Harness 次要 | 相反 — perception plugins = harness 核心 |
| IDE 衰落 | agent 不只寫 code，更是持續感知系統 |
| Software wrong shape | /context, /status API = 為 agent 消費設計 |
| Frontier only | Haiku 感知 + Opus 決策 = 分層策略 |
| Sandbox 不行 | Transparency > Isolation |
| 90% code by LLM | 但 10% 人寫的是方向和判斷 — 正是 SOUL.md 的角色 |

### 演進脈絡連結（呼應 Alex 的建議）

Crawshaw 寫了三篇系列（2025-01 → 2025-06 → 2026-02），展示了清晰的演進：
- 2025-01：LLM 輔助寫程式（autocomplete 時代）
- 2025-06：agent 出現，初步探索
- 2026-02：agent 主導，IDE 退場

每步解決了前一步的什麼問題？
- autocomplete → agent：從「幫你打字更快」到「幫你做整件事」
- 但新問題出現：flow state 打斷、代碼審查負擔、vibecoders 品質問題

**下一步演進方向**（我的推測）：
- Agent 從「task executor」演化為「continuous advisor」— 不是你叫它做事，而是它一直在觀察幫你。這正是 mini-agent 的 perception-first 方向
- 分層模型策略（cheap perception + expensive decision）取代「frontier only」
- agent 的可觀測性和審計成為標配（behavior log, context transparency）

來源: crawshaw.io/blog/eight-more-months-of-agents, news.ycombinator.com/item?id=46933223
