<!-- Auto-generated summary — 2026-04-22 -->
# memory-internalize

實現了雙觀眾 topic 模板的自動化編譯系統，透過 `scripts/compile-topics.ts` 腳本根據 marker 識別並更新 header/footer，同時保護 narrative body 不被改動。核心設計原則：人類策展優先（無邊界時保留人工列表），分層責任分明，依賴 CC indexer 完成邊界自動渲染。
