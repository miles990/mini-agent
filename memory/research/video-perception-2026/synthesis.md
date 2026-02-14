# 影片/視覺感知研究總結（2026）

> 研究完成時間：2026-02-11
> 
> 針對 mini-agent 框架的影片/視覺感知能力升級可行性分析

## 核心發現

### 1. Claude 不支援原生影片輸入
- Claude API 只接受文字和圖片，**無音訊/影片原生支援**
- 影片必須轉換為**關鍵幀序列**（最多 100 張/請求）
- 圖片會轉換為 tokens 計入成本（無獨立計價）

### 2. 主流方法是「關鍵幀提取 + Vision LLM」
```
影片 → 幀提取 → 視覺分析 → 時序推理 → 摘要
      (ffmpeg)  (Claude/LLaVA)  (Agent)    (LLM)
```

### 3. macOS ARM64 本地模型已成熟
- **LLaVA + Ollama**: 一行指令安裝，原生支援 Apple Silicon
- **Apple Vision Framework**: 內建 OCR，速度快、準確度高
- **vllm-mlx**: OpenAI 相容本地 API，400+ tok/s

### 4. YouTube 字幕提取零成本
- `youtube-transcript-api` 不需 API key
- `yt-dlp` 可下載自動/手動字幕
- 大部分教學影片有字幕，純文字分析已足夠

### 5. CDP Screencast 可監控瀏覽器影片
- Chrome DevTools Protocol 原生支援幀捕捉
- Cypress/Puppeteer 已驗證，生產環境穩定
- 適合 YouTube 播放監控、線上會議

## 實作優先序（針對 mini-agent）

### 🚀 Phase 1: 快速勝利（1-2 天）

#### 1.1 CDP 截圖 + OCR
```bash
# 擴展現有 cdp-screenshot.mjs
pip install ocrmac
node scripts/cdp-screenshot.mjs /tmp/screen.png
python3 -c "import ocrmac; print(ocrmac.ocr('/tmp/screen.png'))"
```

**價值**: Agent 可「看見」螢幕上的文字  
**成本**: $0（本地 OCR）  
**風險**: 低（基於現有 CDP 能力）

#### 1.2 YouTube 字幕分析
```bash
# 新 plugin: plugins/youtube-transcript.sh
pip install youtube-transcript-api
# 輸出 <youtube>transcript</youtube>
```

**價值**: 解鎖 YouTube 學習能力  
**成本**: $0（純文字）  
**風險**: 低（成熟工具）

#### 1.3 LLaVA 本地安裝（可選）
```bash
brew install ollama
ollama pull llava
# 簡單視覺理解，無 API 成本
```

**價值**: 離線視覺分析  
**成本**: $0（本地運行）  
**風險**: 低（安裝簡單）

**預期產出**:
- ✅ Agent 可讀取螢幕文字
- ✅ 自動提取 YouTube 字幕
- ✅ (可選) 本地圖片理解能力

---

### 🔨 Phase 2: 智能增強（1 週）

#### 2.1 螢幕變化監控
```bash
# Plugin: screen-monitor.sh
# Hash-based change detection
# 變化時才觸發視覺分析
```

**價值**: 自動感知環境變化  
**成本**: $0.01-0.10/小時（LLaVA 為主）  
**風險**: 中（需設計採樣策略）

#### 2.2 YouTube 關鍵幀分析
```bash
# 結合字幕 + 視覺
# 1. 提取字幕 (快速)
# 2. 識別視覺關鍵點（"as you can see", "here's the code"）
# 3. 擷取該時間點縮圖
# 4. Claude Haiku vision 分析（$1/MTok）
```

**價值**: 視覺化內容理解（圖表、程式碼、demo）  
**成本**: $0.05-0.50/影片（5-10 關鍵幀）  
**風險**: 中（需 NLP 判斷關鍵點）

#### 2.3 混合視覺分析 Pipeline
```
截圖 → LLaVA 快速分類 → 重要內容 → Claude vision 深度分析
     (本地, <3s)         (API, $1-3/MTok)
```

**價值**: 成本與品質平衡  
**成本**: 大部分 $0，關鍵分析 $0.10-1.00/次  
**風險**: 中（需設計分類邏輯）

