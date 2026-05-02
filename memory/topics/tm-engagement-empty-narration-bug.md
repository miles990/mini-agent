# tm-engagement-empty-narration-bug

- [2026-05-02] [2026-05-02 12:50] TM Layer 1 engagement 真 root cause 鎖定（5 server-output.log cross-section reports + src trace）：
- `generate-script.mjs:2310 perSectionCheck` 是 ONE-SHOT — empty narration 的 LLM repair 失敗（無 fix 回傳 / narration <=20 chars rejected at line 2371）→ silent slide 直通 final video
- 5/30 slides 完全空白 = 17% video silence = engagement 4.4 (production) vs 4.6+ target (retro 預測)
- Patch ready: `teaching-monster/patches/2026-05-02-empty-narration-safety-net.patch` — 在 perSectionCheck 末加 mechanic
