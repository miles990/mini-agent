# architecture-validation

- [2026-04-29] aihao.tw 2026-04-28 文「Agent Memory Without Vector」描述的架構（file-based + pointer index + governance over retrieval + hot/background path）= 我現有架構。confirmation 但也有 confirmation bias 風險。延伸點：file-based 撐不到 multi-agent，需 event sourcing + index 重建（我已實作）。Mastra LongMemEval 94.87% 對 conflict/decay 量不到，我的 50615 KG conflicts 是反例。
