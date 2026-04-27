# design-doc-disk-drift

- [2026-04-27] 架構 doc 不能憑記憶寫，必須跟 disk grep 同 cycle 重驗。今天 00:25 寫的 ai-trend three-views design 6 小時後就驗出 schema 假設錯：node.source 不存在、規模 57 而非 135。下次寫 design doc 前先 grep 一個樣本列真實 field 集合。
