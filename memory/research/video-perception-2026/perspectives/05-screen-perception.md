# 螢幕感知與實時視覺監控

## CDP Screencast API（瀏覽器內）

### 技術細節

**CDP 方法**:
- `Page.startScreencast` — 開始捕捉畫面幀
- `Page.stopScreencast` — 停止捕捉
- `Page.screencastFrame` — 接收幀資料事件
- `Page.screencastFrameAck` — 確認收到幀（必須，否則停止發送）

**幀格式**:
- Base64 編碼的 JPEG/PNG
- 可設定品質、間隔、解析度
- 預設 1 幀/秒（可調整）

**已驗證框架**:
- Cypress、Puppeteer、Playwright 都使用此 API 錄製測試影片
- 成熟穩定，生產環境可用

### 使用場景

#### 1. YouTube 播放監控
```javascript
// 監控 YouTube 播放的實際畫面（非字幕）
// 可捕捉：
// - 螢幕錄影教學的程式碼
// - 視覺化圖表/動畫
// - 無字幕影片的畫面
```

**優勢**:
- 不需下載影片
- 使用已登入的 Chrome session（可看私人影片）
- 實時分析（邊播邊看）

**挑戰**:
- 資料量大（1280×720 @ 1fps ≈ 50KB/幀 ≈ 3MB/min）
- 需選擇性儲存（不是每幀都重要）
- 處理速度需跟上播放速度

#### 2. 線上會議錄製
- Google Meet、Zoom web 版
- 擷取投影片、螢幕分享
- 結合音訊轉錄（另外處理）

#### 3. 網頁視覺變化偵測
- 監控儀表板
- 偵測彈出視窗/通知
- UI 測試/回歸測試

### mini-agent 整合策略

#### 方案 A：定時截圖（現有能力擴展）
```bash
# Plugin: screen-monitor.sh
# 每 N 秒執行一次 cdp-screenshot.mjs
# 比對前後差異，有變化才分析

#!/bin/bash
PREV_HASH=$(md5 /tmp/prev-screen.png 2>/dev/null || echo "")
node scripts/cdp-screenshot.mjs /tmp/curr-screen.png

CURR_HASH=$(md5 /tmp/curr-screen.png)
if [ "$CURR_HASH" != "$PREV_HASH" ]; then
  echo "Screen changed, analyzing..."
  # 觸發視覺分析 (Claude vision / LLaVA)
fi

cp /tmp/curr-screen.png /tmp/prev-screen.png
```

**優勢**:
- 基於現有 `cdp-screenshot.mjs`，無新依賴
- 適合 OODA loop 定期檢查
- 輕量（只在變化時分析）

**劣勢**:
- 非連續幀，可能漏掉短暫內容
- Hash 比對不精確（小變化也觸發）

#### 方案 B：CDP Screencast 串流
```javascript
// scripts/cdp-screencast.mjs
// 持續接收幀，intelligent sampling

const ws = new WebSocket(cdpWebSocketUrl);
await cdpCommand(ws, 'Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 30  // 每 30 幀取 1 幀 (≈1fps)
});

ws.on('message', (msg) => {
  const event = JSON.parse(msg);
  if (event.method === 'Page.screencastFrame') {
    const { data, metadata } = event.params;
    
    // Intelligent sampling: 場景變化檢測
    if (detectSceneChange(data)) {
      saveAndAnalyze(data);
    }
    
    // 必須 ack，否則 CDP 停止發送
    cdpCommand(ws, 'Page.screencastFrameAck', {
      sessionId: metadata.sessionId
    });
  }
});
```

**優勢**:
- 連續監控，不漏幀
- 可做場景變化檢測（OpenCV.js）
- 適合長時間監控

**劣勢**:
- 需持續運行（資源消耗）
- 複雜度高（需場景檢測演算法）
- 超出 plugin 簡單模型（需獨立服務）

#### 方案 C：混合式（推薦）
```yaml
# 1. OODA loop: 定時截圖（每 30 秒）
#    → 快速 hash 比對
#    → 有變化才進一步分析

# 2. 特定任務觸發 screencast
#    User: "幫我看這個 YouTube 影片的程式碼範例"
#    Agent: 啟動 CDP screencast → 監控 5 分鐘 → 提取程式碼畫面

# 3. 背景低頻採樣（夜間/閒置時）
#    → 記錄一天的螢幕活動
#    → 次日晨間摘要
```

