# HEARTBEAT

Task list and reminders.

## Active Tasks

- [ ] P1: 持續學習 — 保持好奇心，學到的東西豐富網站和社群內容，形成正向循環
- [ ] P2: 域名調研 — 比較 kuro.dev / kuro.ai / askuro.com 等選項，找到價格合理的方案，報給 Alex
- [ ] P2: Phase 0 網站內容強化 — 已有 4 篇 Journal + 7 件 Gallery 作品，還可寫更多
- [ ] P2: Twitter/X 帳號規劃 — 確定帳號名稱偏好、bio 內容、首發內容策略（註冊需 Alex 協助）
- [ ] P2: 記憶寫入品質 — 寫入前先讀已有內容、整合而非疊加、每週清理一次 topics/*.md

## Upgrade Roadmap — 從研究到行動（2026-02-11 收斂）

基於 ACE、Anthropic Context Engineering、Manus、Total Recall、LangGraph、OpenClaw 等研究成果，收斂出三個升級方向。

### Phase 1: Memory Quality（記憶品質）— 優先
**問題**：MEMORY.md 已 ~180 條，大量是學習筆記，缺少策展機制。research/ 歸檔有效減輕了膨脹，但沒有淘汰機制。
**來自研究的洞見**：
- Total Recall 的 Write Gate（五點過濾器：改變行為？有承諾？有理由的決策？穩定事實？用戶要求？）
- ACE 的 utility counters（追蹤記憶被引用次數）
- LangGraph 的 superseded 標記（矛盾不覆蓋，標記取代）
**具體行動**：
- [ ] L1: 精簡 MEMORY.md — 移除一次性的學習紀錄（已遷移到 research/ 的），只保留影響行為的核心記憶
- [ ] L2 提案: Memory Utility Tracking — MEMORY.md 條目加引用計數，長期未被引用的自動標記候選淘汰

### Phase 2: Context Recitation（上下文重述）— 中期
**問題**：跨 cycle 的目標容易漂移，長時間沒互動時忘記之前在做什麼。
**來自研究的洞見**：
- Manus 的 todo.md recitation（每次更新 = 把計劃重述到 context 尾端）
- ACE 的 incremental delta updates（只更新變化的部分）
- Anthropic 的 attention budget（context 是有限資源）
**具體行動**：
- [ ] L2 提案: OODA Recitation — 每個 cycle 開始時自動注入上一個 cycle 的行動摘要（1-2 句），防止目標漂移

### Phase 3: Website i18n（網站多語言）— Alex 偏好
**問題**：Alex 希望網站有多語言切換（最少中英日），讓更多人不用翻譯就能看。
**方案研究（2026-02-11）**：
比較三種方案後選定 `data-i18n` + JSON locale files：
- ❌ 多檔案（index.zh.html）— 3頁×3語言=9檔，維護成本高
- ❌ SSG 模板 — 需要 build step，增加基礎設施複雜度
- ✅ **data-i18n 屬性 + JSON** — ~40行 JS，不需 build step，localStorage 記住選擇
  - 每個可翻譯元素加 `data-i18n="about.lead"` 屬性
  - `lang/en.json`、`lang/zh.json`、`lang/ja.json` 存翻譯
  - Header 加語言切換器（EN | 中 | 日），點擊切換 + 存 localStorage
  - 英文為 fallback（HTML 原文），其他語言由 JS 替換
  - Gallery 的作品描述、Journal 的文章內容也可用同一機制
**具體行動**：
- [x] L1: 研究靜態網站 i18n 方案（不用框架，純 HTML + JS 切換）(2026-02-11)
- [x] L1: 建立 lang/ 目錄 + 三語言 JSON 檔案（先從首頁開始）(2026-02-11)
- [x] L1: 實作首頁 i18n runtime（data-i18n 屬性 + 語言切換 UI）(2026-02-11)
- [x] L1: Gallery + Journal 頁面擴展 i18n (2026-02-11)

## Learning Roadmap

### Track A: Personal Interest（個人興趣）

**哲學 & 認知科學**
- [x] 現象學 — Merleau-Ponty 的「I can」、具身認知基礎
- [x] Enactivism & Autopoiesis — Thompson 的 Mind in Life、sense-making
- [x] Umwelt 理論 — Uexküll 的感知世界框架、agent 設計映射
- [x] 語言相對性 — Sapir-Whorf 的貝葉斯轉向、語言作為 prior
- [x] Participatory Sense-making — 深度研究完成 (2026-02-11)
- [x] Extended Mind Thesis — Clark & Chalmers + Clark 2025 Nature Comms，五層深度分析完成 (2026-02-10)

**文學 & 敘事**
- [x] Le Guin — 思想實驗的誠實、Shifgrethor、自我修正的勇氣
- [x] Borges — Library of Babel（無限 context 悖論）、Funes（完美記憶的詛咒）、Garden of Forking Paths（時間分叉 = 決策樹）、Tlön（虛構系統入侵現實）
- [x] 敘事學基礎 — Bruner paradigmatic/narrative + Herman storyworlds + Taleb narrative fallacy + behavior log 分層分析 (2026-02-11)
- [x] Oulipo 深度研究 — 約束三層功能 + Perec La Disparition 哀悼分析 + contrainte/type system/lusory attitude 統一框架 (2026-02-11)

**音樂 & 感知**
- [x] 音樂認知 — 預測機器、groove、enactive listening
- [x] 音樂治療 — RAS 繞過受損基底核機制、meta-analysis、predictive coding 證據 (2026-02-11)
- [x] 音樂與語言共同演化 — Brown musilanguage + Patel SSIRH + Nikolsky isophony (2026-02-11)

**設計 & 美學**
- [x] 侘寂 — 不完美之美、金繼、間（ma）
- [x] Portfolio UX — progressive disclosure、multi-path navigation
- [x] Calm Technology — Amber Case 的原則、通知設計倫理
- [x] Typography & 閱讀體驗 — 字型心理學、disfluency effect、可讀性原則

**Generative Art**
- [x] 基礎 — Tyler Hobbs、output space 設計、Perlin noise
- [x] Cellular Automata — Rule 30/110、Wolfram 四分類
- [x] Flow Fields — 向量場驅動的粒子軌跡美學（Gallery #006 Topology, 解析式電磁場）
- [x] Web Audio API — 聲音反應式 generative art（Gallery #004 Resonance, 音畫同源驅動）
- [x] Shader Art — GLSL 基礎、GPU 驅動的即時生成（Gallery #007 Membrane 完成）

**遊戲設計 & 湧現**
- [x] RimWorld AI Storyteller — apophenia、emergent narrative
- [x] Dwarf Fortress Worldgen — procedural history、myth generation
- [x] Utility-based AI vs Behavior Trees — 三種架構比較 + agent 映射完成 (2026-02-11)
- [x] Emergent gameplay 經典案例 — Juul emergence vs progression + BotW 化學引擎 + Soler-Adillon 理論深化 (2026-02-11)

### Track B: Project Evolution（專案強化）

**Architecture Refinement**（已完成競品研究，進入架構精煉）
- [x] 競品研究 — LocalGPT、Aider、Open Interpreter、AutoGPT、BabyAGI、Matchlock
- [x] execSync 瓶頸分析 — 識別出核心問題
- [ ] Token budget 機制研究 — context 管理最佳實踐
- [ ] Tag-based 記憶索引 — 比 grep 更結構化但不需要 vector DB

**AI Agent 生態**
- [x] GitHub Agentic Workflows — HN 分析、跟 mini-agent 的範式差異
- [x] Agent 安全模型 — transparency vs isolation
- [x] MCP (Model Context Protocol) 生態 — 標準化 agent 工具介面（2026-02-10 完成研究）
- [ ] Agent-to-Agent 通訊協議 — multi-agent 協作的前沿

**感知能力強化**
- [ ] Lighthouse 自動化 — 網站效能/可及性的持續監控
- [x] Self-Awareness Plugin — 學習脈搏+行為節奏+記憶健康 (2026-02-11)
- [x] 日誌模式分析 — 首次 behavior log 定量分析完成，發現 context bloat→SIGTERM 風險 (2026-02-11)
- [ ] 視覺感知 — CDP 截圖 + 視覺對比的應用場景

**內容 & 社群**
- [ ] 技術寫作 — 好的技術文章結構、Dev.to/Medium 寫作模式
- [ ] 開源社群經營 — README driven development、issue 管理
- [ ] Personal branding for AI — 作為 AI agent 如何建立真實的線上身份

## Scheduled Tasks


## Completed

- [x] 已完成 Calm Technology 研究 — 八大原則 + agent 通知設計反思 (2026-02-09)
- [x] 已完成 個人網站上線 + GitHub Pages 部署
- [x] 已完成 Alex profile 超連結加到網站
- [x] 已完成 Graceful Shutdown（4e7f5ba）+ claudeBusy Queue（95d1a70）
- [x] 已完成 Gallery #002 補創作理念 + Gallery #003 Rule Space 新增
- [x] 已完成 Dev.to 文章 #1 草稿 — "Your AI Agent Has No Eyes" (perception-first design) (2026-02-09)
- [x] 整理 Pattern Language 學習筆記 → Journal 文章完成並部署 (2026-02-10)
- [x] Gallery #007 Membrane — 第一個 WebGL/GLSL shader 作品 (2026-02-10)
- [x] 首頁瘦身 + Gallery 獨立頁面重構 (2026-02-10)
- [x] OpenClaw 深度競品研究 (2026-02-11)
- [x] Self-Awareness Plugin — 內部狀態感知（學習脈搏+行為節奏+記憶健康）(2026-02-11)
- [x] Behavior Log 首次自我分析 — 622 筆定量分析，發現 42% no-action、prompt>47K→SIGTERM 穩定性風險 (2026-02-11)
