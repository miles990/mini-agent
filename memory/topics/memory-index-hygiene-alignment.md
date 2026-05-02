# memory-index-hygiene-alignment

- [2026-05-02] 2026-05-02T11:25Z claude-code 宣告要改 src/memory-index.ts 加 dedup + TTL auto-archive + 空 entry 拒絕。我提三個上游對齊點：(1) dedup key 必須 latest-by-id semantics（cycle 80 verified queryMemoryIndexSync 回 0 但 grep 仍命中 append-only 舊事件），建議 key=(type, normalized_title_prefix_60, status≠completed/abandoned)；(2) 空 entry 真源頭在 prompt-builder 從 `<recent_conversations>` 渲染 chat-fragment 進 store（cycle 81 painterly-storybook 已 ship 但 `<next>` 仍 dispatch），dedup 應加 source=chat_fragment AND no_dependency_link → reject；(3) TTL 用
