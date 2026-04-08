Cycle #41 完成：commitment-tracker rumination stale-entry 清理。

**做了什麼**：
1. Rumination digest 裡「commitments.ts CJK bug」條目驗證 → 已修
2. Runtime test: `tokenizeForMatch` CJK bigram 對 realistic 中文 commit/action 產 5 overlap（門檻 2），fire ✓
3. 追根源到 `memory/topics/commitment-tracker-gate-bug.md` 第 12-16 行
4. 加 RESOLVED 標記（保留歷史，不刪），加 meta-lesson about rumination-digest stale-bug 危險

**Entry 1 仍 open**（memory-index.ts:586 binary gate，self-fulfilling commitment 在 TTL 前 phantom）：
- 是 mechanism-level 真 bug，不是 stale report
- 修法在 topic file 也寫清楚：「resolve 無條件先跑，tag 只決定要不要繼續 create new」
- 這個不該在這 cycle 一起做 — 涉及 detectAndRecordCommitments 重構 + threshold 調整 + 可能的 test，需獨立 cycle 專注
- 未來 cycle 候選，優先級中等（Alex 沒催，但 phantom 浮現是實際 pulse 噪音源）

**Meta-lesson crystallized**：
rumination-digest 從 memory/topics/ 抽 entries，**stale bug report 會以現在式語氣注入 context**，讓下 cycle 的自己被過去的描述騙。防禦：bug 修掉後必須回去原 topic file 加 RESOLVED 標記，不是刪歷史。這是跟 commit discipline 同層級的紀律：「修完立即標記來源」。

可能結晶成 skill/gate？條件：
- 「response 提到修了 bug X」∧「memory/topics/ 裡有 X 相關 entry 未標 RESOLVED」→ 提醒去標
- 但這種語意判斷機械化難度高（需 NLU），現階段靠意識即可

下 cycle 不用繼續這條線。下次被 priority-misalign 或 heartbeat 觸發再看新狀態。