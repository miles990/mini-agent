#!/bin/bash
# Focus Context — Active Application Perception
# Detects what application Alex is currently using
# stdout → <focus>...</focus> XML tag in Agent context
# Category: workspace (30s refresh with distinctUntilChanged)

# Get frontmost application
FRONT_APP=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)

if [ -z "$FRONT_APP" ]; then
  echo "Unable to detect active app (Accessibility permission needed?)"
  exit 0
fi

# Get window title (often contains file path, URL, or document name)
WINDOW_TITLE=$(osascript -e 'tell application "System Events" to get title of front window of first application process whose frontmost is true' 2>/dev/null)

# Get idle time (seconds since last user input)
IDLE_SECS=$(osascript -e 'tell application "System Events" to get (do shell script "ioreg -c IOHIDSystem | awk '\''/HIDIdleTime/ {print int($NF/1000000000)}'\''")')

echo "Active app: $FRONT_APP"
[ -n "$WINDOW_TITLE" ] && [ "$WINDOW_TITLE" != "" ] && echo "Window: $WINDOW_TITLE"

# Idle status
if [ -n "$IDLE_SECS" ] && [ "$IDLE_SECS" != "" ]; then
  if [ "$IDLE_SECS" -gt 600 ]; then
    echo "Idle: $(( IDLE_SECS / 60 ))m (away from keyboard)"
  elif [ "$IDLE_SECS" -gt 60 ]; then
    echo "Idle: $(( IDLE_SECS / 60 ))m"
  fi
fi
