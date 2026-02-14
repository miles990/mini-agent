# Audio/Speech Perception for AI Agents - Research Synthesis

**研究日期**: 2026-02-11
**研究範圍**: 本地 macOS ARM64 音訊感知方案

---

## TL;DR

2026 年的本地音訊感知已經成熟，**Whisper.cpp** 是最平衡的選擇（CLI 友善、通用性佳、效能充足）。音樂分析用 **Essentia**（業界標準 MIR 工具）。即時串流用 **Voxtral Mini 4B**（延遲 <500ms）。**不建議 mini-agent 當前整合語音監聽**（與 perception-first 理念衝突），但可考慮 **Telegram 語音訊息轉錄**（檔案分析模式）。

---

## 核心發現

### 1. Speech-to-Text 生態系統

| 方案 | 速度 | 準確度 | 整合難度 | 推薦場景 |
|------|------|--------|---------|---------|
| **Apple SpeechAnalyzer** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ (需 Swift wrapper) | iOS/macOS 原生 app |
| **Whisper.cpp** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (CLI ready) | 通用 STT、跨平台 |
| **Voxtral Mini 4B** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (需 Python/WASM) | 即時串流、低延遲 |

**決策矩陣**:
- **mini-agent 用**: Whisper.cpp（極簡依賴、Shell 友善）
- **未來升級**: Voxtral Mini 4B（當 CLI 工具成熟後）
- **不考慮**: Apple SpeechAnalyzer（整合成本高於效能增益）

---

### 2. 音訊分析能力

**LLM 原生音訊**（2026 現狀）:
- ✅ Claude Sonnet 4.5: 語音理解（轉錄、情緒、說話者分析）
- ❌ 不支援: 音樂分類、環境音識別、音效偵測

**傳統 MIR 工具**（仍是主流）:
- **Essentia**: 業界標準（Spotify 等使用），支援 BPM/曲風/情緒標籤
- **Librosa**: 研究友善，API 簡潔，但速度慢、功能少

**關鍵洞察**: LLM 的音訊能力是「理解說話內容」，音樂分析仍需專用工具。

---

### 3. 整合模式

**三種監聽模式**:

| 模式 | 延遲 | 記憶體 | 隱私 | 適用場景 |
|------|------|--------|------|---------|
| **檔案分析** | 5-30s | ~500MB | ✅ 高 | 音樂庫、會議錄音 |
| **即時串流** | 0.5-2s | ~3GB | ⚠️ 中 | 語音助理、即時字幕 |
| **Wake-word** | <1s（觸發後） | ~10MB（待機） | ✅ 高 | Siri/Alexa 式助理 |

**延遲預算**（2026 標準: <1.5s）:
```
VAD (10ms) + STT (500ms) + LLM (300ms) + TTS (400ms) = 1210ms ✅
```

**隱私層級**:
- **Level 1**: 完全本地（STT + LLM + TTS 全本地）→ 記憶體需 16GB+
- **Level 2**: 混合模式（敏感資料本地、一般查詢雲端）→ **推薦**
- **Level 3**: 雲端優先（現狀）→ 隱私風險

---

## Mini-agent 整合建議

### 當前策略（階段 0）: **不整合主動監聽**

**理由**:
1. **理念衝突**: mini-agent 是 perception-first（觀察環境），持續監聽麥克風是 action-first（主動侵入）
2. **隱私優先**: Transparency > Isolation 原則下，持續錄音違背信任模型
3. **資源成本**: 即時 STT 需 +3GB 記憶體、+50% CPU（影響系統其他 perception）
4. **使用頻率**: 個人 agent 不需 24/7 語音待命（不像智慧音箱）

### 近期可行（階段 1）: **Telegram 語音訊息轉錄**

**設計**:
```yaml
perception:
  custom:
    - name: telegram-voice
      script: ./plugins/telegram-voice.sh
      timeout: 10000
```

**工作流程**:
```
用戶發送語音到 Telegram
    ↓
TelegramPoller 下載 .oga 到 memory/media/
    ↓
Plugin 偵測新檔案（5 分鐘內）
    ↓
FFmpeg 轉 WAV → Whisper.cpp 轉錄
    ↓
注入 <telegram-voice> context
    ↓
Agent 回應（可回覆語音或文字）
```

