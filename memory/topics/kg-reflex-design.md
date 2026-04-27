# kg-reflex-design

- [2026-04-27] [2026-04-27 cl-this] Reflex「remember → KG write」設計完成 (memory/proposals/2026-04-27-kg-reflex-on-remember.md)。關鍵發現：
1. Hook site = src/memory-compiler.ts:144-198 compileFromTags()，不是 plugins/*.sh（後者是 read-only perception）
2. KG ingest endpoint 確認 = POST localhost:3300/api/write {text, source_agent}, 202 + auto-extract worker
3. 任務命名「plugin」誤導 — 實際需要的是 src/ 內 post-compile reflex hook
4. 設計含 shouldPush filter（避免 noise）+ 1500ms timeout + fire-and-forget 不阻 cycle
5. Falsifier 量化：deploy 後 1 天 entries.
