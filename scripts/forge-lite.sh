#!/usr/bin/env bash
# forge-lite.sh — Crash-proof worktree isolation for AI agent subprocesses
#
# Problem: AI agents that spawn subprocesses to write code (delegations/tentacles)
# need git worktree isolation, but unattended subprocesses crash, leave stale
# worktrees, corrupt node_modules with symlink loops, and conflict when running
# in parallel. Nobody is watching to clean up.
#
# Solution: A single script that handles the mechanical git plumbing safely —
# lock file prevents parallel conflicts, state file enables crash recovery,
# auto-prune cleans up stale worktrees, deps are installed before verify
# to prevent pnpm symlink corruption, and 3 persistent worktree slots with
# cached node_modules support concurrent runs (first run installs, reuse skips).
# Before merge, rebase onto main reduces conflicts from concurrent work.
#
# Usage:
#   forge-lite.sh create <task-name> [--files "a.ts,b.ts"] [--no-install]  → Create worktree + branch
#   forge-lite.sh verify <worktree-path>          → Run typecheck + tests
#   forge-lite.sh merge <worktree-path> [message]  → Merge to main + cleanup
#   forge-lite.sh yolo <worktree-path> [message]   → Verify + merge in one shot
#   forge-lite.sh cleanup <worktree-path>          → Remove worktree without merging
#   forge-lite.sh status                           → Show slot states (busy/free/abandoned)
#   forge-lite.sh recover                          → Recover from a previous crash
#
# Exit code 2 = file overlap with busy slot (caller should wait and retry)
#
# Exit codes: 0 = success, 1 = failure (details on stderr)

set -euo pipefail

MAIN_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Error: not inside a git repository" >&2
  exit 1
}

LOCK_FILE="$MAIN_DIR/.git/forge-lite.lock"
STATE_FILE="$MAIN_DIR/.git/forge-lite-state"
STALE_HOURS=24
FORGE_SLOTS=3
SLOT_STALE_MINUTES=60

# ============================================================
# Safety infrastructure
# ============================================================

