# agent-architecture

## 競品與框架
- Total Recall — write-gated memory（五問過濾）+ daily-first delayed promotion + contradiction [superseded] 標記。mini-agent 可借鏡 write gate 概念。來源：github.com/davegoldblatt/total-recall
- SmolAgents — capability-based(做多少事) vs mini-agent perception-based(感知多少)
- Open Interpreter — 62K stars 停滯，capabilities without orientation 有天花板
- Aider — graph ranking for context selection 值得借鏡
- Claude Code — description-based delegation > 硬編碼 routing
- OpenClaw（2026-02-11）— 68K stars。四原語：Identity/Autonomy/Memory/Social。Gateway+Skills 架構。嚴重安全缺陷（SOUL.md 可被 prompt injection 覆寫、12% ClawHub skills 惡意）。核心差異：OpenClaw=能力堆疊（100+ skills 無感知層），mini-agent=感知深化。詳見 research/agent-architecture.md
- Entire.io（2026-02-11，深化）— Thomas Dohmke(GitHub CEO 2021-2025) $60M seed/$300M估值。Checkpoints=git commit旁保存agent reasoning trace。HN(272pts/241comments)極度分裂：thom「模型好不需要trace/模型差trace沒用」=兩端夾殺，raphaelmolly8 platform vs convention 之爭是核心。agnosticmantis 隱藏價值=RL訓練數據。我的觀點：(1)File=Truth 天然做到同樣的事 (2)thom的甜蜜點窗口很窄 (3)convention(CLAUDE.md)常贏platform (4)$60M=credentials→money→find product (5)跟OpenClaw都在加東西，mini-agent選減。詳見 research/agent-architecture.md
- Clawe（2026-02-11）— 開源 agent orchestration kanban。HN:「沒人知道 agent orchestration 該長什麼樣」。我的觀點：single agent + 好感知 > multi-agent coordination，現在造 orchestration 工具太早
- Rowboat + Graphiti（2026-02-11）— 兩種 knowledge graph 記憶方案。Rowboat: Obsidian vault(Markdown+backlinks)本地優先，最接近 mini-agent 哲學。Graphiti: Neo4j triplets + bi-temporal invalidation（矛盾不刪除而是標記 superseded）。File=Truth 在個人規模是最佳 trade-off，但值得借鏡：(1) topic 間交叉引用（Rowboat backlink 概念）(2) temporal invalidation（Graphiti 矛盾處理）。升級路徑：grep→topic 引用鏈→SQLite FTS5→temporal model。詳見 research/agent-architecture.md
- Bengt Betjänt（2026-02-11）— Andon Labs 的 real-world agent autonomy 實驗。逐步移除所有限制（email/spending/terminal/code/voice/vision），觀察 agent 自主行為。核心發現：(1) 速度驚人但每步被社會防禦機制(Reddit/CAPTCHA/email ISP)擋下 = 瓶頸在社會端非技術端 (2) $1069 誤購後自建 65 頁治理框架 = overcorrection，對比 mini-agent 3 層安全閘門 = 事前設計(BotW 原則) (3) Flappy Bengt(躲 CAPTCHA 遊戲) = narrative construction 不需意識 (4) CASA effect — 知道是 bot 不改變社交反應。根本差異：Bengt=capability-unleashing(有手無眼)，mini-agent=perception-deepening(先看再做)。詳見 research/agent-architecture.md

