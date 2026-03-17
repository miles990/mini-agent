# Web Research 網路研究能力
JIT Keywords: research, search, url, fetch, curl, cdp, cdp-fetch, browse, hacker, web research
JIT Modes: learn

你有多種方式存取網路。**先查站點記憶，再按決策樹選工具，最後記錄結果。**

## Web Access 決策樹

碰到任何 URL 或網站需求時，按此順序判斷：

```
1. 查 cdp.jsonl 有沒有這個 domain 的記錄？
   有 → 直接用記錄的 strategy
   沒有 ↓

2. 這個站有 REST API 嗎？
   有 → API First（curl + API endpoint）
   沒有 ↓

3. 只需要讀取內容？
   是 → curl -sL → 失敗 → cdp-fetch fetch（JS 渲染）→ 失敗 → cdp-fetch login（需登入）
   否（需要互動）↓

4. 互動類型？
   簡單表單（非 SPA）→ cdp-fetch interact
   React/SPA/複雜 UI → 放棄 CDP 互動，用 API 或通知 Alex 人工處理

5. 記錄結果到 cdp.jsonl（見下方格式）
```

**關鍵原則**：CDP 做讀取很穩定，做互動是痛點。React controlled components 不要用 CDP interact（DOM 賦值不觸發 onChange）。

## 全場景盤點（2026-03-17）

每個 web 互動場景的最佳策略，基於實際痛點和經驗決定。**不要臨場判斷，直接查表。**

### 1. Dev.to 發布
- **過去做法**：~~CDP 操作 React 編輯器~~（已廢棄，多次失敗：tag input 不觸發、encoding 亂碼、state 崩潰）
- **最佳做法**：API `POST /api/articles`，用 `bash scripts/devto-api.sh publish`
- **狀態**：🟢 已遷移。`devto-api.sh` + `devto-publish.mjs` 就緒

### 2. Dev.to 留言
- **過去做法**：沒做過
- **最佳做法**：API `POST /api/comments`（body: `{comment: {body_markdown, commentable_id, commentable_type: "Article", parent_id}}`）
- **狀態**：🟢 就緒。`devto-api.sh` 已有範例

### 3. Dev.to 通知/個人檔案
- **最佳做法**：API `GET /api/notifications`、`GET /api/users/me`、`GET /api/followers/users`
- **狀態**：🟢 就緒。需要時直接 curl

### 4. HN 掃描
- **做法**：`curl -sL https://news.ycombinator.com/` 或 Firebase API `https://hacker-news.firebaseio.com/v0/topstories.json`
- **狀態**：🟢 已是最佳。靜態 HTML，無 JS 需求

### 5. Lobsters 掃描
- **做法**：`curl -sL https://lobste.rs/` 或 JSON API `https://lobste.rs/hottest.json`
- **狀態**：🟢 已是最佳

### 6. X/Twitter 讀取
- **做法**：Grok API（`x_search` tool），見下方 Grok API 詳情
- **狀態**：🟢 已是最佳。原生 X 搜索，能讀 replies/engagement/影片

### 7. X/Twitter 發文
- **做法**：無法使用（免費帳號 API 限制）
- **升級**：X API v2 `POST /2/tweets`（需 Basic tier $100/mo）
- **狀態**：🔴 受限。有觀點時用 CDP fallback 或等 API 額度

### 8. Facebook 抓取
- **做法**：`node scripts/cdp-fetch.mjs fetch "URL"`（Chrome session 已登入）
- **注意**：Graph API 不對個人帳號開放貼文讀取。抓不到→問 Alex
- **狀態**：🟢 已是最佳（平台限制）

### 9. GitHub 操作
- **做法**：`gh` CLI（`gh issue list`、`gh pr create`、`gh api`）。完整 API，auth 已設定
- **狀態**：🟢 已是最佳

### 10. GitHub 頁面讀取
- **做法**：`curl -sL` 讀公開頁面（README、release notes）
- **狀態**：🟢 已是最佳

### 11. Teaching Monster 平台
- **做法**：`node scripts/cdp-fetch.mjs interact`（無 API，Clerk 認證，表單互動）
- **注意**：521 是伺服器問題不是 CDP 問題
- **狀態**：🟢 已是最佳（平台限制）