**優點**:
- 符合 File=Truth（音訊檔案存在 memory/media/）
- 不需常駐監聽（按需處理）
- 可選功能（無 Whisper 時自動跳過）

**實作成本**:
- 安裝: `brew install whisper-cpp` + 下載 base 模型（~142MB）
- Plugin: ~30 行 Bash
- 測試: Telegram 發送語音訊息驗證

### 未來考慮（階段 2）: **Wake-word 語音助理**

**前提**:
- 用戶明確同意（opt-in）
- 提供隱私指示器（錄音中的視覺提示）
- 可隨時關閉（`/voice off`）

**架構**:
```
Microphone → Porcupine ("Hey Kuro") → Whisper.cpp → Claude API → Piper TTS
```

**資源用量**:
- Porcupine (keyword): ~10MB（常駐）
- Whisper.cpp: ~500MB（觸發後載入）
- 總延遲: ~3s（首次啟動）+ ~1s（後續回應）

**不推薦當前實作**: 複雜度高、用戶需求不明確、資源消耗可觀。

---

## 技術選型總結

### 必要工具（階段 1）

| 工具 | 用途 | 安裝 | 大小 |
|------|------|------|------|
| **Whisper.cpp** | 語音轉錄 | `brew install whisper-cpp` | ~142MB (base 模型) |
| **FFmpeg** | 音訊轉換 | `brew install ffmpeg` | ~70MB |

**記憶體用量**: ~500MB（處理時）
**處理速度**: 1 分鐘音訊 ~8 秒（M1 Pro）

### 可選工具（未來）

| 工具 | 用途 | 安裝 | 大小 |
|------|------|------|------|
| **Essentia** | 音樂分析 | `pip install essentia` | ~800MB (含模型) |
| **Voxtral Mini 4B** | 即時 STT | ONNX Runtime + Python | ~2.5GB |
| **Porcupine** | Wake-word | Python SDK + API key | ~1MB |

---

## 實作路徑

### Step 1: 基礎架設（1-2 小時）

```bash
# 1. 安裝依賴
brew install whisper-cpp ffmpeg

# 2. 下載模型
whisper-cpp  # 自動下載 base 模型

# 3. 測試
echo "Hello, this is a test" | say -o /tmp/test.aiff
ffmpeg -i /tmp/test.aiff -ar 16000 /tmp/test.wav
whisper-cpp -m ~/.whisper-cpp/ggml-base.bin -f /tmp/test.wav
```

### Step 2: Telegram 語音 Plugin（30 分鐘）

建立 `plugins/telegram-voice.sh`（見 perspectives/3-integration-patterns.md 範例）

### Step 3: 測試與調優（1 小時）

- 發送中文語音訊息（測試多語言支援）
- 發送長語音（>1 分鐘，測試逾時處理）
- 發送音樂片段（驗證非語音內容行為）

### Step 4: 文件化（30 分鐘）

更新 `ARCHITECTURE.md` 的 Perception Plugins 清單：
```markdown
### Custom Plugins

現有 (13): chrome-status / web-fetch / docker-status / port-check / 
task-tracker / state-watcher / telegram-inbox / disk-usage / 
git-status / homebrew-outdated / self-awareness / website-monitor / 
**telegram-voice**
```

---

## 競品對比

### OpenAI Realtime API

**特色**: 端到端語音對話（STT + LLM + TTS 一體化）
**延遲**: ~300ms（業界最快）
**成本**: $0.06/分鐘（輸入）+ $0.24/分鐘（輸出）
**限制**: 僅 GPT-4o、需持續連線

**vs mini-agent**:
- OpenAI: 雲端優先、低延遲、高成本
- mini-agent: 本地優先、中延遲、零成本

### Whisper.cpp vs Cloud STT

| 方案 | 成本 | 延遲 | 隱私 | 離線 |
|------|------|------|------|------|
| Whisper.cpp | $0 | 8s/min | ✅ | ✅ |
| OpenAI Whisper API | $0.006/min | 2s/min | ❌ | ❌ |
| Google Cloud STT | $0.016/min | 1s/min | ❌ | ❌ |
| Apple SpeechAnalyzer | $0 | 4.5s/min | ✅ | ✅ |

**結論**: 個人 agent 場景下，Whisper.cpp 的成本優勢遠大於延遲劣勢。