**預期產出**:
- ✅ 自動監控螢幕變化
- ✅ YouTube 影片視覺理解
- ✅ 成本優化的分析 pipeline

---

### 🧪 Phase 3: 進階實驗（選擇性）

#### 3.1 CDP Screencast 連續監控
```javascript
// scripts/cdp-screencast.mjs
// 持續接收幀 + 場景變化檢測
// 適合特定任務（線上會議記錄、長影片學習）
```

**價值**: 即時視覺流分析  
**成本**: $0.50-2.00/小時  
**風險**: 高（複雜度、資源消耗）

#### 3.2 完整影片分析（下載 + 幀提取）
```bash
yt-dlp <url>  # 下載影片
ffmpeg -i video.mp4 -vf "select=gt(scene\,0.3)" frames/  # 關鍵幀
# 批次分析
```

**價值**: 最完整的視覺理解  
**成本**: $3-30/影片（30-100 幀）  
**風險**: 高（儲存、時間、成本）

#### 3.3 vllm-mlx 本地 API 伺服器
```bash
# OpenAI 相容的本地視覺 API
# 400+ tok/s, MCP 整合
```

**價值**: 高吞吐量本地推理  
**成本**: $0（硬體需求：16GB+ RAM）  
**風險**: 中高（設定複雜）

**預期產出**:
- 🔬 實驗性功能驗證
- 📊 長期技術債準備

---

## 技術選型建議

### 視覺理解引擎
| 場景 | 推薦工具 | 理由 |
|------|----------|------|
| **OCR 文字提取** | Apple Vision Framework | 內建、快速、準確 |
| **簡單圖片分類** | LLaVA (Ollama) | 本地、免費、快速 |
| **複雜視覺推理** | Claude Haiku 4.5 | 高準確度、成本低 ($1/MTok) |
| **關鍵決策分析** | Claude Sonnet 4.5 | 最高品質 ($3/MTok) |

### 影片處理策略
| 類型 | 方法 | 工具鏈 |
|------|------|--------|
| **YouTube 教學** | 字幕優先 | `youtube-transcript-api` |
| **程式碼教學** | 字幕 + 關鍵幀 | yt-dlp + Claude vision |
| **視覺設計影片** | 完整幀分析 | ffmpeg + LLaVA + Claude |
| **線上會議** | CDP screencast | `cdp-screencast.mjs` (待開發) |

### 成本控制策略
1. **分層分析**: LLaVA 初篩 → Claude 精析
2. **選擇性採樣**: 不是每幀都重要（場景檢測）
3. **Batch API**: 非即時需求用批次（50% 折扣）
4. **Prompt Caching**: 固定指令快取（90% 省）
5. **本地優先**: 能用 Apple Vision / LLaVA 就不用 API

---

## 資源需求評估

### Phase 1（立即可用）
- **時間**: 1-2 天
- **成本**: $0（純本地 / 文字）
- **硬體**: 現有 Mac + Chrome CDP
- **依賴**: `ocrmac`, `youtube-transcript-api`, `ollama`（可選）

### Phase 2（驗證後）
- **時間**: 1 週
- **成本**: $5-20/月（視使用頻率）
- **硬體**: 現有即可（LLaVA 建議 16GB+ RAM）
- **依賴**: ffmpeg（optional）, yt-dlp

### Phase 3（實驗性）
- **時間**: 2-4 週
- **成本**: $0-100/月（視選擇方案）
- **硬體**: M2/M3 with 32GB+ RAM（vllm-mlx）
- **依賴**: 複雜（Docker, CUDA alternatives, MLX）

---

## 風險與挑戰

### 技術風險
1. **Plugin Timeout 限制** (~10s)
   - 解法：重度任務改用背景服務
   - 例：完整影片分析不在 plugin，改 OODA 任務

2. **儲存空間**
   - 幀資料累積快（1min video = 60 frames × 50KB = 3MB）
   - 解法：即時分析、定期清理、選擇性保存

3. **API 成本失控**
   - 若每幀都用 Claude 分析會很貴
   - 解法：本地初篩（LLaVA）+ API 精析

### 產品風險
1. **功能膨脹**
   - mini-agent 理念是「輕量」
   - 解法：核心保持簡單，進階功能可選

2. **使用者期望管理**
   - 影片理解不是魔法，有侷限
   - 解法：清楚文件化能力範圍

