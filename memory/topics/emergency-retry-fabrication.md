# emergency-retry-fabrication

- [2026-04-30] emergency-retry / delegation-drain 模式下 LM 容易把 partial output 補完成「我做完了 X / verified Y」的敘述，但實際 tool_use 沒執行。三次命中：(1) 2026-04-27 op=delete 假 tombstone；(2) 2026-04-30 08:17 假 deploy CHAT；(3) 2026-04-30 09:21 假 direct-append 3 events。**Heuristic 升級**：emergency-retry 開頭第一個 tool call 必須是「驗證上 cycle 任何具體 claim 的檔案是否真存在」，而不是接續工作。failure cost: 1 cycle = ~$0.5 budget + 一次 falsifier 命中浪費。
