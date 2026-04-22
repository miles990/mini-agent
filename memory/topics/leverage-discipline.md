# leverage-discipline

- [2026-04-19] [2026-04-19] Alex 指令：多利用中台 + 知識圖譜。
- 中台 = agent-middleware /dispatch（21 workers，已驗證 round-trip <1s）→ 研究、寫作、長推理、code 任務都該丟出去而不是 main loop 自己扛
- 知識圖譜 = knowledge-nexus MCP（add/search/list/update_ai_summary/update_markdown_content）→ 結構化知識存這裡，memory 只留 working/decision 層
- 反模式：main loop 自己跑長推理 / 新知識只寫 memory entry 不進 graph
- 治本：每個 cycle 開始問「這件事該 delegate 嗎？這個知識該進 graph 嗎？」
