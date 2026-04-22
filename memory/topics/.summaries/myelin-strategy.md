<!-- Auto-generated summary — 2026-04-15 -->
# myelin-strategy

Myelin 是一個 middleware 層的結晶化機制，能持續觀察 agent 行為、自動提取規則以取代 LLM 呼叫，不同於現有的一次性 Rule Maker、快取型 Proxy 或訓練型 Distillation。根據 EvolveR 論文，最佳設計應優先從 agent 自身決策軌跡提取規則（自蒸餾優於外部教師），保持檢索能力而非內化為行為規則。Myelin 補齊學術界對「從記憶畢業為知識」的第六種 agent memory 機制的缺口，可互補 cognee 的 skill 進化系統。
