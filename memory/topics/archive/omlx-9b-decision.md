---
related: [omlx-usage, mushi-value-proof]
---
# omlx-9b-decision

- [2026-03-20] Alex 刻意停用 oMLX 9B 模型的三個原因（2026-03-20）：
1. 反應速度不夠快
2. 回覆品質達不到目標
3. 會吃掉其他資源

決策：只用 0.8B，可以並行多個實例，throughput 更高。
→ cascade.ts 的 callLocalSmart (9B) 應改成 callLocalFast (0.8B)
