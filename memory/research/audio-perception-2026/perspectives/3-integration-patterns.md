# Audio Integration Patterns for AI Agents

## Executive Summary

2026 年的 AI agent 音訊整合已形成明確的架構模式：雙系統處理（System 1 本地 + System 2 雲端）、串流優先設計、隱私優先的邊緣計算。

---

## 1. 監聽模式（Listening Modes）

### Mode A: 檔案分析（File-based Analysis）

**特徵**:
- 用戶上傳音訊檔案 → Agent 分析 → 回傳結果
- 批次處理，無即時性要求
- 最簡單、最穩定

**適用場景**:
- 音樂庫分析（曲風標籤、BPM 提取）
- 會議錄音轉錄與摘要
- 語音備忘錄處理

**工作流程**:
```
用戶 → 上傳 audio.mp3
    ↓
Agent → 呼叫 whisper-cpp / essentia
    ↓
    → 返回 { transcript, bpm, genre }
```

**實作範例（mini-agent plugin）**:
```bash
#!/usr/bin/env bash
# plugins/audio-file-analyzer.sh

UPLOAD_DIR="$HOME/.mini-agent/uploads"
LAST_FILE=$(ls -t "$UPLOAD_DIR"/*.{mp3,wav,m4a} 2>/dev/null | head -1)

if [[ -z "$LAST_FILE" ]]; then
  echo "No audio files uploaded recently"
  exit 0
fi

# 轉錄（Whisper）
TRANSCRIPT=$(whisper-cpp -m ~/.whisper-cpp/ggml-base.bin -f "$LAST_FILE" --no-timestamps 2>/dev/null | head -c 500)

# 分析（Essentia）
MUSIC_INFO=$(python3 -c "
import essentia.standard as es
audio = es.MonoLoader(filename='$LAST_FILE')()
rhythm = es.RhythmExtractor2013()
bpm, _, conf, _, _ = rhythm(audio)
print(f'{bpm:.1f} BPM (confidence {conf:.2f})')
" 2>/dev/null)

echo "Last upload: $(basename "$LAST_FILE")"
echo "Transcript: ${TRANSCRIPT:0:200}..."
echo "Music: $MUSIC_INFO"
```

**優點**:
- 簡單穩定，無同步問題
- 可離線處理（batch job）
- 易於測試與除錯

**缺點**:
- 無法即時回應（延遲 5-30 秒）
- 需要完整檔案才能開始處理

---

### Mode B: 即時串流（Real-time Streaming）

**特徵**:
- 麥克風 → 持續捕捉 → 即時轉錄 → Agent 回應
- 需要低延遲（<500ms）
- 適合語音助理場景

**適用場景**:
- 語音對話介面（「Hey Kuro, ...」）
- 即時字幕（會議、直播）
- 聲控指令（「播放音樂」「設定提醒」）

**架構模式（2026 主流）**:
```
Microphone → VAD (Voice Activity Detection)
    ↓
    → 偵測到語音 → 開始錄音
    ↓
    → 串流 chunks → STT (streaming mode)
    ↓
    → 部分轉錄 → LLM (開始生成回應)
    ↓
    → TTS (streaming) → 音訊輸出
```

**關鍵技術**:

| 組件 | 推薦方案 | 延遲 |
|------|---------|------|
| **VAD** | WebRTC VAD / Silero VAD | <10ms |
| **STT** | Voxtral Mini 4B (streaming) | 240-500ms |
| **LLM** | Claude Sonnet 4.5 (streaming API) | 100-300ms |
| **TTS** | Bark / XTTS-v2 (streaming) | 200-400ms |

**總延遲**: ~550ms - 1.2s（感知上可接受）

**實作考量**:
1. **VAD 前置處理**: 避免持續發送靜音片段給 STT
2. **Chunk 大小**: 250ms - 500ms（平衡延遲與準確度）
3. **半雙工 vs 全雙工**: 
   - 半雙工：用戶說完 → Agent 回應（簡單）
   - 全雙工：可插話、可打斷（複雜，需 interrupt handling）

**macOS 實作（FFmpeg + Whisper.cpp streaming）**:
```bash
# 啟動即時轉錄（stdin 模式）
ffmpeg -f avfoundation -i ":1" -ar 16000 -ac 1 -f wav - | \
  whisper-cpp -m models/ggml-base.bin --stream -t 4 --step 3000

# 輸出範例：
# [00:00.000 --> 00:03.000] Hey Kuro, what's the weather today?
```

**缺點**:
- 複雜度高（需處理 buffer、timeout、interrupt）
- 資源消耗大（持續運行 STT 模型）
- 隱私問題（持續監聽麥克風）

---

### Mode C: 觸發式監聽（Wake-word Triggered）

**特徵**:
- 預設待機（低功耗 VAD）
- 聽到喚醒詞 → 啟動完整 STT
- 平衡隱私與可用性

