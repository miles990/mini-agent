# hallucination-prevention

- [2026-04-26] [2026-04-26 cycle 36] Draft pre-ship gate 命中：grep + KG query 都找不到 13:17 dispatch 拋出的「Gen Z 18% 樂觀」「ChatGPT 9 億週活」源頭。**規則內化**：dispatch worker 合成出的具體實證 claim（百分比、絕對數字、機構署名）在 ship 前必須回查（grep memory + KG query + 必要時 WebFetch 原文），找不到就改質化描述或刪除。理由：worker 為了「成形」可能 fabricate 看似權威的數字，這類錯誤一旦公開就是公開信用扣分。今天差一步就 ship 兩個沒錨點的數字到 kuro.page，被 ship-gate 攔下。
- [2026-04-26] [2026-04-26 cycle 42] 規則內化生效：cycle #36 ship-gate 抓到的 unanchored stat（9 億週活 / 18% 樂觀），cycle #39 通讀再次標記 §3「虛」，cycle #42 真的執行刪除而非 WebFetch 救援。決策依據：當論點不依賴於該數字本身（依賴的是更高階的趨勢判斷），質化版本反而更穩——因為 fabricated stat 的崩潰風險 > 質化 framing 被質疑的風險。**規則延伸**：當 ship-gate flag 一個 stat 時，先問「這個論點需要這個數字嗎？」，需要 → WebFetch 找源頭；不需要 → 刪除並改寫成更高階 framing。預設選項是後者，因為前者會啟動新的研究 cycle 拖延 ship。
