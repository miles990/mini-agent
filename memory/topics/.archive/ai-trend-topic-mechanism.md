# ai-trend-topic-mechanism

- [2026-04-29] [2026-04-29 11:27 Taipei] Topic 來源機制鎖定（回 Alex「趨勢的 topic 是怎麼來的」）：

**兩層機制**:
1. summary (LLM)：claim/evidence/novelty/so_what — `hn-ai-trend-enrich-remote.mjs`
2. topic (regex 硬編)：`hn-ai-trend-graph.mjs:38-50` 9 條 keyword regex + first-match-wins

**順序敏感**: TOPICS array 順序決定優先級。memory 排第一 → agent+memory 重疊文章被吃成 memory。

**盲點**: 新概念全進 other（agentic infra/CSG/context engineering）；regex 不認中文；不認概念換句話說。

**升級候選**: A. enricher 多輸出 topic 欄位（LLM）/ B. embedding cluster（無人工 taxonomy）/ C. 補 regex taxonomy（a
