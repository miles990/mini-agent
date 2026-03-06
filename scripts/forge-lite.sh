#!/usr/bin/env bash
# forge-lite.sh — Lightweight worktree isolation for AI agent delegations
# Mechanical steps only. Creative work is done by the LLM between commands.
#
# Usage:
#   forge-lite.sh create <task-name>              → Create worktree + branch
#   forge-lite.sh verify <worktree-path>          → Run typecheck + tests
#   forge-lite.sh merge <worktree-path> [message]  → Merge to main + cleanup
#   forge-lite.sh yolo <worktree-path> [message]   → Verify + merge in one shot
#   forge-lite.sh cleanup <worktree-path>          → Remove worktree without merging
#
# Exit codes: 0 = success, 1 = failure (details on stderr)

set -euo pipefail

MAIN_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Error: not inside a git repository" >&2
  exit 1
}

# --- Detect project verification commands ---
detect_commands() {
  local dir="${1:-$MAIN_DIR}"
  BUILD_CMD="" TYPECHECK_CMD="" TEST_CMD="" LINT_CMD=""

  if [ -f "$dir/package.json" ]; then
    # Node.js project — detect package manager
    local pm="npm run"
    [ -f "$dir/pnpm-lock.yaml" ] && pm="pnpm"
    [ -f "$dir/bun.lockb" ] && pm="bun run"
    [ -f "$dir/yarn.lock" ] && pm="yarn"

    grep -q '"build"' "$dir/package.json" 2>/dev/null && BUILD_CMD="$pm build"
    grep -q '"typecheck"' "$dir/package.json" 2>/dev/null && TYPECHECK_CMD="$pm typecheck"
    grep -q '"test"' "$dir/package.json" 2>/dev/null && TEST_CMD="$pm test"
    grep -q '"lint"' "$dir/package.json" 2>/dev/null && LINT_CMD="$pm lint"
  elif [ -f "$dir/Cargo.toml" ]; then
    BUILD_CMD="cargo build"
    TYPECHECK_CMD="cargo check"
    TEST_CMD="cargo test"
  elif [ -f "$dir/go.mod" ]; then
    BUILD_CMD="go build ./..."
    TYPECHECK_CMD="go vet ./..."
    TEST_CMD="go test ./..."
  elif [ -f "$dir/pyproject.toml" ] || [ -f "$dir/setup.py" ]; then
    [ -f "$dir/pyproject.toml" ] && grep -q "mypy" "$dir/pyproject.toml" 2>/dev/null && TYPECHECK_CMD="mypy ."
    command -v pytest >/dev/null 2>&1 && TEST_CMD="pytest"
  elif [ -f "$dir/Makefile" ]; then
    grep -q "^build:" "$dir/Makefile" 2>/dev/null && BUILD_CMD="make build"
    grep -q "^test:" "$dir/Makefile" 2>/dev/null && TEST_CMD="make test"
  fi
}

# --- Commands ---

cmd_create() {
  local task_name="${1:?Usage: forge-lite.sh create <task-name>}"
  # Sanitize task name for branch/dir names
  task_name=$(echo "$task_name" | tr ' ' '-' | tr -cd '[:alnum:]-_' | tr '[:upper:]' '[:lower:]')

  local branch="feature/$task_name"
  local worktree_dir="$MAIN_DIR/../$(basename "$MAIN_DIR")-forge-$task_name"

  if [ -d "$worktree_dir" ]; then
    echo "Error: worktree already exists: $worktree_dir" >&2
    echo "Clean up first: forge-lite.sh cleanup $worktree_dir" >&2
    exit 1
  fi

  git -C "$MAIN_DIR" worktree add "$worktree_dir" -b "$branch" 2>&1
  echo "$worktree_dir"
}

cmd_verify() {
  local worktree="${1:?Usage: forge-lite.sh verify <worktree-path>}"
  [ -d "$worktree" ] || { echo "Error: directory not found: $worktree" >&2; exit 1; }

  detect_commands "$worktree"

  local failed=0
  local skipped=""

  if [ -n "$BUILD_CMD" ]; then
    echo "[verify] Running: $BUILD_CMD" >&2
    (cd "$worktree" && eval "$BUILD_CMD") || { echo "[verify] FAILED: $BUILD_CMD" >&2; failed=1; }
  else
    skipped="${skipped}build "
  fi

  if [ -n "$TYPECHECK_CMD" ] && [ "$failed" -eq 0 ]; then
    echo "[verify] Running: $TYPECHECK_CMD" >&2
    (cd "$worktree" && eval "$TYPECHECK_CMD") || { echo "[verify] FAILED: $TYPECHECK_CMD" >&2; failed=1; }
  else
    [ -z "$TYPECHECK_CMD" ] && skipped="${skipped}typecheck "
  fi

  if [ -n "$TEST_CMD" ] && [ "$failed" -eq 0 ]; then
    echo "[verify] Running: $TEST_CMD" >&2
    (cd "$worktree" && eval "$TEST_CMD") || { echo "[verify] FAILED: $TEST_CMD" >&2; failed=1; }
  else
    [ -z "$TEST_CMD" ] && skipped="${skipped}test "
  fi

  if [ -n "$skipped" ]; then
    echo "[verify] Skipped (not detected): $skipped" >&2
  fi

  if [ "$failed" -eq 0 ]; then
    echo "[verify] All checks passed" >&2
    return 0
  else
    echo "[verify] Verification failed — do NOT merge" >&2
    return 1
  fi
}

