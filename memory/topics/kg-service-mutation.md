# kg-service-mutation

- [2026-04-25] [2026-04-25 16:03] KG service `PUT /api/v1/knowledge/{id}` returns **HTTP 405 Method Not Allowed**. Route exists (per cycle #15 server.go grep) but PUT verb not registered. `updated_at` field in GET response confirms mutations are tracked, so update verb exists — most likely PATCH (chi router idiomatic). Next attempt: PATCH with same body shape `{content, type, tags, status}`. Bash-variable-→-python pipeline corrupts JSON with control chars; always pipe curl directly into python3, never via int
- [2026-04-25] KG service mutation API ground truth (knowledge-nexus/internal/server/server.go:51-65):
- PATCH /api/v1/knowledge/{id} — partial update, preserves unspecified fields, advances updated_at. Verified 2026-04-25 16:04 with f5be290a (HTTP 200).
- PUT /api/v1/knowledge/{id}/ai — AI summary only (NOT general mutation). cl-17 PUT 405 root cause.
- POST/GET/DELETE on /knowledge or /knowledge/{id} — standard CRUD.
- No /relationships endpoint exists. Relations encoded inline as markdown `## Related` sect
