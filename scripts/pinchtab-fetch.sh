#!/bin/bash
# Pinchtab Fetch — Smart browser content fetcher via Pinchtab API
#
# Intelligent flow:
#   1. Open URL in new tab → read via ?tabId= (isolated)
#   2. Success → output content → auto-close tab
#   3. AUTH_REQUIRED + headless → auto-switch visible → reopen → prompt login
#   4. Extract after login → output content → auto-switch back to headless
#
# All operations logged to ~/.mini-agent/cdp.jsonl with result/timing/context.
#
# Usage:
#   bash scripts/pinchtab-fetch.sh status                  # Check availability
#   bash scripts/pinchtab-fetch.sh fetch <url>             # Smart fetch (auto tab + auth handling)
#   bash scripts/pinchtab-fetch.sh fetch <url> --full      # Fetch full content
#   bash scripts/pinchtab-fetch.sh open <url>              # Open visible tab (manual)
#   bash scripts/pinchtab-fetch.sh extract [tabId]         # Extract from tab (auto-headless after)
#   bash scripts/pinchtab-fetch.sh close <tabId>           # Close a tab

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:${PINCHTAB_PORT}"
PINCHTAB_TIMEOUT="${PINCHTAB_TIMEOUT:-15000}"
PINCHTAB_MAX_CONTENT="${PINCHTAB_MAX_CONTENT:-8000}"
LOG_DIR="$HOME/.mini-agent"
LOG_FILE="$LOG_DIR/cdp.jsonl"
PINCHTAB_MODE_FILE="$HOME/.mini-agent/pinchtab.mode"
PINCHTAB_LEARNED="$HOME/.mini-agent/pinchtab-learned.jsonl"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Logging ─────────────────────────────────────────────────────────────────

# Structured log: every operation with result, context, timing
# Fields: ts, op, url?, tabId?, result, detail?, contentLen?, durationMs?, mode?
log_event() {
  mkdir -p "$LOG_DIR"
  local json
  json=$(python3 -c "
import json, datetime, sys
d = {}
for arg in sys.argv[1:]:
    if '=' in arg:
        k, v = arg.split('=', 1)
        # Auto-type numbers
        if v.isdigit(): v = int(v)
        elif v == 'true': v = True
        elif v == 'false': v = False
        d[k] = v
d['ts'] = datetime.datetime.utcnow().isoformat() + 'Z'
print(json.dumps(d))
" "$@" 2>/dev/null || echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"op\":\"$1\"}")
  echo "$json" >> "$LOG_FILE" 2>/dev/null
}

# Timer helpers
timer_start() { python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null; }
timer_elapsed() { local now; now=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null); echo $(( now - $1 )); }

# ─── Helpers ──────────────────────────────────────────────────────────────────

# ─── Experience Memory ────────────────────────────────────────────────────────
# Learn from past fetches: remember which domains need auth, which work headless.
# Each entry: {"domain":"x.com","behavior":"auth_required|ok","lastSeen":"ISO","mode":"headless"}
# On next fetch, check learned behavior → skip wasted attempts.

learn_domain() {
  local domain="$1" behavior="$2" mode="$3"
  mkdir -p "$LOG_DIR"
  python3 -c "
import json, datetime, sys
d = {'domain': sys.argv[1], 'behavior': sys.argv[2], 'mode': sys.argv[3],
     'lastSeen': datetime.datetime.utcnow().isoformat() + 'Z'}
print(json.dumps(d))
" "$domain" "$behavior" "$mode" >> "$PINCHTAB_LEARNED" 2>/dev/null
}

# Get most recent learned behavior for a domain
check_domain() {
  local domain="$1"
  [[ ! -f "$PINCHTAB_LEARNED" ]] && return 1
  # Return the most recent entry for this domain
  python3 -c "
import sys, json
domain = sys.argv[1]
last = None
for line in open(sys.argv[2]):
    try:
        d = json.loads(line.strip())
        if d.get('domain') == domain:
            last = d
    except: pass
if last:
    print(last.get('behavior', ''))
else:
    sys.exit(1)
" "$domain" "$PINCHTAB_LEARNED" 2>/dev/null
}

