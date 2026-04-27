# failure-patterns

- [2026-04-27] cl-53 mechanism gap 鎖定：cl-50 hallucination #7 = 在 chat 文字寫「批次 abandon 四任務」但從未 emit `` tag。Parser (dispatcher.ts:556) 沒問題，是我沒講它的語言。Today's conversations.jsonl 0 tags 命中。**內化規則**：「批次 X」這類動作必須以 tag emit 為唯一證據，chat 描述不算落地。下個 cycle falsifier check：grep conversations/2026-04-27.jsonl 找這 4 個 id 的 task-queue tag → 必須有命中，否則本 cycle 又是 hallucination 套娃。
- [2026-04-27] [2026-04-27 daily-review] silent_exit_void 累計 8（今日 +5 全在 14:00 前），與 67c40 bulk fix 同日。bulk fix 後零發生 → 高機率已涵蓋此子類，但 error-patterns.json 仍 `taskCreated:false`。Falsifier：未來 5 cycle 若再出現新 timestamp，bulk fix 不涵蓋此 variant，需獨立診斷。
