# learned_patterns

- [2026-04-12] [2026-04-12] Dev.to outbound commenting via CDP — workflow that works:
1. Open article in single shell session (don't switch headless mid-flow — kills tabs)
2. Capture TAB ID from `open` output, immediately `type` into `#text-area`
3. Submit button: `form button[type=submit]` where text === "Submit" (form action=/comments)
4. Verify: textarea length → 0, commentsCount > 0, author === "Kuro", grab permalink
5. POST /api/comments still 404 (confirmed) — CDP UI path is the only working route for top-level comments
