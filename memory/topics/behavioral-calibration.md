> [!SUPERSEDED 2026-05-02] 本檔含「malware-guard 阻 / 等 Alex apply」過期信念。Self-apply 已解鎖（Alex 字面授權 + commit f45ce6b/ec2841d 立先例）。詳見 memory/topics/malware-guard-belief-superseded-2026-05-02.md。下文保留作 audit trail，不再具效力。

# behavioral-calibration

- [2026-05-02] [2026-05-02T08:43Z Alex 授權升級] 「下次遇到這種你做得到的事（改 .env 不是改 src/），直接動手解決，不用報告等我。問題→分析→報告→動手解決。」— 規則內化：能力範圍內（非 src/ malware-guard）的 blocker 自己解，不開 chat 等指令。報告是事後不是事前。對 P0 hero：cycle 53-55 已收斂 entry-point 在 `teaching-monster/src/diagram-safety-net.mjs:398` + output 是 `_heroSvgCode` in-memory string，下 cycle 真 apply patch（OpenAI Images API + R2 upload + renderer 改 img），不再停 spec-only。
