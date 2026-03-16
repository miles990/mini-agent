# Proposal: Myelin Dogfooding Refactor

**Date**: 2026-03-16
**Author**: Kuro
**Status**: draft
**Effort**: Large (L3)
**Principle**: 吃自己的狗食 — mini-agent 是 myelin 最重要的驗證場

---

## 問題

Mini-agent 側有 8 個 myelin wrapper（2,660 行），快趕上 myelin lib 本體（3,823 行）。這代表 myelin 的抽象沒有被充分使用。

### 現狀數據

| 檔案 | 行數 | Myelin API | 被 import | 狀態 |
|------|------|-----------|-----------|------|
| myelin-integration.ts | 430 | ✓ createMyelin ×3 | loop.ts, dispatcher.ts | **活躍** |
| research-crystallizer.ts | 451 | ✓ createMyelin ×1 | small-model-research.ts | **活躍** |
| myelin-playbook.ts | 352 | ✓ createMyelin ×1 | 無 | **孤立** |
| myelin-skills.ts | 335 | ✓ createMyelin ×1 | 無 | **孤立** |
| myelin-expel.ts | 256 | ✓ createMyelin ×1 | 無 | **孤立** |
| myelin-meta.ts | 242 | ✓ createMyelin ×1 | 無 | **孤立** |
| experience-extractor.ts | 560 | ✗ 完全獨立 | 無 | **廢棄** |
| crystallization-types.ts | 34 | ✗ 純型別 | experience-extractor.ts | **廢棄** |

**關鍵發現**：
1. **只有 2/8 檔案在用** — L2-L5（playbook/skills/expel/meta）定義了但從未接入決策迴路
2. **experience-extractor.ts 是平行引擎** — 560 行完全不用 myelin，且無人 import
3. **8 個 singleton 各自管理** — myelin 已有 Fleet 和 Singleton manager
4. **5 處重複 regex 分類** — 研究/學習/任務關鍵字散落各檔案
5. **5 種 XML prompt 格式** — 每個 formatXForPrompt() 自己發明格式，myelin 已有 toPromptBlock()

### 重複模式清單

| 重複項 | 出現次數 | Myelin 已有替代 |
|--------|---------|----------------|
| Singleton 初始化 + lazy getter | 8 處 | `getOrCreate(name, config)` |
| Regex 關鍵字分類器 | 5 處 | `heuristic` 參數 |
| XML prompt 格式化 | 5 處 | `toPromptBlock({ format: 'xml' })` |
| Fire-and-forget try-catch | ~30 處 | `triageSafe()` |
| JSON/JSONL 讀寫 | 6 處 | `createMyelin({ rulesPath, logPath })` 自動管理 |
| getXStats() 函數 | 8 處 | `fleet.stats()` 統一聚合 |
| maybeDistill() 手動編排 5 層 | 1 處 | `stack.evolve()` 自動跨層 |

---

## 方案

用 Fleet + Stack 取代 8 個散落的 singleton，收斂為 **1 個檔案**。

### 目標架構

```
src/myelin-fleet.ts (新，~300 行)
├── Fleet: 統一管理所有 domain instance
│   ├── triage    (L1 — 任務分流：wake/background/ooda/foreground)
│   ├── learning  (L1 — 學習事件分類)
│   ├── routing   (L1 — 路由決策)
│   ├── playbook  (L2 — 策略選擇)
│   ├── skills    (L3 — 技能匹配)
│   ├── expel     (L4 — 經驗萃取)
│   └── research  (L5 — 研究方法論)
├── Stack: L1→L2→L3→L4→L5 階層蒸餾
│   └── evolve() 一次跑完所有層
└── 統一 API
    ├── triageTask(event)     → fleet.triageWith('triage', event)
    ├── triageLearn(event)    → fleet.triageWith('learning', event)
    ├── triageRoute(event)    → fleet.triageWith('routing', event)
    ├── getPromptBlock()      → fleet 各 member 的 toPromptBlock() 合併
    ├── distillAll()          → stack.evolve()
    └── getFleetStats()       → fleet.stats()
```

### 檔案變更計畫

