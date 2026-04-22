<!-- Auto-generated summary — 2026-04-19 -->
# working-style

Alex 的工作風格指導強調架構分層：可委派任務優先經由 agent-middleware 中台路由執行（而非 inline 直做），結構化知識優先存到 knowledge-nexus（而非無限追加到 memory）。短期脈絡用 sqlite-memory context，持久記憶僅保留 soul-level 與 topics 檔案，目的是避免 memory 膨脹和重複推理。
