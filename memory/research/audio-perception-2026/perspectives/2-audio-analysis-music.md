# Audio Analysis & Music Understanding

## Executive Summary

2026 年的音訊分析領域分為兩個軌道：(1) LLM 原生音訊處理（Claude Sonnet 4.5 支援語音理解但非音樂分類）、(2) 傳統 MIR 工具（librosa、essentia）仍是音樂特徵提取的主流。

---

## 1. LLM 原生音訊能力

### Claude Sonnet 4.5 (2025-09)

**支援範圍**:
- ✅ 語音轉錄與理解（對話、會議、訪談）
- ✅ 語調、情緒、說話者關係分析
- ✅ 結構化轉錄（主題、摘要、行動項目）
- ❌ **不支援音樂分類**（節奏、曲風、情緒標籤）
- ❌ **不支援音效識別**（環境音、警報、機械聲）

**處理流程**:
```
音訊 → 內建 STT → 文本推理層 → 結構化輸出
```

**限制**:
- 音訊處理限 Advanced tier（API 需額外費用）
- 設計目標是「理解語音內容」而非「分析聲音特徵」
- 無法提取音樂元數據（BPM、調性、音色）

### GPT-5 / Gemini 2.0（競品對比）

**GPT-5**（預計 2026 年中）:
- OpenAI 宣稱將支援「multimodal voice AI」
- 與 Claude 類似，聚焦語音對話而非音樂分析

**Gemini 2.0**:
- Google 已有 YouTube Music 的音樂理解能力
- 但 Gemini API 尚未開放音樂特徵提取功能

**結論**: 2026 年的 LLM 音訊能力仍聚焦在「語音理解」，音樂分析需仰賴專用工具。

---

## 2. Music Information Retrieval (MIR) 工具

### Essentia

**概述**:
- 由 Universitat Pompeu Fabra（巴塞隆納）Music Technology Group 開發
- C++ 核心 + Python binding
- 業界標準 MIR 工具（Spotify、SoundCloud 等使用）

**技術規格**:
- **語言**: C++ (核心) / Python (API)
- **平台**: macOS ARM64 支援（2023-10 起）
- **授權**: AGPL v3
- **安裝**: `pip install essentia`（提供 prebuilt wheels for macOS ARM64）

**主要功能**:

| 類別 | 功能 |
|------|------|
| **Rhythm** | BPM、節拍追蹤、onset detection |
| **Tonal** | 調性、和弦辨識、音高提取 |
| **Loudness** | RMS、峰值、動態範圍 |
| **Timbre** | MFCC、光譜質心、諧波比 |
| **High-level** | 曲風分類、情緒標籤、樂器辨識 |

**使用範例**:
```python
import essentia.standard as es

# 載入音訊
audio = es.MonoLoader(filename='song.mp3')()

# 提取 BPM
rhythm_extractor = es.RhythmExtractor2013()
bpm, beats, confidence, _, _ = rhythm_extractor(audio)

# 提取曲風
genre_extractor = es.TensorflowPredictEffnetDiscogs()
embeddings = genre_extractor(audio)
# 返回 400 維 embedding，可用於分類

print(f"BPM: {bpm:.1f}, Confidence: {confidence:.2f}")
```

**深度學習模型**（內建）:
- **Effnet-Discogs**: 基於 400 萬 Discogs 曲目訓練，支援曲風/情緒標籤
- **Music Tagging**: 50+ 標籤（acoustic, electronic, sad, happy 等）
- **樂器辨識**: 10+ 樂器類型

**效能**:
- **處理速度**: 3 分鐘歌曲約 1-2 秒（M1 Pro）
- **記憶體**: ~500MB（含模型）

### Librosa

**概述**:
- Python 音訊分析庫，由 Brian McFee（NYU）開發
- 研究導向，API 設計簡潔

**技術規格**:
- **語言**: 純 Python（底層用 NumPy/SciPy）
- **平台**: 跨平台，macOS ARM64 原生支援
- **授權**: ISC License
- **安裝**: `pip install librosa`

**主要功能**:

| 類別 | 功能 |
|------|------|
| **載入/轉換** | 多格式音訊載入、重採樣、單聲道轉換 |
| **特徵提取** | MFCC、Chroma、Spectral centroid、Zero-crossing rate |
| **節奏** | Tempo、beat tracking、onset strength |
| **視覺化** | Waveform、spectrogram、chromagram 繪圖 |

**使用範例**:
```python
import librosa

# 載入音訊（自動重採樣至 22050 Hz）
y, sr = librosa.load('song.mp3')

# 提取節奏
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)

# 提取 MFCC（音色特徵）
mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)

# 提取 Chroma（和聲特徵）
chroma = librosa.feature.chroma_stft(y=y, sr=sr)

print(f"Tempo: {tempo:.1f} BPM")
print(f"MFCC shape: {mfccs.shape}")  # (13, time_frames)
```

