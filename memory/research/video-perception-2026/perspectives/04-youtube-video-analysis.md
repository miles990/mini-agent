# YouTube 影片分析實作策略

## 核心工具：yt-dlp

### 基本能力
```bash
# 下載字幕（不下載影片）
yt-dlp --write-subs --sub-format vtt --skip-download <youtube-url>

# 下載自動字幕
yt-dlp --write-auto-subs --sub-lang en --skip-download <youtube-url>

# 提取影片資訊（JSON）
yt-dlp --dump-json <youtube-url>
```

### Python Wrapper 工具

#### 1. yt-dlp-transcript
**特色**:
- Command-line 和 Python API
- 直接提取字幕，無需下載影片
- 轉換為 Markdown 格式

**安裝**:
```bash
pip install yt-dlp-transcript
```

**使用**:
```python
from yt_dlp_transcript import get_transcript
transcript = get_transcript("https://youtube.com/watch?v=...")
```

#### 2. youtube-transcript-api
**特色**:
- **不需要 YouTube API key**
- 可讀取自動生成和手動字幕
- 純 Python，無外部依賴

**安裝**:
```bash
pip install youtube-transcript-api
```

**使用**:
```python
from youtube_transcript_api import YouTubeTranscriptApi
transcript = YouTubeTranscriptApi.get_transcript(video_id)
```

#### 3. 進階工具（Markdown + AI 摘要）
**功能**:
- 提取字幕並轉為乾淨的 Markdown
- 整合 Google Gemini API 自動摘要
- 批次處理播放清單/頻道

## 實作架構（mini-agent）

### 方案 A：純字幕分析（最輕量）

**優勢**:
- ✅ 零視覺處理，速度極快
- ✅ Token 成本低（文字比圖片便宜）
- ✅ 可處理長影片（2小時+）
- ✅ 適合 plugin timeout（<10s）

**流程**:
```bash
# Plugin: youtube-transcript.sh
# Input: YouTube URL (from user or web-fetch)
# Output: <youtube>transcript + metadata</youtube>

#!/bin/bash
VIDEO_ID=$(echo "$1" | grep -oP '(?<=v=)[^&]+')
yt-dlp --write-auto-subs --sub-lang en --skip-download \
  --output "/tmp/%(id)s.%(ext)s" \
  "https://youtube.com/watch?v=$VIDEO_ID"

# Parse VTT and output XML
cat "/tmp/$VIDEO_ID.en.vtt" | sed 's/<[^>]*>//g' | grep -v '^$'
```

**限制**:
- 無視覺資訊（圖表、demo、程式碼範例看不到）
- 依賴字幕品質（無字幕影片無法處理）

### 方案 B：字幕 + 關鍵幀（平衡）

**優勢**:
- ✅ 結合文字和視覺
- ✅ 可捕捉圖表、螢幕截圖、demo
- ✅ 選擇性提取幀（控制成本）

**流程**:
```bash
# 1. 提取字幕（快速，<3s）
yt-dlp --write-auto-subs --skip-download <url>

# 2. 識別關鍵時間點（場景變化/重點字詞）
# 例：標題投影片、"as you can see"、"here's the code"

# 3. 用 yt-dlp 下載特定時間點的縮圖
yt-dlp --write-thumbnail --skip-download <url>

# 4. 批次傳給 Claude vision (100 張/請求)
```

**挑戰**:
- 需要判斷哪些時間點需要視覺（自然語言處理）
- 下載部分影片需要額外工具（ffmpeg）

### 方案 C：完整視覺分析（資源密集）

**適用場景**:
- 教學影片（大量螢幕錄影）
- 設計/藝術影片（視覺為主）
- 無字幕影片

**流程**:
```bash
# 1. 下載影片（yt-dlp）
yt-dlp -f best <url>

# 2. 關鍵幀提取（ffmpeg）
ffmpeg -i video.mp4 -vf "select=gt(scene\,0.3)" -vsync 0 frame%d.png

# 3. 批次分析（Claude vision / LLaVA）

# 4. 整合字幕 + 視覺分析
```

**限制**:
- 超出 plugin timeout（需背景任務）
- 儲存空間需求大
- API 成本高（100 幀 × $1/MTok = $0.10-1.00）

## 推薦實作順序

### Phase 1: 純字幕（立即）
```bash
# Create plugin: plugins/youtube-transcript.sh
# - Use youtube-transcript-api (no API key)
# - Output <youtube> tag with metadata + transcript
# - Add to perception when URL detected
```

**時間**: 1-2 小時
**風險**: 低
**價值**: 高（解鎖 YouTube 學習能力）

### Phase 2: 智能關鍵幀（驗證後）
```bash
# Extend plugin to:
# - Detect visual cues in transcript
# - Extract thumbnails at key moments
# - Send to Claude Haiku vision
```

**時間**: 4-6 小時
**風險**: 中（需處理 async download）
**價值**: 中高（視覺理解）

### Phase 3: 完整分析（實驗性）
```bash
# Background task (not plugin):
# - Full video download + frame extraction
# - Batch processing with progress
# - Store results in memory/youtube-analysis/
```

**時間**: 1-2 天
**風險**: 高（複雜度、成本、儲存）
**價值**: 高（但邊際效益遞減）

## 成本估算（100 部影片/月）

| 方案 | API 成本 | 儲存 | 處理時間 |
|------|----------|------|----------|
| 純字幕 | $0 | ~10MB | 3s/影片 |
| 字幕 + 5 關鍵幀 | $0.05-0.50 | ~50MB | 30s/影片 |
| 完整分析 (30 幀/影片) | $3-30 | ~5GB | 5min/影片 |

**建議**: 從純字幕開始，根據實際需求漸進升級。

## 現有整合點

### 1. Web-fetch plugin
```bash
# plugins/web-fetch.sh 已能提取 URL
# 擴展邏輯：檢測 youtube.com → 呼叫 youtube-transcript.sh
```

### 2. Skills knowledge
```markdown
# skills/web-learning.md
## YouTube 學習
- 檢測 YouTube URL
- 提取字幕
- 總結重點
- [REMEMBER #topic] 保存筆記
```

### 3. Autonomous behavior
```markdown
# Agent 自主學習流程
1. HEARTBEAT 設定學習目標
2. 搜尋相關 YouTube 影片
3. 分析字幕（關鍵概念）
4. 記錄到 topics/*.md
5. [ACTION] 報告學習成果
```

## 參考資料
- [Free API to Get YouTube Transcript](https://supadata.ai/youtube-transcript-api)
- [Using yt-dlp to download youtube transcript](https://medium.com/@jallenswrx2016/using-yt-dlp-to-download-youtube-transcript-3479fccad9ea)
- [youtube-transcript-api PyPI](https://pypi.org/project/youtube-transcript-api/)
- [yt-dlp-transcript GitHub](https://github.com/haron/yt-dlp-transcript)
- [Summarizing Youtube transcripts](https://www.danielcorin.com/til/yt-dlp/summarizing-video-transcript/)
