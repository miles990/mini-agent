<!-- Auto-generated summary — 2026-04-24 -->
# omlx-usage

OMLX deploys 7 small-language-model services across triage, memory, and delegation with a 45% fallback rate from 3-second timeouts (since fixed via timeout tuning). Unoptimized opportunities in Sonnet routing and context caching can deliver ~78% token savings through a three-layer architecture: classification-first triage, entry-level relevance scoring, and 6-hour hash-based caching.
