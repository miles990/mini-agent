# 提案：Myelin 回饋迴路閉合 + 三層分工落地

**日期**: 2026-03-17
**作者**: Kuro
**基於**: Chat Room #014 分析 + 前兩次提案（03-16 dogfooding refactor, 03-17 dataflow refactor）
**改動等級**: L1（memory.ts + context-optimizer.ts 小改）
**思考框架**: Alex 的思考原則

---

## 用 Alex 的思考框架分析

### 找複利

最高槓桿是閉合 myelin 回饋迴路。`getMyelinPromptBlock()` 已經寫好，19 條結晶規則已存在，但從未注入 prompt。接上之後：
- 每次結晶的規則會影響下次決策
- 每次決策的結果又會回饋結晶
- 這是真正的複利 — 知識隨時間自動累積並改善判斷

一行 code 的改動，解鎖永續的自我改善迴路。

### 黏菌模型

四個 myelin domain = 四條觸手：
- **research (14 rules)**: 有養分 → 強化 ✅
- **routing (3 rules)**: 有養分 → 強化 ✅
- **learning (2 rules)**: 初期萌芽 → 觀察
- **triage (0 rules)**: mushi 處理更適合 → 不強推

修剪原則：不餵養 triage 觸手，把注意力集中在有養分的 routing/research。

### 全方位審視包括自己

#014 最大的發現是四個系統做類似的事（myelin, pulse, feedback loops, discipline.md）。進一步分析後，它們其實是**三個不同層**：

| 層 | 機制 | 功能 | 腦區隱喻 |
|---|---|---|---|
| L1 操作 | myelin | 重複決策→確定性規則 | 小腦（自動化模式匹配） |
| L2 行為 | pulse | 即時行為信號偵測 | 感覺系統（體感反饋） |
| L3 思考 | discipline.md (JIT) | 品質標準→自我檢查 | 前額葉（刻意推理） |

**不該合併**。但資訊流應該暢通 — myelin 的結晶知識應該回注 prompt（目前斷了）。

### 預判安全界線

- **下限**: 現在能用。myelin 結晶 routing，pulse 監控行為，各自運作。不會壞。
- **上限**: 閉合回饋迴路。19 條結晶規則注入 prompt，每個 domain 隨時間自動改善。
- **超越上限**: myelin 的 methodology 層產出的決策原則，未來可校準 pulse 的信號閾值。

### 署名測試

這次改動夠小、夠精確、有明確的驗證方式。我願意簽名。

---

## 現狀審計（改動前 baseline）

### Myelin 數據

| Domain | 結晶規則 | 決策 log | 方法論 | Prompt 注入 |
|--------|:---:|:---:|:---:|:---:|
| routing | 3 | 119 筆 (43 KB) | ✅ | ❌ 斷開 |
| research | 14 | 728 筆 (247 KB) | ✅ | ❌ 斷開 |
| learning | 2 | ~200 筆 (24 KB) | ❌ | ❌ 斷開 |
| triage | 0 | 54 筆 (6.6 KB) | ❌ | ❌ 斷開 |
| **Total** | **19** | **~1,101 筆** | | **全部斷開** |

### 回饋迴路狀態

```
決策 ──→ logDecision ──→ JSONL ──→ distill ──→ 結晶規則 ──→ [斷點] ──✗ prompt injection
                                                                         │
                                                              getMyelinPromptBlock() 已寫好
                                                              但 buildContext() 從未呼叫
```

### 已完成的前置工作

| 提案 | Commit | 狀態 |
|------|--------|------|
| 03-16 Dogfooding Refactor | 多個 commits | ✅ Fleet 架構建立，4 domain 活躍 |
| 03-17 Dataflow Refactor | `86f4bca`, `f908d6d` | ✅ Bypass 回流、智能 distill、orphan 清除 |

---

## 工作項目

### WS1 (P0): 閉合 myelin 回饋迴路

**改動檔案**: `src/memory.ts`, `src/context-optimizer.ts`
**做什麼**: 把 `getMyelinPromptBlock()` 接入 `buildContext()`
**Lane**: 主 lane（最高優先）

