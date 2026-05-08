---
date: YYYY-MM-DD
author: kuro
purpose: Daily hand-written content for ai-trend v3 generator
schema_version: 1
---

<!-- ============================================================
  ai-trend daily content template
  Usage: copy to memory/state/kuro-content/YYYY-MM-DD.md
         fill in each section below
         run: node scripts/build-ai-trend-preview.mjs YYYY-MM-DD
  ============================================================ -->

## kuro-take
<!-- Block ① — Kuro's daily editorial take on the AI trend stream.
     Write 1–3 paragraphs. Use [text](url) for inline links.
     Each paragraph becomes a <p> in the .take section.
     Leave this section empty → generator emits a placeholder banner. -->

① **headline of first observation** — brief one-liner. [source name](https://url)
   refs: src-id-1, src-id-2

② **headline of second observation** — brief one-liner.
   refs: src-id-3

## github-spotlight
<!-- Block ③ — One GitHub project spotlight.
     Fields below are all optional; missing fields are omitted gracefully.
     repo: must be owner/repo format.
     why-good / risk / paths: use hyphen-list items. -->
repo: owner/repo-name
license: MIT
version: v0.0.0
why-it-matters: One paragraph explaining why this project matters today.
why-good:
- First reason it's good
- Second reason it's good
risk:
- Known risk or limitation
paths:
- Path 1 (label) — shipped <commit-sha>
- Path 2 (label) — pending
- Path 3 (label) — pending

## swot
<!-- Block ④ — SWOT analysis: Kuro vs today's AI information flow.
     Each dimension is a hyphen-list. Use plain text (no markdown links here). -->
strengths:
- Strength bullet one
- Strength bullet two
weaknesses:
- Weakness bullet one
opportunities:
- Opportunity bullet one
threats:
- Threat bullet one
