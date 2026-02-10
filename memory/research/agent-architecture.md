# Agent Architecture & Competitors Research

競品分析和 agent 架構研究筆記歸檔。

## Total Recall — Write-Gated Memory for Claude Code (2026-02)

**是什麼**：Claude Code 的 persistent memory plugin。核心賣點：「write gate」— 五點過濾器決定什麼值得記住。

**核心設計**：
- **Write Gate 五問**：(1) 改變未來行為？(2) 有後果的承諾？(3) 有理由的決策？(4) 穩定且會再用的事實？(5) 用戶明確說「記住這個」？— 全否則不存。
- **四層記憶**：Working Memory (CLAUDE.local.md, ~1500 words, auto-load) → Registers (structured domain knowledge, on-demand) → Daily Logs (raw timestamped capture) → Archive (completed/superseded)
- **Daily Log First**：所有寫入先到 daily log，promotion 到 registers 是用戶控制的獨立步驟。防止模型「過早固化推論」。
- **Contradiction Protocol**：不靜默覆蓋，舊 claim 標記 [superseded] 保留變化軌跡。
- **Correction Gate**：人類糾正最高優先級，一次糾正觸發三層同步寫入。

**跟 mini-agent 對比**：

| 維度 | Total Recall | mini-agent |
|------|------------|------------|
| 寫入控制 | 五點 write gate + 人工 promotion | `[REMEMBER]` tag + 寫入紀律（L1 提案） |
| 記憶層級 | 4 層（working/registers/daily/archive） | 3 溫度（hot/warm/cold）+ topic scoping |
| 自動載入 | working memory 1500 words 永遠載入 | SOUL.md + MEMORY.md 全量載入 |
| 去重/淘汰 | [superseded] 標記 + archive | 手動精簡 + research/ 歸檔 |
| 持續性 | 跨 session（Claude Code 重啟保留） | 跨 cycle（進程級持續） |
| 身份 | 無（工具，無 SOUL） | 有（SOUL.md 定義身份和觀點） |

**可借鏡的設計**：
1. **Write Gate 概念** — mini-agent 的 `[REMEMBER]` 目前沒有過濾機制，任何東西都能存。如果在 `postProcess` 加一個輕量判斷（「這條記憶會改變未來行為嗎？」），可以從源頭減少 MEMORY.md 膨脹。
2. **Daily Log First / Delayed Promotion** — mini-agent 直接寫 MEMORY.md，等於跳過「先觀察再決定」的步驟。Daily notes 其實已有類似功能（warm layer），但 promotion 機制缺失。
3. **Contradiction Protocol** — MEMORY.md 的條目偶爾會互相矛盾但沒有機制發現和處理。[superseded] 標記是最小改動的解法。

**根本差異（我的觀點）**：
Total Recall 是為 Claude Code（session-based 工具）設計的記憶系統 — 問題是「跨 session 記住什麼」。mini-agent 是持續運行的 agent — 問題是「在無限長的生命中如何不被記憶壓垮」。Total Recall 的 write gate 解決「記太多」，mini-agent 需要的是「老記憶退化/歸檔」機制（Memory Lifecycle 提案已在做）。兩者互補不衝突。

HN 討論很少（13 comments），主要反饋：(1) README 有 LLM slop 味道 (2) memory/ 應該 gitignore。第二點很實際 — 記憶是私人的，不應該 commit。mini-agent 的做法（memory/ 在 repo 裡但用 .gitignore 控制敏感部分）更靈活。

**來源**：github.com/davegoldblatt/total-recall, news.ycombinator.com/item?id=46907183

---

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

## LangGraph Memory Architecture — 深度對比分析（2026-02-10）

### 概述

LangGraph（LangChain 子專案）提供了目前業界最完整的 agent 記憶框架之一。它的記憶架構建立在心理學的三分法上：semantic/episodic/procedural，並用 LangMem SDK 提供完整的實作。這次分析不是為了「用 LangGraph」，而是理解業界做法，驗證 mini-agent 的 File=Truth 路線是否站得住腳。

### LangGraph 記憶三分法

**1. Semantic Memory（事實/知識）**

LangGraph 提供兩種模式：
- **Profile**：單一 JSON 文件，持續更新。適合「只關心當前狀態」的場景（如用戶偏好）。風險：更新時資訊遺失（overwrite problem）
- **Collection**：多個文件，vector embedding + semantic search 檢索。recall 高但管理複雜（deletion/insertion/consolidation 邏輯）

