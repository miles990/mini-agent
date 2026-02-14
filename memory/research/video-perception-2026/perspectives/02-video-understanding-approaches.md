# 影片理解方法論（2026）

## 主流方法：關鍵幀提取 + Vision LLM

### 架構模式
```
影片檔案 → 幀提取 → 視覺分析 → 時序推理 → 摘要生成
         (ffmpeg)   (Claude/LLaVA)  (Agent)    (LLM)
```

### 關鍵技術

#### 1. 幀提取策略
- **固定間隔採樣**: 每 N 秒取一幀（適合長影片概覽）
- **場景變化檢測**: OpenCV 檢測畫面切換（適合剪輯影片）
- **語義關鍵幀**: 使用預訓練模型選擇資訊量最大的幀

#### 2. 多模態處理
- **影像 + 文字**: 結合視覺幀與字幕/轉錄
- **時序對齊**: 保留幀的時間戳，用於上下文推理
- **批次分析**: Claude 支援 100 張/請求，可一次傳完整序列

#### 3. CDP Screencast API（瀏覽器影片監控）
- **Chrome DevTools Protocol** 原生支援影片幀捕捉
- **已驗證的框架**: Cypress, Puppeteer, Playwright 都使用此 API
- **實作方式**:
  ```javascript
  Page.startScreencast() → 接收 screencastFrame 事件 → Page.screencastFrameAck()
  ```
- **適用場景**: YouTube 播放監控、線上會議記錄、網頁影片分析

## Agentic Video Intelligence（2026 新趨勢）

### 三階段推理 (Retrieve-Perceive-Review)
1. **Retrieve**: 從影片提取視覺線索
2. **Perceive**: 將視覺轉為搜尋查詢，在網路上多步驟檢索
3. **Review**: 整合資訊，避免「目標漂移」（被海量文字淹沒初始視覺訊息）

### 挑戰
- **Goal Drift**: Agent 容易被網路搜尋結果帶偏，忘記影片中的關鍵視覺訊息
- **模型能力依賴**: 影片理解高度依賴視覺模型的能力
- **多步驟協調**: 需要專門的 Agent 協調視覺、文字、時序分析

### 多 Agent 系統範例
```
s3_frame_extraction_agent → 用 OpenCV 提取有意義的幀
visual_analysis_agent     → 處理幀的視覺內容
temporal_analysis_agent   → 按時間順序分析幀
summarization_agent       → 生成最終摘要
```

## 對 mini-agent 的建議

### 優先實作
1. **CDP 截圖監控**: 擴展現有 `cdp-screenshot.mjs` 為週期性截圖
2. **YouTube 影片分析**: yt-dlp 提取字幕 + 關鍵幀採樣 + Claude 視覺分析
3. **Screencast 監控**: 開發 plugin 監控瀏覽器播放的影片

### 延後考慮
- 本地影片檔案處理（需 ffmpeg，超出 ~10s timeout）
- 即時影片流分析（資源消耗大）
- 複雜的多 Agent 協調（先驗證單一 Agent 能力）

## 參考資料
- [VideoDR: Bridging Video Understanding and Agentic Search](https://datasciocean.com/en/paper-intro/video-deep-research/)
- [Agentic Video Intelligence Framework](https://arxiv.org/html/2511.14446v1)
- [NVIDIA AI Blueprint for Video Search](https://developer.nvidia.com/blog/advance-video-analytics-ai-agents-using-the-nvidia-ai-blueprint-for-video-search-and-summarization/)
- [Chrome CDP screencast API discussion](https://github.com/selenide/selenide/issues/2145)
