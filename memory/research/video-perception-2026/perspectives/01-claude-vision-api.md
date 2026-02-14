# Claude Vision API 能力分析（2026）

## 核心能力

### 支援的輸入格式
- **圖片格式**: JPEG, PNG, GIF, WebP
- **輸入方式**: Base64 編碼或 URL 直接引用（2026 年新增）
- **影片**: **不支援原生影片輸入**，需轉換為關鍵幀

### 批次處理限制
- **API 請求**: 最多 100 張圖片/請求
- **claude.ai 網頁**: 最多 20 張圖片/請求
- **請求大小**: 32MB 上限（標準端點）
- **圖片縮放**: 長邊 > 1568px 或 > ~1,600 tokens 會自動縮放
- **最小尺寸警告**: 任一邊 < 200px 可能影響性能

### Token 成本（2026）

| 模型 | 輸入 (per MTok) | 輸出 (per MTok) |
|------|-----------------|-----------------|
| **Claude Haiku 4.5** | $1 | $5 |
| **Claude Sonnet 4.5** | $3 | $15 |
| **Claude Opus 4.5** | $5 | $25 |

**圖片分析沒有獨立計價** — 圖片會轉換為 tokens 計入整體成本。

**成本優化**：
- Batch API: 非即時請求可享 **50% 折扣**
- Prompt Caching: 快取長指令可省 **90% 成本**（Sonnet 4.5 讀取快取 $0.30/MTok）
- 200K tokens 門檻: 超過此值全部 tokens 以 premium 計價

### 已知限制
1. **無法辨識人物姓名** — 會拒絕回答
2. **空間推理弱** — 精確定位困難（讀時鐘、棋盤位置等）
3. **無音訊/影片原生支援** — 需外部工具轉錄/幀提取

## 對 mini-agent 的實用性

### 優勢
- ✅ 已有 CDP 截圖能力（`cdp-screenshot.mjs`）
- ✅ 可用 URL 直接傳圖，無需 base64 編碼
- ✅ Haiku 4.5 已支援視覺（$1/MTok 輸入）— 適合快速分析
- ✅ 100 張/請求 — 可分析影片關鍵幀序列

### 整合策略
1. **即時截圖分析**: CDP 截圖 → 上傳到可公開存取的 URL → Claude vision
2. **影片理解**: 關鍵幀提取（ffmpeg/CDP screencast）→ 批次傳給 Claude
3. **成本控制**: 簡單視覺任務用 Haiku，複雜推理用 Sonnet

### 建議實作
```typescript
// Plugin: visual-perception.sh
// 1. CDP 截圖到 /tmp/screen.png
// 2. 上傳到臨時 hosting（或 base64）
// 3. 用 Haiku vision 快速分析
// 4. 輸出結構化描述到 <visual>...</visual>
```

## 參考資料
- [Vision - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Models overview - Claude API Docs](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Vision for Document Analysis](https://getstream.io/blog/anthropic-claude-visual-reasoning/)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
