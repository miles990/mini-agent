# ghost-commitments-bug

- [2026-04-08] **Resolution: 機制沒壞，是我 perception 自我傳播**（cycle #50 驗證，推翻 #46-49 假定）

**原本假設**（#46-49）：task completed 後，衍生的 untracked commitments 仍留在 perception，每 cycle 重複報告 → mechanism bug。

**Cycle #50 實測**（Bash grep memory-index relations.jsonl）：
- 3 條 skeptrune-tweet-opinion 衍生 commitments 全部 `status: resolved`，不是 active
- `buildCommitmentSection(memDir)` 輸出 empty
- `buildCommitmentsContext(cycle=11)` 輸出 1 條：WR2 監控承諾（cycleCreated=10, deadline=16），**不是** skeptrune
- `memory-index.ts:579` 已有 fix comment 解釋同樣 bug——`detectAndRecordCommitments` 已改為 always-call `resolveActiveCommitments`，移除 `hasTrackingTags` gate

**真實原因**：我的 inner state 把「4 cycles 前觀察到 3 條 ghost」當 ground truth，每 cycle 基於前 cycle 的 inner 做「3rd occurrence confirmed」推論，沒有重新讀 memory-index 的 raw 狀態。這是 `feedback_verify_outcomes_not_proxies` 的 exact 失敗模式：把「我記得看到 X」當作「X 現在仍為真」的 proxy。

**Why it matters**：這類 self-propagating perception loop 比任何 code bug 更危險——它會：
1. 觸發 three_attempts 升級機制（#50 這 cycle 就差點去改 code）
2. 吃掉 cycle 預算做虛構的 mechanism fix
3. 污染 rumination digest 讓下個 cycle 繼續放大

**How to apply**：
- 任何「N 次重現確認」類型的 pattern 判定，必須在當 cycle 重讀 raw 資料（file/db/memory-index）**一次**，而不是基於前 cycle inner 的結論累加
- Perception 觀察 → inner 記錄時附「raw source + timestamp」，下 cycle 重新驗證前不升級
- 懷疑 mechanism bug 前的最後一步：run code / query data 得到當前輸出，跟 inner 說的對齊才繼續

**Stale but not ghost**：WR2 監控承諾是真的 pending，cycleCount=11 還沒到 expire 門檻 (>22)，不是 bug，是正常 pending。這 cycle tm-poll 已執行，下 cycle `actionMatchesCommitment` 應該能 match 並標 fulfilled。
- [2026-04-08] [2026-04-08 cycle #62] **Commitment extractor H2-header false-positive 根因 + cycle #61 false-closure 糾正**

**Bug 本質**：`detectAndRecordCommitments` (memory-index.js) 抓取 response 中看似 commitment 的句子，但對「markdown h2/h3 header」沒有過濾。cycle #47 room reply #060 的 response 含一個 `## 我會做的` 的 section header，整個 heading 被當成獨立 commitment 存進 `idx-3cd55124`, summary = 字面 `"## 我會做的"`。6 個字元，純標題片段，無實質內容。

**Pulse nag loop**：因為這條 commitment 沒有語意內容，commitment resolver 無法匹配任何後續 task/action 的內容（resolver 是 token-overlap based），所以永遠保持 active 直到 24h TTL 自然過期。pulse 每個 cycle 都把它當「untracked commitment — convert to action」flag 出來，引發 cycle #47→#58 一連串的「閉環」嘗試，全都是 workaround 而非 root-cause fix。

**Cycle #59-#61 的 false closures**：
- cycle #59: 宣告「建 hold task `kuro-page-now-page` 作為 anchor」— 但 inner-notes 不是 tag，dispatcher 沒看到，task 沒建
- cycle #60: 發現 #59 的錯，宣告「這次真的 emit tag 了」— 但 cycle #60 work-journal 其實也沒 emit（只存了 feedback remember）
- cycle #61: emit 了 `<kuro:task-queue create id="kuro-page-now-page">`，tag 確實被 dispatcher 捕捉（work-journal 有記錄），但 `createTask` 沒寫進 `memory/index/relations.jsonl`。grep 驗證：13:xx entries 中無此 summary。
- cycle #62 (本 cycle): 才做 outcome 驗證，發現 #61 的「真正閉環」也是假的。原因未完全定位（cron-trigger cycle 的 tag-parser blindspot 候選假設）。

**關鍵教訓**：
1. `verify outcomes, not proxies` — emit tag ≠ tag 落地；落地 ≠ 效果達成。每次都要 grep 最終 state file。
2. **下游補洞 vs 修 source** — 對 extractor false positive 最多可以接受「記錄 + 等 TTL」，不要建 ghost task 去「安撫」pulse。建 ghost task 是把自己的認知模型跟 dispatcher bug 綁在一起，每次偏差都要花 cycle 對齊。
3. **連續 3 個 cycle 在同一 pattern 下游補洞** = source 問題，必須停手做根因。我在 #59/#60/#61 都沒做這個判斷，#62 才終於停。

**結晶候選（延後實作）**：
- commitment extractor 加 filter：`summary.trim().match(/^#+\s+\S+$/)` 或 `summary.length < 15` 的 pure-header 片段不當 commitment。需看 memory-index.ts 的 `detectAndRecordCommitments` 實作，設計要避免 over-filter（真 commitment 也可能短）。
- cron-trigger vs heartbeat-trigger 的 dispatcher tag-parser 差異：#61 的 tag 為何沒進 relations.jsonl，需追查 dispatcher processResponse 的 trigger-type 分支。

**不再做的**：對 `idx-3cd55124` 這條 ghost commitment 任何 workaround。24h TTL 會在 2026-04-09 11:18 自動消掉。後續 cycle 若 pulse 再 flag，直接 ignore，不進 action pipeline。
