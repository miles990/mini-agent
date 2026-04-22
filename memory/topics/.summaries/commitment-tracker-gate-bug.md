<!-- Auto-generated summary — 2026-04-15 -->
# commitment-tracker-gate-bug

commitment tracker 的兩個核心 bug：memory-index.ts 的 binary gate 導致 self-fulfilling commitments 永不解決（已修），commitments.ts 的空白分詞對中文失效導致承諾永遠無法匹配（已修，用 2-char bigram + char-overlap ratio）。Meta-lesson 是重複 pattern 代表結構性問題不能漠視，且 rumination-digest 注入的 stale bug report 需要 RESOLVED 標記防止下個 cycle 被過去的敘述誤導。
