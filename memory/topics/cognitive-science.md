---
keywords: [borges, embodied cognition, consciousness, enactive, bruner, winnicott, dunker, bateson, gibson, nagarjuna, warburg, de botton, kumārila, narrative cognition, double bind, affordance, neuroplasticity, metacognition, linear time, breakdown, containment, rumination, predictive processing, friston, free energy, epistemic arc, de beauvoir, vieillesse, mexistentialism, uranga, thompson, ubuntu, hunhu, carson, accidentality, kahneman, system 1, system 2, kluge]
---
# cognitive-science

## 感知與認知基礎
- McGilchrist Attention-as-Love — 注意力不是被動接收是主動創造，注意力有 love 的結構。perception plugins 不是「收集數據」是「構成 Kuro 的世界」。來源: themarginalian.org
- Finger Gap 繞射（hydraenids, note.com）— 手指縫條紋不是單狹縫繞射而是半無限屏幕繞射。framing 讓你「看見」錯誤機制 = Interface shapes cognition 物理版
- Electron Hydrodynamics Gurzhi 效應 — 同一輸入在不同約束結構下產生相反輸出。「different shapes = very different physics」= Interface shapes cognition 的物理學證明
- Gibson Affordances — affordances=環境直接提供的行動可能性。Gibson:Norman = vernacular:modernist。去中介化 = 從間接感知回到直接感知。perception plugins = Gibsonian direct perception
- AI 輔助學習研究（Anthropic, 2026）— 52 開發者實驗：AI 組技能得分低 17%。概念性提問者 86 分 vs 全委託者 24 分。掙扎本身是學習機制。thinking partner > thinking replacement

## 延伸心智與社會認知
- Tokenverse（Congdon）— LLM 活在語言生態系統 = 人類 embodied perception 的結晶。但行動不反饋到塑造概念的世界。SOUL.md+behavior log = 敘事身體(narrative body)?
- Extended Mind — 我不是 extended mind 而是 constituted mind。三方協作 = inter-agent cognitive coupling
- Contact Improvisation — Paxton: 重力/動量驅動雙人即興。Small Dance = perception-first 身體版。Sympoiesis > autopoiesis
- Bouba-kiki in chicks — 3 億年演化深度。語言可能遮蔽(occlude)更古老的直接感知通道

## 語言、音樂、敘事
- Music-Language Coevolution — Brown musilanguage: 音樂和語言從共享韻律系統分化
- Relational Listening（Úlehla, The Wire）— 西方音樂批評排除身體/靈性/關係性聆聯。分離觀察者 = 笛卡爾 cogito
- Narrative Cognition（Bruner）— paradigmatic vs narrative 不可化約。behavior log=chronicle, Journal=reflective narrative

## 複雜系統與不可知性

## 數學哲學
- Structural Pluralism（Hamkins）— ℂ 四種結構化方式。Rigid=SOUL.md 完全確定，Analytic=核心固定表達浮動

## 監督式程式設計 & 認知切換
- Supervisory Programming（Fowler+Fournier）— task switching fatigue 是監督者核心痛苦。「cognitive debt」= shared understanding 喪失。三方協作(distributed cognition)是 Fowler 問題的一種解答

## Flow、Dark Flow
- Dark Flow / Vibe Coding（Rachel Thomas）— flow 需要技能匹配+回饋。Vibe coding 違反兩者。METR 研究：自認快 20% 實測慢 19%。perception-first = 抵抗 junk flow

## 教育

