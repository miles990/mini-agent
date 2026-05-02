# tm-hero-e2e-verified

- [2026-05-02] 2026-05-02T09:18Z TM hero pipeline E2E verified end-to-end + 1 critical gap found and fixed.

**Cycle 65 patch was incomplete** — `_heroPromise` is awaited only in `server.mjs:880-886` (HTTP orchestration), NOT in `pipeline.mjs` (CLI). Standalone `node src/pipeline.mjs --topic X` would silently skip image-API path → fall through to old drawsvg/Haiku fallback → Anthropic billing depleted → black slide 1.

**Patch this cycle (cycle 67)**: insert 11-line hero-resolve block at `pipeline.mjs:54` mirr
