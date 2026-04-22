<!-- Auto-generated summary — 2026-04-15 -->
# ghost-commitments-bug

Commitment extractor bug：`detectAndRecordCommitments` 誤將 markdown header（"## 我會做的"）當成 commitment 存入系統，因其無語義內容導致 resolver 永遠無法匹配任何 action，引發 6 cycles 的虛假閉環嘗試。根本原因是 inner state 沿用舊的感知而未重驗當前 raw 狀態——典型的 `verify_outcomes_not_proxies` 失敗模式，對 source 誤判應修根源而非下游補洞。