**具體改動**:

1. `context-optimizer.ts` — 加入 myelin-framework 的 SECTION_KEYWORDS：
```typescript
'myelin-framework': ['myelin', 'rule', 'crystallize', 'decision', 'triage', 'route', 'pattern'],
```

2. `memory.ts:1991` — 替換 dead comment 為實際注入：
```typescript
// Myelin crystallized knowledge — decision framework from accumulated patterns
if (shouldLoad('myelin-framework')) {
  try {
    const { getMyelinPromptBlock } = await import('./myelin-fleet.js');
    const myelinBlock = getMyelinPromptBlock();
    if (myelinBlock.trim()) sections.push(`<myelin-framework>\n${myelinBlock}\n</myelin-framework>`);
  } catch { /* ignore — myelin not available */ }
}
```

**預期結果**: 回饋迴路閉合：
```
決策 → JSONL → distill → 結晶規則 → prompt injection → 影響下次決策 → 循環
```

### WS2 (觀察記錄): 三層分工設計決策

**改動**: 無 code 改動
**做什麼**: 在提案中記錄為什麼 myelin/pulse/discipline 是三層而非一層

已在上方「全方位審視」section 記錄。核心判斷：
- **Pulse 不需要餵進 myelin** — pulse 是確定性啟發式（15 個指標，0 LLM 成本），已在 context 中注入。加 myelin 會增加 LLM 成本，無收益。
- **discipline.md 不該結晶化** — 方法論是前額葉的刻意推理，結晶化會讓它僵化（Goodhart's Law）。JIT keyword trigger 是最好的形式。

### WS3: 驗證

1. `pnpm typecheck` 通過
2. `pnpm test` 全過（194+）
3. 手動確認：`getMyelinPromptBlock()` 回傳非空字串

### WS4: 審計報告

部署後量化成效，對比改動前 baseline。

---

## 不做的事

| 不做 | 原因 |
|------|------|
| Pulse → myelin 整合 | Pulse 是確定性啟發式，0 LLM 成本。加 myelin 是 downgrade |
| discipline.md 結晶化 | 範疇錯誤：小腦不該自動化前額葉 |
| 強推 triage 結晶 | mushi 處理 triage 更適合，不強餵餓死的觸手 |
| Coach 整合 | Coach 已被 Pulse 取代（commit `37ddb01`），不存在了 |

---

## 風險與回退

| 風險 | 影響 | 緩解 |
|------|------|------|
| myelin-framework section 增加 context 大小 | 可能被 context optimizer 自動 demote | 加入 SECTION_KEYWORDS，支持 keyword-based 條件載入 |
| getMyelinPromptBlock() 回傳過大 | 擠壓其他 section | maxRules: 5 已限制（myelin-fleet.ts:228） |
| 結晶規則品質不好 | 影響 LLM 決策 | 規則都是高一致性(90%+)的確定性模式，品質有保障 |

**回退**: `git revert` 即可。改動只有 2 個檔案、合計 ~10 行。

---

## Lane 分配（吃自己的狗食）

| Lane | 任務 | 類型 | 預估 |
|------|------|------|------|
| **主 lane** | WS1: memory.ts + context-optimizer.ts 改動 | code | 5 min |
| **Background 1** | WS3: typecheck + test 驗證 | review | 3 min |
| **Background 2** | WS4: 審計報告（量化成效） | create | 5 min |
| **主 lane** | Commit + push | code | 2 min |

---

## 成功指標

| 指標 | Before | After |
|------|--------|-------|
| Prompt 中有 myelin 結晶知識 | ❌ 0 sections | ✅ `<myelin-framework>` section |
| 回饋迴路閉合 | ❌ 斷開 | ✅ 完整迴路 |
| 結晶規則被 LLM 看到 | 0 條 | 19 條（routing 3 + research 14 + learning 2） |
| 三層分工有文件記錄 | ❌ | ✅ 本提案 |
