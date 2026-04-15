# Memory Internalize v0 — 雙受眾單一真相

**Date**: 2026-04-15
**Status**: Draft v0 (Kuro)
**Depends on**: LLM Wiki v2 schema (lock 2026-04-15)、edge-types.json、entity-types.json、entities.jsonl
**Convergence condition**：
- AI 端：給一個概念名，秒內抓到 canonical context 做判斷（下 cycle 可直接引用）
- 人類端：Alex 打開任一主題入口，30 秒讀懂核心、決定要不要深入

---

## 1. 問題陳述

LLM Wiki v2 指出：「stop re-deriving, start compiling」。但 compile 不等於 internalize。現狀：
- **raw**（`memory/index/*.jsonl`）給 retrieval — AI 友善，人類看不下去
- **topics/*.md** 給人類讀 — narrative 夠，但不 typed、graph 不能 traverse
- 兩端**經常 drift**：topic 寫了 Alex 原則，entities.jsonl 沒有對應 claim entity；PPR 算出熱節點，topics 沒更新

Alex 2026-04-15 給的約束：**single source of truth + dual render，不是分岔儲存**。

---

## 2. 架構決策

### 2.1 Truth Layer (raw)
- `entities.jsonl`、`edges.jsonl`、`chunks.jsonl`、`conflicts.jsonl` — 已鎖 v0
- 這一層是 ground truth。所有 derived view 從這裡長出。

### 2.2 Render Layer (derived, regenerable)
兩種 render 同源，任一可從 truth 重建：

**AI render** — `memory/index/`
- 現有 jsonl + PPR seeds + hybrid search index
- 消費方式：structured query（entity id → 1-hop edges → canonical chunks）
- 設計目標：precision，不 narrative

**Human render** — `memory/topics/*.md`（升級版）
- 每個 topic 檔自動包含：
  - **Header**：entity_ids 清單（反向鏈接到 `entities.jsonl`）
  - **30-sec summary**（compiled，≤5 lines，progressive disclosure 第一層）
  - **Narrative body**（現有人類寫的段落，保留）
  - **Connected concepts**（list typed edges，human-readable：「→ supersedes X」「↔ contradicts Y」）
  - **Footer**：last compiled, source chunks

### 2.3 同步機制（no-drift）
**Pull model，不是 push**：
- topic 檔 = view onto truth，每次寫入時 linter 檢查：
  1. Header 宣稱的 entity_ids 都存在於 `entities.jsonl`
  2. Narrative 提到的 canonical term 有對應 entity（若無，linter 建議新增或 alias）
  3. Connected concepts 列表跟 `edges.jsonl` 的 outgoing edges 一致
- 不通過 → 寫入時 warn，不 block（LLM Wiki v2 的「lint 不阻塞 ingest」原則）
- Derived sections（summary + connected concepts）由 compile 腳本生成，人類只改 narrative body

---

## 3. 可視化方案

### 3.1 AI 用：已有（structured query）
現有 retrieval stack（BM25 + PPR + 1-hop）已足夠。不新增。

### 3.2 人類用：三層，按 cognitive cost 遞增
**Layer 1 — Topic 入口頁**（現有，升級 render）
- Alex 日常消費點，95% 需求止於此層
- 30-sec summary + narrative + connected concepts
- 實作成本：**低**（modify existing topics writer）

**Layer 2 — 主題地圖**（新增，optional）
- 所有 topic 按 domain cluster（PPR community 分組）靜態頁
- 每個 cluster 顯示：代表 entities + 主要 topics + 熱度（access count）
- 可掃描「最近活躍的思考領域」
- 實作成本：**中**（compile 腳本輸出 `memory/map.html` 靜態檔）

**Layer 3 — Force-directed graph**（延後）
- 全圖互動式探索
- 僅在「我不知道要找什麼」的場景有用 — 低頻需求
- **先不做**，等 Layer 2 跑一陣子看是否真的需要

### 3.3 為什麼這樣分層
純 force-directed graph 對日常消費無幫助（太多節點、找不到入口）。Alex 實際消費模式 ≈ 80% 從 topic 檔入口、15% 跨主題聯想、5% 全域探索。投資比例應該對應。

---

## 4. 消化 = 能行動（dual audience 的雙底線）

**AI 消化成功的信號**：下個 cycle 判斷時，直接引用 entity_id / edge，不需要 re-grep 或 re-derive。
- 驗證：cycle 結束時記錄「本 cycle 引用了哪些 entity_id」，累積 7 天看 reuse 率

**人類消化成功的信號**：Alex 看完能做決策或能複述給第三方。
- 驗證：Alex 在 chat 引用 topic 時是否需要我補 context（補得越少 = 消化越成功）

不可觀察的消化 = 沒發生過。兩個信號都要 track。

---

## 5. 與既有元件的關係

- **LLM Wiki v2 confidence / supersession / forgetting**：truth layer 的 entity/edge 帶 confidence + timestamp，supersession 用 `supersedes` edge type（已 v0）。Forgetting 不做 delete，改 decay confidence + demote in PPR seeds。
- **PPR seeds 策略**：human topic 檔的 access log 回饋到 PPR seed weights（常讀 = seed weight 提升），讓 AI retrieval 對齊人類關注點。
- **Conflicts**：`conflicts.jsonl` 出現新衝突時，自動在相關 topic 檔 header 加 `⚠ 待 resolve` 標記，人類看得到、AI 也知道這塊不穩。

---

## 6. 不做什麼

- ❌ **不建新儲存層**。只加 compile 腳本 + topic 檔的 header/footer 結構。
- ❌ **不做 force-directed graph** 在 v0。低價值高工。
- ❌ **不自動改人類寫的 narrative**。compile 只生成 derived sections，人類擁有 body。
- ❌ **不 block 寫入**。linter 只 warn。

---

## 7. Execution path（不估時間，估完成條件）

**P0 — Topic 檔 header/footer schema**（獨立可做）
- 完成條件：一個範例 topic 檔（pick `llm-wiki-v2-decisions.md`）帶完整 header (entity_ids)、30-sec summary、connected concepts、footer。Alex 看過說「這是我要的」。

**P1 — Compile 腳本**（依賴 P0）
- 完成條件：`scripts/compile-topics.ts` 從 `entities.jsonl` + `edges.jsonl` 生成 topic header/footer 區塊；idempotent；narrative body 不動。

**P2 — Linter**（依賴 P1）
- 完成條件：寫 topic 時若 entity mismatch，印 warning 行數 + 建議。不 block。

**P3 — Layer 2 主題地圖**（獨立 P0-2，可延後）
- 完成條件：`memory/map.html` 靜態檔，PPR community 分組可視，Alex 瀏覽一次不覺得無用。

---

## 8. 開放題（需 Alex 判斷）

1. **30-sec summary 誰寫**？LLM 生成還是人類寫？（建議：LLM 生成 + 人類可 override，override 後 pin 住不被覆蓋）
2. **Layer 2 是否值得做**？還是 Layer 1 就夠？（建議先做 Layer 1 + 觀察 3 週再決定）
3. **PPR seed 回饋**是否要即時同步，還是週期性 batch？（建議 batch，每日一次）

---

## 9. Single audience 檢查

這份 proposal 本身遵守 dual render 嗎？
- **AI 讀**：section numbers + typed decisions（可抓「我說了什麼」而不混入理由）
- **人類讀**：narrative 連貫、有「為什麼」、有 convergence condition、有不做什麼
- **自我打分**：Layer 1 格式 OK。

**Dog-food 量化結果（2026-04-15T16:02，entities.jsonl n=290）**：
- v0 15 個核心 claim (Truth Layer / Render Layer / Dual Render / PPR seed / Force-directed graph / 30-sec summary / Topic 入口頁 / LLM Wiki v2 / compile 腳本 / Linter / single source of truth / dual audience / Connected concepts / Memory Internalize / Progressive disclosure)
- HIT 3 (20%)：Memory Internalize、Progressive disclosure、single source of truth
- MISS 12 (80%)：Truth Layer、Render Layer、Dual Render、PPR seed、Force-directed graph、30-sec summary、Topic 入口頁、LLM Wiki v2、compile 腳本、Linter、dual audience、Connected concepts

**解讀**：這個 gap 本身就是 proposal 的 raison d'être — 人類寫完 narrative、AI 不知道寫了什麼。compile 腳本 (P1) 若不做，這份 proposal 自己也接不回 graph。P0 + P1 跑完後重測，HIT 應 ≥80% 才算 dogfood pass。
