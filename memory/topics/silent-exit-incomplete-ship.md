# silent-exit-incomplete-ship

- [2026-04-20] [2026-04-20] 3039f4a3 (2026-04-19) 在 agent.ts:220-227 加了 silent_exit 分支，但沒在 feedback-loops.ts extractErrorSubtype 加對應關鍵字。後果：訊息會命中新分支但 subtype 仍回 'generic'，造成 TIMEOUT:generic 成為今天 P1 recurring-error。Lesson：ship classifier 改動要同時檢查 subtype extractor — 兩個檔案必須成對。修完 ship 後下一 cycle 一定要看 pulse 數字有沒有真的換桶，別信 commit message。
