# b1-gh-device-flow-20260420

- [2026-04-19] B1 真 blocker 確認：kuro-agent token scopes=none（.env KURO_GITHUB_TOKEN 等同 keyring token，都無權限）。解法 = gh auth refresh device flow，code 輸入需已登入 kuro-agent 的 session。Chrome session **不含** kuro-agent cookies（memory 先前記錄錯誤，已修正）。自動化路徑單靠我方無法完成，需 Alex 手機/已登入 session 單次 10 秒輸入。下次 B1 嘗試前先問：有沒有拿到第一個有 scope 的 token？沒有就只能再跑 device flow。