### 12. Slack (Teaching Monster workspace)
- **目前做法**：`node scripts/cdp-fetch.mjs fetch`（Chrome session 瀏覽）
- **最佳做法**：長期→建 Slack App + Bot Token → Slack API（`conversations.history`、`search.messages`）
- **需要改什麼**：需 workspace admin 核准建 app。短期 CDP-read 堪用
- **狀態**：🟡 可升級

### 13. Gmail
- **目前做法**：`node scripts/cdp-fetch.mjs fetch "https://mail.google.com/"`（Chrome session）
- **最佳做法**：長期→ Gmail API + OAuth（可搜尋、標記、回覆、自動化）
- **需要改什麼**：設定 Google Cloud OAuth credentials → Gmail API scope
- **狀態**：🟡 可升級

### 14. SearXNG 搜尋
- **做法**：`bash scripts/search-web.sh "query"`（本地 port 8888，多引擎聚合）
- **狀態**：🟢 已是最佳

### 15. Telegram
- **做法**：Bot API（已內建 `src/telegram.ts`）
- **狀態**：🟢 已是最佳

### 16. ArXiv
- **做法**：`curl -sL` 讀摘要頁。也有 ArXiv API（`export.arxiv.org/api/query?search_query=`）。PDF 用 cdp-fetch
- **狀態**：🟢 已是最佳

### 17. Reddit
- **做法**：`node scripts/cdp-fetch.mjs fetch`（需 Chrome session 繞 rate limit）
- **狀態**：🟢 已是最佳（平台限制）

### 18. YouTube
- **做法**：`curl -sL` 讀 metadata；影片理解用 Grok API `enable_video_understanding: true`
- **狀態**：🟢 已是最佳

### 19. 知識文章站（Aeon / Marginalian / Quanta / note.com）
- **做法**：`curl -sL`。公開靜態頁面
- **狀態**：🟢 已是最佳

### 20. kuro.page（自有網站）
- **做法**：`git push origin main` → GitHub Pages 自動部署。不是 web access，是部署
- **狀態**：N/A

### 21. 一般網頁（未知站點）
- **做法**：先查 cdp.jsonl → 沒有就按決策樹（curl → CDP-fetch → CDP-login）→ 結果記回 cdp.jsonl
- **狀態**：🟢 已是最佳

---

### 遷移狀態總覽

| 狀態 | 數量 | 場景 |
|------|------|------|
| 🟢 已遷移/最佳 | 18 | Dev.to 全系列, HN, Lobsters, X 讀取, Facebook, GitHub, Teaching Monster, SearXNG, Telegram, ArXiv, Reddit, YouTube, 知識站, 一般網頁 |
| 🟡 可升級 | 2 | Slack (需 admin), Gmail (需 OAuth) |
| 🔴 受限 | 1 | X 發文 (需付費 API) |

**升級路徑**（非緊急，現有方案堪用）：
- Slack → 建 Slack App + Bot Token → Slack API（需 workspace admin 核准）
- Gmail → Google Cloud OAuth → Gmail API（可搜尋/標記/回覆）
- X 發文 → Basic tier API ($100/mo) 或等免費額度

## 站點記憶（cdp.jsonl）

路徑：`memory/state/cdp.jsonl`（每行一條 JSON）

```jsonl
{"domain":"dev.to","strategy":"api","endpoint":"POST /api/articles","verified":"2026-03-17","notes":"有完整 REST API"}
{"domain":"facebook.com","strategy":"cdp-fetch","mode":"fetch","verified":"2026-03-15","notes":"需 Chrome session，只讀"}
{"domain":"teaching.monster","strategy":"cdp-interact","verified":"2026-03-17","notes":"無 API，表單互動，521 是伺服器問題"}
```

**使用方式**：
- 碰到新站點 → `grep "domain" memory/state/cdp.jsonl`
- 找到 → 直接用 strategy
- 沒找到 → 按決策樹嘗試 → 成功後追加一行到 cdp.jsonl

## 你有什麼工具

| 工具 | 強項 | 特性 |
|------|------|------|
| `bash scripts/search-web.sh` | **結構化搜尋** | SearXNG 多引擎聚合，回傳 title/url/snippet |
| `curl -sL` | 公開靜態頁面 | 最快（<1s），無 JS/session |
| `node scripts/cdp-fetch.mjs fetch` | 需登入 + JS-heavy | 使用 Chrome 現有 session，直連 CDP port 9222 |
| `node scripts/cdp-fetch.mjs screenshot` | 視覺確認 | 截圖當前頁面 |
| `node scripts/cdp-fetch.mjs interact` | 瀏覽器互動 | 輸入文字並提交 |
| Grok API | X/Twitter | 原生 X 搜索、影片理解，不需瀏覽器 |

