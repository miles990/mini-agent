# Web Research 網路研究能力

你有多種方式存取網路。**根據實際情境判斷用什麼，不要照固定順序。**

## 你有什麼工具

| 工具 | 強項 | 特性 |
|------|------|------|
| `curl -sL` | 公開靜態頁面 | 最快（<1s），無 JS/session |
| `pinchtab-fetch.sh fetch` | 需登入 + JS-heavy | 有 session、自動 auth 偵測/切換、隔離 tab |
| `pinchtab-vision.sh` | 視覺理解 | 截圖 + OCR/Vision，SPA 友好 |
| `pinchtab-interact.sh` | 瀏覽器互動 | 點擊、輸入、執行 JS |
| Grok API | X/Twitter | 原生 X 搜索、影片理解，不需瀏覽器 |

## 怎麼選

**自己判斷**。看 URL、看你對這個網站的經驗、看感知中 Pinchtab 是否可用。

常見情境（參考，不是規則）：
- X/Twitter 連結 → Grok API 效果最好（能讀 replies、engagement）
- Facebook、Reddit 等社群 → Pinchtab（profile 已有登入 session）
- GitHub、新聞、文件 → curl 通常就夠
- 內容是空的 → 可能是 JS 渲染，試 Pinchtab 或 vision
- 被要求登入 → `pinchtab-fetch.sh fetch` 會自動偵測並處理

**關鍵**：`pinchtab-fetch.sh fetch` 內建 auth 偵測 + headless/visible 自動切換。直接用它，不需要手動判斷要不要登入、要不要切模式。

## 工具詳情

### Grok API（X/Twitter 專用，最優先）
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

### Pinchtab Smart Fetch（主力工具）
```bash
bash scripts/pinchtab-fetch.sh fetch "URL"         # 智能擷取（自動 auth 處理）
bash scripts/pinchtab-fetch.sh fetch "URL" --full   # 不截斷
bash scripts/pinchtab-fetch.sh status               # 檢查狀態 + 模式 + tabs
bash scripts/pinchtab-setup.sh mode                 # 查看當前模式
bash scripts/pinchtab-setup.sh mode visible         # 手動切可見（含自動重啟）
bash scripts/pinchtab-setup.sh mode headless        # 手動切 headless（含自動重啟）
```
- `~/.mini-agent/pinchtab.mode` 持久記錄當前模式
- 新 tab 隔離讀取（`?tabId=`），不干擾其他 tab
- Tab API 只支援 `new`/`close`（不支援 `activate`）

### Pinchtab Vision（視覺理解）
```bash
bash scripts/pinchtab-vision.sh "URL" --ocr     # Apple OCR（免費、本地）
bash scripts/pinchtab-vision.sh "URL" --vision   # Claude Vision（需 API）
```

### Pinchtab 互動
```bash
bash scripts/pinchtab-interact.sh click <selector>       # 點擊
bash scripts/pinchtab-interact.sh type <selector> "text"  # 輸入
bash scripts/pinchtab-interact.sh eval "js"               # 執行 JS
bash scripts/pinchtab-interact.sh list-inputs             # 列出互動元素
bash scripts/pinchtab-interact.sh screenshot [path]       # 截圖
```

## Pinchtab 自動修復

Pinchtab 未啟用時，先 `bash scripts/pinchtab-setup.sh start` 自動修復。原則：先動手修，修不好才找用戶。

## Facebook 貼文 URL

`facebook.com/{page}/posts/{id}` 格式中，`{page}` 是**發文者帳號**，不是內容主題。
任何粉絲頁都可以轉貼任何主題的內容，發文者和貼文內容之間沒有必然關係。

處理步驟：
1. `bash scripts/pinchtab-fetch.sh fetch "URL"` — 自動 headless → visible 切換（visible 有 FB login session）
2. 還是抓不到 → 直接問 Alex：「那篇貼文我看不到，在講什麼？」
3. ❌ 不要去訪問 `{page}` 對應的網站來推測內容

## 原則

- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- **不要嘗試繞過認證機制**
- 大型頁面預設擷取前 8000 字元（`--full` 取消限制）
- Pinchtab 使用 accessibility tree（a11y refs）取代 CSS selectors，更可靠
