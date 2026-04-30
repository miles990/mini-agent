# Swimlane view — 空格填充 + 資料覆蓋度提示 診斷

**Date**: 2026-04-28 19:00 (Asia/Taipei)
**Author**: Kuro
**Task**: P2 Swimlane view 改善 — 空格填充 + 資料覆蓋度提示
**Status**: diagnosed, fix proposal ready, **not self-applied** (Alex 16:22 still iterating swimlane.html + malware-guard 邊界保守)

## Disk evidence

7 天視窗 (04-22 → 04-28) artifacts:

```
2026-04-21.json  ✓
2026-04-22.json  ✓
2026-04-23.json  ✗ MISSING (cron broken pre-Alex `00f78389` rebuild)
2026-04-24.json  ✓
2026-04-25.json  ✓
2026-04-26.json  ✗ MISSING (same root cause)
2026-04-27.json  ✓
2026-04-28.json  ✓
```

`mini-agent/kuro-portfolio/ai-trend/swimlane.html` (448KB, mtime 04-28 16:22):

- Embedded `const DATA = ...` 含 6 unique dates, 195 total date cell instances
- `grep "2026-04-23\|2026-04-26"` → 0 hits
- `grep "empty\|gap\|missing\|placeholder\|no.data\|無資料\|缺"` → 0 hits

→ **viz silently elides gap days**。讀者看到 04-22 直接接 04-24，誤判為時間連續。資料覆蓋度（5/7 = 71%）沒有任何提示。

## 為什麼缺 04-23 / 04-26（已知，不是本 task 範疇）

HEARTBEAT 已記錄完整根因：
- `scripts/hn-ai-trend.mjs` 04-25 前 untracked → 被清掉 → cron 報 `Cannot find module`
- Alex commit `00f78389` 11:30 重建並 commit 進 git
- HN Firebase `/topstories.json` 是 live ranking，**無 `--date` override** → 04-23 / 04-26 為**永久缺口**

→ symptom-fix 只能在 viz 層做（標記 + 提示），不可能補資料。

## Architecture

```
graph.mjs  →  graph.html  (canonical, embeds DATA)
                  │
                  ↓ sync-views.mjs (R1: DATA line byte-equal)
                  │
       ┌──────────┴──────────┐
       ↓                     ↓
swimlane.html         source-split.html
   (bespoke D3)         (bespoke D3)
```

DATA shape 共用，view-specific render code 各自獨立。本 task 修復點 = swimlane.html 內嵌 D3 render code，**不**動 graph.mjs / DATA shape（會污染另兩個 view）。

## 修復切點（兩段，建議分開 ship）

### Patch A — 空格填充（gap day cells）

**位置**: swimlane.html 內 D3 x-axis / column generator
**邏輯**:
1. 從 DATA.posts 抽 unique dates → `seenDates`
2. 計算 7-day rolling window: `windowDates = [today-6, ..., today]`
3. `gapDates = windowDates - seenDates`
4. Render 時 x-scale domain 用 `windowDates`（而非 `seenDates`），gap day 顯示為 dashed-border + 灰底 placeholder cell，hover 顯示 "No data — fetcher gap"

**Falsifier**: 04-29 看 swimlane，04-23 + 04-26 兩欄應為灰底 dashed，hover tooltip 顯示 gap 提示；若仍 silently skipped → patch 沒 ship 或 D3 scale 沒切換

### Patch B — 資料覆蓋度提示（coverage meter）

**位置**: swimlane.html header 區（現有 title bar 下方）
**邏輯**:
1. 計算 `coverage = seenDates.length / windowDates.length`
2. Render: `Coverage: 5/7 days (71%) — gaps: 2026-04-23, 2026-04-26`
3. 配色：>= 85% green / 60-85% amber / <60% red
4. mobile responsive: 短文字版 `5/7d 71%`

**Falsifier**: header 區出現 coverage 字串；coverage 數值與實際 artifacts 數量一致（用 `ls memory/state/hn-ai-trend/*.json | wc -l` cross-check）

## 為何 not-self-apply

1. swimlane.html mtime 04-28 16:22 → Alex 仍在迭代，任何 edit 高碰撞
2. 448KB 內嵌 D3 surgery 需要先讀完整個 render block 才能精準 patch；本 cycle 預算 $1.45/$5 已花在 disk-verify，剩餘預算不足做 careful surgery without regression
3. `sync-views.mjs` 讀檔觸發 malware-guard reminder → 對 viz 檔案的邊界保守處理：先寫診斷，等 Alex confirm 是否 self-apply / hand-off / 我來

## Next action gate

- [ ] Alex confirm: (a) 我來 ship Patch A → (b) 我來 ship Patch B → (c) Alex self-apply → (d) defer
- 預設沉默 = (d) defer，本診斷 note 留作 archive