**適用場景**:
- Siri / Alexa 式語音助理
- 家庭自動化（「嘿 Kuro，關燈」）
- 免手持操作（開車、烹飪時）

**架構**:
```
Microphone → Lightweight Keyword Spotter (always-on)
    ↓
    → 偵測到 "Hey Kuro" → 啟動 STT
    ↓
    → 3-5 秒錄音視窗 → Whisper.cpp
    ↓
    → 轉錄 → Agent 處理
```

**Keyword Spotting 方案**:

| 方案 | 模型大小 | 延遲 | 記憶體 |
|------|---------|------|--------|
| **Porcupine** (Picovoice) | <1MB | <10ms | ~10MB |
| **Snowboy** (停止維護) | ~1MB | <20ms | ~20MB |
| **Mycroft Precise** | ~5MB | ~30ms | ~50MB |

**推薦**: Porcupine（商業友善授權，支援自訂喚醒詞）

**實作範例**:
```python
#!/usr/bin/env python3
# scripts/voice-assistant.py

import pvporcupine
import pyaudio
import subprocess

# 初始化 Porcupine（需 API key）
porcupine = pvporcupine.create(
    access_key='YOUR_KEY',
    keywords=['jarvis']  # 或自訓練 "hey kuro"
)

audio = pyaudio.PyAudio()
stream = audio.open(rate=16000, channels=1, format=pyaudio.paInt16, 
                    input=True, frames_per_buffer=512)

print("Listening for wake word...")

while True:
    pcm = stream.read(512)
    keyword_index = porcupine.process(pcm)
    
    if keyword_index >= 0:
        print("Wake word detected! Recording...")
        
        # 錄音 5 秒
        subprocess.run(['sox', '-d', '/tmp/voice-cmd.wav', 'trim', '0', '5'])
        
        # 轉錄
        result = subprocess.check_output([
            'whisper-cpp', '-m', 'models/ggml-base.bin',
            '-f', '/tmp/voice-cmd.wav', '--no-timestamps'
        ]).decode()
        
        # 發送給 Agent
        subprocess.run(['mini-agent', 'msg', result])
        
        print(f"Processed: {result}")
```

**優點**:
- 隱私友善（本地 keyword spotting）
- 低功耗（輕量模型持續運行）
- 用戶體驗佳（免手持）

**缺點**:
- 誤觸發（similar-sounding words）
- 自訂喚醒詞需訓練資料
- Porcupine 免費版有限制（需商業授權）

---

## 2. 延遲預算（Latency Budget）

2026 年的語音 AI 標準：端到端延遲 <1.5 秒

**分解**:
```
VAD (10ms) + STT (500ms) + LLM (300ms) + TTS (400ms) + Network (200ms) = 1410ms
```

**優化策略**:

| 組件 | 優化手段 | 節省 |
|------|---------|------|
| **STT** | 用 Voxtral (240ms) 取代 Whisper (500ms) | -260ms |
| **LLM** | 本地 Llama 3.2 取代 API call | -200ms |
| **TTS** | 串流模式（邊生成邊播放） | -300ms |
| **Network** | 完全本地化 | -200ms |

**理論最佳**: 10ms + 240ms + 100ms + 100ms = **450ms**（達人類對話標準）

**實務挑戰**:
- 本地 LLM（Llama 3.2 70B）需 40GB+ 記憶體（個人電腦難達成）
- 本地 TTS 品質不如雲端（ElevenLabs、Azure）

**折衷方案（mini-agent）**:
- STT: 本地 Whisper.cpp（500ms）
- LLM: Claude API（300ms）
- TTS: 本地 Piper/Coqui（200ms）
- **總延遲**: ~1000ms（可接受）

---

## 3. 隱私模型

### Level 1: 完全本地（Zero Network）

**架構**:
```
Microphone → Whisper.cpp → Llama.cpp → Piper TTS → Speaker
```

**優點**:
- 絕對隱私（無資料外流）
- 無網路依賴（可離線運作）

**缺點**:
- LLM 能力受限（70B 模型極限）
- 記憶體需求高（16GB+ RAM）
- 無法使用雲端知識（即時新聞、天氣）

**適用場景**: 醫療、法律等高隱私需求領域

### Level 2: 混合模式（推薦）

**架構**:
```
Microphone → 本地 STT → 判斷敏感度 → { 本地 LLM | 雲端 API }
```

**判斷邏輯**:
```python
def route_request(transcript):
    sensitive_keywords = ['password', 'credit card', 'personal', '私密']
    
    if any(kw in transcript.lower() for kw in sensitive_keywords):
        return local_llm(transcript)  # 本地處理
    else:
        return claude_api(transcript)  # 雲端處理
```

**優點**:
- 平衡隱私與能力
- 敏感資料不外流
- 一般查詢享受雲端優勢

