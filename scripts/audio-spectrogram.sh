#!/bin/bash
# Generate spectrogram PNG from audio file using sox
# Usage: ./scripts/audio-spectrogram.sh <audio_file> [output.png]
# Output: path to generated PNG

set -euo pipefail

AUDIO_FILE="${1:-}"
OUTPUT="${2:-/tmp/mini-agent-spectrogram.png}"

if [ -z "$AUDIO_FILE" ] || [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: file not found: $AUDIO_FILE"
  exit 1
fi

if ! command -v sox &>/dev/null; then
  echo "Error: sox not installed (brew install sox)"
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not installed (brew install ffmpeg)"
  exit 1
fi

TMP_WAV="/tmp/mini-agent-spectro-$$.wav"
trap 'rm -f "$TMP_WAV"' EXIT

# Convert to WAV (sox needs a format it can read)
ffmpeg -i "$AUDIO_FILE" -ar 44100 -ac 1 -y "$TMP_WAV" 2>/dev/null

# Generate spectrogram
sox "$TMP_WAV" -n spectrogram \
  -o "$OUTPUT" \
  -t "$(basename "$AUDIO_FILE")" \
  -x 1200 -y 400 \
  -z 80

echo "$OUTPUT"