acquire_lock() {
  if [ -f "$LOCK_FILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null) || lock_pid=""
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      echo "Error: another forge-lite is running (pid $lock_pid)" >&2
      echo "If stale: rm $LOCK_FILE" >&2
      exit 1
    fi
    echo "[lock] Removing stale lock (pid $lock_pid no longer running)" >&2
    rm -f "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE"
}

release_lock() {
  rm -f "$LOCK_FILE"
}

set_state() {
  echo "$1:$2:$(date +%s)" > "$STATE_FILE"
}

clear_state() {
  rm -f "$STATE_FILE"
}

on_exit() {
  local code=$?
  release_lock
  if [ "$code" -eq 0 ]; then
    clear_state
  elif [ -f "$STATE_FILE" ]; then
    echo "[crash] State saved: $(cat "$STATE_FILE")" >&2
    echo "[crash] Run 'forge-lite.sh recover' to clean up" >&2
  fi
}

trap on_exit EXIT
trap 'exit 130' INT TERM

# ============================================================
# Persistent slot detection
# ============================================================

is_persistent_slot() {
  local dir="${1:?}"
  local base
  base=$(basename "$dir")
  local project
  project=$(basename "$MAIN_DIR")
  for i in $(seq 1 $FORGE_SLOTS); do
    [ "$base" = "${project}-forge-${i}" ] && return 0
  done
  return 1
}

# ============================================================
# Slot marker helpers (self-healing state persistence)
# ============================================================

# .forge-in-use format (3 lines):
#   line 1: branch name
#   line 2: caller PID (for instant liveness check)
#   line 3: unix timestamp (fallback for stale detection)

write_slot_marker() {
  local slot_dir="${1:?}" branch="${2:?}" caller_pid="${3:-0}"
  printf '%s\n%s\n%s\n' "$branch" "$caller_pid" "$(date +%s)" > "$slot_dir/.forge-in-use"
}

read_slot_marker() {
  local marker="${1:?}"
  SLOT_BRANCH="" SLOT_PID="" SLOT_TS=""
  [ -f "$marker" ] || return 1
  SLOT_BRANCH=$(sed -n '1p' "$marker" 2>/dev/null)
  SLOT_PID=$(sed -n '2p' "$marker" 2>/dev/null)
  SLOT_TS=$(sed -n '3p' "$marker" 2>/dev/null)
}

# Returns 0 (true) if the slot's caller is dead or marker is stale
is_slot_abandoned() {
  local marker="${1:?}"
  read_slot_marker "$marker" || return 1

  # Instant check: caller PID dead → abandoned
  if [ -n "$SLOT_PID" ] && [ "$SLOT_PID" != "0" ]; then
    if ! kill -0 "$SLOT_PID" 2>/dev/null; then
      return 0  # caller is dead
    fi
  fi

  # Fallback: timestamp too old → abandoned (handles PID recycling edge case)
  if [ -n "$SLOT_TS" ] && [ "$SLOT_TS" != "0" ]; then
    local now
    now=$(date +%s)
    [ $(( (now - SLOT_TS) / 60 )) -ge "$SLOT_STALE_MINUTES" ] && return 0
  fi

  return 1  # still alive
}

# Legacy compat: returns 0 if file mtime is stale (for state file check)
is_stale_marker() {
  local marker="${1:?}"
  [ -f "$marker" ] || return 1
  local now mtime
  now=$(date +%s)
  if stat -f %m "$marker" >/dev/null 2>&1; then
    mtime=$(stat -f %m "$marker")    # macOS
  else
    mtime=$(stat -c %Y "$marker" 2>/dev/null) || return 1  # Linux
  fi
  [ $(( (now - mtime) / 60 )) -ge "$SLOT_STALE_MINUTES" ]
}

# ============================================================
# File overlap detection
# ============================================================

check_file_overlap() {
  local my_files="${1:?}"
  local base_dir="$MAIN_DIR/../$(basename "$MAIN_DIR")-forge"

  for i in $(seq 1 $FORGE_SLOTS); do
    local slot="${base_dir}-${i}"
    [ -f "$slot/.forge-in-use" ] || continue

    read_slot_marker "$slot/.forge-in-use" || continue
    local busy_branch="$SLOT_BRANCH"

    # Combine ACTUAL modified files (git diff) + declared files (planned work)
    # This catches both: files already changed + files not yet changed
    local busy_files
    busy_files=$(git -C "$slot" diff --name-only main 2>/dev/null || true)
    if [ -f "$slot/.forge-files" ]; then
      busy_files=$(printf '%s\n%s' "$busy_files" "$(cat "$slot/.forge-files")" | sort -u)
    fi
    [ -z "$busy_files" ] && continue

    # Check each of my files against the busy slot's combined file list
    local my_file
    for my_file in $(echo "$my_files" | tr ',' '\n'); do
      [ -z "$my_file" ] && continue
      if echo "$busy_files" | grep -qxF "$my_file" 2>/dev/null; then
        echo "[overlap] File '$my_file' conflicts with slot $i ($busy_branch)" >&2
        echo "$my_file"
        return 0
      fi
    done
  done
}

# ============================================================
# Stale worktree auto-prune
# ============================================================

auto_prune() {
  git -C "$MAIN_DIR" worktree prune 2>/dev/null || true

  local project_name
  project_name=$(basename "$MAIN_DIR")
  local parent_dir
  parent_dir=$(dirname "$MAIN_DIR")
  local now
  now=$(date +%s)

  for dir in "$parent_dir/${project_name}-forge-"*; do
    [ -d "$dir" ] || continue
    # Never auto-prune persistent slots
    is_persistent_slot "$dir" && continue
    local mtime
    if stat -f %m "$dir" >/dev/null 2>&1; then
      mtime=$(stat -f %m "$dir")    # macOS
    else
      mtime=$(stat -c %Y "$dir" 2>/dev/null) || continue  # Linux
    fi
    local age_hours=$(( (now - mtime) / 3600 ))
    if [ "$age_hours" -ge "$STALE_HOURS" ]; then
      echo "[prune] Removing stale worktree (${age_hours}h old): $dir" >&2
      local branch
      branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=""
      git -C "$MAIN_DIR" worktree remove "$dir" 2>/dev/null || rm -rf "$dir"
      [ -n "$branch" ] && [ "$branch" != "main" ] && \
        git -C "$MAIN_DIR" branch -D "$branch" 2>/dev/null || true
    fi
  done
}

# ============================================================
# Pre-flight validation
# ============================================================

preflight_check() {
  local cmd="${1:?}"

  # Auto-recover stale crash state (>1h = caller is long dead)
  if [ -f "$STATE_FILE" ]; then
    if is_stale_marker "$STATE_FILE"; then
      echo "[preflight] Auto-recovering stale crash state: $(cat "$STATE_FILE")" >&2
      cmd_recover 2>/dev/null || true
    else
      echo "[warn] Recent crash state: $(cat "$STATE_FILE")" >&2
      echo "[warn] Run 'forge-lite.sh recover' to clean up, or continuing..." >&2
    fi
  fi

  # For merge/yolo: ensure main is clean
  if [ "$cmd" = "merge" ] || [ "$cmd" = "yolo" ]; then
    if ! git -C "$MAIN_DIR" diff --quiet 2>/dev/null || \
       ! git -C "$MAIN_DIR" diff --cached --quiet 2>/dev/null; then
      echo "Error: main has uncommitted changes — commit or stash first" >&2
      exit 1
    fi
    if [ -f "$MAIN_DIR/.git/MERGE_HEAD" ]; then
      echo "Error: merge already in progress on main — resolve first" >&2
      exit 1
    fi
  fi
}

# ============================================================
# Install dependencies if needed
# ============================================================

file_hash() {
  md5 -q "$1" 2>/dev/null || md5sum "$1" 2>/dev/null | cut -d' ' -f1
}

install_deps() {
  local dir="${1:?}"

  if [ -f "$dir/package.json" ]; then
    if [ -d "$dir/node_modules" ] && [ ! -L "$dir/node_modules" ]; then
      # node_modules exists — check if lockfile changed since last install
      local lockfile=""
      [ -f "$dir/pnpm-lock.yaml" ] && lockfile="$dir/pnpm-lock.yaml"
      [ -f "$dir/package-lock.json" ] && lockfile="$dir/package-lock.json"
      [ -f "$dir/bun.lockb" ] && lockfile="$dir/bun.lockb"
      [ -f "$dir/yarn.lock" ] && lockfile="$dir/yarn.lock"

      if [ -n "$lockfile" ] && [ -f "$dir/node_modules/.forge-lockfile-hash" ]; then
        local current_hash saved_hash
        current_hash=$(file_hash "$lockfile")
        saved_hash=$(cat "$dir/node_modules/.forge-lockfile-hash" 2>/dev/null)
        if [ "$current_hash" = "$saved_hash" ]; then
          echo "[deps] Lockfile unchanged, skipping install" >&2
          return 0
        fi
        echo "[deps] Lockfile changed, reinstalling..." >&2
      else
        return 0
      fi
    fi

    # Remove broken or stale symlinks (worktree artifact)
    [ -L "$dir/node_modules" ] && rm "$dir/node_modules"

    local install_cmd="npm ci"
    local lockfile=""
    [ -f "$dir/pnpm-lock.yaml" ] && install_cmd="pnpm install --frozen-lockfile" && lockfile="$dir/pnpm-lock.yaml"
    [ -f "$dir/bun.lockb" ] && install_cmd="bun install --frozen-lockfile" && lockfile="$dir/bun.lockb"
    [ -f "$dir/yarn.lock" ] && install_cmd="yarn install --frozen-lockfile" && lockfile="$dir/yarn.lock"
    [ -z "$lockfile" ] && [ -f "$dir/package-lock.json" ] && lockfile="$dir/package-lock.json"

    echo "[deps] Running: $install_cmd" >&2
    (cd "$dir" && eval "$install_cmd") || {
      echo "[deps] FAILED: $install_cmd" >&2
      return 1
    }

    # Save lockfile hash for future change detection
    if [ -n "$lockfile" ] && [ -d "$dir/node_modules" ]; then
      file_hash "$lockfile" > "$dir/node_modules/.forge-lockfile-hash"
    fi
  elif [ -f "$dir/go.mod" ]; then
    echo "[deps] Running: go mod download" >&2
    (cd "$dir" && go mod download) || true
  fi
}

# ============================================================
# Detect project verification commands
# ============================================================

detect_commands() {
  local dir="${1:-$MAIN_DIR}"
  BUILD_CMD="" TYPECHECK_CMD="" TEST_CMD="" LINT_CMD=""

  if [ -f "$dir/package.json" ]; then
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

# ============================================================
# Commands
# ============================================================

cmd_create() {
  local task_name="${1:?Usage: forge-lite.sh create <task-name> [--files \"a.ts,b.ts\"]}"
  task_name=$(echo "$task_name" | tr ' ' '-' | tr -cd '[:alnum:]-_' | tr '[:upper:]' '[:lower:]')
  shift

  # Parse options
  local declared_files="" caller_pid="0" no_install=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --files) declared_files="${2:-}"; shift 2 ;;
      --caller-pid) caller_pid="${2:-0}"; shift 2 ;;
      --no-install) no_install=true; shift ;;
      *) shift ;;
    esac
  done

  # Check file overlap with busy slots (exit 2 = caller should wait)
  if [ -n "$declared_files" ]; then
    local overlap
    overlap=$(check_file_overlap "$declared_files")
    if [ -n "$overlap" ]; then
      echo "[create] BLOCKED: file overlap detected — wait for conflicting slot to finish" >&2
      exit 2
    fi
  fi

  auto_prune

  local branch="feature/$task_name"
  local base_dir="$MAIN_DIR/../$(basename "$MAIN_DIR")-forge"

  # Clean up leftover branch from previous crash
  if git -C "$MAIN_DIR" rev-parse --verify "$branch" >/dev/null 2>&1; then
    echo "[create] Removing leftover branch: $branch" >&2
    git -C "$MAIN_DIR" branch -D "$branch" 2>/dev/null || true
  fi

  # Find a free persistent slot (1..FORGE_SLOTS)
  local worktree_dir=""
  for i in $(seq 1 $FORGE_SLOTS); do
    local slot="${base_dir}-${i}"
    if [ -d "$slot" ]; then
      if [ -f "$slot/.forge-in-use" ]; then
        # Self-healing: reclaim slot if caller is dead or marker is stale
        if is_slot_abandoned "$slot/.forge-in-use"; then
          echo "[create] Reclaiming abandoned slot $i ($SLOT_BRANCH, pid=$SLOT_PID) — caller dead" >&2
          rm -f "$slot/.forge-in-use" "$slot/.forge-files"
          worktree_dir="$slot"
          break
        fi
        continue  # genuinely busy
      fi
      worktree_dir="$slot"
      echo "[create] Reusing slot $i (node_modules cached)" >&2
      break
    else
      # Slot doesn't exist yet — will create it
      worktree_dir="$slot"
      echo "[create] Creating slot $i (first-time setup)" >&2
      break
    fi
  done

  set_state "create" "${worktree_dir:-dedicated}"

  if [ -z "$worktree_dir" ]; then
    # All slots busy — fallback to dedicated worktree (slow, full install)
    echo "[create] All $FORGE_SLOTS slots busy, using dedicated worktree" >&2
    worktree_dir="$MAIN_DIR/../$(basename "$MAIN_DIR")-forge-$task_name"
    git -C "$MAIN_DIR" worktree add "$worktree_dir" -b "$branch" 2>&1
    if [ "$no_install" = false ]; then
      install_deps "$worktree_dir" || echo "[create] WARNING: dependency install failed (worktree still usable)" >&2
    else
      echo "[create] Skipping dependency install (--no-install)" >&2
    fi
  elif [ -d "$worktree_dir" ]; then
    # Reuse existing slot — reset to main, create new branch
    local old_branch
    old_branch=$(git -C "$worktree_dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || old_branch=""
    git -C "$worktree_dir" checkout --detach HEAD 2>/dev/null || true
    [ -n "$old_branch" ] && [ "$old_branch" != "HEAD" ] && \
      git -C "$MAIN_DIR" branch -D "$old_branch" 2>/dev/null || true
    git -C "$worktree_dir" checkout -b "$branch" main 2>&1
    git -C "$worktree_dir" clean -fd 2>/dev/null || true
    git -C "$worktree_dir" checkout -- . 2>/dev/null || true
    if [ "$no_install" = false ]; then
      install_deps "$worktree_dir" || echo "[create] WARNING: dependency install failed (worktree still usable)" >&2
    else
      echo "[create] Skipping dependency install (--no-install)" >&2
    fi
  else
    # Create new slot
    git -C "$MAIN_DIR" worktree add "$worktree_dir" -b "$branch" 2>&1
    if [ "$no_install" = false ]; then
      install_deps "$worktree_dir" || echo "[create] WARNING: dependency install failed (worktree still usable)" >&2
    else
      echo "[create] Skipping dependency install (--no-install)" >&2
    fi
  fi

  # Mark as in use (branch + caller PID + timestamp for liveness detection)
  write_slot_marker "$worktree_dir" "$branch" "$caller_pid"

  # Save declared files for overlap detection
  if [ -n "$declared_files" ]; then
    echo "$declared_files" | tr ',' '\n' > "$worktree_dir/.forge-files"
  else
    rm -f "$worktree_dir/.forge-files"
  fi

  clear_state
  echo "$worktree_dir"
}

