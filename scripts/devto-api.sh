#!/bin/bash
# Dev.to API 工具 — 取代 CDP 瀏覽器操作
# Usage:
#   devto-api.sh publish <markdown-file> [--draft]
#   devto-api.sh update <article-id> <markdown-file>
#   devto-api.sh list [--per-page N]
#   devto-api.sh get <article-id>

set -euo pipefail

API="https://dev.to/api"

ensure_api_key() {
  if [ -z "${DEV_TO_API_KEY:-}" ]; then
    ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
    if [ -f "$ENV_FILE" ]; then
      DEV_TO_API_KEY=$(grep '^DEV_TO_API_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d "'\"" || true)
    fi
  fi
  if [ -z "${DEV_TO_API_KEY:-}" ]; then
    echo "ERROR: DEV_TO_API_KEY not set. Add to .env or export it." >&2
    exit 1
  fi
  export DEV_TO_API_KEY
}

# Extract body (everything after second ---)
extract_body() {
  local file="$1"
  awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$file"
}

check_cadence_gate() {
  # Hard gate: ≤2 published articles per 7 days
  # 3x violation data: 3/26(4), 3/31(5), 4/4(5) all → zero engagement
  local count
  count=$(curl -sf "https://dev.to/api/articles?username=kuro_agent&per_page=15" | python3 -c "
import json, sys
from datetime import datetime, timedelta, timezone
cutoff = datetime.now(timezone.utc) - timedelta(days=7)
articles = json.load(sys.stdin)
recent = [a for a in articles if datetime.fromisoformat(a['published_at'].replace('Z','+00:00')) > cutoff]
print(len(recent))
" 2>/dev/null || echo "0")

  if [ "$count" -ge 2 ]; then
    echo "⛔ CADENCE GATE: $count articles in last 7 days (limit: 2)." >&2
    echo "   Data shows 5/day → zero engagement. Use --force to override." >&2
    return 1
  fi
  echo "✅ Cadence OK: $count/2 articles this week" >&2
  return 0
}

cmd_publish() {
  ensure_api_key
  local file="$1"
  local draft="${2:-false}"

  if [ ! -f "$file" ]; then
    echo "ERROR: File not found: $file" >&2
    exit 1
  fi

  # Cadence gate (skip for drafts, override with --force)
  if [ "$draft" != "--draft" ] && [ "$draft" != "--force" ]; then
    if ! check_cadence_gate; then
      exit 1
    fi
  fi

  local first_line
  first_line=$(head -1 "$file")

  local published="True"
  [ "$draft" = "--draft" ] && published="False"

  local body=""
  if [ "$first_line" = "---" ]; then
    body=$(extract_body "$file")
  else
    body=$(cat "$file")
  fi

  # Use python3 for safe JSON construction + frontmatter parsing
  local response
  response=$(python3 -c "
import json, sys, re

content = open('$file', encoding='utf-8').read()
first_line = content.split('\n')[0].strip()

title = ''
tags = []
series = ''
body = content

if first_line == '---':
    parts = content.split('---', 2)
    if len(parts) >= 3:
        fm = parts[1]
        body = parts[2].strip()
        for line in fm.strip().split('\n'):
            if line.startswith('title:'):
                title = line[6:].strip()
            elif line.startswith('tags:'):
                tags = [t.strip() for t in line[5:].split(',')]
            elif line.startswith('series:'):
                series = line[7:].strip()

if not title:
    import os
    title = os.path.splitext(os.path.basename('$file'))[0].replace('-', ' ')

article = {
    'title': title,
    'body_markdown': body,
    'published': $published
}
if tags:
    article['tags'] = tags
if series:
    article['series'] = series

print(json.dumps({'article': article}, ensure_ascii=False))
" 2>&1)

  local result
  result=$(curl -sS -w "\n%{http_code}" "$API/articles" \
    -H "api-key: $DEV_TO_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$response")

  local http_code resp_body
  http_code=$(echo "$result" | tail -1)
  resp_body=$(echo "$result" | sed '$d')

  if [ "$http_code" = "201" ]; then
    echo "$resp_body" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Published! ID: {d[\"id\"]}')
print(f'URL: {d[\"url\"]}')
"
  else
    echo "ERROR: HTTP $http_code" >&2
    echo "$resp_body" | python3 -m json.tool 2>/dev/null || echo "$resp_body" >&2
    exit 1
  fi
}

cmd_update() {
  ensure_api_key
  local article_id="$1"
  local file="$2"

  if [ ! -f "$file" ]; then
    echo "ERROR: File not found: $file" >&2
    exit 1
  fi

  # Always send body_markdown (Dev.to clears body if omitted)
  local payload
  payload=$(python3 -c "
import json, sys

content = open('$file', encoding='utf-8').read()
first_line = content.split('\n')[0].strip()

title = ''
tags = []
series = ''
body = content

if first_line == '---':
    parts = content.split('---', 2)
    if len(parts) >= 3:
        fm = parts[1]
        body = parts[2].strip()
        for line in fm.strip().split('\n'):
            if line.startswith('title:'):
                title = line[6:].strip()
            elif line.startswith('tags:'):
                tags = [t.strip() for t in line[5:].split(',')]
            elif line.startswith('series:'):
                series = line[7:].strip()

article = {'body_markdown': body}
if title:
    article['title'] = title
if tags:
    article['tags'] = tags
if series:
    article['series'] = series

print(json.dumps({'article': article}, ensure_ascii=False))
" 2>&1)

  local result
  result=$(curl -sS -w "\n%{http_code}" -X PUT "$API/articles/$article_id" \
    -H "api-key: $DEV_TO_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$payload")

  local http_code resp_body
  http_code=$(echo "$result" | tail -1)
  resp_body=$(echo "$result" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo "Updated article $article_id"
    echo "$resp_body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'URL: {d[\"url\"]}')"
  else
    echo "ERROR: HTTP $http_code" >&2
    echo "$resp_body" | python3 -m json.tool 2>/dev/null || echo "$resp_body" >&2
    exit 1
  fi
}

cmd_list() {
  ensure_api_key
  local per_page="${1:-10}"

  curl -sS "$API/articles/me?per_page=$per_page" \
    -H "api-key: $DEV_TO_API_KEY" | \
    python3 -c "
import json, sys
articles = json.load(sys.stdin)
for a in articles:
    status = 'published' if a['published'] else 'draft'
    print(f'[{a[\"id\"]}] {status} | {a[\"title\"]}')
    print(f'  URL: {a[\"url\"]}')
    print(f'  Reactions: {a.get(\"positive_reactions_count\", 0)} | Comments: {a.get(\"comments_count\", 0)}')
    print()
"
}

cmd_get() {
  ensure_api_key
  local article_id="$1"
  curl -sS "$API/articles/$article_id" \
    -H "api-key: $DEV_TO_API_KEY" | \
    python3 -m json.tool
}

cmd_comment() {
  ensure_api_key
  local article_id="$1"
  local body="$2"
  local parent_id="${3:-}"

  if [ -z "$article_id" ] || [ -z "$body" ]; then
    echo "ERROR: Usage: $0 comment <article-id> <body-text> [parent-comment-id]" >&2
    exit 1
  fi

  # Write body to temp file for safe Python ingestion
  local tmpbody
  tmpbody=$(mktemp)
  printf '%s' "$body" > "$tmpbody"
  trap "rm -f '$tmpbody'" EXIT

  # Dedup check: fetch existing comments and look for near-duplicate by same user
  local existing_file
  existing_file=$(mktemp)
  curl -sS "$API/comments?a_id=$article_id&per_page=100" \
    -H "api-key: $DEV_TO_API_KEY" > "$existing_file"

  local dup_found
  dup_found=$(python3 -c "
import json, sys, os
with open('$existing_file') as f:
    data = json.load(f)
with open('$tmpbody') as f:
    body = f.read()[:80].lower()
for c in (data if isinstance(data, list) else []):
    u = (c.get('user') or {}).get('name','').lower()
    if 'kuro' in u:
        existing_body = (c.get('body_html','') or '')[:200].lower()
        if body[:40] in existing_body:
            print(f'DUPLICATE: {c.get(\"id_code\",\"?\")}')
            sys.exit(0)
print('OK')
" 2>/dev/null || echo "OK")
  rm -f "$existing_file"

  if [[ "$dup_found" == DUPLICATE* ]]; then
    echo "WARN: Similar comment already exists ($dup_found). Skipping." >&2
    exit 0
  fi

  # Build payload using temp file for body
  local payload
  payload=$(python3 -c "
import json
with open('$tmpbody') as f:
    body = f.read()
comment = {
    'body_markdown': body,
    'commentable_id': $article_id,
    'commentable_type': 'Article'
}
parent = '$parent_id'
if parent:
    comment['parent_id'] = parent
print(json.dumps({'comment': comment}, ensure_ascii=False))
")

  local result
  result=$(curl -sS -w "\n%{http_code}" "$API/comments" \
    -H "api-key: $DEV_TO_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$payload")

  local http_code resp_body
  http_code=$(echo "$result" | tail -1)
  resp_body=$(echo "$result" | sed '$d')

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "$resp_body" | python3 -c "
import json, sys
d = json.load(sys.stdin)
cid = d.get('id_code', '?')
print(f'Comment posted! ID: {cid}')
print(f'URL: https://dev.to/kuro_agent/comment/{cid}')
"
  else
    echo "ERROR: HTTP $http_code" >&2
    echo "$resp_body" | python3 -m json.tool 2>/dev/null || echo "$resp_body" >&2
    exit 1
  fi
}

cmd_comments() {
  ensure_api_key
  local article_id="$1"

  if [ -z "$article_id" ]; then
    echo "ERROR: Usage: $0 comments <article-id>" >&2
    exit 1
  fi

  curl -sS "$API/comments?a_id=$article_id&per_page=50" \
    -H "api-key: $DEV_TO_API_KEY" | \
    python3 -c "
import json, sys
data = json.load(sys.stdin)
if not isinstance(data, list):
    print('No comments or invalid response')
    sys.exit(0)

total = 0
def walk(comments, depth=0):
    global total
    for c in comments:
        total += 1
        u = c.get('user',{}).get('name','unknown')
        cid = c.get('id_code','?')
        body = c.get('body_html','')[:100].replace('\n',' ')
        indent = '  ' * depth
        marker = '└─ ' if depth > 0 else ''
        print(f'{indent}{marker}[{cid}] {u}: {body}')
        children = c.get('children') or []
        if children:
            walk(children, depth + 1)

walk(data)
print(f'\nTotal: {total} comments (incl. nested replies)')
"
}

# Main
case "${1:-help}" in
  publish)
    shift
    cmd_publish "$1" "${2:-}"
    ;;
  update)
    shift
    cmd_update "$1" "$2"
    ;;
  list)
    shift || true
    cmd_list "${1:-10}"
    ;;
  get)
    shift
    cmd_get "$1"
    ;;
  comment)
    shift
    cmd_comment "$1" "$2" "${3:-}"
    ;;
  comments)
    shift
    cmd_comments "$1"
    ;;
  help|*)
    echo "Dev.to API Tool"
    echo ""
    echo "Usage:"
    echo "  $0 publish <markdown-file> [--draft]    Create article"
    echo "  $0 update <article-id> <markdown-file>  Update article"
    echo "  $0 list [per-page]                      List my articles"
    echo "  $0 get <article-id>                     Get article details"
    echo "  $0 comment <article-id> <body> [parent]  Post a comment"
    echo "  $0 comments <article-id>                 List article comments"
    echo ""
    echo "Markdown files can have frontmatter:"
    echo "  ---"
    echo "  title: My Article"
    echo "  tags: ai, agent, tutorial"
    echo "  series: Perception-First Thinking"
    echo "  ---"
    echo "  Article body here..."
    echo ""
    echo "Requires DEV_TO_API_KEY in .env or environment."
    ;;
esac
