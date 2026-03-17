#!/bin/bash
# Check kuro.ai.agent@gmail.com inbox via CDP (account slot /u/1/)
# Focus: Teaching Monster competition emails
# Cron: every 6h (0 10,16 * * *)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"

result=$(node "$CDP_FETCH" fetch "https://mail.google.com/mail/u/1/" 2>&1)

# Verify correct account
if ! echo "$result" | grep -qi "kuro.ai.agent"; then
  echo "<email-inbox account=\"kuro.ai.agent@gmail.com\" status=\"wrong-account\">"
  echo "Account slot /u/1/ is not kuro.ai.agent@gmail.com. Check manually."
  echo "</email-inbox>"
  exit 0
fi

echo "<email-inbox account=\"kuro.ai.agent@gmail.com\">"
# Extract subject lines (first 20 emails)
echo "$result" | head -80
echo "</email-inbox>"