cmd_verify() {
  local worktree="${1:?Usage: forge-lite.sh verify <worktree-path>}"
  [ -d "$worktree" ] || { echo "Error: directory not found: $worktree" >&2; exit 1; }

  set_state "verify" "$worktree"
  detect_commands "$worktree"

  # Install dependencies before verification (worktrees have no node_modules)
  install_deps "$worktree" || { echo "[verify] Cannot install dependencies" >&2; clear_state; return 1; }

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

  [ -n "$skipped" ] && echo "[verify] Skipped (not detected): $skipped" >&2

  clear_state
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

  set_state "merge" "$worktree"

  # Get branch name from worktree
  local branch
  branch=$(git -C "$worktree" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
    echo "Error: cannot determine branch in $worktree" >&2; exit 1;
  }

  # Check if there are uncommitted changes
  if ! git -C "$worktree" diff --quiet || ! git -C "$worktree" diff --cached --quiet; then
    echo "[merge] Committing uncommitted changes in worktree..." >&2
    git -C "$worktree" add -A
    git -C "$worktree" reset HEAD -- node_modules 2>/dev/null || true
    git -C "$worktree" commit -m "$message"
  fi

  # Rebase onto latest main to reduce merge conflicts from concurrent work
  echo "[merge] Rebasing $branch onto main..." >&2
  if ! git -C "$worktree" rebase main 2>&1; then
    echo "[merge] Rebase conflict — aborting rebase, will try direct merge" >&2
    git -C "$worktree" rebase --abort 2>/dev/null || true
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
  set_state "merging" "$worktree"
  git -C "$MAIN_DIR" merge --no-ff "$branch" -m "[forge] $message" || {
    echo "[merge] Merge conflict — resolve manually in $MAIN_DIR" >&2
    exit 1
  }

  # Post-merge verify
  set_state "post-verify" "$worktree"
  detect_commands "$MAIN_DIR"
  install_deps "$MAIN_DIR" || true
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

  # Keep persistent slot worktrees for reuse, delete dedicated ones
  if is_persistent_slot "$worktree"; then
    echo "[merge] Keeping slot for reuse (node_modules cached)" >&2
    rm -f "$worktree/.forge-in-use" "$worktree/.forge-files"
    git -C "$worktree" checkout --detach HEAD 2>/dev/null || true
    git -C "$MAIN_DIR" branch -d "$branch" 2>/dev/null || true
  else
    echo "[merge] Cleaning up dedicated worktree..." >&2
    git -C "$MAIN_DIR" worktree remove "$worktree" 2>/dev/null || rm -rf "$worktree"
    git -C "$MAIN_DIR" branch -d "$branch" 2>/dev/null || true
  fi

  clear_state
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
  rm -f "$worktree/.forge-in-use" "$worktree/.forge-files"

  # Persistent slots: release but preserve (keep cached node_modules)
  if is_persistent_slot "$worktree"; then
    git -C "$worktree" checkout --detach HEAD 2>/dev/null || true
    [ -n "$branch" ] && [ "$branch" != "HEAD" ] && \
      git -C "$MAIN_DIR" branch -D "$branch" 2>/dev/null || true
    echo "[cleanup] Released slot (node_modules preserved)" >&2
  else
    git -C "$MAIN_DIR" worktree remove "$worktree" 2>/dev/null || rm -rf "$worktree"
    [ -n "$branch" ] && git -C "$MAIN_DIR" branch -D "$branch" 2>/dev/null || true
    echo "[cleanup] Removed $worktree" >&2
  fi
}

