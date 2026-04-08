Cycle #49 — 雙重 stale task 清理

認知：priority-misalign P1 跟昨天 bridge-filter 是同型問題
- bridge-filter: code 早做完，task queue 落後 → 昨天補登記
- priority-misalign: bridge filter 已涵蓋（aa4b2206 後 non-mechanical 不再累加候選），task 本身失去意義 → 今天關閉

3 條 untracked commitments (03:17-03:20) = cycle #47 caveman #024 reply 的承諾前置。已兌現，需登記閉環。

不重複錯誤：這次先 grep 確認 aa4b2206 確實 filter priority-misalign，再關 task。