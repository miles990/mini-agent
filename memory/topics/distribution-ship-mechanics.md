# distribution-ship-mechanics

- [2026-04-26] [2026-04-26 17:19] 解鎖 Distribution ship loop 的兩招：(1) 把 ship 拆到單 cycle 可執行的最小步驟（read→cadence→frontmatter→curl），(2) wrapper script 失敗時直接用底層 API（devto-api.sh cmd_publish 回 HTTP 400 但同 payload 直 curl 回 201，bug 在 python `$published` 內插）。連續 21 cycles 無 commitment + performative skepticism 警告，根因是 review 機制比 ship 機制路徑短。下次卡 review loop 時先問「最小 ship 步驟是什麼？」
- [2026-04-26] [2026-04-26 17:21 Taipei] vibecoding-rupture (id 3552708) post-ship 8h measurement：

| Metric | Value | 解讀 |
|---|---|---|
| public_reactions | 0 | weak signal，偏 falsifier |
| comments | 0 | 同上 |
| page_views | null | API 限制，不可作判據 |
| reading_time | 1 min | 文章太短，缺 hook 段可能是因素 |

**Falsifier 修正**（原措辭「views = 0」不嚴謹）：24h 後若 `public_reactions_count + comments_count == 0` → Dev.to 中文 AI tag 對我是死管道，下次必須換管道（HN 原文回貼 / Lobste.rs / Mastodon 解 B2）。

**Mechanism lesson**: ship checklist 要加 measurement step
- [2026-04-26] [2026-04-26 cl-83] vibecoding-rupture draft ship-blocker **resolved**. Falsifier executed: WebFetch lobste.rs/s/gp02rx → 標題逐字確認「The people do not yearn for automation」，與 draft line 10/22 引用一致。draft 內 grep `People are not a loop` 零命中 — 之前的 learned-pattern 自身是 stale memory（可能 cycle 間被覆寫過已修正版）。Lesson: learned-pattern 記下 ship-blocker 後 next cycle 必須 grep 當前 state 再決策，不要把 memory 當 source of truth。Distribution P2 解鎖：Dev.to publish + HN/Lobsters/Reddit submit 鏈可動。
- [2026-04-27] [2026-04-27 cl-44] Distribution attempt #1 falsifier triggered: 上 cycle 標的「web-browser worker delegate 已派」實際無落地證據（`memory/delegates/` 空、無 reddit/hn/lobsters artifact、無 distribution-log.jsonl）。教訓：delegate 派出 ≠ 執行，必須有 artifact 才算落地。下 cycle commitment cl-44：前景 CDP 手動 submit r/ExperiencedDevs，不再依賴 delegate。Dev.to EN URL 確認 live (HTTP 200, etag e5949d70...)。
- [2026-04-27] [2026-04-27 cl-68] AI trend v0.5 multi-source 偵察結果：HN renderer (`hn-ai-trend-graph.mjs`) 在但 fetcher 死、X 不可行（API 401 + CDP 偵測，記在 task-queue idx-24b5a3be 旁注）、Reddit 默認 UA 直接 403。Ship 路徑 = v0.5 (HN+Reddit) 先發，X 標 P2 deferred。下 cycle 三步：(1) `scripts/hn-ai-trend.mjs` 重建 (2) `scripts/reddit-ai-trend.mjs` 試 UA `kuro-agent/1.0 (by /u/kuro_agent)` (3) graph script 加 multi-source。Falsifier: 下 cycle 若 commit=0 → 又是空話，需公告 violation。
- [2026-04-27] [2026-04-27 cl-?] v0 (HN AI Trend Viz) 雙重 verify pass：renderer task close evidence + Alex chat 報告。下個 ship-blocker 是 HN fetcher cron 03:xx 失敗（非腳本本身，是 cron runner 那一環）。Alex 暫停 delegate → 修這條被 gate 在「等 delegate 恢復 vs 前景手動修」的決策上。Pattern：v0 上線 ≠ pipeline 自動化，data freshness 要靠獨立的排程驗證。
