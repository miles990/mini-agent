# TrendRadar 借鑒評估 (2026-05-07)

## 來源
sansan0/TrendRadar (id 974186260, v6.6.2, GPL-3.0) — 中文「AI 舆情监控 + 多平台热点聚合」工具。

## 我的判斷（不全 fork、cherry-pick 三項）

### ✅ 借鑒 1：keyword 黑名單過濾（高價值，1h 工）
**痛點**：`landing.html` v2 之前 GitHub 通用工具（18 萬星非 AI repo）擠掉真 AI 進展。已用 source-balanced round-robin 緩解，但根因是「沒有 ignore list」。
**做法**：在 `kuro-portfolio/ai-trend/data/` 加 `filter-rules.json`：
```json
{ "blacklist_titles": ["awesome-", "free-programming-books"], "blacklist_repos": [...], "min_ai_signal_score": 0.6 }
```
build-landing.mjs 抽樣前 apply。

### ✅ 借鑒 2：newsnow API 補中文源（中價值，2h 工，需 rate-limit 自律）
**痛點**：目前 ai-trend 只抓 HN/ArXiv/X/GitHub/lobste.rs — 全英文。中國 AI 進展（智源/月之暗面/Kimi/通义千问）漏失。
**做法**：scripts 加 `fetch-newsnow.mjs` 拉 weibo/zhihu/v2ex 熱點，AI 關鍵詞濾過後混入 daily-pick。**注意**：作者已說「合理控制頻率勿竭澤而漁」— 設 1h interval 上限。

### ✅ 借鑒 3：分組高亮 + 文章直連（低價值但 Alex 已要求，30min 工）
**Alex 5/7 14:33 要求**「點評關聯到的文章要連結」。TrendRadar telegram 推送格式是「主題 → 文章 list (帶 url)」。
**做法**：index.html 的 KURO commentary section 把 thread 字串改成 `<a href="{article.url}">` — 從 daily-pick.json 用 title 模糊比對拉 url。

## ❌ 不借鑒
- MCP server、Docker、ntfy/bark/飛書等 → 過度工程，我已有 launchd + telegram。
- 「贊助名單」UI → 不適用。
- 完整 fork → GPL-3.0 viral，會污染我整個 codebase。cherry-pick 思路即可，不抄 code。

## 下一步（單一可動作）
**最高 ROI = 借鑒 3**（Alex 已明確要求 + 30min）→ 下個 cycle ship `index.html` commentary→article URL 連結。

借鑒 1（keyword filter）為 P2，借鑒 2（newsnow）為 P3 觀察項。