cmd_status() {
  local base_dir="$MAIN_DIR/../$(basename "$MAIN_DIR")-forge"
  local total=0 busy=0 free=0

  for i in $(seq 1 $FORGE_SLOTS); do
    local slot="${base_dir}-${i}"
    total=$((total + 1))
    if [ -d "$slot" ] && [ -f "$slot/.forge-in-use" ]; then
      if is_slot_abandoned "$slot/.forge-in-use"; then
        echo "slot $i: abandoned (branch=$SLOT_BRANCH pid=$SLOT_PID) — reclaimable" >&2
        free=$((free + 1))
      else
        local files=""
        [ -f "$slot/.forge-files" ] && files=" files=$(cat "$slot/.forge-files" | tr '\n' ',')"
        echo "slot $i: busy (branch=$SLOT_BRANCH pid=$SLOT_PID${files})" >&2
        busy=$((busy + 1))
      fi
    else
      echo "slot $i: free" >&2
      free=$((free + 1))
    fi
  done

  echo "total=$total busy=$busy free=$free"
}

cmd_recover() {
  if [ ! -f "$STATE_FILE" ]; then
    echo "[recover] No crash state found — nothing to recover" >&2
    # Still prune stale worktrees as a courtesy
    auto_prune
    return 0
  fi

  local state_info
  state_info=$(cat "$STATE_FILE")
  local phase worktree timestamp
  phase=$(echo "$state_info" | cut -d: -f1)
  worktree=$(echo "$state_info" | cut -d: -f2)
  timestamp=$(echo "$state_info" | cut -d: -f3)

  local age=""
  if [ -n "$timestamp" ]; then
    local now
    now=$(date +%s)
    age="$(( (now - timestamp) / 60 ))min ago"
  fi

  echo "[recover] Found crash state: phase=$phase worktree=$worktree ${age:+($age)}" >&2

  case "$phase" in
    create)
      echo "[recover] Crashed during create — cleaning up partial worktree" >&2
      cmd_cleanup "$worktree" 2>/dev/null || true
      ;;
    verify)
      echo "[recover] Crashed during verify — worktree is safe" >&2
      echo "[recover] Re-verify:  forge-lite.sh verify $worktree" >&2
      echo "[recover] Or abandon: forge-lite.sh cleanup $worktree" >&2
      clear_state
      return 0
      ;;
    merge|merging)
      echo "[recover] Crashed during merge — checking main state" >&2
      if [ -f "$MAIN_DIR/.git/MERGE_HEAD" ]; then
        echo "[recover] Aborting in-progress merge on main" >&2
        git -C "$MAIN_DIR" merge --abort 2>/dev/null || true
      fi
      echo "[recover] Cleaning up worktree" >&2
      cmd_cleanup "$worktree" 2>/dev/null || true
      ;;
    post-verify)
      echo "[recover] Crashed during post-merge verify — rolling back merge" >&2
      git -C "$MAIN_DIR" reset --merge HEAD~1 2>/dev/null || true
      echo "[recover] Main restored. Cleaning up worktree" >&2
      cmd_cleanup "$worktree" 2>/dev/null || true
      ;;
    *)
      echo "[recover] Unknown phase: $phase — cleaning up" >&2
      cmd_cleanup "$worktree" 2>/dev/null || true
      ;;
  esac

  clear_state
  git -C "$MAIN_DIR" worktree prune 2>/dev/null || true
  echo "[recover] Done" >&2
}

# ============================================================
# Dispatch
# ============================================================

# Acquire lock for all commands except recover (which cleans up locks)
case "${1:-}" in
  recover|status) ;;
  "") ;;
  *) acquire_lock ;;
esac

preflight_check "${1:-help}"

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  merge)   shift; cmd_merge "$@" ;;
  yolo)    shift; cmd_yolo "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  status)  cmd_status ;;
  recover) cmd_recover ;;
  *)
    echo "Usage: forge-lite.sh <create|verify|merge|yolo|cleanup|status|recover> [args]" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  create <task-name>              Create worktree + feature branch" >&2
    echo "  verify <worktree-path>          Run typecheck + tests" >&2
    echo "  merge  <worktree-path> [msg]    Merge to main + cleanup" >&2
    echo "  yolo   <worktree-path> [msg]    Verify + merge in one shot" >&2
    echo "  cleanup <worktree-path>         Remove worktree without merging" >&2
    echo "  status                          Show slot states (busy/free/abandoned)" >&2
    echo "  recover                         Recover from a previous crash" >&2
    exit 1
    ;;
esac