---

## 風險與限制

### 技術風險

| 風險 | 影響 | 緩解策略 |
|------|------|---------|
| Whisper.cpp 模型載入慢 | 首次轉錄延遲 3s | 改用 tiny 模型（犧牲準確度） |
| 多語言準確度不穩 | 中文轉錄錯誤率高 | 指定語言參數 `--language zh` |
| 背景噪音影響 | 轉錄失敗或亂碼 | 加 VAD 前置處理 |

### 隱私風險

| 風險 | 場景 | 緩解策略 |
|------|------|---------|
| 誤錄敏感對話 | Wake-word 誤觸發 | 階段 0 不實作主動監聽 |
| 音訊檔案洩漏 | memory/media/ 未加密 | 提醒用戶定期清理（透過 skill） |

### 資源風險

| 風險 | 影響 | 緩解策略 |
|------|------|---------|
| 記憶體不足 | 系統變慢 | 使用 tiny/base 模型（<500MB） |
| 磁碟空間耗盡 | 音訊檔案累積 | Cron 自動清理 >7 天檔案 |

---

## 未來研究方向

### 短期（3 個月內）

- [ ] 實作 Telegram 語音轉錄 plugin
- [ ] 測試 Whisper.cpp 中文準確度
- [ ] 評估 Voxtral Mini 4B 的 CLI 可用性

### 中期（6 個月內）

- [ ] 研究 wake-word 方案（Porcupine vs Mycroft Precise）
- [ ] 實驗 Essentia 音樂分析（Spotify listening habits）
- [ ] 探索本地 TTS（Piper vs Coqui）

### 長期（1 年內）

- [ ] 完整語音助理原型（wake-word + STT + LLM + TTS）
- [ ] 環境音偵測（YAMNet 整合）
- [ ] 多模態感知（vision + audio 融合）

---

## 結論

2026 年的音訊感知技術已足夠成熟，可支援個人 AI agent 的基本需求。**Whisper.cpp** 提供了極簡依賴、本地隱私、通用 STT 能力，是 mini-agent 的最佳起點。

**核心原則**:
- ✅ **File-based 優先**: Telegram 語音訊息（已下載的檔案）
- ✅ **隱私優先**: 本地處理，無資料上傳
- ✅ **極簡依賴**: CLI 工具（Whisper.cpp + FFmpeg）
- ❌ **不做**: 主動麥克風監聽（與 perception-first 衝突）

**下一步行動**: 實作 `plugins/telegram-voice.sh` 驗證技術可行性，再決定是否深化整合。

---

## 參考資料索引

### Speech-to-Text
- [GitHub - ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [Whisper.cpp on Apple Silicon](https://sotto.to/blog/whisper-cpp-apple-silicon)
- [Apple SpeechAnalyzer WWDC25](https://developer.apple.com/videos/play/wwdc2025/277/)
- [MacStories - Apple Speech APIs vs Whisper](https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/)
- [Mistral AI - Voxtral Transcribe](https://mistral.ai/news/voxtral-transcribe-2)
- [Hugging Face - Voxtral Mini 4B](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)

### Audio Analysis
- [Claude Sonnet 4.5 Multimodality](https://www.datastudios.org/post/claude-sonnet-4-5-multimodality-vision-audio-document-understanding-and-context-integration)
- [Essentia Documentation](https://essentia.upf.edu/)
- [Essentia Paper - ISMIR](https://www.academia.edu/13029875/Essentia_An_Audio_Analysis_Library_for_Music_Information_Retrieval)
- [AudioMuse-AI](https://neptunehub.github.io/AudioMuse-AI/)

### Integration Patterns
- [The Voice AI Stack - AssemblyAI](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents)
- [2026 Voice AI Trends - Kardome](https://www.kardome.com/resources/blog/voice-ai-engineering-the-interface-of-2026/)
- [Auditory Intelligence - arXiv](https://arxiv.org/html/2508.07829v1)
- [FFmpeg macOS Audio Capture](https://gist.github.com/ali5h/0541913b220ca09571102a8cd165916c)
- [Whisper.cpp Real-time Transcription](https://www.alibaba.com/product-insights/how-to-run-whisper-cpp-offline-for-real-time-meeting-transcription-on-a-macbook-air-m2.html)
