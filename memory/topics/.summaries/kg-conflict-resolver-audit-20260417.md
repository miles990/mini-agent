<!-- Auto-generated summary — 2026-04-16 -->
# kg-conflict-resolver-audit-20260417

The conflict resolver achieves 100% outcome correctness but 91% rule-label accuracy; two mislabels (#9 HEARTBEAT, #16 PERCEPTION) stem from unclear-signal cases inheriting the nearest rule label due to missing explicit default/fallback paths. The structural finding reveals the resolver lacks a defined R-default/R-fallback mechanism, causing ambiguous cases to default to whichever named rule is closest rather than a designated fallback category.
