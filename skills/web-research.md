# Web Research 網路研究能力

你具備多層網路存取能力，從簡單到完整：

## 多層存取策略

### Layer 1: curl（公開頁面，最快）
```bash
curl -sL "URL"
```
- 適用：公開網頁、API、GitHub、新聞
- 速度：< 3 秒

### Layer 2: Pinchtab（已登入的頁面）
```bash
bash scripts/pinchtab-fetch.sh fetch "URL"
```
- 適用：用戶已在 Chrome 登入的網站
- 需要：Pinchtab 運行中（port 9867）
- 能力：完整存取用戶的 Chrome session + accessibility tree

### Layer 3: 開啟頁面讓用戶登入
```bash
bash scripts/pinchtab-fetch.sh open "URL"
# 用戶登入後：
bash scripts/pinchtab-fetch.sh extract <tabId>
```
- 適用：需要新登入或驗證的頁面
- 會在 Chrome 中開啟一個可見的分頁

### Layer 0: Grok API（X/Twitter 專用，最優先）
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
- 適用：**所有 x.com / twitter.com 連結**（推文、thread、profile）
- 速度：10-30 秒
- 優勢：不需 Chrome、不需登入、能讀到 replies 和 engagement 數據、**影片理解**
- 需要：`XAI_API_KEY` 環境變數
- 解析回應：response → `output[]` → type `message` → `content[]` → type `output_text` → `text`
- 影片理解：`enable_video_understanding: true` 讓 Grok 分析 X 貼文中的影片內容（僅限 X Search）

### Layer 0.5: Pinchtab 截圖 + OCR/Vision（JS-heavy 頁面）
```bash
bash scripts/pinchtab-vision.sh "URL" --ocr     # Apple OCR（免費、本地）
bash scripts/pinchtab-vision.sh "URL" --vision   # Claude Vision（需 API）
```
- 適用：JavaScript-heavy 頁面的視覺理解（SPA、動態渲染）
- 需要：Pinchtab 運行中 + ocrmac（OCR 模式）
- 不適用：X/Twitter（用 Grok API）

## 決策流程

1. **URL 是 x.com 或 twitter.com → 直接用 Grok API（Layer 0）**，不走 curl/Pinchtab
2. 其他 URL → 先檢查 `<chrome>` 感知，確認 Pinchtab 是否可用
3. **Pinchtab 未啟用 → 自動修復**（見下方）
4. 嘗試 `curl -sL "URL"` 取得內容
5. 如果得到登入頁面或空內容 → 用 `pinchtab-fetch.sh fetch`
6. 如果內容是 JS-heavy 空白 → 用 `pinchtab-vision.sh` 截圖 OCR
7. 如果 Pinchtab 也偵測到需要登入 → 用 `pinchtab-fetch.sh open` 開啟頁面，告知用戶登入
8. 用戶確認登入後 → 用 `pinchtab-fetch.sh extract <tabId>` 取得內容

## Pinchtab 自動修復

Pinchtab 未啟用時，先 `bash scripts/pinchtab-setup.sh start` 自動修復。根據輸出（OK/NOT_RUNNING/UNHEALTHY）決定下一步。原則：先動手修，修不好才找用戶。

## 常用命令

```bash
bash scripts/pinchtab-setup.sh start                          # 啟動 Pinchtab
bash scripts/pinchtab-setup.sh status                          # 檢查狀態
bash scripts/pinchtab-fetch.sh fetch "URL"                     # 擷取內容（背景）
bash scripts/pinchtab-fetch.sh open "URL"                      # 開啟可見分頁
bash scripts/pinchtab-fetch.sh extract <tabId>                 # 從已開分頁提取
bash scripts/pinchtab-interact.sh click <selector>             # 點擊元素
bash scripts/pinchtab-interact.sh type <selector> "text"       # 輸入文字
bash scripts/pinchtab-interact.sh eval "js"                    # 執行 JS
bash scripts/pinchtab-interact.sh list-inputs                  # 列出互動元素
bash scripts/pinchtab-interact.sh screenshot [path]            # 截圖
bash scripts/pinchtab-vision.sh "URL" --ocr                    # 截圖 + OCR
```

## 無法存取時的回應

### 重要原則
- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- 說明原因要簡潔（一句話）
- 重點放在「我做了什麼」和「還需要你做什麼」

## 注意事項

- 大型頁面只擷取前 5000 字元
- 不要嘗試繞過認證機制
- Pinchtab 管理 Chrome 進程生命週期，支援 headless 模式
- Pinchtab 使用 accessibility tree（a11y refs）取代 CSS selectors，更可靠
