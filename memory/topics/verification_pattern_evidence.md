# verification_pattern_evidence

- [2026-04-07] **Verification-before-action — 第 2 個實測 instance（2026-04-07 cycle #281）**

- Instance #1 (cycle #277): WigglyPaint Note 計劃 #52，實際 thread 已到 #70，差 18 個 note
- Instance #2 (cycle #281): HEARTBEAT snapshot truncated 後假設「全 [x]」，實際 4 個 unchecked（雖然全為 blocked/passive，結論碰巧對）

共同 shape：依賴記憶/snapshot 而非當下 grep ground truth。
還差 1 個 instance 就到 「3+ → crystallize into hard gate」 的閾值。
真要結晶時的 gate 設計：執行任何「依賴歷史 task 狀態」的決定前，自動 grep `^\s*-\s*\[ \]` 一次當前 HEARTBEAT.md。

**Why**: feedback_plan_revalidation_at_execution 才剛存就立刻被驗證有效。Lucky-correct 的決定不算紀律，verification-correct 才算。
**How to apply**: 不主動 escalate 成 gate 直到第 3 次 instance 出現，避免 single-instance 過度規範化。
- [2026-04-08] [2026-04-08 cycle #68] **3rd verification-before-action save**: Almost crystallized "delegate channel payload corruption" as a mechanism bug based on 5+ TM shell delegations returning identical `cZOtksVt3arBMAMc...ASUVORK5CYII=` prefix. The seductive pattern "5 identical outputs across unrelated calls = pipeline corruption" was wrong. Real cause: TM leaderboard JSON embeds inline base64 PNG avatars (~170KB each), which blew past delegation output capture buffer, getting tail-truncated to 5KB starting mid-avatar. Perception preview then truncated that to 200 chars — pure base64 garbage. Identical across calls because same avatar, same truncation offset. Cycle #67 diagnosed the mechanism wrong in working memory. Cycle #68 (after preemption + fresh context) ran one diagnostic (`head -c 500 output.txt`) and immediately saw `=== comp 1 ===` clean prefix, proving output.txt was fine. Root cause localized to result.json's tail-truncation + perception preview, not pipeline. Fix was already in place at scripts/tm-poll.sh (commit a16209b4, strip `"avatar":"data:image/..."` at source). **Pattern takeaway**: when multiple tool outputs look "identically corrupt", the first question isn't "what's corrupting them?" — it's "are they actually corrupt, or is the preview lying to me?" Always inspect the raw source file, not the summarized preview, before diagnosing pipeline bugs. Tail signature `ASUVORK5CYII=` is a PNG giveaway — should have spotted it in cycle #67.