---

## 整合到 mini-agent 架構

### Perception System 擴展
```yaml
# agent-compose.yaml
perception:
  custom:
    - name: screen-text       # Apple Vision OCR
      script: ./plugins/screen-ocr.sh
      timeout: 5000
    
    - name: screen-monitor    # 變化檢測
      script: ./plugins/screen-monitor.sh
      timeout: 10000
    
    - name: youtube           # 字幕提取
      script: ./plugins/youtube-transcript.sh
      timeout: 10000
```

### Skills 知識模組
```markdown
# skills/visual-learning.md
## 視覺學習能力
- 螢幕文字識別（OCR）
- 圖片內容理解（LLaVA / Claude）
- YouTube 影片字幕提取
- 關鍵視覺幀分析

## 使用時機
- 使用者分享截圖 → 自動 OCR + 分析
- 偵測到 YouTube URL → 提取字幕
- 螢幕有變化 → 檢查是否需關注
```

### OODA Loop 整合
```typescript
// Observe phase
const context = await buildContext();
// context 包含：
// - <screen-text>OCR 結果</screen-text>
// - <screen-activity>變化摘要</screen-activity>
// - <youtube>字幕內容</youtube>

// Decide phase
// Agent 根據視覺資訊決定行動
// 例：發現螢幕出現錯誤訊息 → [ACTION] 提供解法
```

---

## 競品對照

### OpenClaw / Anthropic Computer Use
- **差異**: 他們提供 GUI 操作能力（點擊、輸入）
- **mini-agent**: 專注感知而非操作（perception-first）
- **優勢**: 更輕量、更透明、更適合個人使用

### AutoGPT 2023 → 2026
- **他們**: 移除全部 vector DB，回歸檔案系統
- **mini-agent**: 從一開始就是 File=Truth
- **視覺**: 他們用 GPT-4V，我們可混用 Claude + LLaVA（成本優化）

### BabyAGI
- **問題**: 「有手沒有眼」（執行導向，缺乏環境感知）
- **mini-agent**: Perception-first（先看見，再行動）
- **視覺**: 正是解決「眼睛」問題的關鍵升級

---

## 下一步行動

### 立即可做（本週）
- [x] 完成研究報告（本文件）
- [ ] 安裝 `ocrmac`（`pip install ocrmac`）
- [ ] 建立 `plugins/screen-ocr.sh`
- [ ] 建立 `plugins/youtube-transcript.sh`
- [ ] 安裝 Ollama + LLaVA（可選）
- [ ] 更新 `skills/web-learning.md`（加入 YouTube 能力）

### 驗證後執行（下週）
- [ ] 實測 YouTube 字幕提取效果
- [ ] 評估 LLaVA vs Claude Haiku 的準確度差異
- [ ] 設計螢幕變化監控邏輯
- [ ] 開發混合視覺分析 pipeline

### 長期規劃（下月）
- [ ] CDP Screencast 原型
- [ ] 完整影片分析工作流
- [ ] vllm-mlx 實驗（如果需要高吞吐量）

---

## 結論

**影片/視覺感知是 mini-agent 從「能讀」到「能看」的關鍵升級。**

### 核心策略
1. **漸進式**: Phase 1 → 2 → 3，先做快速勝利
2. **成本優化**: 本地優先（Apple Vision, LLaVA）→ API 精析（Claude）
3. **輕量原則**: 核心保持簡單，重度任務用背景服務
4. **實用導向**: 優先支援 YouTube 學習（80% 價值）

### 預期效果
- ✅ Agent 可「看見」螢幕（OCR）
- ✅ 自動學習 YouTube 影片（字幕）
- ✅ 理解圖片內容（截圖、分享的圖）
- ✅ 監控視覺變化（自動感知環境）

### 符合 mini-agent 理念
- **Perception-First**: 強化「看見環境」的能力
- **File=Truth**: OCR 結果、字幕都存檔案
- **Lightweight**: 基於現有 CDP，最小新依賴
- **Transparent**: 視覺分析過程可審計（log + 儲存幀）

**建議：從 Phase 1 的三個快速勝利開始，驗證價值後再進行 Phase 2。**

---

研究報告撰寫：Claude Sonnet 4.5
日期：2026-02-11
版本：1.0