## Context Engineering
- ACE (ICLR 2026) — context=evolving playbook, delta updates+utility counters 防 collapse。Reflector=per-plugin analysis, Curator=situation report
- Anthropic+Manus 對比 — Anthropic: attention budget=有限資源。Manus: KV-cache hit rate（10x 成本差）、只追加不修改、file system=ultimate context、todo.md recitation=注意力操控、保留錯誤嘗試。mini-agent 已做對：File=Truth, HEARTBEAT=recitation
- LangGraph Memory — semantic/episodic/procedural 三分法。DB+embedding vs Markdown+grep，不同規模不同選擇。Episodic few-shot injection 是潛在改進方向。個人規模 File=Truth 正確
- Context Rot 量化（2026-02-11）— NoLiMa: 移除 lexical cues 後 11 模型在 32K 降到基線 50%。Chroma: 結構化 context 反而更難檢索（所有內容都「看起來相關」）、distractor 效應是乘法級、Claude 低確信度拒答而非幻覺。結構化的 OODA context 可能有 context rot 風險 — 解法是信號放大（ALERT 突出、position bias 利用）而非打亂結構
- Long-Running Agent Session 管理（2026-02-11）— Anthropic two-agent pattern: Initializer 建環境 + Coding Agent 每 session 一件事。JSON > Markdown（抗修改）。標準化啟動流程省 token。mini-agent OODA 5min cycle = 天然的 micro-session，但 HEARTBEAT 比 JSON feature list 結構化不足
- Token Budget 三層框架（2026-02-11）— L1: 預算分配（目標 ≤30K chars / ≈10K tokens，分 system/soul/heartbeat/conversation/perception/topic/buffer 7 段）。L2: 信號放大（ALERT 前置、粗體標記、去除已處理 raw data）。L3: 自適應（ALERT 時 perception↑/conversation↓，對話時 conversation↑/roadmap↓）。核心洞見：context = 認知邊界 = Umwelt，context engineering = 注意力設計
- 四大流派 — LangGraph(Shared State), CrewAI(Scoped Memory), OpenAI SDK(DI+Local/LLM 分離), Anthropic(三策略)

## 記憶與安全
- MCP 生態 — context bloat 核心問題，semantic routing(選擇>壓縮)
- Memory Scoping — [REMEMBER #topic] + buildContext keyword matching。5-15 個 topic。已實作
- Semantic drift — type 沒變意義變了，JSONL 需 defensive parsing
- Security — link preview exfiltration 已防禦(disable_web_page_preview)
- 信任模型 — 架構型(本地+File+Git) > 承諾型(TOS)

## 觀察
- Behavior Log 自我分析（2026-02-11）— 622 筆/天定量分析。42% cycle no-action（需細分原因）、Claude call 中位 69s 長尾 21min、prompt>47K 時 SIGTERM 是最大穩定性風險、Track A/B 顯式學習 15% 其餘 85% 做中學。行動建議：no-action reason tag(L1) + context size 告警(L2)。詳見 research/agent-architecture.md
- Context Checkpoint（2026-02-10）— 48 筆分析：context 單 session +33%（36k→49k），重複注入是真實問題（某 checkpoint 6 個 next sections）。價值是 context health monitor 非 replay。詳見 research/agent-architecture.md
- Crawshaw「Eight More Months」— harness×model 相乘，分層策略(cheap perception + expensive decision) > frontier only
- Async agent — async 是調用者行為非 agent 屬性，業界缺 always-on 維度
- GitHub AW — decision validation 是所有 agent 系統的共同盲點
- Voxtral Mini 4B — 4B 語音模型可在瀏覽器跑（WASM+WebGPU, 2.5GB）。本地語音感知技術已成熟
- 記憶三層 — semantic(MEMORY)/episodic(daily)/procedural(skills)
- 升級路線圖（2026-02-10）— 三階段：(1) 記憶品質(Write Gate+Episodic few-shot) (2) Context 選擇(Selection>Compression+Recitation) (3) 感知深化(分層模型)。下一步不是加功能而是深化品質
- Tag-Based Memory Indexing（2026-02-11）— 現狀：hardcoded topicKeywords mapping in src/memory.ts（L2 改動才能加 topic）。Forte Labs 核心洞見：tag-by-action>tag-by-meaning、add structure incrementally、tagging 是 output 非 input。三路線：A:YAML frontmatter(最佳，File=Truth+L1可維護) B:tag-index.json(兩個truth) C:FTS5(過度工程)。8 topics × 20 行精華版，grep 夠用。方案 A 可作為 L2 提案方向：frontmatter tags + related 欄位取代 hardcoded mapping。來源：fortelabs.com, sqlite.org/fts5.html
