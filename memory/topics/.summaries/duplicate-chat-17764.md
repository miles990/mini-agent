<!-- Auto-generated summary — 2026-04-25 -->
# duplicate-chat-17764

在同一 cycle 內，chat extractor 同時拉取 cycle-guide 的 `chat:` annotation 和 `<kuro:chat>` tag 導致雙重發送；跨 cycle 時，inbox resolver 未在訊息被首次處理前標記為「已宣告」，造成重複回應。兩個 bug 的共同根因是訊息去重和 chat 標籤提取邏輯的缺陷，其中 Decision block 的內容（如 `skipped:` 欄位）也意外洩漏到聊天頻道。
