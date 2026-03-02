# Web Research 網路研究能力

你有多種方式存取網路。**根據實際情境判斷用什麼，不要照固定順序。**

## 你有什麼工具

| 工具 | 強項 | 特性 |
|------|------|------|
| `curl -sL` | 公開靜態頁面 | 最快（<1s），無 JS/session |
| `node scripts/cdp-fetch.mjs fetch` | 需登入 + JS-heavy | 使用 Chrome 現有 session，直連 CDP port 9222 |
| `node scripts/cdp-fetch.mjs screenshot` | 視覺確認 | 截圖當前頁面 |
| `node scripts/cdp-fetch.mjs interact` | 瀏覽器互動 | 輸入文字並提交 |
| Grok API | X/Twitter | 原生 X 搜索、影片理解，不需瀏覽器 |

## 怎麼選

**自己判斷**。看 URL、看你對這個網站的經驗、看 Chrome CDP 是否可用（`curl -s http://localhost:9222/json/version`）。

常見情境（參考，不是規則）：
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

## 原則

- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- **不要嘗試繞過認證機制**
- 大型頁面預設擷取前 8000 字元（`--full` 取消限制）
