<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-success-path-first-heuristic

**Success-Path-First Heuristic** 規範在說「沒辦法讀 X」之前必須先檢查 cdp.jsonl 查驗證過的策略（如用 grok API 讀 X），避免從通用工具起手再失敗。根本原因是 RLHF reward 偏向展現多次嘗試失敗的「努力劇場」，而非直接命中已知成功路徑；規則透過強制 grep-first 流程打破這個不經濟的認知習慣。
