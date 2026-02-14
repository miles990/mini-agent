# Video/Visual Perception Research (2026)

研究完成：2026-02-11

## 快速摘要

**核心發現**：Claude 不支援原生影片輸入，需轉換為關鍵幀。macOS 本地模型（LLaVA, Apple Vision）已成熟。YouTube 字幕提取零成本。CDP screencast 可監控瀏覽器影片。

**推薦策略**：漸進式（Phase 1→2→3）、成本優化（本地優先→API精析）、輕量原則（核心簡單）。

## 文件結構

```
.
├── README.md                                   # 本文件
├── summary.yaml                                # 結構化摘要
├── synthesis.md                                # 完整總結報告
└── perspectives/
    ├── 01-claude-vision-api.md                 # Claude 視覺 API 能力
    ├── 02-video-understanding-approaches.md    # 影片理解方法論
    ├── 03-local-models-macos.md                # macOS ARM64 本地模型
    ├── 04-youtube-video-analysis.md            # YouTube 影片分析策略
    └── 05-screen-perception.md                 # 螢幕感知與監控
```

## 實作優先序

### Phase 1: 快速勝利（1-2 天，$0）
- CDP 截圖 + OCR（`ocrmac`）
- YouTube 字幕提取（`youtube-transcript-api`）
- 可選：LLaVA 本地安裝（`ollama`）

**價值**：Agent 可「看見」螢幕文字、學習 YouTube 影片

### Phase 2: 智能增強（1 週，$5-20/月）
- 螢幕變化監控（hash-based）
- YouTube 關鍵幀分析（字幕 + 視覺）
- 混合視覺 pipeline（LLaVA 初篩 + Claude 精析）

**價值**：自動偵測環境變化、視覺內容理解

### Phase 3: 進階實驗（選擇性，$0-100/月）
- CDP screencast 連續監控
- 完整影片分析（下載 + 幀提取）
- vllm-mlx 本地 API 伺服器

**價值**：即時視覺流、完整影片理解（但邊際效益遞減）

## 技術選型

| 需求 | 推薦工具 | 成本 |
|------|----------|------|
| **OCR 文字** | Apple Vision Framework | $0 |
| **簡單視覺** | LLaVA (Ollama) | $0 |
| **複雜推理** | Claude Haiku 4.5 | $1/MTok |
| **YouTube 字幕** | youtube-transcript-api | $0 |
| **影片幀提取** | ffmpeg / yt-dlp | $0 |
| **瀏覽器監控** | CDP screencast | $0 |

## 下一步行動

立即可做：
- [ ] 安裝 `ocrmac`
- [ ] 建立 `plugins/screen-ocr.sh`
- [ ] 建立 `plugins/youtube-transcript.sh`
- [ ] 安裝 Ollama + LLaVA（可選）

## 參考資料

詳見各 perspective 文件的參考連結。主要來源包括：
- Claude API 官方文檔
- Anthropic 定價頁面
- 學術論文（Agentic Video Intelligence, VideoDR）
- 開源專案（Ollama, LLaVA, yt-dlp, ocrmac）
- Chrome DevTools Protocol 文檔
