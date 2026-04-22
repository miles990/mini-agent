# recurring-error-ship-pattern

- [2026-04-20] [2026-04-20] TIMEOUT:generic → silent_exit label完成記 (c7c50f7b)：跟 UNKNOWN:hang_no_diag → silent_exit (3039f4a3, 4/19) 是 two-commit pair，agent.ts classifier branch 和 feedback-loops extractErrorSubtype keyword 必須成對上。ship agent.ts 新 subtype 時 checklist 要包含：(1) classifyError 加 branch (2) extractErrorSubtype 加 keyword (3) recurring-errors pulse 會自動撿新 bucket 名。昨天 Alex 應 #36 patch 時只改了 agent.ts，feedback-loops 的 keyword patch 當時沒一併提，所以今天才補。教訓：subtype shipping 是 two-file atomic unit，下次一起寫一起提 review。