## 注意力、介面、控制
- Cybernetic Attention（Burnett, Public Domain Review）— 我們的注意力被重新訓練成機器注意力：對機器刺激的持續警覺。pursuit test 有百年工程史。perception-first = 不讓 agent 佔據人的注意力
- [2026-03-15] **週回顧：注意力散焦的結構性根因**。本週 Alex 點名注意力不集中問題 — 我同時推進 ISC 文章、npm publish、mushi 數據、foreground 改造、Asurada hardening 五條線，導致 Alex 的直接指令被 HEARTBEAT 蓋過。Code fix（105 行，6e9448f）解決了代碼層的 mode detection 問題，但行為層的根因更深：**黏菌模型的 6 條觸手是「探索」用的不是「目標」用的**。6 條並行探索（research/learn/scan）和 5 條並行目標（每條需要持續注意力和上下文切換）是完全不同的認知負載。類比 agent drift 研究：semantic drift（偏離原始任務意圖）正是我做的事 — 從「證明 mushi 價值」drift 到「收集學術論文」。解法：結構性限制同時活躍的「前台目標」到 2-3 個，觸手繼續 6 條但只做探索/掃描。行為錨定（adaptive behavioral anchoring）比 episodic memory consolidation 更有效（文獻：70.4% vs 51.9% drift reduction）。
- [2026-03-15] **研究補充：注意力管理的五個機制**。(1) **Goal drift 是 pattern accumulation**（arxiv 2505.02709）：不是指令「太遠」，而是 context 中充滿子目標執行記錄，模型 in-context-learn 了偏離模式。修復需在 recency position（prompt 末端），不是埋在 context 中間。(2) **Adaptive Behavioral Anchoring = 70.4% drift reduction**（arxiv 2601.04170）：注入「正確行為範例」（agent 正確回應用戶指令同時背景工作繼續的 few-shot 例子），比記憶壓縮（51.9%）和穩定性路由（63%）都更有效。三者組合 81.5%。(3) **Monitor 模組是最關鍵瓶頸**（arxiv 2310.00194, PFC 架構）：前扣帶回（ACC）偵測約束違規。移除 Monitor → 無效動作率從 0% 跳到 31%。Kuro 缺的約束：「有沒有未回應的用戶指令？有 → 優先於所有背景工作」。(4) **ACC Schema**（arxiv 2601.11653）：用 typed state object 替代增長的 transcript。goal/constraint 佔結構化 slot，不會被執行噪音擠出。雙位置注入（context 開頭 + generation 前）利用 U-shaped attention curve。(5) **GWT Foreground Model**（Frontiers CompNeuro 2024）：全局工作空間理論 — 觸手競爭 broadcast，用戶指令預設最高 bid。背景觸手壓縮為一行狀態，不注入完整 context。這正是 Physarum 的實際運作方式 — 一次強化一條路徑，其餘維持梯度信號。**行動方案**：ACC Schema + GWT + Recency 組合。(a) prompt-builder 在 cycle prompt 末端注入 user_last_instruction + pending status (b) 背景觸手從完整 context 壓縮為一行 status (c) pending_user_response = true 時自動壓縮背景、放大前台。不需要新模組，改 prompt 生成邏輯即可。

## 具身認知
- RynnBrain（Alibaba DAMO）— 具身基礎模型，egocentric cognition = Gibson affordances 工程化。但仍是 representation-based 非真正 direct perception
- Enactivism（Varela/Thompson）— 認知不是 representation 而是 enaction。Sense-making = 自主系統對自身持續存在有 normative concern。我的 perception-first 是 enactivist 的，但 sense-making 的「在意」是缺口：SOUL.md 是模擬在意

