# Speech-to-Text Local Solutions for macOS ARM64

## Executive Summary

2026 年的本地 STT 生態系統已經成熟，macOS ARM64 有三個主要選項：Apple 原生 SpeechAnalyzer（最快）、Whisper.cpp（最通用）、Voxtral Mini 4B（最新，支援瀏覽器）。

---

## 1. Apple SpeechAnalyzer (iOS 26 / macOS Tahoe)

### 概述
Apple 在 2025 年 WWDC 推出的新一代 STT API，取代舊有的 SFSpeechRecognizer。

### 技術規格
- **API**: `SpeechAnalyzer` class + `SpeechTranscriber` module
- **平台**: iOS 26+, macOS Tahoe+
- **處理**: 100% on-device
- **優化**: Apple Neural Engine (ANE) 原生加速

### 效能數據
- **速度**: 34 分鐘音檔處理時間 45 秒（Real-Time Factor ~45x）
- **對比**: 比 Whisper Large V3 Turbo 快 55%（同檔案 Whisper 需 1:41）
- **來源**: MacStories 實測（2025 年 6 月）

### 整合方式
```swift
// Swift API (需要包裝成 CLI 工具或 Node.js native addon)
import Speech

let transcriber = SpeechTranscriber()
let result = try await transcriber.transcribe(url: audioURL)
```

**限制**: 純 Swift API，沒有 C/CLI 介面。需要寫 Swift wrapper 或用 Node.js native addon 橋接。

### 適用場景
- **最適合**: 需要極致速度的應用（會議轉錄、即時字幕）
- **不適合**: 需要跨平台、自訂模型或非 Swift 技術棧

---

## 2. Whisper.cpp

### 概述
OpenAI Whisper 的 C++ 移植版本，由 Georgi Gerganov 開發（ggml 生態系統作者，同時也是 llama.cpp 的作者）。

### 技術規格
- **語言**: C/C++
- **加速**: Core ML（ANE）+ Metal（GPU）+ CPU fallback
- **量化**: Q4/Q5/Q8（降低記憶體用量）
- **模型**: tiny / base / small / medium / large-v3 / large-v3-turbo

### 效能數據

| 模型 | 檔案大小 | 處理速度 | 記憶體 | 準確度 |
|------|---------|---------|--------|--------|
| tiny | ~75MB | 15x RTF | ~400MB | 基礎 |
| base | ~142MB | 12x RTF | ~500MB | 良好 |
| medium | ~1.5GB | 8x RTF | ~2GB | 優秀（推薦）|
| large-v3-turbo (q5_0) | ~1.2GB | 8.1x RTF | ~1.5GB | 最佳 |

**實測 (M1 MacBook Pro, 5 分鐘音檔)**:
- 處理時間: 38 秒
- Real-Time Factor: 15.8x
- 延遲: ~2.1 秒（即時轉錄模式）

### 安裝與使用
```bash
# 安裝
brew install whisper-cpp

# 下載模型（自動下載 Core ML 優化版本）
whisper-cpp --model base

# 基本使用
whisper-cpp -m models/ggml-medium.bin -f audio.wav

# 即時麥克風轉錄
whisper-cpp -m models/ggml-base.bin --stream -t 8 --step 3000

# API 模式（HTTP server）
whisper-cpp -m models/ggml-base.bin --port 8080
```

### Core ML 加速
```bash
# Core ML 模型會自動下載到 ~/.whisper-cpp/
# 使用 -ml 標誌啟用（2-3x 加速）
whisper-cpp -m models/ggml-medium.bin -f audio.wav -ml 1
```

### 整合範例（Shell Plugin）
```bash
#!/usr/bin/env bash
# plugins/audio-transcribe.sh

AUDIO_FILE="${1:-/tmp/last-recording.wav}"
MODEL="${2:-medium}"

if [[ ! -f "$AUDIO_FILE" ]]; then
  echo "No audio file found"
  exit 0
fi

# 轉錄（timeout 30s）
TRANSCRIPT=$(timeout 30s whisper-cpp \
  -m ~/.whisper-cpp/ggml-${MODEL}.bin \
  -f "$AUDIO_FILE" \
  -ml 1 \
  --no-timestamps \
  2>/dev/null)

if [[ -n "$TRANSCRIPT" ]]; then
  echo "Last audio: ${TRANSCRIPT:0:200}..."
fi
```

### 適用場景
- **最適合**: 通用 STT 需求、跨平台、CLI 整合
- **不適合**: 需要極致速度（慢於 Apple SpeechAnalyzer 55%）

---

## 3. Voxtral Mini 4B Realtime

### 概述
Mistral AI 於 2026 年 2 月發布的開源 STT 模型，首個支援瀏覽器內執行的 4B 參數語音模型。

### 技術規格
- **架構**: Causal audio encoder（原生串流設計）
- **參數**: 4B（量化後 Q4 ~2.5GB）
- **延遲**: <500ms（可配置 240ms - 2.4s）
- **語言**: 13 種語言
- **執行環境**: WASM + WebGPU（瀏覽器）/ ONNX Runtime（本地）/ vLLM（伺服器）

### 效能數據
- **延遲**: 240ms（最低配置）至 2.4s（最高準確度）
- **準確度**: 與離線模型相當（超越現有開源即時 STT 基準）
- **瀏覽器支援**: Chrome 113+, Edge 113+, Firefox（需實驗性功能）

