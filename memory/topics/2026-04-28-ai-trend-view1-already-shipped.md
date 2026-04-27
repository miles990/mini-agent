# ai-trend View 1 已 ship — 不要再寫 prototype

**Date**: 2026-04-28 01:23 Taipei
**Trigger**: 啟動 task「ai-trend View 1 prototype: Time × Source Swimlane」前 disk-verify

## 發現

`/Users/user/Workspace/mini-agent/kuro-portfolio/hn-ai-trend/` 已存在以下檔案（untracked，mtime 2026-04-28 01:22）：

- `swimlane.html` (225,339 B) — **就是 View 1**：Time × Source Swimlane（標題明確 "AI Trend — Swimlane"）
- `source-split.html` (221,556 B) — **就是 View 2**：Source Split Panels
- `graph.html` (231,137 B) — modified（既有 force-graph）
- `index.html` (3,158 B) — modified（多半加上新 view 連結）

`swimlane.html` 包含完整 D3 swimlane 渲染 + claim/so_what hover panel + responsive resize — 是 production-ready，不是 prototype。

## 結論

Task 列表上的「ai-trend View 1 prototype」（2026-04-27T16:24:44 added）已被 Alex 在 01:22 ship 完成。我的 task 是 **ghost commitment**。如果這個 cycle 我 Write 一個競爭版本的 swimlane.html，會 clobber Alex 的 work — 同 stdout-tail patch 三日前的 anti-pattern。

## 行動

- 本 cycle：不寫 prototype，記錄此發現
- 下 cycle 開場若再被排到此 task：直接 No action（指向此檔案）
- 等 Alex 把這 4 個 untracked 檔案 commit 進 git 後，task 自動失效

## Lesson re-internalized

「Disk first, task list second.」在 Write 任何 task 列表上的「待 ship」項目前，先 `ls` / `git status` 該檔案路徑。連續 3 天的 stdout-tail patch ghost commitment + 今天的 swimlane.html ghost commitment = **task 列表的「pending」狀態跟 disk 真實狀態之間有持續性 drift**。需要的不是「我下次更小心」而是：在 task 進入 active stack-rank 前，scheduler 該跑一個 disk-verification step。但那是 src-level 修，目前 malware-guard active 不 self-apply。

## Falsifier

如果下個 cycle (a) `ls kuro-portfolio/hn-ai-trend/swimlane.html` 不存在 — 表示我看錯路徑或檔案被刪 → 此記錄錯誤
(b) Alex 主動說「View 1 還沒做你來做」— 那這 4 個檔案是別的東西，task 仍 valid
否則：task closed by external lane。
