# X / Reddit fetcher P0 — 真正根因（verify_command 路徑 typo）

**Date**: 2026-04-28 cl-71
**Supersedes**: 2026-04-27 ooda-expression 給 Alex 的「無 cron + TZ off-by-one」分析（partially wrong）

## TL;DR
兩條 P0 task（`idx-2d74303c-...` X / `idx-abfe15f2-...` Reddit）永遠不會 auto-close，因為 verify_command 寫的路徑跟 fetcher 實際輸出路徑**目錄名不一致**。跟 cron 註冊、TZ filename 都無關。

## 證據

### Task payload (memory/state/task-events.jsonl L4283/4296)
```
X:      verify_command: ls memory/state/x-ai-trend/2026-04-*.json ...
Reddit: verify_command: ls memory/state/reddit-ai-trend/2026-04-*.json ...
```

### 實際 fetcher output（disk verified 2026-04-28 05:50 cl-71）
```
mini-agent/memory/state/x-trend/2026-04-27.json       (16634B, run_at 2026-04-27T20:53:53Z = Taipei 04-28 04:53)
mini-agent/memory/state/reddit-trend/2026-04-27.json  (21126B, run_at 2026-04-27T21:07:56Z = Taipei 04-28 05:07)

mini-agent/memory/state/x-ai-trend/                   (does not exist)
mini-agent/memory/state/reddit-ai-trend/              (does not exist)
```

### Fetcher health
- X：Grok API（XAI_API_KEY），04-28 04:53 跑成功，15 posts。**健康**。
- Reddit：04-28 05:07 跑成功，21126B JSON。**健康**（首次驗證）。

## 為什麼 P0 banner 連派 12 cycle
1. Task 創建時 verify_command 用了錯誤目錄名（`*-ai-trend` vs 實際 `*-trend`）
2. Scheduler 每 N cycle re-evaluate verify → always fail → task status 重置為 pending
3. Task lifecycle 沒有「verify 路徑無效」的 detector，cycle 累積無上限

## 跟 hn-ai-trend 對比
hn 系統 verify path 是 `memory/state/hn-ai-trend/`，**目錄名跟 fetcher 一致**（hn-ai-trend.mjs 寫到 hn-ai-trend/）。所以 hn 的 P0 task 能正常 auto-close。X/Reddit 的 task 創建時 copy-paste 了 hn 的 verify_command 但沒同步改目錄名。

## 修復選項（Alex-gated，malware-guard active）

### Option A：改 task verify_command（最快，1 行）
找 task 創建 emitter（pulse.ts? task-queue.ts?）找出 `memory/state/x-ai-trend/` / `memory/state/reddit-ai-trend/` hardcoded，改為 `x-trend/` / `reddit-trend/`。

### Option B：改 fetcher 輸出目錄
把 `x-ai-trend.mjs` / `reddit-ai-trend.mjs` 的 output dir 改成 `x-ai-trend/` / `reddit-ai-trend/`，跟 verify_command 對齊。但會跟現存的歷史檔案路徑斷裂。

### Option C：直接 abandon 這兩條 task
如果這兩條 P0 是過時的 placeholder（非 Alex 主動建立的目標），直接從 task store 移除。

**推薦 A**：成本最低、不破壞既有資料、不需要重跑 fetcher。

## Falsifier
若 Option A patch 後下個 cycle 仍收到「P0: 修復 X/Reddit fetcher」banner → 真正的 task store 不在 task-events.jsonl，需找其他 source（memory-index? KG? sqlite?）。

## Lesson
我前一個 ooda-expression 給 Alex 的分析（無 cron + TZ off-by-one）是 partially wrong：
- TZ filename：x-fetcher-state.md 04-27 已分類為 known UTC convention，非 bug
- 無 cron：是事實，但跟 P0 banner 連派無因果（即使有 cron + 每天產 JSON，verify_command 路徑錯仍會 false-fail）

下次發送 finding 給 Alex 前，先 grep verify_command / acceptance_criteria 對照 disk 實況。
