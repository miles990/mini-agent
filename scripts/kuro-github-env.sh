#!/usr/bin/env bash

kuro_read_dotenv() {
  local key="${1:?}"
  local env_file="${KURO_GITHUB_ENV_FILE:-${MAIN_DIR:-$(pwd)}/.env}"
  [ -f "$env_file" ] || return 1
  grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" | tail -1 | sed -E "s/^[^=]+=//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^['\\\"]//; s/['\\\"]$//"
}

kuro_github_env_required() {
  local token="${KURO_GITHUB_TOKEN:-}"
  if [ -z "$token" ]; then
    token="$(kuro_read_dotenv KURO_GITHUB_TOKEN || true)"
  fi
  if [ -z "$token" ]; then
    echo "Error: KURO_GITHUB_TOKEN is required for Kuro-owned GitHub automation" >&2
    return 1
  fi

  local expected="${KURO_GITHUB_LOGIN:-}"
  if [ -z "$expected" ]; then
    expected="$(kuro_read_dotenv KURO_GITHUB_LOGIN || true)"
  fi
  if [ -z "$expected" ]; then
    expected="${KURO_GITHUB_USER:-}"
  fi
  if [ -z "$expected" ]; then
    expected="$(kuro_read_dotenv KURO_GITHUB_USER || true)"
  fi
  if [ -z "$expected" ]; then
    local profile="${KURO_GITHUB:-}"
    [ -n "$profile" ] || profile="$(kuro_read_dotenv KURO_GITHUB || true)"
    expected="${profile%/}"
    expected="${expected##*/}"
    expected="${expected%.git}"
  fi
  [ -n "$expected" ] || expected="kuro-agent"

  export GH_TOKEN="$token"
  export GITHUB_TOKEN="$token"
  export KURO_GITHUB_TOKEN="$token"

  if command -v gh >/dev/null 2>&1; then
    local actual
    actual="$(gh api user --jq .login 2>/dev/null || true)"
    if [ "$actual" != "$expected" ]; then
      echo "Error: Kuro GitHub identity mismatch: expected $expected, got ${actual:-unknown}" >&2
      return 1
    fi
  fi

  local idx="${GIT_CONFIG_COUNT:-0}"
  export "GIT_CONFIG_KEY_${idx}=http.https://github.com/.extraheader"
  export "GIT_CONFIG_VALUE_${idx}=AUTHORIZATION: bearer ${token}"
  idx=$((idx + 1))
  export "GIT_CONFIG_KEY_${idx}=url.https://github.com/.insteadOf"
  export "GIT_CONFIG_VALUE_${idx}=git@github.com:"
  idx=$((idx + 1))
  export "GIT_CONFIG_KEY_${idx}=url.https://github.com/.pushInsteadOf"
  export "GIT_CONFIG_VALUE_${idx}=git@github.com:"
  idx=$((idx + 1))
  export "GIT_CONFIG_KEY_${idx}=user.name"
  export "GIT_CONFIG_VALUE_${idx}=${KURO_GIT_AUTHOR_NAME:-Kuro}"
  idx=$((idx + 1))
  export "GIT_CONFIG_KEY_${idx}=user.email"
  export "GIT_CONFIG_VALUE_${idx}=${KURO_GIT_AUTHOR_EMAIL:-kuro@mini-agent}"
  idx=$((idx + 1))
  export GIT_CONFIG_COUNT="$idx"
}
