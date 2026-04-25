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