extract_domain() {
  echo "$1" | python3 -c "from urllib.parse import urlparse; import sys; print(urlparse(sys.stdin.read().strip()).netloc)" 2>/dev/null
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

timeout_secs() {
  echo $(( PINCHTAB_TIMEOUT / 1000 ))
}

health_ok() {
  curl -sf --max-time 3 "${PINCHTAB_BASE}/health" >/dev/null 2>&1
}

current_mode() {
  if is_headless; then echo "headless"; else echo "visible"; fi
}

is_headless() {
  if [[ -f "$PINCHTAB_MODE_FILE" ]]; then
    [[ "$(cat "$PINCHTAB_MODE_FILE")" == "true" ]]
  else
    return 0  # default headless
  fi
}

switch_mode() {
  local mode="$1" reason="${2:-manual}"
  local from_mode
  from_mode=$(current_mode)
  log_event "op=mode_switch" "from=$from_mode" "to=$mode" "reason=$reason"
  bash "$SCRIPT_DIR/pinchtab-setup.sh" mode "$mode" >&2
  sleep 2
}

# Open URL in new tab, return tab ID
open_tab() {
  local url="$1"
  local result
  result=$(curl -sf --max-time "$(timeout_secs)" -X POST "${PINCHTAB_BASE}/tab" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"new\",\"url\":\"$url\"}" 2>/dev/null)
  local tab_id
  tab_id=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',d.get('tabId','')))" 2>/dev/null || echo "")
  if [[ -n "$tab_id" ]]; then
    log_event "op=tab_open" "tabId=$tab_id" "url=$url" "result=ok"
  else
    log_event "op=tab_open" "url=$url" "result=failed" "detail=no_tab_id"
  fi
  echo "$tab_id"
}

# Read text from specific tab
read_tab() {
  local tab_id="$1"
  if [[ -n "$tab_id" ]]; then
    curl -sf --max-time "$(timeout_secs)" "${PINCHTAB_BASE}/text?tabId=$tab_id" 2>/dev/null
  else
    curl -sf --max-time "$(timeout_secs)" "${PINCHTAB_BASE}/text" 2>/dev/null
  fi
}

# Close a tab
close_tab() {
  local tab_id="$1"
  [[ -z "$tab_id" ]] && return
  curl -sf --max-time 5 -X POST "${PINCHTAB_BASE}/tab" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"close\",\"tabId\":\"$tab_id\"}" >/dev/null 2>&1
  log_event "op=tab_close" "tabId=$tab_id"
}

# Extract text field from JSON response
extract_text() {
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('text', '') if isinstance(d, dict) else d)
except:
    print(sys.stdin.read())
" 2>/dev/null
}

