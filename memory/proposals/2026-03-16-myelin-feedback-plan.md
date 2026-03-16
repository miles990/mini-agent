# Myelin Engine Feedback Plan: mini-agent 經驗反饋引擎增強

> 日期：2026-03-16
> 狀態：待審

## 核心發現

mini-agent 在 myelin 上層建了 5 層結晶化系統（L1-L5），過程中反覆撞到相同的結構性限制：**myelin 只知道扁平事件和字串動作**。它沒有策略、集數（episode）、技能庫、經驗池、或 prompt 注入的概念。

**最關鍵的訊號**：mini-agent 建了一個**完全平行的規則結晶引擎**（`experience-extractor.ts`，536 行），完全不使用 myelin。當消費者需要另起爐灶做引擎該做的事，代表引擎的抽象層次根本不對。

---

## 反饋清單（按優先度排序）

### Phase 1: P0 — 基礎能力缺口（先做這些，其他才能蓋上去）

| # | 項目 | 複雜度 | 證據來源 |
|---|-------|--------|----------|
| 1 | 加 `observe()` 方法 — 觀察式記錄，不觸發 LLM/規則 | S | myelin-expel.ts:59, myelin-skills.ts:157, research-crystallizer.ts:111 |
| 2 | 定義 `Episode` 型別 — 多步驟經驗序列 | S | myelin-expel.ts:19-31 |
| 3 | `TriageResult` 附加策略元資料 — 動作+策略一體交付 | M | myelin-playbook.ts:33-170 |
| 4 | 安全模式 `triageSafe()` — 永不拋錯 | S | 所有 myelin-*.ts 都 try/catch |
| 5 | Heuristic 模式一級支援 — 區分關鍵字函式和真正 LLM | M | 7 個檔案都用 heuristic 假裝 LLM |
| 6 | 統一 `ExperienceRule` 型別 — 消除雙重定義 | S | myelin-expel.ts:33 vs experience-extractor.ts |

### Phase 2: P1 — 提升可用性

| # | 項目 | 複雜度 | 證據來源 |
|---|-------|--------|----------|
| 7 | Episode 級結晶化 — 從經驗序列萃取規則 | L | experience-extractor.ts（平行引擎 536 行） |
| 8 | `MyelinFleet` — 多實例協調管理 | M | myelin-integration.ts:341-418 |
| 9 | `toPromptBlock()` — 統一 prompt 注入格式 | M | 5 個不同的 formatXxxForPrompt() |
| 10 | 陣列條件匹配 — context 不再需要扁平化 | S | myelin-skills.ts:165 |
| 11 | Template 擴展技能元資料 — avgDuration, successRate | M | myelin-skills.ts:40-50 |

### Phase 3: P2 — 減少樣板碼

| # | 項目 | 複雜度 | 證據來源 |
|---|-------|--------|----------|
| 12 | 自動蒸餾排程 `maybeDistill()` | S | myelin-integration.ts:333-344 |
| 13 | 跨層蒸餾 `evolveMeta()` | M | myelin-meta.ts:102-160 |
| 14 | 小模型 prompt 生成 `toSmallModelPrompt()` | M | research-crystallizer.ts:344-398 |
| 15 | `MyelinStack` 階層式結晶化 | L | 整個 L1-L5 架構 |
| 16 | Singleton 管理器 | S | 7 個檔案重複 singleton 模式 |

---

## 實作路線

**Phase 1**（P0，6 項，約 2S+2M = 中等工作量）→ 解鎖基礎能力
**Phase 2**（P1，5 項，1L+3M+1S = 較大工作量）→ 關閉平行引擎差距
**Phase 3**（P2，5 項，1L+2M+2S = 中等工作量）→ 精煉體驗

建議先完成 Phase 1 全部，然後 Phase 2 的 #7（Episode 級結晶化）是最高影響項目。

---

## 為什麼是反饋而不是重寫

myelin 的核心迴圈（accumulate → distill → match → apply）是對的。需要的是：
1. 提升資料模型（從扁平事件 → 多層經驗）
2. 擴展匹配邏輯（從精確指紋 → 相似度匹配）
3. 補足 API 表面（observe, safe mode, fleet, prompt injection）
4. 統一型別系統（消除消費者端的重複定義）

引擎架構不需要翻新，需要**加深**。
