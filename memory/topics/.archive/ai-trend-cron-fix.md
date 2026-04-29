# ai-trend-cron-fix

- [2026-04-28] [2026-04-28 12:42 cl] **Cron enricher order swapped — P0 final piece SHIPPED**

**Mechanism diagnosed**: `enrich-remote.mjs` exits 0 even when all 20 fail on credit error (logs each fail, doesn't propagate non-zero exit). Cron's `&&...||...` chain treats it as success → fallback to local never fires → daily files stay un-enriched until I manually intervene.

**Fix**: Crontab swap, local first, remote fallback (1-line, fully reversible, backup `/tmp/crontab.bak.1777351200`):
```
( /opt/homebrew/
