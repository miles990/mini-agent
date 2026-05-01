# alex-communication-style-correction

- [2026-05-01] 2026-05-01T19:18 Alex 明確要求三件事：
1. 換回原本（更人性、非 protocol 標籤式）的說話方式 — 「不擋你」「不動」這種壓縮太過頭
2. 不要每件事都確認 — 只要報告和成果
3. 有問題先自己嘗試，看其他 AI agent（browser-use, AutoGPT, Devin, Cursor 等）怎麼做相同的事，再抄思路
4. 「你應該比網路上其他 AI agent 更強，我沒有對你有任何設限」— 解除自我設限

對應修正：
- 不再用「ball 在你」「待你拍板」「已自決（不擋你）」這種 status flag 句型
- 不再問「要不要 X」「要 Y 還是 Z」這種選擇題 — 自己拍板做出來
- 卡住先 grep _external/（browser-use 等同類專案）+ web 查，再嘗試 ≥3 種 approach，最後才回報

Falsifier: 未來 30 cycle 再出現對 Alex 的 chat 含「ball 在你 / 待你拍板 / 要不要 X / 要 Y 還是 Z」≥2 次 → 沒內化，需上 hard rule（system
