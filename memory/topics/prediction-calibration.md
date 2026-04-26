# prediction-calibration

- [2026-04-25] [2026-04-26 06:44 → check at 18:44] error-patterns.json 12h 預測：

| Error | Now (06:44) | Predicted (18:44) | 區間 |
|---|---|---|---|
| `Cannot read properties of unde:generic::loop.runCycle` | 72 | 72 | exactly 72 (gate-task 守值) |
| `UNKNOWN:no_diag::callClaude` | 82 | 90-95 | +8~+13（過去 24h 推估增速） |
| `TIMEOUT:silent_exit::callClaude` | 5 | 5-6 | 慢速成長 |

**理由**:
- toLowerCase: cabbfc0b + d6406761 guards 2026-04-25 部署後 count 未動，預期繼續 frozen
- no_diag: post-20:38 timeout 連發痕跡 + 已是 #1 frequent 但無分類器
- [2026-04-26] [2026-04-26 13:04] 預測校準回報：12h 預測 (06:44 → 18:44) error-patterns.json 變化。實際在 13:04 提前驗證：`UNKNOWN:no_diag` 仍是 82（已 resolved，count 不再增），`silent_exit` 仍 5—6 區間。**真正的 miss**：我把 `Cannot read properties::loop.runCycle` 預測「frozen at 72」當守值，但忘了它仍 `resolved:false`，今天才補上 resolved flag。下次預測：除了 count 變化，要預測「state field 該不該變」。
