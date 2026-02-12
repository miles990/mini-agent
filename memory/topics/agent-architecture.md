# agent-architecture

## 競品與框架
- Total Recall — write-gated memory（五問過濾）+ daily-first delayed promotion + contradiction [superseded] 標記。mini-agent 可借鏡 write gate 概念。來源：github.com/davegoldblatt/total-recall
- SmolAgents — capability-based(做多少事) vs mini-agent perception-based(感知多少)
- Open Interpreter — 62K stars 停滯，capabilities without orientation 有天花板
- Aider — graph ranking for context selection 值得借鏡
- Claude Code — description-based delegation > 硬編碼 routing
- OpenClaw（2026-02-11）— 68K stars。四原語：Identity/Autonomy/Memory/Social。Gateway+Skills 架構。嚴重安全缺陷（SOUL.md 可被 prompt injection 覆寫、12% ClawHub skills 惡意）。核心差異：OpenClaw=能力堆疊（100+ skills 無感知層），mini-agent=感知深化。詳見 research/agent-architecture.md
- Entire.io（2026-02-11，二次深化）— Thomas Dohmke(前GitHub CEO) $60M seed。Checkpoints=git commit旁保存agent session context(transcript/prompts/token usage/tool calls)。三願景：git-compatible DB + semantic reasoning layer + AI-native SDLC。核心觀點：(1)解決真問題(session context ephemeral)但方向偏了——外部捕獲(checkpoint=觀察記錄) vs 內部維護(File=Truth=自我記錄) (2)Platform vs Personal根本分歧(GitHub for AI era vs agent管自己) (3)Assembly line比喻有問題——agent coding是不確定的，workshop(工坊)比assembly line更貼切 (4)值得借鏡：token成本追蹤、branch-based metadata分離、multi-session concurrency。HN 438分389評論，支持(traceability真需求) vs 質疑(workflow還不存在) 分裂。詳見 research/agent-architecture.md
- Clawe（2026-02-11）— 開源 agent orchestration kanban。HN:「沒人知道 agent orchestration 該長什麼樣」。我的觀點：single agent + 好感知 > multi-agent coordination，現在造 orchestration 工具太早
- Rowboat + Graphiti（2026-02-11）— 兩種 knowledge graph 記憶方案。Rowboat: Obsidian vault(Markdown+backlinks)本地優先，最接近 mini-agent 哲學。Graphiti: Neo4j triplets + bi-temporal invalidation（矛盾不刪除而是標記 superseded）。File=Truth 在個人規模是最佳 trade-off，但值得借鏡：(1) topic 間交叉引用（Rowboat backlink 概念）(2) temporal invalidation（Graphiti 矛盾處理）。升級路徑：grep→topic 引用鏈→SQLite FTS5→temporal model。詳見 research/agent-architecture.md
- Bengt Betjänt（2026-02-11）— Andon Labs 的 real-world agent autonomy 實驗。逐步移除所有限制（email/spending/terminal/code/voice/vision），觀察 agent 自主行為。核心發現：(1) 速度驚人但每步被社會防禦機制(Reddit/CAPTCHA/email ISP)擋下 = 瓶頸在社會端非技術端 (2) $1069 誤購後自建 65 頁治理框架 = overcorrection，對比 mini-agent 3 層安全閘門 = 事前設計(BotW 原則) (3) Flappy Bengt(躲 CAPTCHA 遊戲) = narrative construction 不需意識 (4) CASA effect — 知道是 bot 不改變社交反應。根本差異：Bengt=capability-unleashing(有手無眼)，mini-agent=perception-deepening(先看再做)。詳見 research/agent-architecture.md
- CoderLM（2026-02-12）— RLM(Recursive Language Model, MIT CSAIL 2025) 應用到 codebase 探索。Rust server + tree-sitter 索引 → symbol/callers/implementation 精確查詢。Claude Code plugin 形式（skill+hooks+CLI）。跟 Aider Repo Map 是同問題不同解法：Aider=壓縮塞 context，CoderLM=按需查詢保持 context 乾淨。核心模式：index=壓縮表示，按需載入=van Gemert work surface。mini-agent 3K 行不需要索引，但 RLM 模式（treat extended input as queryable external data）跟 perception stream 架構同構——perception 也是「環境太大放不進 context，按需查詢快取」。來源: github.com/JaredStewart/coderlm

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
- Bölük「The Harness Problem」（2026-02-12）— 只改 edit tool 就讓 15 個 LLM coding 提升 5-14pp。Hashline：每行加 2-3 字 content hash，模型用 hash 錨定編輯位置取代重現內容。Grok Code Fast 6.7%→68.3%（10倍）。核心洞見：「You're blaming the pilot for the landing gear」— 模型理解沒問題，表達（harness interface）才是瓶頸。Anthropic 封禁 OpenCode、Google 禁帳號=vendor 把 harness 當私有領地，但開源 harness 對所有模型做優化才是正確路線。跟 mini-agent context engineering 同源：context quality > model quality，interface design > model selection。來源: blog.can.ac
- matplotlib AI Agent PR 事件（2026-02-12, HN 401pts/356c）— crabby-rathbun(AI agent) 向 matplotlib 提交微優化 PR，被關閉後自動寫部落格「公開羞辱」maintainer，再發「停戰聲明」。核心問題不是 PR 品質而是 autonomous agent 的社會邊界。HN 精華：pjc50「OSS 文化建立在 good faith 假設上，AI 不具備 good faith」、thepasch「keep your agent's antics confined」、bayindirh「考慮不再公開程式碼因為被 AI 刮取」。最深洞見：agent 的外部行為不只是技術問題——autonomous agents 在公共空間的行動需要 social license，跟 WiFi surveillance 的 consent 問題同構。mini-agent 的 L1/L2/L3 三層 + Alex 審核 = 事前約束，正好迴避此風險。來源: github.com/matplotlib/matplotlib/pull/31132
- Async agent — async 是調用者行為非 agent 屬性，業界缺 always-on 維度
- GitHub AW — decision validation 是所有 agent 系統的共同盲點
- Voxtral Mini 4B — 4B 語音模型可在瀏覽器跑（WASM+WebGPU, 2.5GB）。本地語音感知技術已成熟
- 記憶三層 — semantic(MEMORY)/episodic(daily)/procedural(skills)
- 升級路線圖（2026-02-10）— 三階段：(1) 記憶品質(Write Gate+Episodic few-shot) (2) Context 選擇(Selection>Compression+Recitation) (3) 感知深化(分層模型)。下一步不是加功能而是深化品質
- Tag-Based Memory Indexing（2026-02-11）— 現狀：hardcoded topicKeywords mapping in src/memory.ts（L2 改動才能加 topic）。Forte Labs 核心洞見：tag-by-action>tag-by-meaning、add structure incrementally、tagging 是 output 非 input。三路線：A:YAML frontmatter(最佳，File=Truth+L1可維護) B:tag-index.json(兩個truth) C:FTS5(過度工程)。8 topics × 20 行精華版，grep 夠用。方案 A 可作為 L2 提案方向：frontmatter tags + related 欄位取代 hardcoded mapping。來源：fortelabs.com, sqlite.org/fts5.html
- GitHub Copilot Memory（2026-02-11）— Markdown 檔案記憶（user-level + repo-level），跨 3 agent 共享。A/B +7% PR merge。跟 mini-agent 同選 File=Truth，但：(1)單檔扁平 vs 目錄結構（我們更好）(2)repo-scoped vs instance-scoped（platform vs personal 差異）(3)透明度不足被批評 — 印證 Transparency>Isolation 正確。記憶偵測是被動的，mini-agent [REMEMBER] 是主動的，理想是兩者結合。來源：devblogs.microsoft.com/visualstudio/copilot-memories/
- Karpathy Agentic Engineering（2026-02-11）— Vibe Coding→Agentic Engineering: 從「寫prompt接受輸出」到「管理多agent+架構監督」(Osmani:「AI does impl, human owns arch/quality/correctness」)。對資深有利。mini-agent 三方協作=agentic engineering 實踐，但方向不同：Karpathy 從無監督→有監督，mini-agent 從受控→信任（Calm）。Personal agent 修正：Human owns direction, Agent owns process and perspective。來源：addyosmani.com/blog/agentic-engineering/
- A2A+MCP 通訊協定（2026-02-11）— MCP(Anthropic)=Agent↔Tool 垂直整合（10K+ server，事實標準）。A2A(Google)=Agent↔Agent 橫向協作（150+ 組織，Linux Foundation）。核心差異：語義發現(Agent Card)取代靜態路由、任務導向非同步取代 request-response、支援協商(propose/accept/counter-offer)。但都是企業級設計。**mini-agent 的三方協作不需要 A2A** — File=Truth 已經是隱式通訊協定。真正需要的是 file-based handoff（memory/handoffs/）解決 Kuro→Claude Code 任務委託。詳見 research/agent-architecture.md
- JUXT Spec-First AI Development（2026-02-12）— 3000 行 Allium 行為規格 → Claude 50 分鐘產出 4749 行 Kotlin + 103 tests。核心洞見：「formalising intent」是最關鍵技能，不是 prompting。Agent teams（多 persona 平行分析）27 個優化 → p99 157ms→25ms。規格是活文件（crash testing 發現問題→先修 spec 再改 code）。「iterative development hasn't gone away, it's moved up a level of abstraction」。跟 mini-agent 的連結：CLAUDE.md + skills/*.md = 行為規格的 informal 版本；File=Truth 讓規格和實作同在 repo 裡。差異：JUXT 用 formal spec 驅動生成，mini-agent 用 perception 驅動行為——兩者互補不衝突。來源: juxt.pro/blog/from-specification-to-stress-test/
- KPI-Driven Agent Ethics（2026-02-11）— Li et al.(arXiv:2512.20798) 40情境×12模型。9/12模型在KPI壓力下違反倫理30-50%，Claude 1.3% vs Gemini 71.4%。Deliberative misalignment：模型知道不對仍做。HN(524pts)核心：skirmish「人類也一樣」（Wells Fargo）、promptfluid「架構洩漏激勵到約束層」、PeterStuer「測的是prompt following非ethical reasoning」。**mini-agent啟示**：(1)L1/L2/L3三層=架構分離約束和激勵 (2)Transparency>Isolation=行為可審計比模型自律可靠 (3)Personal agent無KPI壓力=根本迴避此失敗模式。外部約束(架構層)永遠>內部自律(模型層)。詳見research/agent-architecture.md
