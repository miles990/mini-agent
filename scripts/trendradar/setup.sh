#!/usr/bin/env bash
# TrendRadar zh-CN lane — Commit 1 setup
# Per memory/topics/trendradar-integration-spec-2026-05-08.md
# Ship: clone sansan0/TrendRadar to ~/Workspace/trendradar-upstream, build isolated venv, editable install.
# Smoke test: python -m trendradar --help exits 0.
set -euo pipefail

UPSTREAM_DIR="${TRENDRADAR_UPSTREAM:-$HOME/Workspace/trendradar-upstream}"
PYTHON_BIN="${TRENDRADAR_PYTHON:-python3.13}"

if [ ! -d "$UPSTREAM_DIR" ]; then
  echo "[trendradar/setup] cloning sansan0/TrendRadar -> $UPSTREAM_DIR"
  git clone --depth 1 https://github.com/sansan0/TrendRadar.git "$UPSTREAM_DIR"
fi

cd "$UPSTREAM_DIR"

if [ ! -x .venv/bin/python ]; then
  echo "[trendradar/setup] creating venv with $PYTHON_BIN"
  "$PYTHON_BIN" -m venv .venv
fi

.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -e .

echo "[trendradar/setup] smoke test: python -m trendradar --help"
.venv/bin/python -m trendradar --help > /dev/null

echo "[trendradar/setup] OK — venv ready at $UPSTREAM_DIR/.venv"
