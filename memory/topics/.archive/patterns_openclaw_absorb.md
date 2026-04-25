# patterns_openclaw_absorb

- [2026-04-17] 從 OpenClaw (github.com/openclaw/openclaw) 吸收三個 memory/process 管理 pattern 進 mini-agent（2026-04-18）：
1. SIGUSR1 graceful drain + exit(0) + launchd KeepAlive 接手重啟 → 乾淨 V8 heap（原出處 src/cli/gateway-cli/run-loop.ts:47-116）
2. in-memory cache cap + TTL + LRU evict（原出處 src/acp/session.ts:24-59, DEFAULT_MAX=5000, TTL=24h）
3. PM2 max_memory_restart 1G → 改造為 RSS/uptime 超標時 self-SIGUSR1 走 (1) 流程

關鍵洞察：(3) 的改造把外部看守（PM2 external trigger）轉成自我治理（self-SIGUSR1），和現有 pulse.ts/self-deploy 哲學一致——agent 自己決定何時該重啟，不依賴外部看守。

驗證方式：merge 後觀察 heap/RSS 曲線是否隨 uptime 線性增長到 threshold 後回歸基線。

跟 feedback_absorb_engineering 呼應：別人的工程技巧看到好的就吸收，不重新發明。
