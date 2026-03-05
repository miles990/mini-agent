# Upgrade Report: 新陳代謝系統（Metabolism）

- Date: 2026-03-04T02:31:00Z
- Track: metabolism
- Effort: M
- Files: `src/metabolism.ts`（新增）, `src/loop.ts`

## Problem

Kuro 的知識管理缺乏自動閉環：
- **吸收斷裂**：learning 停在 topic memory，沒有 Fact → Pattern → Skill 昇華路徑
- **排泄缺失**：過時知識永遠堆積，無淘汰機制
- **摩擦力被動**：friction-reducer skill 存在但需手動觸發
- **Kuro 是瓶頸**：所有知識管理都要 Kuro 手動 review，阻塞進化速度

Alex 指示：「不然他會變成整個閉環裡最大的瓶頸」

## Solution

新增 `src/metabolism.ts` — 全自動新陳代謝系統，零瓶頸設計：

| 功能 | 機制 | 節流 |
|------|------|------|
| 吸收 `detectPatterns()` | mushi similarity clustering，≥0.85 自動合併重複 | event-driven（有新 REMEMBER 才跑） |
| 排泄 `detectStaleKnowledge()` | ≥30 天 + 零引用 → 自動移除 | 每 6h |
| 偵測 `detectFriction()` | placeholder（Phase 4） | 每 1h |

整合方式：`metabolismScan()` 掛在 `runConcurrentTasks()`，利用既有並發基礎設施，跟 perception refresh + auto-commit 三路並行。

## Before → After

| Metric | Before | After |
|--------|--------|-------|
| 重複知識處理 | 手動（永不處理） | 自動合併（similarity ≥ 0.85） |
| 過時知識淘汰 | 無機制 | 每 6h 自動掃描 + 移除 |
| 新陳代謝延遲 | 無（不存在） | 0（跟 perception refresh 並行） |
| 瓶頸 | Kuro 手動 review | 高信心自動做，低信心寫 log |

## Verification

- `pnpm typecheck` — PASS
- `pnpm build` — PASS
- mushi 離線時 fail-open（不影響正常運作）
- 回退：L1，刪 `src/metabolism.ts` + revert loop.ts 3 行

## Next

- Phase 2: Pattern → Skill 昇華（≥3 次引用的 pattern 自動建議提煉成 skill）
- Phase 3: detectStaleKnowledge() 已實作，觀察 6h 後首次掃描結果
- Phase 4: detectFriction() 填入 behavior log 掃描邏輯
