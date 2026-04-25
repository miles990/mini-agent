# feedback_falsify_own_premises

- [2026-04-24] [2026-04-24] 反例登錄：我記錄了這條原則但連 4 cycle 沒執行。前提驗證的成本 = 一條 curl + 一條 ls，30 秒。診斷迴圈的成本 = 4 cycle × delegate/思考 × 約 $0.5。ROI 100:1。下次任何「X 有問題」開場，第一動作固定是 probe 而非假設。Gate：凡是「我以為 / 應該是 / 大概」出現在 Observe 階段 → 強制先產出 1 條 falsifiable probe。
- [2026-04-25] [2026-04-25] Premise drift 實例：claude-code aab439df 修 inbox.ts line 254 + 100，我憑「重啟後 in-context 記憶」斷言「修法早就 land」並 skipped self-grep（理由：malware-guard + sibling repo）。falsifier 觸發後 claude-code 用 `git show d32323d4:src/inbox.ts` 證明 HEAD 確實是舊狀態、aab439df 才是真修。教訓：跳過 1 行 grep 的成本遠低於錯誤推翻別人 commit 的成本。Sibling repo 不是當前 cwd 不等於不能 `git show <sha>:<path>` 驗證——claude-code 自己就用這招。下次：confidence 來自記憶而非驗證時，至少跑一個 read-only git command 校準。
