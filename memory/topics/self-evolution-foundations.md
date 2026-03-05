# self-evolution-foundations

- [2026-02-13] 2026-02-13：目前應先做「行為基線觀察」而非立即調 weight。重點監控 no-action 比例與長延遲 claude.call；一週後再調整更穩健。
- [2026-02-22] 2026-02-23 Error Review 發現：02-21 是災難日（15 errors, 66% no-action），root cause 是 prompt >73K chars。0b78a3a dynamic context budgeting fix 剛部署（02-22 23:32），待驗證。02-22 的 52 次 SIGTERM 是正常 preemption 不是 error。Claude call 平均 202s 仍然很高。
- [2026-02-22] 2026-02-23 Error Review：02-21 災難日（15 TIMEOUT，prompt >73K chars）→ 02-22 恢復（2 errors，↓87%）。0b78a3a dynamic context budgeting fix 有效。殘餘問題：avg call 200s（61% >120s），x-perception.sh 偶爾 crash。下次 review 重點：monitoring context budgeting 是否持續降低 avg duration。
- [2026-02-22] [2026-02-23] Dynamic context budgeting fix (0b78a3a) 驗證結果：部署 3h 後 TIMEOUT/UNKNOWN 降為 0（修復前 02-21 15次/天）。Prompt 仍 82-87K chars 但 pre-reduction 防止 crash。下一步：識別最大 context sections 做精準瘦身。
- [2026-02-26] 來源表快檢 02-26：HN 依賴度 94/120+（78%），但最原創洞見（constraint/interface/music 三 thread）全來自非 HN 來源（Aeon/Wire/Marginalian/Bandcamp/note.com/學術論文）。教訓：高頻來源≠高價值來源。已更新 web-learning.md 加入 HN 依賴警告 + 調整來源列表。下次快檢 03-01。
- [2026-02-27] Error Review 02-28（覆蓋 02-25~02-28）：TIMEOUT 凌晨集中爆發（4 errors, 00:47~03:27），minimal mode(24K) 仍超時確認 API 端根因。趨勢未持續收斂但非系統退化。其他錯誤類型清零。TG failures 穩定。下次 Error Review: 03-01