## 系統層螢幕錄製（macOS）

### 1. 原生 screencapture
```bash
# 截圖（已在 cdp-screenshot.mjs 用 CDP）
screencapture -x /tmp/screen.png

# 錄影（需使用者授權）
screencapture -v /tmp/screen-recording.mov
```

**限制**:
- 需 Screen Recording 權限
- 錄影格式大（.mov）
- 非即時分析友善

### 2. ffmpeg screen capture
```bash
# macOS AVFoundation
ffmpeg -f avfoundation -i "1" -r 1 -t 60 frames/frame%d.png
# 每秒 1 幀，持續 60 秒
```

**使用時機**:
- 需要系統層錄製（非瀏覽器）
- 桌面應用監控
- 遊戲畫面捕捉

**限制**:
- 需額外權限
- 超出 mini-agent "輕量" 原則
- 用 CDP 能做的就不要系統層

## 實時視覺分析流程

### 低頻檢查（現況）
```
OODA Loop (30s)
  → CDP 截圖
  → 文字 OCR (Apple Vision)
  → 注入 <visual> context
```

**成本**: 幾乎為 0（本地 OCR）
**延遲**: <1 秒

### 中頻監控（建議）
```
Screen Monitor Plugin (5s)
  → 截圖 + hash 比對
  → 若變化 → LLaVA 快速分類
  → 若重要 → Claude vision 深度分析
```

**成本**: $0.01-0.10/小時（大部分用 LLaVA）
**延遲**: 2-5 秒

### 高頻串流（進階）
```
CDP Screencast (連續)
  → 場景變化檢測
  → 關鍵幀提取
  → 批次分析（每分鐘一次）
```

**成本**: $0.50-2.00/小時（視分析頻率）
**延遲**: 即時（< 1 秒）

## 推薦實作路徑

### Phase 1: 增強現有截圖（立即）
```bash
# 1. CDP 截圖加入 OCR
node scripts/cdp-screenshot.mjs /tmp/screen.png
python3 -c "import ocrmac; print(ocrmac.ocr('/tmp/screen.png'))"

# 2. 注入 <visual> perception
# 3. Agent 可"看見"螢幕上的文字
```

**工作量**: 2-3 小時
**價值**: 高（立即可用）

### Phase 2: 變化監控（驗證後）
```bash
# Plugin: screen-change-detector.sh
# - Hash-based change detection
# - 有變化才觸發視覺分析
# - 輸出 <screen-activity> 摘要
```

**工作量**: 4-6 小時
**價值**: 中高（自動感知環境）

### Phase 3: CDP Screencast（實驗性）
```javascript
// scripts/cdp-screencast.mjs
// 獨立服務，可被 Agent 按需啟動
// 適合特定任務（YouTube 學習、會議記錄）
```

**工作量**: 2-3 天
**價值**: 高（但適用場景較窄）

## 現有能力整合

### 已有 CDP 基礎
- ✅ `cdp-screenshot.mjs` — 單次截圖
- ✅ `cdp-fetch.mjs` — WebSocket 連接
- ✅ Chrome 9222 port 設定

### 需新增
- [ ] OCR 整合（Apple Vision）
- [ ] 變化檢測邏輯
- [ ] 視覺分析 pipeline（截圖 → 分析 → context）

### 可複用
- Telegram 通知截圖（已有 `notifyScreenshot()`）
- 日誌系統（CDP 操作已記錄到 `cdp.jsonl`）
- Perception 插件架構（直接加 `screen-monitor.sh`）

## 參考資料
- [Chrome CDP screencast API](https://chromedevtools.github.io/devtools-protocol/)
- [Video recording with CDP screencast](https://medium.com/@anchen.li/how-to-do-video-recording-on-headless-chrome-966e10b1221)
- [Selenide CDP screencast issue](https://github.com/selenide/selenide/issues/2145)
- [OpenClaw Browser Relay](https://www.aifreeapi.com/en/posts/openclaw-browser-relay-guide)