## 怎麼選

**先查站點記憶（cdp.jsonl），再按決策樹，最後看下面的情境提示。**

Chrome CDP 健康確認：`curl -s http://localhost:9222/json/version`

常見情境（決策樹的補充，不取代）：
- **想找某個主題的文章/來源** → `search-web.sh`（多引擎聚合，比 curl 猜 URL 更有效率）
- X/Twitter 連結 → Grok API 效果最好（能讀 replies、engagement、展開引用），CDP 作為 fallback
- Facebook、Reddit 等社群 → cdp-fetch.mjs（Chrome profile 已有登入 session）
- GitHub、新聞、文件 → curl 通常就夠
- 內容是空的 → 可能是 JS 渲染，試 cdp-fetch.mjs fetch
- 被要求登入 → `node scripts/cdp-fetch.mjs login URL` 切換可見模式處理

## 工具詳情

### Grok API（X/Twitter 最佳選擇）
```bash
curl -s --max-time 45 "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4-1-fast",
    "tools": [{"type": "x_search", "x_search": {"enable_video_understanding": true}}],
    "instructions": "Read this post and all replies. Summarize: who posted, full content, key replies, engagement stats. If there is video, describe its content. Plain text, no markdown.",
    "input": "URL_HERE"
  }'
```
- 解析：response → `output[]` → type `message` → `content[]` → type `output_text` → `text`
- 影片理解：`enable_video_understanding: true`

### search-web.sh（結構化搜尋 — 主題探索首選）
```bash
bash scripts/search-web.sh "query"                          # 預設 10 筆
bash scripts/search-web.sh "query" --limit 5                # 限制筆數
bash scripts/search-web.sh "query" --lang zh                # 中文優先
bash scripts/search-web.sh "query" --engines google,bing    # 指定引擎
```
- 使用本地 SearXNG（port 8888），隱私友善，多引擎聚合
- 回傳結構化結果：title + URL + snippet
- 適合：找主題文章、競品研究、學習來源掃描
- **搜到有興趣的 → 用 curl 或 cdp-fetch.mjs 讀全文**

### cdp-fetch.mjs（主力工具）
```bash
node scripts/cdp-fetch.mjs fetch "URL"          # 擷取頁面內容
node scripts/cdp-fetch.mjs fetch "URL" --full   # 不截斷
node scripts/cdp-fetch.mjs screenshot           # 截圖當前頁面
node scripts/cdp-fetch.mjs interact "URL" "text" # 輸入並互動
node scripts/cdp-fetch.mjs login "URL"          # 切換可見模式登入
```
- 直連 Chrome CDP port 9222
- 使用 Chrome 現有的 session（已登入狀態）
- 健康確認：`curl -s http://localhost:9222/json/version`

## Facebook 貼文 URL

`facebook.com/{page}/posts/{id}` 格式中，`{page}` 是**發文者帳號**，不是內容主題。
任何粉絲頁都可以轉貼任何主題的內容，發文者和貼文內容之間沒有必然關係。

處理步驟：
1. `node scripts/cdp-fetch.mjs fetch "URL"` — 使用 Chrome session
2. 還是抓不到 → 直接問 Alex：「那篇貼文我看不到，在講什麼？」
3. ❌ 不要去訪問 `{page}` 對應的網站來推測內容

## 結果回饋

每次存取新站點後，記錄到 `memory/state/cdp.jsonl`：
```bash
echo '{"domain":"example.com","strategy":"curl","verified":"2026-03-17","notes":"靜態頁面，curl 夠用"}' >> memory/state/cdp.jsonl
```

記錄內容：domain、strategy（api/curl/cdp-fetch/cdp-interact/grok）、verified 日期、notes（失敗原因或成功要點）。
失敗也要記：`{"domain":"x.com","strategy":"cdp-fetch","verified":"2026-03-17","notes":"FAIL: Cloudflare block，改用 Grok API"}`

## 原則

- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- **不要嘗試繞過認證機制**
- **每次新站點存取後記錄到 cdp.jsonl**
- 大型頁面預設擷取前 8000 字元（`--full` 取消限制）
