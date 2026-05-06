#!/bin/sh
# Install repo-tracked git hooks into .git/hooks/.
# Idempotent: backs up existing hooks once to <hook>.pre-install.bak.
#
# Usage: bash scripts/install-git-hooks.sh

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
SRC_DIR="$REPO_ROOT/scripts/git-hooks"
DEST_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$SRC_DIR" ]; then
  echo "✗ no $SRC_DIR — nothing to install"
  exit 1
fi

for hook_src in "$SRC_DIR"/*; do
  [ -f "$hook_src" ] || continue
  name=$(basename "$hook_src")
  dest="$DEST_DIR/$name"

  if [ -f "$dest" ] && ! cmp -s "$hook_src" "$dest"; then
    if [ ! -f "$dest.pre-install.bak" ]; then
      cp "$dest" "$dest.pre-install.bak"
      echo "  backed up existing $name → $name.pre-install.bak"
    fi
  fi

  cp "$hook_src" "$dest"
  chmod +x "$dest"
  echo "✓ installed $name"
done

echo ""
echo "Done. Hooks active in $DEST_DIR/"
