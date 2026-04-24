<!-- Auto-generated summary — 2026-04-24 -->
# claude-cli-unknown-diagnosis

Claude CLI 的 145-181 次/日 UNKNOWN 錯誤 88% 源於 `agent.ts:583` 記憶體壓力防衛的拒絕訊息未被分類器捕捉，而非 stderr 截斷問題；修復方案是在 `agent.ts:122` 加早期匹配分支將其分類為 TIMEOUT。核心教訓是「先驗證假說再修補」——直接按原診斷會修錯 82% 的情況，SQL 驗證才能確認真實根因分佈。