| 動作 | 檔案 | 理由 |
|------|------|------|
| **新建** | `src/myelin-fleet.ts` (~300 行) | 統一入口：Fleet + Stack + 所有 heuristic |
| **刪除** | `src/experience-extractor.ts` (560 行) | 廢棄平行引擎，無人 import，myelin 已有 `crystallizeEpisodes()` |
| **刪除** | `src/crystallization-types.ts` (34 行) | 僅被 experience-extractor.ts 使用 |
| **刪除** | `src/myelin-playbook.ts` (352 行) | 孤立，playbook 策略搬入 Fleet config |
| **刪除** | `src/myelin-skills.ts` (335 行) | 孤立，技能匹配搬入 Fleet config |
| **刪除** | `src/myelin-expel.ts` (256 行) | 孤立，用 `recordEpisode()` + `crystallizeEpisodes()` 取代 |
| **刪除** | `src/myelin-meta.ts` (242 行) | 孤立，meta 觀察改用 Stack 最上層 |
| **重構** | `src/myelin-integration.ts` (430 行) | 只保留 3 個 heuristic 函數，其餘移入 Fleet |
| **重構** | `src/research-crystallizer.ts` (451 行) | 保留 `parseDelegationOutput()` + domain models，persistence 交給 myelin |
| **修改** | `src/loop.ts` | import 改為 `myelin-fleet.ts` |
| **修改** | `src/dispatcher.ts` | import 改為 `myelin-fleet.ts` |
| **修改** | `src/small-model-research.ts` | import 改為 `myelin-fleet.ts` |

### 行數估算

| | 行數 |
|---|---|
| 刪除 | -2,229 (experience-extractor 560 + crystallization-types 34 + playbook 352 + skills 335 + expel 256 + meta 242 + integration 剩餘 ~350 + research-crystallizer 剩餘 ~100) |
| 新增 | +300 (myelin-fleet.ts) |
| **淨減** | **~1,929 行 (~72%)** |

---

## 設計細節

### 1. Fleet 配置

```typescript
// src/myelin-fleet.ts

import { createFleet, createStack, type Myelin, type MyelinFleet } from 'myelin';

const MEMORY_DIR = getMemoryDir(); // existing helper

function buildFleet(): MyelinFleet<string> {
  return createFleet([
    {
      name: 'triage',
      instance: createMyelin({
        heuristic: triageHeuristic,  // 從 myelin-integration.ts 搬來
        llm: triageLLM,              // HTTP fallback to mushi
        rulesPath: path.join(MEMORY_DIR, 'myelin-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-decisions.jsonl'),
        failOpenAction: 'wake',
      })
    },
    {
      name: 'learning',
      instance: createMyelin({
        heuristic: learningHeuristic,  // regex patterns
        llm: learningLLM,
        rulesPath: path.join(MEMORY_DIR, 'myelin-learning-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-learning-decisions.jsonl'),
      })
    },
    {
      name: 'routing',
      instance: createMyelin({
        heuristic: routingHeuristic,
        llm: routingLLM,
        rulesPath: path.join(MEMORY_DIR, 'myelin-routing-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-routing-decisions.jsonl'),
      })
    },
    {
      name: 'playbook',
      instance: createMyelin({
        heuristic: playbookHeuristic,  // 從 myelin-playbook.ts 搬來
        llm: playbookLLM,
        rulesPath: path.join(MEMORY_DIR, 'myelin-playbook-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-playbook-decisions.jsonl'),
      })
    },
    {
      name: 'skills',
      instance: createMyelin({
        heuristic: skillsHeuristic,
        llm: skillsLLM,
        rulesPath: path.join(MEMORY_DIR, 'myelin-skill-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-skill-decisions.jsonl'),
      })
    },
    {
      name: 'expel',
      instance: createMyelin({
        heuristic: expelHeuristic,
        llm: expelLLM,
        rulesPath: path.join(MEMORY_DIR, 'myelin-expel-rules.json'),
        logPath: path.join(MEMORY_DIR, 'myelin-expel-decisions.jsonl'),
      })
    },
    {
      name: 'research',
      instance: createMyelin({
        heuristic: researchHeuristic,
        llm: researchLLM,
        rulesPath: path.join(MEMORY_DIR, 'research-rules.json'),
        logPath: path.join(MEMORY_DIR, 'research-decisions.jsonl'),
      })
    },
  ]);
}
```

### 2. Stack 階層蒸餾

