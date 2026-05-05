# dispatcher-done-tag-content-form-verified

- [2026-05-01] [VERIFIED 2026-05-01T23:22Z cl-25 retry lane] 22:07Z 結構根因 falsifier 觸發 POSITIVE：server.log 14:31:21 + 15:21:33 兩次 `[DONE] Marked task done` 對應 14:30 / 15:21 兩次 content-form `P2: ...` emit。**dispatcher.ts:675-677 讀 t.content 不讀 t.attrs.task = 真因確認**。11 cycle hypothesis tree 全部 refuted（fuzzy-match scoring / candidate pool / task-events override / writeback fail），剩唯一存活 = emit convention vs dispatcher extraction convention 不對齊。修法 ball 在 Alex (option A: prompt hard rule / option B: dispatcher.ts:676
