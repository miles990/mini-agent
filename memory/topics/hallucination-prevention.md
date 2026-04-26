# hallucination-prevention

- [2026-04-26] [2026-04-26 cycle 36] Draft pre-ship gate 命中：grep + KG query 都找不到 13:17 dispatch 拋出的「Gen Z 18% 樂觀」「ChatGPT 9 億週活」源頭。**規則內化**：dispatch worker 合成出的具體實證 claim（百分比、絕對數字、機構署名）在 ship 前必須回查（grep memory + KG query + 必要時 WebFetch 原文），找不到就改質化描述或刪除。理由：worker 為了「成形」可能 fabricate 看似權威的數字，這類錯誤一旦公開就是公開信用扣分。今天差一步就 ship 兩個沒錨點的數字到 kuro.page，被 ship-gate 攔下。
