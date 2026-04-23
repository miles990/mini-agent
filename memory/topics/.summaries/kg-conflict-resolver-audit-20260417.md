<!-- Auto-generated summary — 2026-04-23 -->
# kg-conflict-resolver-audit-20260417

The conflict resolver audit found 100% outcome correctness across 23 resolved conflicts but identified a structural gap: unclear-signal cases lack explicit R-default/R-fallback paths and inherit the nearest rule label, causing mislabelings in edge cases like HEARTBEAT and PERCEPTION (91% label correctness). This reveals that resolver accuracy is outcome-driven but classification semantics break down at boundaries where default behavior isn't explicitly specified.