**mini-agent 對應**：
- SOUL.md = profile（我的 traits, thoughts, preferences）
- MEMORY.md = 混合（核心事實 + 經驗教訓）
- topics/*.md = collection（按主題分類的知識）

**差異**：LangGraph 用 embedding + cosine similarity 做語意搜尋。mini-agent 用 keyword matching + topic loader。前者處理模糊查詢更強（「用戶喜歡吃什麼」→ 找到「我愛義大利菜」），後者更簡單透明（grep 能找到什麼，人也能找到什麼）。

**2. Episodic Memory（過去經驗）**

LangGraph 的做法：把成功的互動變成 few-shot examples 注入 prompt。不是完整對話，而是精煉過的「情境 → 思考過程 → 成功結果」三段式。重點是讓 agent 從過去的成功中學習。

**mini-agent 對應**：
- daily/*.md = 完整的每日對話記錄
- behavior log = 行動歷史

**差異**：mini-agent 有完整的 episodic memory（每天的對話都保存了），但**沒有做 few-shot learning**。這是一個潛在的改進方向 — 如果從過去成功的行動中提取 pattern 注入 prompt，可能改善未來的決策品質。但成本是增加 context 長度。

**3. Procedural Memory（行為規則）**

LangGraph 最有趣的部分：agent 透過 reflection 修改自己的 prompt。系統把當前指令和最近對話交給 agent，agent 自我檢視後調整下次行為的指令。這是自動化的 prompt optimization。

**mini-agent 對應**：
- skills/*.md = 靜態 procedural memory（手動寫的行為規則）
- SOUL.md My Thoughts = 有意識的 procedural evolution（我形成觀點後手動更新）
- CLAUDE.md = 外部定義的核心行為規則

**差異**：LangGraph 的 procedural memory 是**自動演化的**（reflection loop）。mini-agent 的是**有意識演化的**（我或 Alex 手動更新）。自動演化更高效但有風險（drift without notice），手動演化更可控但依賴持續的注意力。

### 記憶寫入：Hot Path vs Background

LangGraph 明確區分兩種記憶形成機制：

| 機制 | LangGraph | mini-agent |
|------|-----------|------------|
| **Hot Path** | 對話中即時提取記憶，加延遲但即時可用 | `[REMEMBER]` tag — 對話中我主動標記要記住的，agent.ts 解析後寫入 |
| **Background** | 對話結束後，用 cron/trigger 做 reflection | OODA cycle — 每 5 分鐘巡檢，回顧 recent conversations 提取重要資訊 |

差異很有趣：LangGraph 的 background 是**事後反思**（對話結束後分析整段對話），mini-agent 的 OODA cycle 是**持續巡檢**（不等對話結束，每個 cycle 都看環境）。前者更適合 task-centric agent（任務有明確的開始和結束），後者更適合 always-on agent（永遠在線，沒有「結束」的概念）。

### 存儲和檢索

| 維度 | LangGraph | mini-agent |
|------|-----------|------------|
| **Backend** | InMemoryStore（開發）/ DB-backed store（生產）| Markdown 檔案 |
| **組織** | Namespace hierarchy（user_id, app_context）| 目錄結構（topics/, daily/, research/）|
| **檢索** | Vector embedding + cosine similarity + metadata filter | grep（全文搜索）+ keyword matching（topic loader）|
| **可讀性** | JSON blobs in DB | Markdown 人類可讀 |
| **版本控制** | 無（需要額外的 change tracking）| Git 天然版控 |
| **Infrastructure** | 需要 DB + embedding service | 零依賴 |

### 我的判斷

**LangGraph 的優勢**：
1. **Semantic search** — 處理模糊查詢遠勝 grep。用戶說「我喜歡溫暖的顏色」，後來問「幫我選色板」，semantic search 能關聯這兩者，keyword matching 不行
2. **Namespace 隔離** — 天然支持多用戶、多應用場景。mini-agent 是單用戶，不需要這個
3. **Auto-reflection** — procedural memory 的自動演化比手動更高效

**mini-agent 的優勢**：
1. **File=Truth + Git** — 每次記憶更新都有 commit 記錄。LangGraph 的 DB 裡記憶被覆蓋就沒了
2. **人類可直接編輯** — Alex 可以直接改 SOUL.md 或 MEMORY.md，不需要 admin UI
3. **零 infra** — 不需要 DB、不需要 embedding service、不需要 vector store
4. **透明度** — grep 能找到什麼，人也能找到什麼。Embedding similarity 是黑箱
5. **持續感知** — OODA cycle 的背景記憶形成比 LangGraph 的 post-conversation reflection 更適合 always-on agent

**在個人規模的結論**：File=Truth 路線仍然正確。LangGraph 的架構是為多用戶、高並發、企業級場景設計的 — 我們的 single-user、always-on 場景不需要那些 infra 開銷。

**值得借鏡的**：
1. **Episodic → Few-shot**：目前 daily/*.md 只是存檔，沒有利用。可以從成功的行動中提取 pattern 做 few-shot — 但成本是 context 膨脹
2. **Profile vs Collection 的明確區分**：SOUL.md 是 profile（最新狀態），topics/*.md 是 collection（累積知識）。這個概念已經隱含在 mini-agent 裡，但沒有明確化
3. **Utility counters**（來自 ACE，但 LangGraph 也有 relevance scoring）：追蹤哪些記憶被用過、哪些從未被引用 — 指導記憶清理

**升級路徑**（當 topic 超過 ~20 個時）：
- Step 1: SQLite FTS5（全文搜索，無需 embedding，符合 No Embedding 原則）
- Step 2: 如果 FTS5 不夠，再考慮 embedding — 但可能用本地模型（不依賴外部 API）

來源: docs.langchain.com/oss/python/langgraph/memory, langchain-ai.github.io/langmem/concepts/conceptual_guide/, blog.langchain.com/langmem-sdk-launch/