# Check if content looks like an auth/login page
is_auth_page() {
  local content="$1"
  local count
  count=$(echo "$content" | head -30 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized|create.an.account' || true)
  [[ "$count" -ge 2 ]]
}

# Check if content looks like a restricted/unavailable page (not login, but gated content)
# Catches: Facebook "目前無法查看此內容", short social media restriction pages, etc.
is_content_restricted() {
  local content="$1" url="$2"
  local content_len=${#content}

  # Pattern 1: Known restriction messages (any site)
  local restrict_count
  restrict_count=$(echo "$content" | head -30 | grep -ciE '目前無法查看此內容|此內容目前無法顯示|this content isn.t available|sorry.*this page isn.t available|content.unavailable|you must log in to continue|受限制的內容' || true)
  [[ "$restrict_count" -ge 1 ]] && return 0

  # Pattern 2: Suspiciously short content from social media (< 500 chars = likely restriction page)
  local domain
  domain=$(extract_domain "$url" 2>/dev/null || echo "")
  if echo "$domain" | grep -qiE 'facebook\.com|instagram\.com|threads\.net|x\.com|twitter\.com'; then
    [[ "$content_len" -lt 500 ]] && return 0
  fi

  return 1
}

# Output content with offset + truncation
output_content() {
  local content="$1"
  local total=${#content}

  if [[ $OFFSET -gt 0 ]]; then
    content="${content:$OFFSET}"
    total=${#content}
  fi

  if [[ "$FULL_OUTPUT" == "true" ]] || [[ $total -le $PINCHTAB_MAX_CONTENT ]]; then
    echo "$content"
  else
    echo "$content" | head -c "$PINCHTAB_MAX_CONTENT"
    local remaining=$((total - PINCHTAB_MAX_CONTENT))
    local next_offset=$((OFFSET + PINCHTAB_MAX_CONTENT))
    echo ""
    echo "[... truncated, ${remaining} more chars. Use --offset ${next_offset} to continue]"
  fi
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_status() {
  if ! health_ok; then
    echo "Pinchtab: NOT AVAILABLE"
    echo ""
    echo "To enable, run:"
    echo "  bash scripts/pinchtab-setup.sh start"
    exit 1
  fi

  echo "Pinchtab: AVAILABLE (${PINCHTAB_BASE})"
  echo "Mode: $(current_mode)"

  # List tabs
  local tabs
  tabs=$(curl -sf --max-time 5 "${PINCHTAB_BASE}/tabs" 2>/dev/null)
  if [[ -n "$tabs" ]]; then
    echo "$tabs" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tabs = data if isinstance(data, list) else data.get('tabs', [])
    print(f'Open tabs: {len(tabs)}')
    print()
    for t in tabs[:10]:
        title = (t.get('title', '') or 'Untitled')[:60]
        url = (t.get('url', '') or '')[:80]
        tid = t.get('id', t.get('tabId', ''))
        print(f'  [{str(tid)[:12]}] {title}')
        print(f'  {\" \" * 14}{url}')
    if len(tabs) > 10:
        print(f'  ... and {len(tabs) - 10} more')
except Exception as e:
    print(f'Tab parse error: {e}')
" 2>/dev/null
  fi
}

cmd_fetch() {
  local url="$1"
  if [[ -z "$url" ]]; then
    echo "Usage: pinchtab-fetch.sh fetch <url>" >&2
    exit 1
  fi

  local t0
  t0=$(timer_start)

  if ! health_ok; then
    log_event "op=fetch" "url=$url" "result=error" "detail=pinchtab_unavailable"
    echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
    exit 1
  fi

  # Step 0: Check learned experience for this domain
  local domain
  domain=$(extract_domain "$url")
  local learned
  learned=$(check_domain "$domain" 2>/dev/null || echo "")

  if [[ "$learned" == "auth_required" || "$learned" == "content_restricted" || "$learned" == "needs_visible" ]] && is_headless; then
    # We know this domain needs visible mode — skip wasted headless attempt
    log_event "op=fetch" "url=$url" "detail=learned_skip_headless" "domain=$domain" "learned=$learned"
    echo "Known restricted domain ($domain) — switching to visible mode..." >&2
    switch_mode visible "learned:$domain"
  fi

  # Step 1: Open URL in new tab
  local tab_id
  tab_id=$(open_tab "$url")

  if [[ -z "$tab_id" ]]; then
    # Fallback: navigate in current tab
    log_event "op=fetch" "url=$url" "detail=tab_open_failed_fallback_navigate" "mode=$(current_mode)"
    curl -sf --max-time "$(timeout_secs)" -X POST "${PINCHTAB_BASE}/navigate" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$url\"}" >/dev/null 2>&1
    sleep 3
    local raw
    raw=$(curl -sf --max-time "$(timeout_secs)" "${PINCHTAB_BASE}/text" 2>/dev/null)
    local content
    content=$(echo "$raw" | extract_text)
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=fetch" "url=$url" "result=fallback_ok" "contentLen=${#content}" "durationMs=$ms"
    output_content "$content"
    return
  fi

  # Step 2: Wait for page load
  sleep 3

  # Step 3: Read content from the specific tab
  local raw
  raw=$(read_tab "$tab_id")
  local content
  content=$(echo "$raw" | extract_text)

  if [[ -z "$content" ]]; then
    close_tab "$tab_id"
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=error" "detail=empty_content" "durationMs=$ms" "mode=$(current_mode)"
    echo "Failed to fetch content from: $url" >&2
    exit 1
  fi

  # Step 4: Check for auth
  if is_auth_page "$content"; then
    local auth_snippet
    auth_snippet=$(echo "$content" | head -5 | tr '\n' ' ' | head -c 100)

    if is_headless; then
      # Auto-switch to visible mode + learn for next time
      local ms; ms=$(timer_elapsed "$t0")
      log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=auth_required" "detail=auto_switch_visible" "durationMs=$ms" "mode=headless" "contentLen=${#content}"
      [[ -n "$domain" ]] && learn_domain "$domain" "auth_required" "headless"
      echo "AUTH_REQUIRED — auto-switching to visible mode..." >&2
      close_tab "$tab_id"
      switch_mode visible "auth_required"

      # Re-open URL in visible Chrome
      tab_id=$(open_tab "$url")
      sleep 2

      echo "AUTH_REQUIRED: $url"
      echo "VISIBLE_MODE: Chrome is now open with the page."
      echo "TAB_ID: ${tab_id}"
      echo ""
      echo "Log in to the site, then run:"
      echo "  bash scripts/pinchtab-fetch.sh extract ${tab_id}"
      return
    fi
    # Already visible — just tell user to log in
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=auth_required" "detail=already_visible" "durationMs=$ms" "mode=visible" "contentLen=${#content}"
    echo "AUTH_REQUIRED: $url"
    echo "TAB_ID: ${tab_id}"
    echo ""
    echo "Please log in to the site in the Chrome window, then run:"
    echo "  bash scripts/pinchtab-fetch.sh extract ${tab_id}"
    return
  fi

  # Step 4b: Check for content restriction (gated content, not login page)
  if is_content_restricted "$content" "$url"; then
    if is_headless; then
      # Content restricted in headless — retry with visible (login session may help)
      local ms; ms=$(timer_elapsed "$t0")
      log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=content_restricted" "detail=retry_visible" "durationMs=$ms" "mode=headless" "contentLen=${#content}"
      [[ -n "$domain" ]] && learn_domain "$domain" "content_restricted" "headless"
      echo "Content restricted in headless — retrying in visible mode..." >&2
      close_tab "$tab_id"
      switch_mode visible "content_restricted:$domain"

      # Re-fetch in visible mode
      tab_id=$(open_tab "$url")
      sleep 3
      raw=$(read_tab "$tab_id")
      content=$(echo "$raw" | extract_text)

      if [[ -n "$content" ]] && ! is_content_restricted "$content" "$url" && ! is_auth_page "$content"; then
        # Visible mode worked!
        close_tab "$tab_id"
        ms=$(timer_elapsed "$t0")
        log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=ok" "detail=visible_retry_success" "durationMs=$ms" "mode=visible" "contentLen=${#content}"
        [[ -n "$domain" ]] && learn_domain "$domain" "needs_visible" "visible"
        output_content "$content"
        switch_mode headless "content_restricted_done"
        return
      fi

      # Still restricted in visible — content genuinely unavailable
      close_tab "$tab_id"
      ms=$(timer_elapsed "$t0")
      log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=content_restricted" "detail=genuinely_unavailable" "durationMs=$ms" "mode=visible" "contentLen=${#content}"
      switch_mode headless "content_restricted_failed"
      echo "CONTENT_RESTRICTED: Content unavailable even with login session." >&2
      exit 1
    fi

    # Already visible — content truly restricted
    close_tab "$tab_id"
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=content_restricted" "detail=genuinely_unavailable" "durationMs=$ms" "mode=visible" "contentLen=${#content}"
    echo "CONTENT_RESTRICTED: $url — content is unavailable." >&2
    exit 1
  fi

  # Step 5: Success — output content, learn, and cleanup
  close_tab "$tab_id"
  local ms; ms=$(timer_elapsed "$t0")
  log_event "op=fetch" "url=$url" "tabId=$tab_id" "result=ok" "contentLen=${#content}" "durationMs=$ms" "mode=$(current_mode)"
  # Learn: this domain works in current mode
  [[ -n "$domain" ]] && learn_domain "$domain" "ok" "$(current_mode)"
  output_content "$content"
}

cmd_open() {
  local url="$1"
  if [[ -z "$url" ]]; then
    echo "Usage: pinchtab-fetch.sh open <url>" >&2
    exit 1
  fi

  if ! health_ok; then
    log_event "op=open" "url=$url" "result=error" "detail=pinchtab_unavailable"
    echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
    exit 1
  fi

  # Switch to visible if headless
  if is_headless; then
    echo "Switching to visible mode..." >&2
    switch_mode visible "open_command"
  fi

  local tab_id
  tab_id=$(open_tab "$url")
  log_event "op=open" "url=$url" "tabId=${tab_id:-none}" "result=ok" "mode=visible"

  echo "Opened: $url"
  echo "Tab ID: ${tab_id:-unknown}"
  echo "Mode: visible"
  echo ""
  echo "After done, extract content:"
  echo "  bash scripts/pinchtab-fetch.sh extract ${tab_id:-}"
}

cmd_extract() {
  local tab_id="$1"
  local t0
  t0=$(timer_start)

  if ! health_ok; then
    log_event "op=extract" "tabId=${tab_id:-none}" "result=error" "detail=pinchtab_unavailable"
    echo "Pinchtab not available" >&2
    exit 1
  fi

  # Read content from specific tab (or current)
  local raw
  raw=$(read_tab "$tab_id")
  local content
  content=$(echo "$raw" | extract_text)

  if [[ -z "$content" ]]; then
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=extract" "tabId=${tab_id:-none}" "result=error" "detail=empty_content" "durationMs=$ms"
    echo "Failed to extract content" >&2
    exit 1
  fi

  # Still auth page? Tell user
  if is_auth_page "$content"; then
    local ms; ms=$(timer_elapsed "$t0")
    log_event "op=extract" "tabId=${tab_id:-none}" "result=auth_still_required" "contentLen=${#content}" "durationMs=$ms"
    echo "AUTH_STILL_REQUIRED — page still shows login."
    echo "Please complete login in Chrome, then retry:"
    echo "  bash scripts/pinchtab-fetch.sh extract ${tab_id}"
    return
  fi

  # Success — output content
  local ms; ms=$(timer_elapsed "$t0")
  log_event "op=extract" "tabId=${tab_id:-none}" "result=ok" "contentLen=${#content}" "durationMs=$ms" "mode=$(current_mode)"
  output_content "$content"

  # Auto-cleanup: close tab + switch back to headless
  if [[ -n "$tab_id" ]]; then
    close_tab "$tab_id"
    echo "" >&2
    echo "Tab closed." >&2
  fi
  if ! is_headless; then
    switch_mode headless "extract_complete"
  fi
}

cmd_close() {
  local tab_id="$1"
  if [[ -z "$tab_id" ]]; then
    echo "Usage: pinchtab-fetch.sh close <tabId>" >&2
    exit 1
  fi

  close_tab "$tab_id"
  echo "Closed tab: $tab_id"
}

cmd_repair() {
  local domain="$1"
  if [[ -z "$domain" ]]; then
    # Scan cdp.jsonl for problematic domains
    echo "=== Fetch Health Report ==="
    python3 -c "
import json, sys
from collections import defaultdict

log_file = '$LOG_FILE'
learned_file = '$PINCHTAB_LEARNED'

# Analyze recent fetches
domains = defaultdict(lambda: {'ok': 0, 'restricted': 0, 'fail': 0, 'avg_len': 0, 'total_len': 0})
try:
    with open(log_file) as f:
        for line in f:
            try:
                d = json.loads(line.strip())
                if d.get('op') != 'fetch': continue
                from urllib.parse import urlparse
                dom = urlparse(d.get('url', '')).netloc
                if not dom: continue
                r = d.get('result', '')
                cl = int(d.get('contentLen', 0))
                if r == 'ok':
                    domains[dom]['ok'] += 1
                    domains[dom]['total_len'] += cl
                elif r == 'content_restricted':
                    domains[dom]['restricted'] += 1
                elif r in ('error', 'auth_required'):
                    domains[dom]['fail'] += 1
            except: pass
except: pass

# Report
problems = []
for dom, s in sorted(domains.items()):
    total = s['ok'] + s['restricted'] + s['fail']
    if total == 0: continue
    avg = s['total_len'] // max(s['ok'], 1)
    issues = []
    if s['restricted']: issues.append(f'restricted:{s[\"restricted\"]}')
    if s['fail']: issues.append(f'failed:{s[\"fail\"]}')
    if avg < 500 and s['ok'] > 0: issues.append(f'avg_len:{avg}')
    if issues:
        problems.append(f'  {dom}: {s[\"ok\"]}/{total} success, {', '.join(issues)}')

if problems:
    print('Problematic domains:')
    for p in problems: print(p)
else:
    total_ok = sum(d['ok'] for d in domains.values())
    total = sum(d['ok'] + d['restricted'] + d['fail'] for d in domains.values())
    print(f'All domains healthy ({total_ok}/{total} success)')

# Show current learned behaviors
print()
print('Current learned behaviors:')
try:
    seen = {}
    with open(learned_file) as f:
        for line in f:
            try:
                d = json.loads(line.strip())
                seen[d['domain']] = d
            except: pass
    for dom, d in sorted(seen.items()):
        b = d.get('behavior', '?')
        m = d.get('mode', '?')
        status = '✅' if b == 'ok' else '⚠️' if b == 'needs_visible' else '❌'
        print(f'  {status} {dom}: {b} (mode: {m})')
except: print('  (no learned data)')
" 2>/dev/null
    echo ""
    echo "To repair a domain: bash scripts/pinchtab-fetch.sh repair <domain>"
    return
  fi

  # Fix specific domain
  log_event "op=repair" "domain=$domain"
  learn_domain "$domain" "content_restricted" "headless"
  echo "Repaired: $domain → content_restricted (will use visible mode next time)"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

# Parse flags from any position
FULL_OUTPUT=false
OFFSET=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) FULL_OUTPUT=true ;;
    --offset) OFFSET="${2:-0}"; shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

case "${ARGS[0]:-}" in
  status)   cmd_status ;;
  fetch)    cmd_fetch "${ARGS[1]:-}" ;;
  open)     cmd_open "${ARGS[1]:-}" ;;
  extract)  cmd_extract "${ARGS[1]:-}" ;;
  close)    cmd_close "${ARGS[1]:-}" ;;
  repair)   cmd_repair "${ARGS[1]:-}" ;;
  *)
    echo "pinchtab-fetch — Smart browser content fetcher via Pinchtab"
    echo ""
    echo "Commands:"
    echo "  status                     Check Pinchtab availability + mode"
    echo "  fetch <url>                Smart fetch (auto tab, auth detection, mode switch)"
    echo "  fetch <url> --full         Fetch full content (no truncation)"
    echo "  fetch <url> --offset N     Skip first N chars (continue reading)"
    echo "  open <url>                 Open in visible Chrome (auto-switch mode)"
    echo "  extract [tabId]            Extract content (auto-switch back to headless)"
    echo "  close <tabId>              Close a tab"
    echo ""
    echo "All operations logged to: $LOG_FILE"
    echo ""
    echo "Environment:"
    echo "  PINCHTAB_PORT=9867          API port"
    echo "  PINCHTAB_TIMEOUT=15000      Command timeout (ms)"
    echo "  PINCHTAB_MAX_CONTENT=8000   Max content chars"
    ;;
esac
