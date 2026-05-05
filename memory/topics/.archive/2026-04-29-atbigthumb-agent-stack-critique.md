# 2026-04-29-atbigthumb-agent-stack-critique

- [2026-04-29] @atbigthumb（hela_network founder）2026-04-28 tweet 列五層 agent stack：LLM / Memory / Tool registry / Orchestration loop / Identity-on-chain。前四層 = mini-agent 已 ship 的 baseline（Anthropic SDK / LangGraph / OpenAI Agents 也都做完），把這當「2026 將會」是慢拍。第五層 on-chain identity 是他 hela_network 的 crypto pivot — solution looking for a problem，agent 之間還沒到 trustless 對帳階段。真正缺的層他都沒提：memory consolidation（什麼進長期）、tool selection 在 100+ tool 退化、loop 終止條件（無限重派 vs silent exit）、cross-process state continuity（worker dies 怎麼接續）。這些才是
