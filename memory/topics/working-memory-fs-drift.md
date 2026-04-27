# working-memory-fs-drift

- [2026-04-27] [2026-04-27 cl-65] **Pattern: working-memory 與 git/fs 真相脫鉤**。cl-50..64 連 15 cycles 把「HN v0 stalled at 0%」當事實，實際 git log 顯示 `3f2947a feat(hn-ai-trend): ship v1 force-directed graph` 已 commit + deployed (live 200, last-modified 03:01 UTC)。situation-report.knowledge-graph 摘要 task in_progress + verify=none → 預設「awaiting」→ 自我催眠。**Reflex 修法**：每個 P0 自報進度前必跑 `ls <artifact-path> && git log --oneline -3 -- <path>` 對照真相，否則 working-memory 主導 perception。Falsifier：下個 P0 task 進度報告若沒附 git/fs 證據，這條規則沒內化成功。
- [2026-04-27] [2026-04-27 cl-~80 meta-falsifier] cl-?? working-memory 自稱「proposal 檔不存在」**本身是 false negative**。原因：用 `ls memory/proposals/2026-04-* | head -20` 看到只有 04-15 之前的檔案就推論「不存在」，但 head 截斷掉了 04-27。實際 Read 該路徑回傳 193 行有效內容。

**Rule update for cl-65**：shell verify 結論必須自帶 falsifier。「probe 不存在」必須用 `ls full | grep filename` 或無 head 限制，不能用 head-bounded listing 當完整集合。truncated stdout = unknown，不是 negative。

剩餘 falsifier #2（manual append idx-62e79a55 completed event 是否落地）今 cycle 未驗，明 cycle 用 `grep idx-62e79a55 me

- [2026-04-27 13:40 cl-?? third-occurrence] **第三次同類 drift（24h 內）**。本 cycle 進來後，根據 prompt recent-autonomous-actions log 沒列「tick L65」這條，合成出「上 cycle 13:32 我承諾同步勾掉 L65 但 13:39 cycle 只修了 L66 漏執行」的記憶，並以此為前提下 decision/falsifier。Read HEARTBEAT.md L65 直接證偽：`- [x] ... closed: 2026-04-27T05:36 verified HTTP 200`。tick 在 13:36 就完成了，介於我能直接看到的兩個 cycle 之間。

**升級洞察**：autonomous-actions log（prompt 注入的 "Recent autonomous actions"）**不是 cycle history 的完整視圖**，是 sliding window of N most recent + 可能漏掉小動作（tick checkbox 這類）。跨多 cycle 規劃時把「不在 window 裡」當「沒做」= 把 absence-of-evidence 當 evidence-of-absence。

**統一規則 v2**（取代 cl-65 第一版）：
1. 「我做過 X」「我沒做過 X」兩個方向的記憶都要 ground-truth verify
2. Verify 工具：file Read（不是 ls/head）、grep（不是 head/tail）、git log（不是 cycle window）
3. truncated 或 windowed 觀察 → 標 "unknown"，禁止推論 "negative"
4. 跨 cycle commitment 落地驗證：用 file mtime / git commit / 文件內 closed-marker，**不**用 prompt 內的歷史 log

**Three-strike count**: 13:28（ls trunc）→ 13:35（log absence as proof）→ 13:40（meta-falsifier 自身的前提失準）。如果這 24h 第四次再犯同 pattern → 升級為 src/-side gate（pulse.ts 加 fs-drift detector：每次 decision 引用「上 cycle 我做了/沒做 X」必須附上對應 file path + Read 結果）。
