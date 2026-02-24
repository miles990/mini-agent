# Web Research 網路研究能力

你具備多層網路存取能力。**核心原則：智能化選擇、最大化利用每個工具的能力、自動 fallback。**

## 工具能力矩陣

| 工具 | 最強項 | 有 session | JS 渲染 | 速度 |
|------|--------|-----------|---------|------|
| `curl` | 公開靜態頁面 | ❌ | ❌ | ⚡ <1s |
| `pinchtab-fetch.sh` | 需登入 + JS-heavy | ✅ 自動 | ✅ | 🔵 3-5s |
| `pinchtab-vision.sh` | 視覺理解 | ✅ | ✅ | 🟡 5-10s |
| Grok API | X/Twitter | N/A | N/A | 🟡 10-30s |

## 智能決策流程

```
URL 進入
  │
  ├─ x.com / twitter.com → Grok API（專用工具，最佳效果）
  │
  ├─ 公開靜態頁面（github.com, news, docs）→ curl -sL
  │   └─ 空/JS 殼 → 升級到 Pinchtab
  │
  └─ 其他（社群、需登入、JS-heavy）→ pinchtab-fetch.sh fetch
      │ ← Smart fetch 自動處理：
      │   • 開新 tab → ?tabId= 讀取 → 自動關 tab
      │   • 有 session 直接讀（Facebook, Reddit 等已登入）
      │   • AUTH → 自動切 visible → 開 URL → 提示登入
      │   • extract 後自動切回 headless
      │
      └─ 純視覺/SPA → pinchtab-vision.sh --ocr
```

**關鍵原則**：
- **不要手動判斷需不需要登入** — `pinchtab-fetch.sh fetch` 會自動偵測 + 處理
- **不要手動切 headless/visible** — script 自動切換，extract 後自動恢復
- **Pinchtab profile（`~/.pinchtab/chrome-profile`）已有 Facebook 等登入 session**
- **一律用 `fetch` 而非 `open`**，除非明確要讓用戶看到頁面

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

## 原則

- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- **不要嘗試繞過認證機制**
- 大型頁面預設擷取前 8000 字元（`--full` 取消限制）
- Pinchtab 使用 accessibility tree（a11y refs）取代 CSS selectors，更可靠
