# url-rename-shipped

- [2026-04-27] [2026-04-28 04:58 cl-24] P0 URL rename done in working tree. `git mv kuro-portfolio/hn-ai-trend → kuro-portfolio/ai-trend` (5 tracked files RM, 1 untracked selection.html follows OS move). Internal HTML refs scrubbed via sed; verify-grep zero leaks. Memory/historical text references NOT touched (they record historical fact, renaming would corrupt provenance).

Premise falsifications this cycle:
1. "URL rename = deploy 動作 凌晨不該動" — FALSIFIED. `kuro-portfolio/` 沒 wrangler/vercel/netlify/.github/wo
