#!/bin/bash
# Pinchtab Interact — Browser interaction via Pinchtab accessibility tree
#
# Drop-in replacement for cdp-interact.mjs.
# Uses a11y tree refs (e0, e1...) instead of CSS selectors.
#
# Usage:
#   bash scripts/pinchtab-interact.sh click <selector>           # Click element
#   bash scripts/pinchtab-interact.sh click-text <text>          # Click by text
#   bash scripts/pinchtab-interact.sh type <selector> <text>     # Type into input
#   bash scripts/pinchtab-interact.sh scroll [pixels]            # Scroll down
#   bash scripts/pinchtab-interact.sh eval <expression>          # Evaluate JS
#   bash scripts/pinchtab-interact.sh screenshot [path]          # Screenshot
#   bash scripts/pinchtab-interact.sh list-inputs                # List interactive elements
#   bash scripts/pinchtab-interact.sh fill-form <json>           # Fill form fields

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:${PINCHTAB_PORT}"
LOG_DIR="$HOME/.mini-agent"
LOG_FILE="$LOG_DIR/cdp.jsonl"

# ─── Helpers ──────────────────────────────────────────────────────────────────

log_op() {
  mkdir -p "$LOG_DIR"
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"op\":\"interact.$1\"}" >> "$LOG_FILE" 2>/dev/null
}

health_ok() {
  curl -sf --max-time 3 "${PINCHTAB_BASE}/health" >/dev/null 2>&1
}

require_pinchtab() {
  if ! health_ok; then
    echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
    exit 1
  fi
}

# Find a11y ref by text content from snapshot
find_ref_by_text() {
  local text="$1"
  curl -sf --max-time 10 "${PINCHTAB_BASE}/snapshot?filter=interactive&format=compact" 2>/dev/null \
    | python3 -c "
import sys, json
text = '$text'
try:
    data = json.load(sys.stdin)
    items = data if isinstance(data, list) else data.get('items', data.get('elements', []))
    for item in items:
        name = item.get('name', '') or item.get('text', '') or ''
        if text.lower() in name.lower():
            print(item.get('ref', ''))
            sys.exit(0)
    print('')
except:
    print('')
" 2>/dev/null
}

# Find a11y ref by CSS-like selector hint (best effort matching)
find_ref_by_selector() {
  local selector="$1"
  curl -sf --max-time 10 "${PINCHTAB_BASE}/snapshot?filter=interactive&format=compact" 2>/dev/null \
    | python3 -c "
import sys, json, re
selector = '$selector'
try:
    data = json.load(sys.stdin)
    items = data if isinstance(data, list) else data.get('items', data.get('elements', []))

    # Try matching by various attributes
    for item in items:
        ref = item.get('ref', '')
        role = item.get('role', '')
        name = item.get('name', '') or ''
        tag = item.get('tag', '') or ''

        # Direct ref match (e.g., 'e0', 'e1')
        if selector == ref:
            print(ref)
            sys.exit(0)

        # ID selector
        if selector.startswith('#'):
            sid = selector[1:]
            if item.get('id') == sid or sid in name:
                print(ref)
                sys.exit(0)

        # Tag + attribute selector
        if '[name=' in selector:
            m = re.search(r'\[name=[\"\\']?(.*?)[\"\\']?\]', selector)
            if m and item.get('name') == m.group(1):
                print(ref)
                sys.exit(0)

        # Simple tag match
        if selector in (tag, role):
            print(ref)
            sys.exit(0)

    # Fallback: first match
    if items:
        print(items[0].get('ref', ''))
    else:
        print('')
except:
    print('')
" 2>/dev/null
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_click() {
  local selector="$1"
  require_pinchtab
  log_op "click"

  local ref
  ref=$(find_ref_by_selector "$selector")
  if [[ -z "$ref" ]]; then
    echo "Element not found: $selector" >&2
    exit 1
  fi

  curl -sf --max-time 10 -X POST "${PINCHTAB_BASE}/action" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"click\",\"ref\":\"$ref\"}" >/dev/null 2>&1

  echo "Clicked: $ref (matched: $selector)"
}

cmd_click_text() {
  local text="$1"
  require_pinchtab
  log_op "click-text"

  local ref
  ref=$(find_ref_by_text "$text")
  if [[ -z "$ref" ]]; then
    echo "No element with text: $text" >&2
    exit 1
  fi

  curl -sf --max-time 10 -X POST "${PINCHTAB_BASE}/action" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"click\",\"ref\":\"$ref\"}" >/dev/null 2>&1

  echo "Clicked: $ref (text: $text)"
}

cmd_type() {
  local selector="$1"
  local text="$2"
  require_pinchtab
  log_op "type"

  local ref
  ref=$(find_ref_by_selector "$selector")
  if [[ -z "$ref" ]]; then
    echo "Element not found: $selector" >&2
    exit 1
  fi

  curl -sf --max-time 10 -X POST "${PINCHTAB_BASE}/action" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"fill\",\"ref\":\"$ref\",\"value\":$(python3 -c "import json; print(json.dumps('$text'))" 2>/dev/null || echo "\"$text\"")}" >/dev/null 2>&1

  echo "Typed ${#text} chars into $ref (matched: $selector)"
}

cmd_scroll() {
  local pixels="${1:-500}"
  require_pinchtab
  log_op "scroll"

  curl -sf --max-time 10 -X POST "${PINCHTAB_BASE}/action" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"scroll\",\"deltaY\":$pixels}" >/dev/null 2>&1

  echo "Scrolled ${pixels}px"
}