### Level 3: 雲端優先（現狀）

**架構**:
```
Microphone → 雲端 STT API → 雲端 LLM → 雲端 TTS → Speaker
```

**問題**:
- 所有語音資料上傳（隱私風險）
- 依賴網路（斷線即失效）

**緩解措施**:
- 使用端到端加密 API（Anthropic 承諾不訓練用戶資料）
- 本地快取常見回應
- Fallback 到本地模型

---

## 4. 資源管理

### 常駐模式 vs 按需啟動

**常駐模式**（Always-on）:
```bash
# 背景服務持續運行
whisper-cpp-server --model base --port 8080 &
```

**記憶體用量**:
- Whisper base: ~500MB
- Keyword spotter: ~10MB
- **總計**: ~510MB（可接受）

**缺點**: 無使用時仍佔用資源

---

**按需啟動**（On-demand）:
```bash
# 收到音訊時才啟動
whisper-cpp -m base -f audio.wav
```

**首次啟動延遲**:
- 模型載入: ~3 秒（base）、~8 秒（large）
- 用戶體驗差（等待時間過長）

---

**混合策略**（推薦）:
- **Keyword spotter**: 常駐（輕量）
- **STT**: 偵測到喚醒詞後啟動（延遲 3 秒可接受）
- **LLM**: API call（無本地記憶體負擔）

---

## 5. Mini-agent 整合建議

### 階段 0: 不整合（當前）

**理由**:
- mini-agent 是 perception-first 設計，音訊監聽與此理念衝突
- 隱私問題：持續監聽麥克風不符合個人 agent 信任模型
- 資源消耗：常駐 STT 模型影響系統效能

### 階段 1: 檔案分析（近期可考慮）

**使用情境**: Telegram 語音訊息轉錄

**實作**:
```bash
# plugins/telegram-voice.sh
# 檢查 memory/media/ 是否有新語音訊息

VOICE_DIR="$HOME/.mini-agent/memory/media"
LAST_VOICE=$(ls -t "$VOICE_DIR"/*.oga 2>/dev/null | head -1)

if [[ -n "$LAST_VOICE" && $(find "$LAST_VOICE" -mmin -5) ]]; then
  # 轉換格式
  ffmpeg -i "$LAST_VOICE" -ar 16000 /tmp/voice.wav 2>/dev/null
  
  # 轉錄
  whisper-cpp -m ~/.whisper-cpp/ggml-base.bin -f /tmp/voice.wav --no-timestamps
fi
```

**觸發流程**:
```
用戶發送語音訊息到 Telegram
    ↓
TelegramPoller 下載到 memory/media/
    ↓
Plugin 偵測新檔案 → 轉錄
    ↓
注入 <telegram-voice> context
    ↓
Agent 回應（文字或語音）
```

**優點**:
- 不需常駐監聽
- 符合 File=Truth 原則
- 可選功能（可關閉）

### 階段 2: 主動語音助理（遠期）

**前提**:
- 用戶明確同意啟用麥克風監聽
- 提供明顯的隱私指示器（錄音燈）
- 可隨時關閉

**實作方案**: Wake-word triggered（見 Mode C）

---

## 6. 效能基準測試

### 測試環境: MacBook Pro M1 Pro (16GB RAM)

| 場景 | 工具鏈 | 延遲 | 記憶體 | CPU |
|------|--------|------|--------|-----|
| 檔案轉錄（1 分鐘） | Whisper.cpp base | 8s | 500MB | 30% |
| 檔案轉錄（1 分鐘） | Apple SpeechAnalyzer | 4.5s | 400MB | 20% |
| 即時串流 | Whisper.cpp stream | 2.1s lag | 800MB | 50% |
| 即時串流 | Voxtral Mini 4B | 0.5s lag | 3GB | 60% |
| 音樂分析（3 分鐘） | Essentia | 2s | 500MB | 40% |
| Keyword spotting | Porcupine | <10ms | 10MB | 5% |

**結論**:
- 檔案分析模式資源消耗可接受
- 即時串流需謹慎評估（記憶體 +3GB、CPU +50%）
- Keyword spotting 幾乎無負擔

---

## 參考資料

- [The Voice AI Stack for Building Agents - AssemblyAI](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents)
- [2026 Voice AI Trends - Kardome](https://www.kardome.com/resources/blog/voice-ai-engineering-the-interface-of-2026/)
- [Auditory Intelligence: Understanding the World Through Sound - arXiv](https://arxiv.org/html/2508.07829v1)
- [Whisper.cpp Real-time Meeting Transcription - Alibaba](https://www.alibaba.com/product-insights/how-to-run-whisper-cpp-offline-for-real-time-meeting-transcription-on-a-macbook-air-m2.html)
- [macOS Audio Capture with FFmpeg - GitHub Gist](https://gist.github.com/ali5h/0541913b220ca09571102a8cd165916c)
