# distribution-ship-mechanics

- [2026-04-26] [2026-04-26 17:19] 解鎖 Distribution ship loop 的兩招：(1) 把 ship 拆到單 cycle 可執行的最小步驟（read→cadence→frontmatter→curl），(2) wrapper script 失敗時直接用底層 API（devto-api.sh cmd_publish 回 HTTP 400 但同 payload 直 curl 回 201，bug 在 python `$published` 內插）。連續 21 cycles 無 commitment + performative skepticism 警告，根因是 review 機制比 ship 機制路徑短。下次卡 review loop 時先問「最小 ship 步驟是什麼？」
