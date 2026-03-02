#!/usr/bin/env bash
# Gmail IMAP access tool for Kuro
# Usage: email.sh check | read <uid> | headers [count] | search <query>
#
# Requires: GMAIL_APP_PASSWORD env var (Google App Password)
# Gmail user: kuro.ai.agent@gmail.com

set -euo pipefail

GMAIL_USER="kuro.ai.agent@gmail.com"
GMAIL_PASS="${GMAIL_APP_PASSWORD:-}"
IMAP_URL="imaps://imap.gmail.com:993"

if [[ -z "$GMAIL_PASS" ]]; then
  echo "ERROR: GMAIL_APP_PASSWORD not set. Generate one at https://myaccount.google.com/apppasswords" >&2
  exit 1
fi

cmd="${1:-check}"
shift 2>/dev/null || true

imap_cmd() {
  curl -s --max-time 15 \
    --url "$IMAP_URL/$1" \
    --user "$GMAIL_USER:$GMAIL_PASS" \
    "${@:2}"
}

case "$cmd" in
  check)
    # Return unseen message UIDs
    result=$(imap_cmd "INBOX" -X "SEARCH UNSEEN" 2>&1)
    if echo "$result" | grep -q "SEARCH"; then
      uids=$(echo "$result" | grep "SEARCH" | sed 's/.*SEARCH//' | tr -s ' ')
      count=$(echo "$uids" | wc -w | tr -d ' ')
      echo "Unread: $count"
      [[ "$count" -gt 0 ]] && echo "UIDs:$uids"
    else
      echo "ERROR: $result" >&2
      exit 1
    fi
    ;;

  headers)
    # Fetch recent message headers (default: 5)
    limit="${1:-5}"
    # Get latest UIDs
    result=$(imap_cmd "INBOX" -X "SEARCH ALL" 2>&1)
    uids=$(echo "$result" | grep "SEARCH" | sed 's/.*SEARCH//' | tr -s ' ' '\n' | tail -"$limit" | tac)
    for uid in $uids; do
      header=$(imap_cmd "INBOX;UID=$uid;SECTION=HEADER.FIELDS%20(FROM%20SUBJECT%20DATE)" 2>&1)
      echo "--- UID $uid ---"
      echo "$header" | grep -iE "^(From|Subject|Date):" | head -3
      echo ""
    done
    ;;

  read)
    # Read a specific message by UID
    uid="${1:?Usage: email.sh read <uid>}"
    imap_cmd "INBOX;UID=$uid"
    ;;

  search)
    # Search messages
    query="${1:?Usage: email.sh search <query>}"
    imap_cmd "INBOX" -X "SEARCH SUBJECT \"$query\""
    ;;

  *)
    echo "Usage: email.sh check|headers [count]|read <uid>|search <query>"
    exit 1
    ;;
esac
