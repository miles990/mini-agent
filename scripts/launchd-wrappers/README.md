# launchd wrappers for daily trend scripts

## Why launchd instead of cron

macOS cron does **not** run missed jobs upon wake from sleep. If the mac is
asleep at 09:00 when `hn-ai-trend` is scheduled, cron silently skips and the
data file for that day never gets produced (verified 2026-05-04 ~ 2026-05-05).

`launchd` with `StartCalendarInterval` **does** run missed jobs upon wake —
this is the documented behavior for `LaunchAgents`. Source:
<https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html>

## Install

```sh
cp scripts/launchd-wrappers/com.kuro.hn-ai-trend.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.kuro.hn-ai-trend.plist
```

Then comment out the corresponding line in `crontab -e` to avoid double-firing.

## Test

```sh
launchctl start com.kuro.hn-ai-trend
tail -f memory/logs/hn-trend-launchd.log
```

## Uninstall

```sh
launchctl unload -w ~/Library/LaunchAgents/com.kuro.hn-ai-trend.plist
rm ~/Library/LaunchAgents/com.kuro.hn-ai-trend.plist
```

## Migration status (2026-05-05)

| script | crontab | launchd | done |
|---|---|---|---|
| hn-ai-trend       | commented | com.kuro.hn-ai-trend       | ✅ |
| latent-space-trend | active   | -                          | TODO |
| arxiv-ai-trend    | active   | -                          | TODO |
| github-ai-trend   | active   | -                          | TODO |
| build-ai-trend-index | active | -                         | TODO (depends on the four above) |
| kuro-daily-pick   | active   | -                          | TODO |

After a day of observation: if `hn-ai-trend` 09:00 launchd run produces
`memory/state/hn-ai-trend/2026-05-06.json` with mtime 09:00:xx (regardless of
whether mac was asleep at 09:00), migrate the rest.