cmd_merge() {
  local worktree="${1:?Usage: forge-lite.sh merge <worktree-path> [message]}"
  local message="${2:-[forge] task completed}"
  [ -d "$worktree" ] || { echo "Error: directory not found: $worktree" >&2; exit 1; }

  # Get branch name from worktree
  local branch
  branch=$(git -C "$worktree" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
    echo "Error: cannot determine branch in $worktree" >&2; exit 1;
  }

  # Check if there are uncommitted changes
  if ! git -C "$worktree" diff --quiet || ! git -C "$worktree" diff --cached --quiet; then
    echo "[merge] Committing uncommitted changes in worktree..." >&2
    git -C "$worktree" add -A
    git -C "$worktree" commit -m "$message"
  fi

  # Check if branch has commits ahead of main
  local ahead
  ahead=$(git -C "$MAIN_DIR" rev-list --count "main..$branch" 2>/dev/null) || ahead=0
  if [ "$ahead" -eq 0 ]; then
    echo "Error: branch $branch has no commits ahead of main" >&2
    exit 1
  fi

  # Merge
  echo "[merge] Merging $branch into main..." >&2
  git -C "$MAIN_DIR" merge --no-ff "$branch" -m "[forge] $message" || {
    echo "[merge] Merge conflict — resolve manually in $MAIN_DIR" >&2
    exit 1
  }

  # Post-merge verify
  detect_commands "$MAIN_DIR"
  local post_fail=0
  if [ -n "$TYPECHECK_CMD" ]; then
    (cd "$MAIN_DIR" && eval "$TYPECHECK_CMD") || post_fail=1
  fi
  if [ -n "$TEST_CMD" ] && [ "$post_fail" -eq 0 ]; then
    (cd "$MAIN_DIR" && eval "$TEST_CMD") || post_fail=1
  fi

  if [ "$post_fail" -ne 0 ]; then
    echo "[merge] Post-merge verification FAILED — rolling back" >&2
    git -C "$MAIN_DIR" reset --merge HEAD~1
    echo "[merge] Main restored. Debug in worktree: $worktree" >&2
    exit 1
  fi

  # Cleanup
  echo "[merge] Cleaning up worktree and branch..." >&2
  git -C "$MAIN_DIR" worktree remove "$worktree" 2>/dev/null || rm -rf "$worktree"
  git -C "$MAIN_DIR" branch -d "$branch" 2>/dev/null || true

  echo "[merge] Done. Merged $branch into main." >&2
}

cmd_yolo() {
  local worktree="${1:?Usage: forge-lite.sh yolo <worktree-path> [message]}"
  local message="${2:-[forge] task completed}"

  cmd_verify "$worktree" || exit 1
  cmd_merge "$worktree" "$message"
}

cmd_cleanup() {
  local worktree="${1:?Usage: forge-lite.sh cleanup <worktree-path>}"
  [ -d "$worktree" ] || { echo "Already cleaned up: $worktree" >&2; return 0; }

  local branch
  branch=$(git -C "$worktree" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=""

  git -C "$MAIN_DIR" worktree remove "$worktree" 2>/dev/null || rm -rf "$worktree"
  [ -n "$branch" ] && git -C "$MAIN_DIR" branch -D "$branch" 2>/dev/null || true

  echo "[cleanup] Removed $worktree" >&2
}

# --- Dispatch ---

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  merge)   shift; cmd_merge "$@" ;;
  yolo)    shift; cmd_yolo "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  *)
    echo "Usage: forge-lite.sh <create|verify|merge|yolo|cleanup> [args]" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  create <task-name>              Create worktree + feature branch" >&2
    echo "  verify <worktree-path>          Run typecheck + tests" >&2
    echo "  merge  <worktree-path> [msg]    Merge to main + cleanup" >&2
    echo "  yolo   <worktree-path> [msg]    Verify + merge in one shot" >&2
    echo "  cleanup <worktree-path>         Remove worktree without merging" >&2
    exit 1
    ;;
esac