cmd_eval() {
  local expression="$1"
  require_pinchtab
  log_op "eval"

  local result
  result=$(curl -sf --max-time 15 -X POST "${PINCHTAB_BASE}/evaluate" \
    -H "Content-Type: application/json" \
    -d "{\"expression\":$(python3 -c "import json; print(json.dumps('''$expression'''))" 2>/dev/null || echo "\"$expression\"")}" 2>/dev/null)

  echo "$result" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    val = d.get('result', d.get('value', d))
    if isinstance(val, (dict, list)):
        print(json.dumps(val, indent=2))
    else:
        print(val)
except:
    print(sys.stdin.read() if hasattr(sys.stdin, 'read') else '')
" 2>/dev/null || echo "$result"
}

cmd_screenshot() {
  local out_path="${1:-/tmp/pinchtab-screenshot.jpg}"
  require_pinchtab
  log_op "screenshot"

  curl -sf --max-time 15 "${PINCHTAB_BASE}/screenshot" -o "$out_path" 2>/dev/null

  if [[ -f "$out_path" ]] && [[ -s "$out_path" ]]; then
    echo "Screenshot saved: $out_path"
  else
    echo "Screenshot failed" >&2
    exit 1
  fi
}

cmd_list_inputs() {
  require_pinchtab
  log_op "list-inputs"

  local snapshot
  snapshot=$(curl -sf --max-time 10 "${PINCHTAB_BASE}/snapshot?filter=interactive&format=compact" 2>/dev/null)

  if [[ -z "$snapshot" ]]; then
    echo "No interactive elements found"
    return
  fi

  echo "$snapshot" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data if isinstance(data, list) else data.get('items', data.get('elements', []))
    print(f'Found {len(items)} interactive elements:\n')
    for item in items:
        ref = item.get('ref', '?')
        role = item.get('role', '')
        name = item.get('name', '') or ''
        tag = item.get('tag', '') or ''
        if role in ('button', 'link'):
            print(f'  [{ref}] [{role.upper()}] \"{name[:50]}\"')
        else:
            ph = f' ({name[:40]})' if name else ''
            print(f'  [{ref}] [{role or tag}]{ph}')
except Exception as e:
    print(f'Parse error: {e}')
" 2>/dev/null
}

cmd_fill_form() {
  local json_str="$1"
  require_pinchtab
  log_op "fill-form"

  echo "$json_str" | python3 -c "
import sys, json, subprocess

fields = json.load(sys.stdin)
base = '${PINCHTAB_BASE}'

for selector, value in fields.items():
    # Try to find ref (simplified — use first matching element)
    try:
        import urllib.request
        snap = json.loads(urllib.request.urlopen(f'{base}/snapshot?filter=interactive&format=compact', timeout=10).read())
        items = snap if isinstance(snap, list) else snap.get('items', snap.get('elements', []))
        ref = None
        for item in items:
            if selector.startswith('#') and item.get('id') == selector[1:]:
                ref = item.get('ref')
                break
            if item.get('name') == selector.lstrip('#'):
                ref = item.get('ref')
                break
        if not ref and items:
            ref = items[0].get('ref')

        if ref:
            import urllib.request
            req = urllib.request.Request(
                f'{base}/action',
                data=json.dumps({'kind': 'fill', 'ref': ref, 'value': str(value)}).encode(),
                headers={'Content-Type': 'application/json'}
            )
            urllib.request.urlopen(req, timeout=10)
            print(f'  ✓ {selector} = \"{str(value)[:50]}\"')
        else:
            print(f'  ✗ {selector}: element not found')
    except Exception as e:
        print(f'  ✗ {selector}: {e}')

print(f'\nFilled {len(fields)} fields.')
" 2>/dev/null
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  click)
    [[ -z "$2" ]] && { echo "Usage: pinchtab-interact.sh click <selector>" >&2; exit 1; }
    cmd_click "$2" ;;
  click-text)
    [[ -z "$2" ]] && { echo "Usage: pinchtab-interact.sh click-text <text>" >&2; exit 1; }
    cmd_click_text "$2" ;;
  type)
    [[ -z "$2" || -z "$3" ]] && { echo "Usage: pinchtab-interact.sh type <selector> <text>" >&2; exit 1; }
    cmd_type "$2" "${*:3}" ;;
  scroll)
    cmd_scroll "$2" ;;
  eval)
    [[ -z "$2" ]] && { echo "Usage: pinchtab-interact.sh eval <expression>" >&2; exit 1; }
    cmd_eval "${*:2}" ;;
  screenshot)
    cmd_screenshot "$2" ;;
  list-inputs)
    cmd_list_inputs ;;
  fill-form)
    [[ -z "$2" ]] && { echo "Usage: pinchtab-interact.sh fill-form '{\"selector\":\"value\"}'" >&2; exit 1; }
    cmd_fill_form "${*:2}" ;;
  *)
    echo "pinchtab-interact — Browser interaction via Pinchtab a11y tree"
    echo ""
    echo "Commands:"
    echo "  click <selector>           Click element (CSS selector → a11y ref)"
    echo "  click-text <text>          Click element containing text"
    echo "  type <selector> <text>     Type into input field"
    echo "  scroll [pixels]            Scroll down (default 500)"
    echo "  eval <expression>          Evaluate JS in page context"
    echo "  screenshot [path]          Capture screenshot (JPEG)"
    echo "  list-inputs                List interactive elements"
    echo "  fill-form <json>           Fill multiple fields"
    echo ""
    echo "Note: Uses Pinchtab a11y tree refs internally."
    echo "CSS selectors are best-effort matched to a11y refs."
    ;;
esac
