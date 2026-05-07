#!/bin/bash
# Check Kuro Gmail inbox via CDP (account slot /u/1/)
# Focus: Teaching Monster competition emails
# Cron: every 6h (0 10,16 * * *)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"
KURO_EMAIL="${KURO_GMAIL_USER:-${KURO_GOOGLE_EMAIL:-kuro.ai.agent@gmail.com}}"
KURO_EMAIL_PREFIX="${KURO_EMAIL%@*}"

result=$(node "$CDP_FETCH" fetch "https://mail.google.com/mail/u/1/" 2>&1)

# Verify correct account
if ! echo "$result" | grep -qi "$KURO_EMAIL_PREFIX"; then
  echo "<email-inbox account=\"$KURO_EMAIL\" status=\"wrong-account\">"
  echo "Account slot /u/1/ is not $KURO_EMAIL. Check manually."
  echo "</email-inbox>"
  exit 0
fi

echo "<email-inbox account=\"$KURO_EMAIL\">"
# Extract subject lines (first 20 emails)
echo "$result" | head -80
echo "</email-inbox>"
