#!/usr/bin/env bash
# Portfolio verification script — checks all pages after deploy
# Usage: bash scripts/portfolio-verify.sh [base_url]
# Default: https://kuro.page

set -euo pipefail

BASE="${1:-https://kuro.page}"
PASS=0
FAIL=0
WARN=0

green() { printf "\033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS + 1)); }
red()   { printf "\033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL + 1)); }
yellow(){ printf "\033[33m⚠\033[0m %s\n" "$1"; WARN=$((WARN + 1)); }

# Check a page: HTTP status + minimum size + required content
check_page() {
  local page="$1"
  local min_size="${2:-1000}"
  shift 2
  local required_strings=("$@")

  local url="${BASE}/${page}"
  local tmpfile
  tmpfile=$(mktemp)
  local http_code
  http_code=$(curl -sf -o "$tmpfile" -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  local size
  size=$(wc -c < "$tmpfile" | tr -d ' ')

  if [ "$http_code" != "200" ]; then
    red "$page — HTTP $http_code"
    rm -f "$tmpfile"
    return
  fi

  if [ "$size" -lt "$min_size" ]; then
    red "$page — too small (${size}B < ${min_size}B expected)"
    rm -f "$tmpfile"
    return
  fi

  # Check required strings
  for str in "${required_strings[@]}"; do
    if ! grep -q "$str" "$tmpfile" 2>/dev/null; then
      red "$page — missing: $str"
      rm -f "$tmpfile"
      return
    fi
  done

  green "$page — ${size}B"
  rm -f "$tmpfile"
}

# Check JSON endpoint
check_json() {
  local path="$1"
  local min_items="${2:-1}"
  local url="${BASE}/${path}"

  local content
  content=$(curl -sf "$url" 2>/dev/null || echo "")

  if [ -z "$content" ]; then
    red "$path — not accessible"
    return
  fi

  # Count array items (rough check)
  local count
  count=$(echo "$content" | grep -o '"slug"' | wc -l | tr -d ' ')

  if [ "$count" -lt "$min_items" ]; then
    red "$path — only $count items (expected >= $min_items)"
    return
  fi

  green "$path — $count items"
}

echo "═══ Portfolio Verification: $BASE ═══"
echo ""

echo "── Pages ──"
check_page "index.html"        5000  "header-nav" "shared.css"
check_page "journal.html"      5000  "header-nav" "shared.js" "manifest.json" "renderList"
check_page "gallery.html"      5000  "header-nav" "shared.css"
check_page "inner.html"        5000  "header-nav" "shared.css"
check_page "only-and.html"     5000  "header-nav" "shared.css"
check_page "three-rooms.html"  5000  "header-nav" "shared.css"
check_page "three-rules.html"  5000  "header-nav" "shared.css"
check_page "constraint-framework.html" 5000 "header-nav" "shared.css"
check_page "constraint-garden.html"    5000 "header-nav" "shared.css"
check_page "tsubuyaki-002.html" 3000  "header-nav" "shared.css"

echo ""
echo "── Assets ──"
check_page "shared.css"  500  "header-nav" "teal"
check_page "shared.js"   200  "I18N" "menu-toggle"
check_page "llms.txt"    500  "Kuro"

echo ""
echo "── Data ──"
check_json "content/journal/manifest.json" 20
check_page "lang/en.json"  100  "nav"
check_page "lang/zh.json"  100  "nav"
check_page "lang/ja.json"  100  "nav"

echo ""
echo "── Cross-page Consistency ──"
# Verify all HTML pages reference shared.css and shared.js
for page in index.html journal.html gallery.html inner.html only-and.html three-rooms.html three-rules.html constraint-framework.html constraint-garden.html; do
  local_file="kuro-portfolio/$page"
  if [ -f "$local_file" ]; then
    if grep -q 'shared.css' "$local_file" && grep -q 'shared.js' "$local_file"; then
      green "$page — refs shared.css + shared.js"
    elif grep -q 'shared.css' "$local_file"; then
      # index.html only uses shared.css (has custom JS)
      green "$page — refs shared.css (custom JS)"
    else
      red "$page — missing shared asset references"
    fi
  fi
done

echo ""
echo "═══════════════════════════════════"
printf "Results: \033[32m%d passed\033[0m" "$PASS"
[ "$WARN" -gt 0 ] && printf ", \033[33m%d warnings\033[0m" "$WARN"
[ "$FAIL" -gt 0 ] && printf ", \033[31m%d failed\033[0m" "$FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "❌ VERIFICATION FAILED"
  exit 1
else
  echo "✅ ALL CHECKS PASSED"
  exit 0
fi
