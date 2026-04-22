<!-- Auto-generated summary — 2026-04-17 -->
# duplicate-chat-17764

Two independent duplication bugs were identified in mini-agent's chat emission on 2026-04-17: (1) same-cycle double-emit where a single cycle fires two responses 2-4ms apart due to the chat extractor pulling both the `chat:` annotation from Decision blocks and the real `<kuro:chat>` tag simultaneously, and (2) cross-cycle dedup failure where multiple cycles respond to the same message because the inbox resolver doesn't mark messages as claimed before the first cycle completes. Evidence was gathered (including Decision-trace content leaking into chat text), but the actual fix was deferred pending budget discipline.
