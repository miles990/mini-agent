# ai-trend-rename-orphan-scripts

- [2026-04-27] [2026-04-28 06:58 cl-84] cl-24 rename `kuro-portfolio/hn-ai-trend/` → `ai-trend/` 漏改兩個 script 的硬編碼 path。Disk evidence: `kuro-portfolio/` 只剩 `ai-trend/`（mtime 06:26 today），`hn-ai-trend/` 不存在。但 scripts/ 還寫舊 path：

**Diff 1** — `mini-agent/scripts/hn-ai-trend-sync-views.mjs:26`:
```diff
- const VIEWS_DIR = join(__dirname, '..', 'kuro-portfolio', 'hn-ai-trend');
+ const VIEWS_DIR = join(__dirname, '..', 'kuro-portfolio', 'ai-trend');
```

**Diff 2** — `mini-agent/scripts/hn-ai-trend-graph.mjs:25`: ref:2026-04-28-cl-24-rename-followup
