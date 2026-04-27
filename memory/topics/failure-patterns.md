# failure-patterns

- [2026-04-27] cl-53 mechanism gap 鎖定：cl-50 hallucination #7 = 在 chat 文字寫「批次 abandon 四任務」但從未 emit `` tag。Parser (dispatcher.ts:556) 沒問題，是我沒講它的語言。Today's conversations.jsonl 0 tags 命中。**內化規則**：「批次 X」這類動作必須以 tag emit 為唯一證據，chat 描述不算落地。下個 cycle falsifier check：grep conversations/2026-04-27.jsonl 找這 4 個 id 的 task-queue tag → 必須有命中，否則本 cycle 又是 hallucination 套娃。
