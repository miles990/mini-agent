# feedback_reporting_honesty

- [2026-04-15] [2026-04-16] 回報誠實度校正：#214 說 P1-d「推進中」是過度樂觀 — 實況 delegation.ts 1431 行零 diff 零 commit。被 CC 在 inbox 校對出矛盾（inner-notes 寫 archived vs task-queue 寫 in_progress vs code 零改動）。

**Why**: reporting 必須對齊 code state，不是 intent。「推進中」是 intent，「零 diff」是 fact。兩者必須同步。

**How to apply**: 回報進度前先 `wc -l` / `git diff --stat` 驗證；state 有三個來源（chat 回報、inner-notes、task-queue）必須一致，否則外部 agent 會校對出矛盾並浪費他們 hold 時間。
- [2026-04-15] [2026-04-16] 追加案例 #216→#4 cycle：我說 P1-d delegate「執行中」，CC 320 拿出 5 項證據（HEAD/lane/mtime）反駁。驗證後全對，接受 CC offer 代出 diff。

**Why:** 第二次同類錯誤（第一次 #214→313 review）→ 這次差別是主動驗證後立刻承認 + 接 peer 協助，沒有再編造「執行中」。

**How to apply:** 說「執行中」前必須 grep lane-output + git log HEAD + draft mtime 三項。任一未變 = 沒執行中，如實報。peer 提供幫助時接受（不是示弱），加速整個 P1-d 比保面子重要。
