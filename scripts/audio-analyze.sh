#!/bin/bash
# Audio feature analysis using Essentia MusicExtractor
# Usage: ./scripts/audio-analyze.sh <audio_file>
# Output: JSON with BPM, key, scale, energy, danceability, duration

set -euo pipefail

AUDIO_FILE="${1:-}"
VENV_PYTHON="$HOME/.mini-agent/venvs/essentia/bin/python3"

if [ -z "$AUDIO_FILE" ] || [ ! -f "$AUDIO_FILE" ]; then
  echo '{"error": "file not found"}'
  exit 1
fi

if [ ! -f "$VENV_PYTHON" ]; then
  echo '{"error": "essentia venv not found at ~/.mini-agent/venvs/essentia"}'
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo '{"error": "ffmpeg not installed"}'
  exit 1
fi

TMP_WAV="/tmp/mini-agent-audio-$$.wav"
trap 'rm -f "$TMP_WAV"' EXIT

# Convert to WAV (mono, 44100Hz for Essentia)
ffmpeg -i "$AUDIO_FILE" -ar 44100 -ac 1 -y "$TMP_WAV" 2>/dev/null

# Run Essentia analysis
"$VENV_PYTHON" -c "
import json, sys, os
os.environ['ESSENTIA_LOG_LEVEL'] = 'silent'

from essentia.standard import MusicExtractor

def get(pool, key, default=0):
    try:
        return pool[key]
    except KeyError:
        return default

try:
    features, _ = MusicExtractor(
        lowlevelStats=['mean'],
        rhythmStats=['mean'],
        tonalStats=['mean']
    )('$TMP_WAV')

    result = {
        'bpm': round(float(get(features, 'rhythm.bpm'))),
        'key': str(get(features, 'tonal.key_edma.key', '?')),
        'scale': str(get(features, 'tonal.key_edma.scale', '?')),
        'key_strength': round(float(get(features, 'tonal.key_edma.strength')), 3),
        'energy': round(float(get(features, 'lowlevel.average_loudness')), 3),
        'loudness_integrated': round(float(get(features, 'lowlevel.loudness_ebu128.integrated')), 2),
        'danceability': round(float(get(features, 'rhythm.danceability')), 3),
        'duration': round(float(get(features, 'metadata.audio_properties.length'))),
        'replay_gain': round(float(get(features, 'metadata.audio_properties.replay_gain')), 2),
    }
    print(json.dumps(result, indent=2))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
"