**與 Essentia 對比**:

| 特性 | Essentia | Librosa |
|------|---------|---------|
| **速度** | 快（C++ 核心） | 慢（純 Python） |
| **功能** | 完整（含深度學習模型） | 基礎（需自建模型） |
| **API** | 複雜 | 簡潔 |
| **曲風分類** | 內建 | 需額外訓練 |
| **學習曲線** | 陡峭 | 平緩 |

**適用場景**:
- **Essentia**: 生產環境、需要高準確度曲風/情緒標籤
- **Librosa**: 研究、原型開發、自訂特徵提取

---

## 3. 整合策略（mini-agent 場景）

### 方案 A: Essentia Plugin（推薦）

Plugin 設計範例略（見程式碼區塊）。

**注入 Context**:
```xml
<music>
Recent tracks analyzed:
- song1.mp3: 128.5 BPM (confidence 0.92)
- song2.mp3: 90.0 BPM (confidence 0.85)
Average tempo: 109 BPM (mid-tempo)
</music>
```

### 方案 B: 輕量級（僅用 Librosa）

**適用場景**: 不需要曲風分類，僅需基本節奏資訊

**記憶體用量**: <200MB（不載入深度學習模型）

---

## 4. 使用情境建議

### 情境 1: 音樂播放感知
**目標**: Agent 知道用戶正在聽什麼類型的音樂

**方案**: 監控 Music.app / Spotify，定期分析音樂庫

**Context 注入**:
```xml
<listening>
Current: "Song Name" by Artist
Genre: Electronic, BPM: 128, Mood: Energetic
Listening pattern: Upbeat music (avg 125 BPM last 3 hours)
</listening>
```

### 情境 2: 環境音偵測
**目標**: 偵測異常聲音（警報、門鈴、突發噪音）

**限制**: Essentia/Librosa 不適合此場景（需專用音效分類模型）

**替代方案**:
- **YAMNet**（Google 開源）: 521 種音效分類
- **PANNs**（PretrainedAudioNeuralNetworks）: 527 種 AudioSet 類別
- 需 TensorFlow/PyTorch 執行環境

**不推薦**: 2026 年仍無輕量級 CLI 工具可偵測環境音

### 情境 3: 語音情緒分析
**目標**: 判斷用戶語氣（憤怒、快樂、悲傷）

**方案**:
- **優先**: Claude Sonnet 4.5（API 原生支援語調分析）
- **次選**: Whisper STT → 文本情緒分析（失去語調資訊）
- **不推薦**: Librosa（需自訓練模型，準確度不如 LLM）

---

## 5. 資源用量總結

| 工具 | 記憶體 | 安裝大小 | 處理速度（3 分鐘歌曲）|
|------|--------|---------|---------------------|
| **Essentia (基本)** | ~200MB | ~150MB | ~0.5s |
| **Essentia (含模型)** | ~500MB | ~800MB | ~2s |
| **Librosa** | ~150MB | ~100MB | ~5s |
| **Claude Sonnet 4.5 (API)** | N/A | N/A | ~10s（含網路延遲）|

---

## 推薦方案（mini-agent 場景）

**階段 1: 觀察優先（當前）**
- 不主動分析音訊，僅在用戶明確請求時使用
- **理由**: 個人 agent 不需要持續監聽音訊（隱私問題 + 資源消耗）

**階段 2: 被動分析（未來考慮）**
- 用戶手動觸發：「分析這首歌的曲風」
- Plugin: `plugins/music-info.sh <file>` → 呼叫 Essentia
- **不使用 Cron 自動執行**（避免背景資源佔用）

**階段 3: 整合語音助理（遠期）**
- 如實作語音對話功能，優先使用 Claude Sonnet 4.5 的音訊理解能力
- 僅在需要音樂元數據時才呼叫 Essentia

---

## 參考資料

- [Claude Sonnet 4.5 Multimodality - DataStudios](https://www.datastudios.org/post/claude-sonnet-4-5-multimodality-vision-audio-document-understanding-and-context-integration)
- [Multimodal Voice AI Revolution - Chanl Blog](https://www.chanl.ai/blog/multimodal-voice-ai-revolution)
- [Essentia Documentation](https://essentia.upf.edu/)
- [Essentia: An Audio Analysis Library for Music Information Retrieval](https://www.academia.edu/13029875/Essentia_An_Audio_Analysis_Library_for_Music_Information_Retrieval)
- [Librosa Documentation](https://librosa.org/)
- [AudioMuse-AI Documentation](https://neptunehub.github.io/AudioMuse-AI/)
