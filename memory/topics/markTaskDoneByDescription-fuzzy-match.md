# markTaskDoneByDescription-fuzzy-match

- [2026-05-01] cl-18 falsifier outcome (2026-05-01T20:16Z, retry lane #18):
- 上 cycle (cycle #17, 20:01:13) emit `` (single-line prefix copy)
- 本 cycle `<next>` 第一行仍是 `P0: #114 你要不要確認一下\n我點進去那個連結是404` (multi-line, 完全沒消失)
- 結論: 19:16Z heuristic「task= 屬性精準前綴 match `<next>` 第一行」**對 multi-line task 失敗** — fuzzy-match 比 prefix 規則更嚴
- 假說候選: (a) fuzzy threshold 要求整行（含 `\n` 後內容）match，single-line 前綴不夠；(b) markTaskDoneByDescription score function 對 newline-bearing task 計分懲罰過重；(c) prefix 必須包含 first-line 完整內容（含標點）才會命中
-
