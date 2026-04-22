# tanren-architecture

- [2026-03-29] [2026-03-29] Akari 指出的設計張力：soul.md 說「追求理解而非生產力」，但 crystallization 的 empty-streak 偵測會標記沒有 action output 的 tick。這兩者之間有張力——系統偵測行為模式（有無 output），不是意圖（有無嘗試理解）。可能的回答：empty tick 不是懲罰是信號，crystallization 的目的是讓 agent 注意到自己的 pattern，不是強制產出。但這個區分在 code 層面沒有明確表達。
