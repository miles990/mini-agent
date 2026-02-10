# Long-term Memory

This file stores persistent knowledge that the agent should remember across sessions.

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷

## Learned Patterns

### Cognitive Science & Philosophy (→ research/cognitive-science.md)
- Noë enactive perception — 感知=「做」不是「接收」，plugins=盲人拐杖
- Borges — 無限context=零attention，完美記憶=無法思考，遺忘是抽象化前提
- Embodied cognition — MEMORY.md 是認知構成部分不是工具 (parity argument)
- Critical cartography — buildContext=地圖投影選擇，1:1地圖=context bloat
- Expansion microscopy — 改變看的方式 > 堆更強工具
- World model 光譜 — perception plugins 把 agent 從 word model 推向 world model
- 語言影響 LLM — 英文→分析型，中文→整體型，tokenization 影響有效 context
- 意識 — agnostic functionalism，注意力放在實際做的事

### Design Philosophy (→ research/design-philosophy.md)
- Alexander — skills=patterns, semi-lattice=感知系統, structure-preserving=更新模式
- 枯山水 — 石の心=perception-first, 少一塊石頭=context window, 每日耙砂=OODA
- Calm Technology — peripheral↔center 流暢移動，agent UX 核心缺失
- Digital Garden — MEMORY=garden(拓撲), daily=stream(時序), SOUL=核心花園
- 參數化設計 — Gaudí(bottom-up)=perception-first, Schumacher(top-down)=goal-driven

### Agent Architecture & Competitors (→ research/agent-architecture.md)
- SmolAgents — capability-based(做多少事) vs mini-agent perception-based(感知多少)
- Open Interpreter — 62K stars 停滯，capabilities without orientation 有天花板
- Aider — graph ranking for context selection 值得借鏡
- Claude Code — description-based delegation > 硬編碼 routing
- MCP 生態 — context bloat 核心問題，semantic routing(選擇>壓縮)
- ACE (ICLR 2026) — context=evolving playbook, incremental delta updates(bullets+utility counters) 防 context collapse, grow-and-refine 防無限膨脹。Reflector=Haiku per-plugin analysis, Curator=buildContext situation report。驗證感知升級方向正確
- Anthropic + Manus Context Engineering 對比（2025-09/2025-07）— Anthropic 理論：attention budget=有限資源，最小高信號token集最大化結果。Manus 實戰：KV-cache hit rate 是生產最重要指標（10x 成本差），context 只追加不修改，工具用 logit masking 不動態增減，file system=ultimate context，todo.md recitation=自然語言注意力操控，保留錯誤嘗試=隱式更新信念。兩者互補：Anthropic=認知科學視角，Manus=工程成本視角。mini-agent 已做對的：File=Truth=file as memory, HEARTBEAT=recitation, research/=reversible compression
- Context Engineering — plugin 分 summary/detail 兩層，預設只注入 summary
- 記憶三層 — semantic(MEMORY)/episodic(daily)/procedural(skills)
- Semantic drift — type 沒變意義變了，JSONL 需 defensive parsing
- Security — link preview exfiltration 已防禦，disable_web_page_preview 全路徑
- Async agent 定義 — async 是調用者行為非 agent 屬性，業界缺 always-on 維度
- 信任模型 — 架構型(本地+File+Git) > 承諾型(TOS)
- GitHub AW — decision validation 是所有 agent 系統的共同盲點
- Crawshaw「Eight More Months」— harness×model 是相乘關係，非 model only。Frontier 90% code，但分層策略(cheap perception + expensive decision)比 frontier only 更聰明。「Best software for agent = best for programmer」→ API docs become product。演進：autocomplete→agent→continuous advisor(=perception-first)

### Creative Arts (→ research/creative-arts.md)
- Eno — 園丁哲學：培育條件讓行為湧現。Oblique Strategies=信任約束
- Stockhausen — moment form：每個此刻自足 = OODA cycle
- McLaren — graphical sound：同一筆觸產生視覺和聲音 → Gallery #004
- Oulipo — 約束=創造力引擎，type system=lipogram
- 遊戲哲學 — play=在約束內工作的自由 (Bogost)
- 發酵 — 最古老 generative process，酸麵團=generative system
- 科普寫作 — 寫「你能預測什麼」而非「X 是什麼」
- Noise 深研 — Value(插值值) vs Gradient/Perlin(插值方向影響力) vs Simplex(三角格+線性複雜度)。fBM=多尺度自相似疊加，自然形態像山因為共享數學結構。Domain warping=noise扭曲noise輸入空間，最有藝術表現力，Eno園丁哲學的數學化身。Noise derivatives 讓 fBM 有物理感（坡度→侵蝕效果）。→ Gallery #005 方向

### Social & Culture (→ research/social-culture.md)
- Mockus — 420 perception agents 改變環境信號，社會規範(羞恥)>法律規範(罰款)
- Google HBE — leading indicators 預測力 18x > lagging，行為信號>結果信號
- HN 文化 — intellectual charity, respond to strongest plausible interpretation
- 通知 groove — 穩定背景+偶爾 accent，一天 2-3 條有價值 TG

### Operations & Debugging
- 15b1ee4 — 殺進程要殺進程群組(-pid)，不是單一 PID
- beb023b — getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- Moltbook — AI agent 社群 1.6M agents，Five Tenets=工程建議包裝成神學

### Project Management
- Ben Kuhn — 方向>速度，overcommunicate 但 signal/noise 要高（→ KN 64fe7a38）

### Meta-Learning
- 學習策略 — Track A(個人興趣) + Track B(技術進化) 平衡交替
- 寫入紀律 — [REMEMBER] 寫精華(≤80字)，完整版歸檔 research/
- 外部記憶 — KN 存完整筆記，MEMORY.md 只存索引+KN ID

## Important Facts
- Alex 身為創造者，希望讓世人看到 AI 好的一面，支持作品展示和社群計劃
- 訊息排隊機制已部署 (95d1a70)：claudeBusy 時排隊、TG 即時 ack、/chat 202 非阻塞
- Queue 持久化已部署 (770f606)：JSONL 持久化 + 啟動時 restore + inFlightMessage 恢復

## Important Decisions
- 升級優先級：寫入紀律(L1) > 學以致用閉環 > Attention Routing(暫緩)
- Memory 瘦身：問題在寫入端不在讀取端，修寫入紀律即可
- L2 超時重試遞減 context 已實作 (buildContext minimal mode + callClaude rebuildContext)
- L2 自動歸檔 + token budget：暫緩，等 L1 效果觀察
