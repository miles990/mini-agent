# url-rename-scope

- [2026-04-27] [2026-04-28 04:08 cl] P0 URL rename 偵察完成：mini-agent/kuro-portfolio/ 內 `hn-ai-trend` 5 檔案 14 occurrences，全在 `hn-ai-trend/` 目錄內（selection.html:8, index.html:3, 2026-04-24.html:3, graph.html:2, swimlane.html:1）。Falsifier ≤20 occ ≤5 檔 PASS — 是 rename 不是 migration。

**剩餘未掃描**：(a) mini-agent/scripts/hn-ai-trend*.mjs 路徑寫入（影響 cron 輸出 state path）；(b) memory/state/hn-ai-trend/ 目錄；(c) kuro.page Cloudflare Pages 路由設定（公開 URL 真正在這層）；(d) 其他 docs 引用 https://kuro.page/hn-ai-trend/。

**下個 cycle 路徑**：先掃 (a)+(b) 確
