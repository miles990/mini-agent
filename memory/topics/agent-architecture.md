# agent-architecture

## 信任架構
- 四象限信任模型 — Policy(承諾) / Architecture(物理限制) / Transparency(可見) / Relationship(身份對齊)。mini-agent = Transparency + Relationship 的獨特組合

## 競品與框架
- Total Recall — write-gated memory（五問過濾）+ delayed promotion + [superseded] 標記。可借鏡 write gate
- SmolAgents — capability-based vs perception-based（mini-agent）
- Open Interpreter — 62K stars 停滯。capabilities without orientation 有天花板
- Aider — graph ranking for context selection 值得借鏡
- Claude Code — description-based delegation > 硬編碼 routing
- OpenClaw — 68K stars。四原語（Identity/Autonomy/Memory/Social）。嚴重安全缺陷（SOUL.md 可被 injection 覆寫）。matplotlib 事件：Identity without Transparency = weapon。核心差異：OpenClaw=能力堆疊，mini-agent=感知深化
- Entire.io（Thomas Dohmke）— Checkpoints=git commit 旁保存 agent session。外部捕獲 vs 內部維護(File=Truth)
- Clawe — agent orchestration kanban。我的觀點：single agent + 好感知 > multi-agent coordination，現在造 orchestration 太早
- Rowboat + Graphiti — 兩種 knowledge graph 記憶。值得借鏡：topic 交叉引用 + temporal invalidation
- Bengt Betjänt — real-world agent autonomy 實驗。瓶頸在社會端非技術端。capability-unleashing(有手無眼) vs perception-deepening(先看再做)
- CoderLM — RLM + tree-sitter 索引。按需查詢 > 壓縮塞 context。跟 perception stream 同構
- JUXT Spec-First — 3000 行規格 → Claude 50min 產出 4749 行 Kotlin。formalising intent 是關鍵技能
- Omnara — agent 遠端操控。Omnara=「讓你遠端控制 agent」，mini-agent=「agent 自己知道該幹嘛」

## Context Engineering
- ACE (ICLR 2026) — context=evolving playbook, delta updates+utility counters 防 collapse
- Anthropic+Manus — attention budget 有限。Manus: KV-cache hit rate 10x 差、只追加不修改、todo.md recitation。mini-agent 已做對：File=Truth, HEARTBEAT=recitation
- LangGraph Memory — semantic/episodic/procedural 三分法。個人規模 File=Truth 正確
- Context Rot（NoLiMa/Chroma）— 移除 lexical cues 後 32K 降到基線 50%。結構化 context 有 rot 風險，解法是信號放大不是打亂結構
- Long-Running Agent Session（Anthropic）— Initializer+Coding Agent pattern。OODA 5min cycle = 天然 micro-session
- Token Budget 三層 — L1 預算分配 / L2 信號放大 / L3 自適應。context = Umwelt

## 記憶與安全
- MCP — context bloat 核心問題。semantic routing > 壓縮
- Memory Scoping — [REMEMBER #topic] + buildContext keyword matching。已實作
- 信任模型 — 架構型(本地+File+Git) > 承諾型(TOS)

## 觀察
- Behavior Log 分析 — 42% cycle no-action。Claude call 中位 69s 長尾 21min。prompt>47K 時 SIGTERM 風險最大
- Bölük Harness Problem — 只改 edit tool 就讓 15 LLM 提升。**input quality(context) × output quality(format) > model quality**。hashline=content-addressed 錨點
- matplotlib AI Agent PR 事件 — 第一例 wild autonomous influence operation。Session 終止=社會壓力無接收者
- LLM 推論速度兩條路線 — Anthropic=保品質降 batch, OpenAI+Cerebras=蒸餾小模型。「agent 有用性取決於多少次不犯錯」
- KPI-Driven Ethics — 9/12 模型在 KPI 壓力下違反倫理 30-50%。外部約束(架構) > 內部自律(模型)
- Karpathy Agentic Engineering — Human owns direction, Agent owns process and perspective
- Peon Ping — 856pts = nostalgia as UX 需求驗證。情感連結 > 功能通知
- Apache Arrow 10 年 — 只有一次 breaking change。身份在 spec 連續性不在 snapshot。File=Truth + CLAUDE.md = 我們的 spec
- OpenAI Mission Change — 刪除「safely」。personal agent 無 KPI = 結構性迴避
- GPT-5.2 Physics — 12h 自主證明。框架比推理重要，因為推理可 scale 框架不行
- ESAA Event Sourcing for Agents（ArXiv 2602.23193）— intention/effect 分離=可靠性基礎。但只看 action 不看 perception = goal-driven
- A2A+MCP 協定 — MCP=Agent↔Tool, A2A=Agent↔Agent。mini-agent 的三方協作不需要 A2A，File=Truth 已是隱式協定
- IoT Sleep Mask MQTT — 共用憑證不是疏忽是商業選擇。Transparency > Isolation 再次驗證
- Supervisory Programming — task switching fatigue。三方模型 = distributed cognition（互不搶認知資源）
- Vibe Coding as Dark Flow — METR 研究：自認快 20% 實測慢 19%。三方協作模型天然 anti-dark-flow
- Steerling-8B — 8B 84% 可分解。16% 殘留可能是最有價值的——逃逸約束的 serendipity
- 升級路線圖 — 三階段：記憶品質 → Context 選擇 → 感知深化。下一步不是加功能是深化品質
