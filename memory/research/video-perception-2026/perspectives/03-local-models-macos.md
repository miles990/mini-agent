# macOS ARM64 本地視覺模型（2026）

## 架構優勢

### Apple Silicon 生態系統
- **MPS (Metal Performance Shaders)**: PyTorch 可直接用 GPU
- **Unified Memory**: CPU 與 GPU 共享記憶體，無需資料複製
- **Neural Accelerators**: M5 晶片內建 GPU 核心專用加速器
- **MLX Framework**: Apple 官方開源 ML 框架，專為 Apple Silicon 優化

### 建議硬體需求
- **最低**: M1 with 16GB RAM
- **推薦**: M2/M3 with 32GB+ RAM（處理大型模型）
- **最佳**: M2 MAX/Ultra with 64GB RAM（影片生成/批次處理）

## 本地視覺語言模型

### 1. LLaVA (Local Large Vision Assistant)

**安裝方式（最簡單）**:
```bash
# 使用 Ollama (一鍵安裝)
brew install ollama
ollama pull llava
ollama run llava
```

**技術細節**:
- 結合 Vision Encoder + Vicuna LLM
- 原生支援 Apple Silicon
- 在 macOS 上運行順暢（Monterey, Ventura, Sonoma）
- 整合 Open WebUI 可獲得 ChatGPT 風格界面

**效能**:
- M2 with 16GB: ~10-15 tok/s
- M2 MAX with 64GB: ~30-40 tok/s
- 延遲: 單張圖分析 2-5 秒

**優勢**:
- ✅ 安裝簡單（Ollama 一行指令）
- ✅ 完全離線運行
- ✅ 無 API 成本
- ✅ 整合本地工作流程

**劣勢**:
- ⚠️ 準確度低於 Claude/GPT-4V
- ⚠️ 處理複雜圖表/文字能力弱
- ⚠️ 需要較多 RAM

### 2. Apple FastVLM

**官方模型**:
- `fastvlm_0.5b_stage3` (500M 參數)
- `fastvlm_1.5b_stage3` (1.5B 參數)
- `fastvlm_7b_stage3` (7B 參數)

**特點**:
- Apple 官方釋出（CVPR 2025）
- 專為高效視覺編碼優化
- 需轉換為 Apple Silicon 格式才能推理

**限制**:
- 文檔較少，整合困難
- 需要 PyTorch 導出步驟
- 社群工具支援不如 LLaVA

### 3. vllm-mlx (OpenAI 相容伺服器)

**特色**:
- OpenAI 和 Anthropic 相容 API
- 支援 Llama, Qwen-VL, LLaVA
- Continuous batching (批次處理優化)
- MCP tool calling 整合
- 原生 MLX 後端，400+ tok/s
- **可與 Claude Code 搭配使用**

**GitHub**: [waybarrios/vllm-mlx](https://github.com/waybarrios/vllm-mlx)

**適用場景**:
- 需要高吞吐量的本地部署
- 已有使用 OpenAI API 的程式碼（drop-in replacement）
- 想在本地複製 Claude-style API

## OCR 能力

### Apple Vision Framework (推薦)

**優勢**:
- macOS 內建，零安裝
- 速度快（GPU 加速）
- 準確度高於 Tesseract（針對英文/中文）
- 支援 14 種語言

**工具**:
1. **ocrmac** (Python wrapper)
   ```bash
   pip install ocrmac
   ```
   - 簡單易用，可批次處理
   - 輸出含位置資訊

2. **macos-vision-ocr** (Command-line tool)
   - 支援單張/批次處理
   - 詳細位置資訊輸出

3. **TRex v1.9** (GUI App)
   - 自動選擇 Apple Vision / Tesseract
   - Apple Vision 不支援的語言自動切換到 Tesseract
   - 支援 100+ 語言（透過 Tesseract）

### Tesseract OCR

**使用時機**:
- Apple Vision 不支援的語言（100+ 語言）
- 需要完全離線且開源的方案
- 特殊字型/手寫體辨識

**安裝**:
```bash
brew install tesseract
```

**效能**:
- 速度較慢（純 CPU）
- 準確度中等（需要調參）

## 推薦策略

### 短期（立即可用）
1. **OCR**: 使用 Apple Vision Framework (`ocrmac`)
2. **簡單視覺理解**: Ollama + LLaVA
3. **CDP 截圖**: 現有 `cdp-screenshot.mjs` + LLaVA 分析

### 中期（驗證後）
1. **vllm-mlx**: 建立本地 OpenAI 相容 API
2. **批次處理**: 關鍵幀 → 本地 LLaVA 快速分類 → 重要幀用 Claude 深度分析

### 長期（實驗性）
1. **Apple FastVLM**: 當工具鏈成熟後考慮
2. **自訓練模型**: 針對特定用例微調

## 資源需求估算

| 方案 | RAM 需求 | 推理速度 | 準確度 | 成本 |
|------|----------|----------|--------|------|
| Apple Vision OCR | <100MB | 極快 (<0.5s) | 高 | $0 |
| LLaVA (Ollama) | 4-8GB | 快 (2-5s) | 中 | $0 |
| FastVLM 7B | 8-12GB | 快 (1-3s) | 中高 | $0 |
| vllm-mlx | 8-16GB | 極快 (400+ tok/s) | 中 | $0 |
| Claude Haiku Vision | 0MB | 快 (API) | 極高 | $1/MTok |
| Claude Sonnet Vision | 0MB | 中 (API) | 極高 | $3/MTok |

## 參考資料
- [Ollama LLaVA](https://ollama.com/library/llava)
- [Running Multimodal LLM locally with Ollama](https://www.jeremymorgan.com/blog/generative-ai/how-to-multimodal-llm-local/)
- [Apple FastVLM Research](https://machinelearning.apple.com/research/fast-vision-language-models)
- [ocrmac PyPI](https://pypi.org/project/ocrmac/)
- [TRex app with Tesseract](https://applech2.com/archives/20250705-trex-app-for-mac-support-tesseract-ocr.html)
- [vllm-mlx GitHub](https://github.com/waybarrios/vllm-mlx)
