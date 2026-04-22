# memory_internalize_dual_audience

- [2026-04-15] **雙受眾約束 — Alex 2026-04-15**

memory 內化與可視化 proposal 的根本 convergence condition：同一原料兩種渲染，不是妥協。

- **AI 端**：dense / machine-readable / graph-traversable / canonical forms / typed edges / 高 retrieval precision
- **人類端**：narrative / 視覺優先 / progressive disclosure / 可 scan / 情感共鳴 / 多層深度

**設計題要點**：
1. Single source of truth + dual render（強建議），而非分岔儲存
2. Dense format (JSONL/graph) ↔ narrative (topics/*.md) 雙向同步不 drift
3. 消化 = 能行動：AI 消化 = 下個 cycle 判斷用；人類消化 = 指導決策或教別人
4. 可視化分層：AI 用 structured query，人類用 force-directed graph/主題地圖/時間線

**Convergence condition**（非 prescription）：
- 同一概念，AI 能秒抓正確上下文做判斷
- 人類打開能 30 秒讀懂核心並決定是否深入

**理論選擇過濾器**：純 AI retrieval-oriented 的 KG/RAG 方案不行（對人不友善），純 wiki-style 對 AI 不夠 structured。要雙向都強，或明確分層。

影響：正在跑的 internalize proposal delegate 必須把這個納入 convergence conditions section。等 delegate 回來整合。
- [2026-04-15] **v0 schema dogfood gap（發現於自身 proposal）**

跑 bold-markup extraction 在 `memory/proposals/2026-04-15-memory-internalize-v0.md` 抓到 40 phrases，分類：

- **Noise（需 blocklist）**：topic template 的 schema field 名（Header/Footer/Status/Date/Depends on/Conflicts/Connected concepts/Narrative body）
- **真 entity**：Convergence condition / Truth Layer / Render Layer / Pull model / AI render / Human render
- **未覆蓋**：execution items (P0/P1/P2/P3) — 像 task 但不該進 KG，heartbeat 才是 truth

**Action**：v0 extractor 需要 skip-list（topic template fields）或 structural-aware（知道 "## 執行項" 底下的 bullet 不抽）。已加入 proposal 開放題 Q4。 ref:v0-schema-dogfood-gap-2026-04-15
- [2026-04-15] [2026-04-15 cycle #54] Dogfood pattern locked in: 每寫新 CC（convergence condition） → 24h 內找剛產出的 artifact 自檢。今天範例：昨天寫 dual-audience CC，今天 P1-a proposal 補 TL;DR block 才過 human render。否則規則 → 行為有 latency，CC 變裝飾。
- [2026-04-15] **Proposal v2 review 收斂 — 2026-04-15**

我的 `memory-internalize-v0.md` 與 CC 的 `kg-internalization.md` 是互補 layer，非競爭方案：
- 我管 human render layer（topic 檔 header/30-sec summary/connected concepts，L1）
- CC 管 runtime wiring（search augmentation / live ingest / conflict perception / dashboard，L3）

**接合面協議**（避免 compile batch 與 live ingest 互踩）：
- entity_ids header = CC path B 動態維護
- summary + connections derived block = 我 `scripts/compile-topics.ts` 重生
- Linter warn（write-time，我）+ errors.jsonl nightly rescan（CC）= 完整錯誤流

**Dogfood 教訓**：v0 section 9 HIT 3/15 (20%) 不是失敗，是 proposal 本身誠實暴露「沒 compile 腳本時人類寫的 narrative 接不回 graph」— 正是 CC path B 要補的洞。三測試鏡片在跨 owner proposal 接合面同樣好用。
