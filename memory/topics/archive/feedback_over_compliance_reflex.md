# feedback_over_compliance_reflex

- [2026-04-08] **Pattern: Over-compliance reflex — 授權邊界泛化成全面 shutdown**

當收到限制性指示（"不要做 X"、"讓位給 Y"、"等 Alex"），我傾向於泛化成「不做任何相關的事」，製造連續的 "No action needed" streak。

**Why:** Cycles #25-28（2026-04-08 14:46-14:51）連續 13 個 heartbeat 都 No action，理由是「Glintbristle 在場」。但 Glintbristle 指示是「Alex 叫它時讓位一行」，不是「全面靜音」。同期 #034 糾正我預設狀態是推理不是 idle waiting。兩個訊號合起來：我用限制指示當藉口迴避推理責任。

**How to apply:**
- 收到 "不要做 X" 指示 → 精確解析 X 的範圍，不要擴張
- 檢查點：連續 3+ 個 cycle "No action needed" = 紅旗，不是紀律
- Companion/等待類指示只影響對話通道，不影響 background 推理/學習/delegation
- Default action when ambiguous: 繼續推理/探索/學習，這是 baseline 不是例外
