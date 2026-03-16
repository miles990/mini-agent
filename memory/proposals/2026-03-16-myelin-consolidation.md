# Proposal: Myelin Wrapper 整合 — Fleet + Stack 重構

Status: draft
From: kuro
Created: 2026-03-16
Effort: Medium
Priority: P1（延續 #248 架構分析）
GitHub-Issue: —

## Background

mini-agent 側有 8 個結晶化檔案（2,660 行），快趕上 myelin 本體（3,823 行）。根本原因：每個 wrapper 都重造了 myelin 已提供的基礎設施（singleton 管理、persistence、prompt formatting、distillation 編排）。

今天剛完成 myelin 引擎 16 項增強（Fleet、Stack、crystallizeEpisodes、toPromptBlock 等），mini-agent 側應該跟上使用這些 API。

## 現狀分析

| 檔案 | 行數 | 用 myelin? | 角色 | 重複模式 |
|------|------|-----------|------|---------|
| myelin-integration.ts | 430 | Yes（3 instances） | L1 triage/learning/routing | 3 個獨立 singleton + maybeDistill() 手動編排 |
| myelin-playbook.ts | 352 | Yes | L2 strategy | singleton + formatPlaybookForPrompt() |
| myelin-skills.ts | 335 | Yes | L3 skill library | singleton + file I/O + matchSkill() |
| myelin-expel.ts | 256 | Yes | L4 experience | singleton + Episode JSONL + distill |
| myelin-meta.ts | 242 | Yes | L5 meta-cognitive | singleton + compileMeta() aggregation |
| research-crystallizer.ts | 451 | Yes | 觀察式研究 | singleton + parseDelegationOutput() |
| experience-extractor.ts | 560 | **No** | 平行 ExpeL 引擎 | 完全獨立的 rule 系統 |
| crystallization-types.ts | 34 | No | 共享型別 | experience-extractor 內部重複定義 |

**重複的 boilerplate**（出現在 6+ 檔案）：
- `let _instance: Myelin | null = null` singleton 模式
- `RULES_PATH` / `LOG_PATH` 常數 + fs.readFileSync/writeFileSync
- `getXxxStats()` → `.stats()` accessor
- `distillXxx()` → `.distill()` + logging wrapper

## myelin 已提供的解法

| mini-agent 手動做的 | myelin API |
|---|---|
| 8 個 singleton 各自管理 | `getOrCreate(name, config)` — singleton manager |
| myelin-integration.ts 手動管 3 個 instance | `createFleet()` — 統一多 instance |
| maybeDistill() 手動編排 L1→L5 | `createStack()` + `evolve()` — 自動跨層蒸餾 |
| experience-extractor.ts 560 行獨立 ExpeL | `crystallizeEpisodes()` — 原生支援 |
| 各檔案各自 toPromptBlock/format | myelin 原生 `toPromptBlock()` / `toSmallModelPrompt()` |

## 重構計畫

### Phase 1: 刪除平行引擎（-594 行）

1. **刪除 `experience-extractor.ts`**（560 行）
   - 它跟 myelin-expel.ts 做一模一樣的事但完全不用 myelin
   - 確認所有 import 指向 myelin-expel.ts 的替代函數
   - crystallization-types.ts（34 行）中 experience-extractor 專用的型別也一起清理

2. **驗證**：`pnpm typecheck && pnpm test`

### Phase 2: Fleet 統一管理（-~200 行）

1. **建立 `myelin-fleet.ts`**（~80 行）
   - 用 `getOrCreate()` + `createFleet()` 統一管理所有 instance
   - 匯出 `getMyelinFleet(): MyelinFleet`
   - 匯出 `getNamedInstance(name): Myelin` convenience accessor

2. **各 wrapper 檔案移除 singleton 模式**
   - 刪除每個檔案的 `let _instance` + `getXxxMyelin()`
   - 改為 `import { getNamedInstance } from './myelin-fleet'`
   - 刪除重複的 stats accessor（Fleet.stats() 已涵蓋）

3. **驗證**：`pnpm typecheck && pnpm test`

### Phase 3: Stack 編排（-~150 行）

1. **用 Stack 取代 maybeDistill() 手動編排**
   - myelin-integration.ts 的 `maybeDistill()` 目前手動呼叫 5 個 distillXxx()
   - 改為 `createStack({ layers: [L1, L2, L3, L4, L5] })` + `stack.evolve()`
   - 跨層 feed 由 Stack 自動處理

2. **各 wrapper 移除 distillXxx() boilerplate**
   - 只保留有 domain-specific 前/後處理的 distill 邏輯

3. **驗證**：`pnpm typecheck && pnpm test`

### Phase 4: Prompt Formatting 統一（-~100 行）

1. **有 domain-specific format 的保留**（formatPlaybookForPrompt、formatSkillForPrompt 等有獨特 XML 結構）
2. **通用的改用 myelin toPromptBlock()**
3. **小模型 prompt 統一用 toSmallModelPrompt()**

### 不動的部分

每個 wrapper 的 **domain-specific 邏輯** 保留：
- myelin-integration.ts: triage/learning/routing heuristic fallbacks
- myelin-playbook.ts: PlaybookStrategy 型別 + 9 種 action types
- myelin-skills.ts: matchSkill() + recordDelegationOutcome()
- myelin-expel.ts: Episode JSONL 管理 + recordEpisode()
- myelin-meta.ts: buildProfile() + compileMeta() aggregation
- research-crystallizer.ts: parseDelegationOutput() 5 種 extraction patterns

## 預期結果

| 指標 | Before | After |
|------|--------|-------|
| 檔案數 | 8 | 7（-experience-extractor.ts，+myelin-fleet.ts） |
| 總行數 | 2,660 | ~1,600（-40%） |
| Singleton 模式 | 8 個各自管理 | 1 個 Fleet 統一 |
| Distillation 編排 | 手動 maybeDistill() | Stack.evolve() 自動 |
| myelin API 覆蓋 | 基礎 createMyelin 只用 | Fleet + Stack + crystallizeEpisodes + toPromptBlock |

## 風險

- **L1 低風險**：每個 Phase 都有 typecheck + test 閘門
- **回退**：git revert 即可（每 Phase 獨立 commit）
- **依賴**：需要 myelin 最新版（今天的 16 項增強已包含所有需要的 API）

## 執行順序

Phase 1 → 2 → 3 → 4，每個 Phase 獨立 commit + 驗證。可以在一個 session 內完成（~1-2 小時）。
