#!/bin/bash
# 語音轉錄 — OGG/MP3/WAV → 文字
# Usage: ./scripts/audio-transcribe.sh <audio_file>

AUDIO_FILE="$1"
MODEL="${WHISPER_MODEL:-$HOME/.mini-agent/models/ggml-small.bin}"

if [ -z "$AUDIO_FILE" ] || [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: file not found"
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "Error: whisper model not found at $MODEL"
  exit 1
fi

TMP_WAV="/tmp/mini-agent-whisper-$$.wav"

# 轉換為 whisper 要求的格式（16kHz mono WAV）
ffmpeg -i "$AUDIO_FILE" -ar 16000 -ac 1 -c:a pcm_s16le -y "$TMP_WAV" 2>/dev/null

if [ ! -f "$TMP_WAV" ]; then
  echo "Error: ffmpeg conversion failed"
  exit 1
fi

# 轉錄（自動偵測語言，whisper-cpp 的 CLI 二進制名為 whisper-cli）
whisper-cli -m "$MODEL" -f "$TMP_WAV" --no-timestamps 2>/dev/null

# 清理
rm -f "$TMP_WAV"
