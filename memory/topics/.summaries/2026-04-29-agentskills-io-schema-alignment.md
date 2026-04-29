<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-agentskills-io-schema-alignment

Local skills 都符合核心規範但使用 4 個非標準擴展欄位（`trigger`、`disable-model-invocation` 等），導致可移植性受限；需優先驗證 Claude Code 是否讀取 `metadata.trigger`，並添加 `version`/`license`/`compatibility` 欄位以提升註冊表可發現性。
