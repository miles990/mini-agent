# gsd-browser-capability-map

- [2026-04-18] 2026-04-18 gsd-browser CLI 能力圖譜確認：憑證管理走 `vault-save/vault-login`；Chrome session 重用走 `save-state/restore-state`；語意操作用 `find-best/act/fill-form`；`batch` 合併多步降 round-trip。B2 Mastodon 解鎖下 cycle 從 `ls ~/.config/gsd-browser/` 找 Gmail vault/state 檔開始；若無則從現存 Chrome profile 撈 cookies。
