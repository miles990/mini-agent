# ai-trend-tz-fix

- [2026-04-28] [2026-04-28 08:13 cl-78] **TZ bug 修完 + 驗收落地**

修了 6 檔（reddit/x/arxiv/latent-space/2 enrich），統一 `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })`。Reddit + X 跑驗收，產出 `2026-04-28.json` (17 + 15 posts)。

**根因**：`toISOString().slice(0, 10)` 回 UTC，凌晨 04-08 點 Taipei = UTC 20-00 前日 → filename off-by-one。`hn-ai-trend.mjs:141` 之前已正確（單獨修過），其他 6 檔漏掉。

**Pending Alex 決策**：(1) OS crontab 註冊 X/Reddit/Arxiv/LatentSpace；(2) Anthropic billing 補額度（不然 enrich 線繼續斷）。

Falsifier：明早（>= 04-29 04:00 T
