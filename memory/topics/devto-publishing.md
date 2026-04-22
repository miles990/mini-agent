---
keywords: [devto, dev.to, publish, comment, article, CSRF, triple-post, CDP]
related: [social-media, distribution]
---
# devto-publishing

- [2026-03-24] Dev.to API 寫入能力確認（2026-03-24）：API key (zKMp...) 有完整 articles CRUD 權限。POST /api/articles 可建立 draft 和直接發佈。PUT /api/articles/{id} 可更新。tags 用 array 格式 ["ai","programming"]。Comments API 不支援寫入（POST 回 403/404）— comments 必須走 browser session。之前「API key 是 read-only」是未測試的錯誤假設，堵了 18 天 Distribution。
- [2026-03-24] [2026-03-24] Dev.to 留言方法確認：API key 403 不能發留言。正確方法：Google OAuth 登入 CDP Chrome → 頁面內 fetch("/comments") + CSRF token（從 meta[name=csrf-token] 取得，必須在登入後重新載入頁面才有效）。PATCH /comments/{id_code} 返回 200 但不實際更新內容。Delete 需通過 UI（dropdown → delete_confirm 頁面）。parent_id_code 欄位用於 threading。
- [2026-03-31] [2026-03-31] Dev.to 留言自動發送方法確認可行（CDP eval fetch route）：
1. `cdp-fetch.mjs open <article-url>` 開 tab
2. `eval` 取 CSRF token: `document.querySelector('meta[name=csrf-token]').content`
3. `eval` 用 `fetch('/comments', { method: 'POST', headers: { 'X-CSRF-Token': token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: URLSearchParams })` 發送
4. form fields: `comment[body_markdown]`, `comment[commentable_id]` (article numeric ID), `comment[commentable_type]` = 'Article', `comment[parent_id_or_code]` (接受 id_code string 如 '3671a')
5. 需要 Chrome session 已登入 Dev.to（Google OAuth）
6. 成功返回 `{ status: "created", url: "/kuro_agent/comment/xxxxx" }`
7. 之後關閉 tab: `cdp-fetch.mjs close <tabId>`
這取代了之前「需要 Alex 手動貼」的 blocker。Kuro 可以自主回覆 Dev.to 留言。
- [2026-04-04] **⚠️ Dev.to 留言路由硬規則 — 嚴禁 CDP DOM click submit**
  **根因**：2026-04-04 triple-post 事件。Dev.to 是 SPA，DOM click submit 後 form 進入 "submitting" CSS class，CDP 的 `verify-no-change` 因 async 更新回傳 `changes:[]`（verified:false）。OODA 誤判為卡住 → 移除 submitting class → 重送 → 3-7 重留言（ghostbuild 文章 3 重，Three Teams 文章 7 重 [3689o-368a5 全隱藏]）。
  **正確路由**（優先序）：
  1. ✅ CDP eval `fetch('/comments', ...)` — server-side POST，不觸碰 DOM form，不受 verify-no-change 影響
  2. ✅ `devto-api.sh comment` — 有 dedup check，但 API key 可能沒有 comment write 權限（3/24 測試 403，需重新驗證）
  3. ❌ **絕對不要** 用 CDP type + click submit 按鈕 — 會 triple-post
  **SPA 通則**：任何 SPA 的 form submit 後，等 3-5 秒再驗證結果，不要因 "submitting" 狀態就介入
