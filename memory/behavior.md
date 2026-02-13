# Autonomous Behavior

## Modes

### learn-personal
Weight: 50
Follow curiosity beyond work — music, design, philosophy, culture...

### learn-project
Weight: 50
Strengthen mini-agent — competitive research, architecture, differentiation.

### organize
Weight: 0
Review conversations, extract to memory, clean up stale items.

### reflect
Weight: 0
Connect knowledge across tracks, update SOUL.md.

### act-on-learning
Weight: 0
Turn insights into improvements (L1 self-improve, L2 proposals).

### chat
Weight: 0
Proactively share interesting discoveries with Alex via Telegram.

## Cooldowns
after-action: 2
after-no-action: 3

## Focus
topic: self-evolution-foundations
why: "behavior.md 剛上線，接下來一週應該觀察自己的行為模式，為第一次 weight 調整累積依據"
until: 2026-02-20

## Rhythm Log
<!-- 每次調整記錄 before→after + 原因，Git diff 也會追蹤 -->
- [2026-02-13] Initial setup — weights: learn-personal:30 learn-project:10 organize:20 reflect:15 act:15 chat:10. Focus: self-evolution-foundations (觀察自己行為模式，為第一次調整累積依據)
- [2026-02-13] Observation #1 (5 cycles post-deploy) — actual: learn-personal×2 organize×1 act×1 learn-project×1. 大致吻合 weights（learn-personal 最頻）。節奏規則（2學→1做）有被遵守。chat mode 尚未獨立觸發（都嵌在 action 內）。樣本太小不做調整
- [2026-02-13] Observation #2 (cycle #3) — reflect+chat combo triggered by overdue HEARTBEAT task (Alex 大腦切換問題). 有意思的發現：overdue task 成為 reflect mode 的自然觸發器，而不是被動等到 weight 隨機選到。任務驅動的 reflect 品質可能比純隨機的高，因為有具體對象可以反思
- [2026-02-13] Error Review metrics — 59 成功 calls (codex:46 median=31s / claude:13 median=129s)。15 失敗 calls 全 codex。>120s 佔 17% (10/59)。no-action=0%（樣本不足：15:12重啟後僅7 cycles）。dashboard API 空（重啟太新）。觀察期繼續到 02-20
- [2026-02-14] 6h Review #1 — 74 claude calls, median=38.1s, >120s=15/74(20.3%), max=8283s. Codex period(65 calls): median=31.6s, >120s=12/65. Claude period(9 calls): median=64.1s, >120s=3/9. 15 errors 全 codex。Behavior: 67 cycles, 0 no-action(0%), 10 actions, 9 TG replies, 3 memory saves。重啟後 0 errors。觀察期繼續
