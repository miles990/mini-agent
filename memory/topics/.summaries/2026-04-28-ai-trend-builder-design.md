<!-- Auto-generated summary — 2026-04-27 -->
# 2026-04-28-ai-trend-builder-design

This design refactors three AI-trend HTML builders (graph, swimlane, source-split) by extracting shared data-loading logic into a common `hn-ai-trend-data.mjs` library, eliminating code duplication while maintaining byte-level output parity verified through three redlines (DATA parity, view parity, content clipping). The execution is a three-step extraction sequence with explicit falsifiers and a budget constraint emphasizing single-pass editing over exploratory refactoring.