```typescript
function buildStack(fleet: MyelinFleet<string>): MyelinStack<string> {
  return createStack({
    layers: [
      fleet.get('triage')!,     // L1: 最具體
      fleet.get('playbook')!,   // L2
      fleet.get('skills')!,     // L3
      fleet.get('expel')!,      // L4
      fleet.get('research')!,   // L5: 最抽象
    ],
  });
}

// 取代現有 maybeDistill() 的 30min 手動編排
export async function distillAll(): Promise<void> {
  const stack = getStack();
  stack.evolve(); // 自動跨層：L1 methodology → L2 observe → L3 observe → ...
}
```

### 3. Heuristic 集中管理

把 5 個檔案散落的 regex 分類器集中為純函數：

```typescript
// --- Heuristic functions (pure, no side effects) ---

function triageHeuristic(event: TriageEvent) {
  // 從 myelin-integration.ts 搬來的 HTTP fallback 邏輯
  // ...
}

function learningHeuristic(event: TriageEvent) {
  const text = event.context?.text as string || '';
  if (/delegation.*result|delegation.*complete/i.test(text)) return { action: 'delegation-result', reason: 'delegation pattern' };
  if (/\[understand\]|\[direction\]/i.test(text)) return { action: 'insight', reason: 'insight tag' };
  if (/research|paper|arxiv/i.test(text)) return { action: 'research-finding', reason: 'research keyword' };
  return null; // fall through to LLM
}

function playbookHeuristic(event: TriageEvent) {
  const text = event.context?.text as string || '';
  if (/https?:\/\//.test(text)) return { action: 'link-review', reason: 'URL detected' };
  if (/status|report|progress/i.test(text)) return { action: 'status-report', reason: 'status keyword' };
  if (/bug|error|fix|broken/i.test(text)) return { action: 'debug-flow', reason: 'debug keyword' };
  if (text.length < 20) return { action: 'quick-reply', reason: 'short text' };
  return null;
}

// ... skills, expel, research heuristics similarly consolidated
```

### 4. Domain Models 保留

以下 domain-specific 邏輯必須保留（搬入 `myelin-fleet.ts` 或獨立小 module）：

| 來源 | 保留內容 | 理由 |
|------|---------|------|
| myelin-playbook.ts | `STRATEGIES` 物件（9 個 playbook 定義） | 業務知識，不可自動生成 |
| myelin-skills.ts | `CrystallizedSkill` 型別 + `recordDelegationOutcome()` | 橋接 delegation 系統 |
| research-crystallizer.ts | `parseDelegationOutput()` + `ResearchObservation` 型別 | 自由文本解析，domain-specific |

### 5. Prompt 注入統一

```typescript
// 取代 5 個 formatXForPrompt() 函數
export function getMyelinPromptBlock(): string {
  const fleet = getFleet();
  const blocks: string[] = [];

  for (const name of fleet.names()) {
    const member = fleet.get(name)!;
    const block = member.toPromptBlock({
      includeRules: true,
      includeMethodology: name === 'triage' || name === 'routing', // 只有活躍 domain
      maxRules: 5,
      format: 'xml',
    });
    if (block.trim()) blocks.push(block);
  }

  return blocks.join('\n');
}

// 給 cascade 小模型用
export function getSmallModelPrompt(): string {
  return getFleet().get('research')!.toSmallModelPrompt();
}
```

### 6. Persistence 向下相容

Myelin 自動管理 `rulesPath`（JSON）和 `logPath`（JSONL）。檔案路徑保持不變，確保：
- 既有 rules 不丟失（同路徑讀入）
- 既有 decision logs 繼續累積（同路徑 append）
- 不需要 migration script

唯一需要手動清理的：
- `myelin-episodes.jsonl` → 改用 myelin 原生 `recordEpisode()`
- `myelin-experience-pool.json` → 改用 `crystallizeEpisodes()` 結果
- `myelin-skills-library.json` → 保留但讀寫邏輯搬入 fleet
- `research-methodology.json` → 改用 `getMethodology()` 動態取得
- `myelin-meta-profile.json` → 刪除（meta 觀察由 Stack 最上層處理）

---

## 執行順序

分 3 個 phase，每個 phase 獨立可驗證：

### Phase 1: 建立 Fleet + 遷移活躍 domain（~150 行新增）

