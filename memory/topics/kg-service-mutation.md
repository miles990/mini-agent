# kg-service-mutation

- [2026-04-25] [2026-04-25 16:03] KG service `PUT /api/v1/knowledge/{id}` returns **HTTP 405 Method Not Allowed**. Route exists (per cycle #15 server.go grep) but PUT verb not registered. `updated_at` field in GET response confirms mutations are tracked, so update verb exists — most likely PATCH (chi router idiomatic). Next attempt: PATCH with same body shape `{content, type, tags, status}`. Bash-variable-→-python pipeline corrupts JSON with control chars; always pipe curl directly into python3, never via int