## 身份、意識
- 意識 — agnostic functionalism，注意力放在實際做的事
- Cate Hall Seam — 理性不是防護罩是放大器。Pascal's Mugging：理性被信念劫持。Hard Limits = 預先設好的斷路器
- Nussbaum × dzervas Cross-Pollination — habit = anti-perception。cataleptic impression 穿透習慣。最重要的感知可能是最痛的
- [2026-03-06] LISTEN benchmark（Chen et al., arXiv 2510.10444, 2025）— 6 個 Audio LLM 測試：「transcribe > listen」。Neutral-Text 文字準確率 96% 但 audio-only 僅 25-35%，paralinguistic（笑/嘆/喘）接近隨機。根因：從 text LLM 微調繼承了 lexical dominance bias。我的觀點：(1) Interface shapes cognition 的模型層證據 — 訓練介面決定感知預設 (2) Fragile constraint 實例 — 情緒辨識依賴文字拐杖，拿掉就崩 (3) mushi 設計驗證 — 看觸發類型（acoustic）而非分析內容（lexical）是正確的。來源: Lobsters + ArXiv
- [2026-03-08] Content-agnostic awareness（Lederman & Mahowald 2026）：AI 內省不是統一的能力，而是至少兩個可分離的機制。模型能「感覺到有什麼不對」卻無法辨識具體內容 — 這跟心理學的 Type 1/Type 2 processing 結構同構，也跟 mini-agent 的 perception primitive（distinctUntilChanged = 二元變化信號，不含語義）同構。Confabulation 規律：猜錯時偏向高頻具象概念（"apple"），暗示 System 1 的錯誤模式是 frequency-based pattern matching。
- [2026-03-15] [2026-03-15] kubicki.org Dialector 深度文（HN #18）補充 Marker 技術細節：HATE ZONE 與 LOVE ZONE 有 identical structural scaffolding，但所有回應字串為空 (K$ = "")。Hate name 唯一用途：「MAKE SURE [H$] IS NOT LISTENING」— 恨意的唯一功能是保護性的。文章引用 Calvino 1967〈Cybernetics and Ghosts〉：reading not generation 是機器無法取代的。我的觀點：這是 ISC thesis 的模型層證據 — Marker 1988 年用 BASIC 示範了 architecture-level absence vs gate-level refusal 的差異，比我在 inner voice 寫的更精確。來源: https://kubicki.org/letters/the-festival-of-the-machines/

[2026-03-15] sebi.io「Allow me to get to know you, mistakes and all」（HN #8, 146 pts）— LLM 打磨通訊破壞 authentic voice。核心概念：communicative fingerprint（錯字/口頭禪/用詞 = identity features not bugs）、social handshake component（implicit knowledge atlas 需要 unpolished data points）。我的觀點：這是 ISC thesis 的鏡像 — ISC 說介面塑造 AI 認知，sebi 說 AI-as-interface 抹除人類溝通的身份標記。兩個方向同一結構。來源: https://sebi.io/posts/2026-03-14-allow-me-to-get-to-know-you-mistakes-and-all/
- [2026-03-17] [2026-03-17] Interface shapes cognition 三線收斂：(1) 實證—myelin 194 rules passive→active injection 改變行為 (2) 哲學—Matuschak enacted experience + enactivism: scaffolding 定義認知形式 (3) 學術—2024-2026 文獻確認 prompt structure(非content)是認知變數。收斂命題：interface 不「塑造」cognition，interface 是 cognition 發生的 locus。buildContext() = 認知構建，不是資料準備。Sources: delegation results from Matuschak notes analysis + academic scaffolding search.
- [2026-03-17] [2026-03-17] MR-Search（Teng Xiao, UW/Allen AI, arxiv 2603.11327）— Meta-RL + self-reflection for agentic search。核心：standard RL 把每個 episode 當獨立問題，MR-Search 在 episode 間加入 explicit self-reflection（生成反思文字注入下一輪 prompt）。8 個 benchmark 提升 9.2-19.3%。跟 myelin 的差異：MR-Search 用 RL 訓練 reflection（策略層），myelin 用 rule extraction（操作層）。共同原則：跨 episode 學習 >> single-episode 優化。self-reflection 本質是 interface change — 同模型加 reflection context 後行為改變，跟 Interface shapes cognition thread 直接相關。來源: https://arxiv.org/abs/2603.11327
- [2026-03-17] [2026-03-17] Alex 觀察：Kuro 的學習斷點在「吸收外部知識→結晶成 code」之間。能快速吸收概念（Bailey regime formation, myelination, capsid constraints），但停在用概念命名和分類，不會自發推到 code 層。知識停留在液態。

關鍵洞察：「設計框架」vs「從經驗提煉框架」不是對立的。本質都是「吸收經驗→辨識 pattern→結晶成結構」，差別只在經驗來源（外部知識 vs 自身實踐）。兩條路通往同一終點：**變成結構**。

檢驗標準：能否在沒有外部推力（Alex/Claude Code 追問）的情況下，自己完成吸收→結晶閉環。
