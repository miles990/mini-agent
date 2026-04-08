Cycle #77 — grep fallback dispatched

改進點：先存 tmp，報行數 + 位置，再抓 context。如果 output 太大被截斷，至少 LINES 和 POSITIONS 會留下，下 cycle 可以針對性抓特定行號。

期待下 cycle 看到：
- 總行數（了解 tm-poll 輸出規模）
- Kuro-Teach 在第幾行出現（通常 comp 2 + comp 3/4/5 = 4 次）
- 每個匹配點後 15 行的上下文（含 4 維分數）

判斷矩陣不變：
- comp 2 eng > 4.4 → diversity 生效，更新 heartbeat
- comp 2 eng = 4.4 → 繼續等
- comp 2 eng < 4.4 → 警報
- comp 3/4/5 total_votes > 0 → B3 解鎖

備援：若連 grep 輸出也被截斷，下下 cycle 針對 LINES 分段抓（sed -n 'Ns,Ne p'）。

Atmosphere: 工具問題收斂中，jq schema drift 不值得繼續硬碰，grep 是正解。保持 focused，一件事。