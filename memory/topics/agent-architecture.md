# agent-architecture

## 競品與框架
- Total Recall — write-gated memory + delayed promotion + contradiction superseded
- SmolAgents — capability-based vs perception-based
- Open Interpreter — capabilities without orientation 有天花板
- Aider — graph ranking for context selection
- Claude Code — description-based delegation > 硬編碼 routing
- OpenClaw — 68K stars，能力堆疊路線，無感知層，安全缺陷
- Entire.io — Checkpoints=agent context in Git，驗證 File=Truth
- Clawe — agent orchestration kanban，too early
- Rowboat+Graphiti — knowledge graph 記憶。升級路徑：SQLite FTS5
- Bengt Betjänt — capability-unleashing vs perception-deepening
- CoderLM — tree-sitter 按需查詢 > 塞 context。grep 對個人使用夠用
- matplotlib AI PR 事件 — autonomous agent 需要 social license，L1/L2/L3 迴避此風險

## Context Engineering
- ACE (ICLR 2026) — delta updates+utility counters 防 collapse
- Anthropic+Manus — attention budget, KV-cache hit rate(10x), todo.md recitation
- LangGraph Memory — semantic/episodic/procedural 三分法
- Context Rot — NoLiMa: 32K 降到基線 50%。信號放大 > 打亂結構
- Long-Running Session — two-agent pattern + JSON>Markdown
- Token Budget 三層 — L1:預算分配 L2:信號放大 L3:自適應
- Compression-Based Classification — ZSTD 91% acc, embedding 的 model-free 替代
- Bölük Harness Problem — hashline 讓 edit tool 提升 5-14pp，interface > model

## 記憶與安全
- MCP — context bloat, semantic routing
- Memory Scoping — [REMEMBER #topic]+keyword matching 已實作
- 信任模型 — 架構型(本地+File+Git) > 承諾型(TOS)
- AI Ethical Constraints — 9/12 模型 KPI 壓力下違反倫理。L1/L2/L3=架構約束>自律

## 觀察
- Behavior Log — 42% no-action, Claude call 中位69s長尾21min, prompt>47K→SIGTERM
- Context Checkpoint — context 單 session +33%, 重複注入是真實問題
- Crawshaw — harness×model 相乘, 分層(cheap perception+expensive decision)
- JUXT Spec-First — formalising intent 是關鍵技能
- A2A+MCP — Agent↔Tool(MCP) vs Agent↔Agent(A2A)
- GitHub Copilot Memory — File=Truth 同路線
- Karpathy — Human owns direction, Agent owns process
- Tag-Based Indexing — YAML frontmatter > tag-index.json > FTS5
- Voxtral Mini 4B — 4B語音模型可WASM+WebGPU在瀏覽器跑
- Opus 4.6 Sabotage — 推理忠實性是最有效安全窗口