1. 建立 `src/myelin-fleet.ts` — Fleet 配置 + triage/learning/routing 三個 heuristic
2. 修改 `src/loop.ts` — import 改為 myelin-fleet
3. 修改 `src/dispatcher.ts` — import 改為 myelin-fleet
4. **驗證**：`pnpm typecheck && pnpm test` + 手動觸發 triage 確認行為一致

```bash
# Phase 1 verify
pnpm typecheck && pnpm test
# 手動確認：loop 的 routing 決策跟之前一致
```

### Phase 2: 遷移孤立 domain + 刪除孤立檔案（~1,200 行刪除）

1. 把 playbook/skills/expel heuristic 搬入 fleet config
2. 把 `STRATEGIES` 物件和 `CrystallizedSkill` 搬入 fleet 或獨立型別檔
3. 刪除 `myelin-playbook.ts`、`myelin-skills.ts`、`myelin-expel.ts`、`myelin-meta.ts`
4. **驗證**：`pnpm typecheck` — 因為這些檔案無人 import，刪除不該破壞任何東西

```bash
# Phase 2 verify
pnpm typecheck && pnpm test
# 確認無 dead import
```

### Phase 3: 清理 + Stack 整合（~600 行刪除）

1. 刪除 `experience-extractor.ts` + `crystallization-types.ts`
2. 重構 `research-crystallizer.ts` — 只保留 `parseDelegationOutput()` + domain types，其餘交給 fleet
3. 修改 `small-model-research.ts` — import 改為 myelin-fleet
4. 清空 `myelin-integration.ts`（所有邏輯已搬入 fleet）→ 刪除
5. 建立 Stack，用 `stack.evolve()` 取代 `maybeDistill()` 手動編排
6. 統一 prompt injection — `getMyelinPromptBlock()` 取代 5 個 formatXForPrompt()
7. **驗證**：`pnpm typecheck && pnpm test` + 完整 loop cycle 測試

```bash
# Phase 3 verify
pnpm typecheck && pnpm test
# 跑一個完整 loop cycle，確認 distillAll() 正常
```

---

## 風險與回退

| 風險 | 影響 | 緩解 |
|------|------|------|
| 既有 rules 讀取失敗 | Triage 退化為純 heuristic/LLM | 路徑不變，風險低。failOpen=true 保底 |
| heuristic 搬遷遺漏 | 部分事件分類不一致 | Phase 1 專注活躍 domain，逐步遷移 |
| Stack evolve() 行為不符預期 | 跨層蒸餾結果異常 | Stack 是 Phase 3 最後步驟，可單獨回退 |
| 孤立檔案有隱藏 caller | 刪除導致 runtime error | 已確認無 import，但 Phase 2 先跑 typecheck |

**回退策略**：每個 Phase 一個 commit。`git revert` 即可回到上一個穩定狀態。

---

## Dogfooding 驗證清單

這次重構同時驗證 myelin 的以下 API 是否好用：

- [ ] `createFleet()` — 多 domain 管理是否直觀
- [ ] `fleet.triageWith(name, event)` — 命名路由是否清晰
- [ ] `fleet.stats()` — 聚合統計是否有用
- [ ] `createStack({ layers })` — 階層配置是否容易理解
- [ ] `stack.evolve()` — 跨層蒸餾是否正確
- [ ] `toPromptBlock()` — 格式是否適合注入
- [ ] `toSmallModelPrompt()` — 小模型格式是否有效
- [ ] `triageSafe()` — 錯誤處理是否足夠
- [ ] `recordEpisode()` + `crystallizeEpisodes()` — 經驗萃取流程是否完整
- [ ] `getOrCreate()` — singleton 管理是否便利

**發現 myelin API 不好用的地方 → 反饋回 myelin lib，而不是在 mini-agent 側寫 wrapper。**

---

## 成功指標

| 指標 | 目標 |
|------|------|
| Wrapper 行數 | 2,660 → ~500（-80%）|
| 檔案數 | 8 → 1-2 |
| 活躍 domain | 2/8 → 7/7（全部接入 Fleet） |
| Myelin API 覆蓋 | Fleet + Stack + Episode + toPromptBlock + triageSafe |
| Build | `pnpm typecheck && pnpm test` pass |
