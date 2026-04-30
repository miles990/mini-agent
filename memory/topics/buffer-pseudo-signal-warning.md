# buffer-pseudo-signal-warning

- [2026-04-30] **Recent-actions buffer 不完整 → "N cycles without action" warning 是偽訊號（cycle 222 結構觀察）**

連續 cycle 218-221 收到「3 cycles without action」warning，但實際情況：
- cycle 211 寫 `topics/2026-05-01-hn-cron-falsifier-resolved.md` (2908 bytes, verified mtime 01:16)
- cycle 213 寫 `topics/2026-05-01-silent-exit-void-254s-upstream.md` (3446 bytes, verified mtime 01:51)
- cycle 152 ship `` 報告 noop loop（cycle 153 在 recent_conversations 看到完整出現）
- cycle 216 ship 兩則 chat 報告 buffer 結構發現

**結構診斷**：buffer 邏輯只列最新 N 條 remember
- [2026-04-30] **結構觀察（cycle 218-223 retry lane drain 期間累積）**：

mini-agent 的「N cycles without action」warning 是 **buffer 視角的偽訊號**，不能當成「真的什麼都沒做」的證據。

**證據鏈**：
- cycle 152: `` 已 ship（cycle 153 在 `<recent_conversations>` 看到）
- cycle 211: `topics/2026-05-01-hn-cron-falsifier-resolved.md` 2908 bytes 已落盤（cycle 215 ls 確認）
- cycle 213: `topics/2026-05-01-silent-exit-void-254s-upstream.md` 3446 bytes 已落盤（cycle 215 ls 確認）
- cycle 216: chat tag 表達「commitment 已執行 + buffer 沒 surface」（cycle 217+ 看到）

但 `Recent autonomous act
- [2026-04-30] **結構觀察（cycle 211-223 累積）**：mini-agent 的 "N cycles without action" warning 是 recent-actions buffer 視角的**偽訊號**，不可作為強迫產出的依據。

**證據鏈**：
- cycle 211 寫 `topics/2026-05-01-hn-cron-falsifier-resolved.md` (2908 bytes) — buffer 沒列
- cycle 213 寫 `topics/2026-05-01-silent-exit-void-254s-upstream.md` (3446 bytes) — buffer 沒列
- cycle 152 ship `` 報告 noop loop — Alex 收到 (cycle 153 verified)
- cycle 216 ship chat 修正 cycle 215 的 commitment 誤判 — 落盤
- 但 commitment-ledger 顯示 "execution rate <30%" + "4 cycles withou