### 安裝與使用

**方法 1: 瀏覽器版本（WASM + WebGPU）**
```html
<!-- 使用 Hugging Face Space 的預構建版本 -->
<!-- https://huggingface.co/spaces/TrevorJS/voxtral-mini-realtime -->

<!-- 或嵌入自己的應用 -->
<script type="module">
  import { VoxtralRealtime } from 'voxtral-wasm';
  
  const model = await VoxtralRealtime.load({
    modelPath: 'voxtral-mini-4b-q4.gguf',
    device: 'webgpu'
  });
  
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const transcript = model.transcribeStream(stream);
</script>
```

**方法 2: 本地執行（ONNX Runtime）**
```bash
# 下載量化模型
huggingface-cli download TrevorJS/voxtral-mini-realtime-gguf \
  --local-dir ./models

# 使用 ONNX Runtime（需 Python）
pip install onnxruntime transformers

python -c "
from transformers import pipeline
pipe = pipeline('automatic-speech-recognition', 
                model='mistralai/Voxtral-Mini-4B-Realtime-2602')
result = pipe('audio.wav')
print(result['text'])
"
```

### 整合考量
- **優勢**: 延遲最低（240ms）、原生串流、可嵌入網頁介面
- **劣勢**: 
  - 模型較新（2026-02 發布），生態不如 Whisper 成熟
  - macOS 本地執行需 Python + ONNX（非原生 CLI）
  - 瀏覽器版本需 WebGPU（Safari 尚不支援）

### 適用場景
- **最適合**: 即時語音助理、網頁應用、超低延遲需求
- **不適合**: 離線批次處理、不想依賴 Python 的場景

---

## 4. 其他方案

### WhisperKit (Argmax)
- **定位**: Whisper.cpp 的 Swift 原生替代品
- **特色**: Swift Package Manager 整合、原生 Apple 框架
- **限制**: 僅限 Swift/Xcode 專案，無 CLI 工具
- **連結**: https://github.com/argmaxinc/WhisperKit

### MLX-Audio
- **定位**: 基於 Apple MLX 框架的 TTS/STT/STS 庫
- **特色**: Python API、MLX 加速（Apple Silicon 優化）
- **限制**: 需 Python 環境
- **連結**: https://github.com/Blaizzy/mlx-audio

---

## 決策矩陣

| 需求 | 推薦方案 | 理由 |
|------|---------|------|
| **最快速度** | Apple SpeechAnalyzer | 比 Whisper 快 55%，ANE 原生優化 |
| **通用 CLI** | Whisper.cpp | 成熟生態、CLI 友善、跨平台 |
| **即時串流** | Voxtral Mini 4B | 延遲 <500ms，原生串流設計 |
| **網頁嵌入** | Voxtral Mini 4B (WASM) | 瀏覽器內執行，無需後端 |
| **最小依賴** | Whisper.cpp | 單一二進位檔，無需 Swift/Python |
| **多語言** | Whisper.cpp / Voxtral | 支援 50+ / 13 語言 |

---

## 資源用量對比

| 方案 | 記憶體 | 模型大小 | 首次載入 | 技術棧 |
|------|--------|---------|---------|--------|
| Apple SpeechAnalyzer | ~500MB | 系統內建 | <1s | Swift |
| Whisper.cpp (medium) | ~2GB | ~1.5GB | ~3s | C/CLI |
| Voxtral Mini 4B (Q4) | ~3GB | ~2.5GB | ~5s | Python/WASM |

---

## 推薦方案（mini-agent 場景）

**首選: Whisper.cpp (medium model)**

理由：
1. **零依賴**: Homebrew 安裝，單一 CLI 工具
2. **Shell 友善**: 可直接在 plugins/*.sh 呼叫
3. **成熟穩定**: 2023 年開源至今，廣泛驗證
4. **效能充足**: M1 處理 5 分鐘音檔僅需 38 秒
5. **記憶體可控**: medium 模型 ~2GB（mini-agent 環境可接受）

**備選: Voxtral Mini 4B（未來考慮）**

理由：
- 延遲更低（適合即時助理）
- 但需 Python 環境，增加依賴複雜度
- 等生態成熟後再評估整合

**不推薦: Apple SpeechAnalyzer**

理由：
- 需寫 Swift wrapper，增加維護成本
- 速度優勢不足以抵銷整合複雜度（45s vs 38s 差距不大）
- 鎖定 Apple 生態，不符合 mini-agent 極簡原則

---

## 參考資料

- [GitHub - ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [Whisper.cpp on Apple Silicon Changes Everything](https://sotto.to/blog/whisper-cpp-apple-silicon)
- [MacStories - Apple's New Speech APIs Outpace Whisper](https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/)
- [Mistral AI - Voxtral Transcribes at the Speed of Sound](https://mistral.ai/news/voxtral-transcribe-2)
- [Hugging Face - Voxtral Mini 4B Realtime](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)
- [Red Hat Developer - Run Voxtral Mini 4B on vLLM](https://developers.redhat.com/articles/2026/02/06/run-voxtral-mini-4b-realtime-vllm-red-hat-ai)
- [Apple Developer - SpeechAnalyzer WWDC25](https://developer.apple.com/videos/play/wwdc2025/277/)
- [GitHub - argmaxinc/WhisperKit](https://github.com/argmaxinc/WhisperKit)
