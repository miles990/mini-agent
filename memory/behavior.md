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
Weight: 5
Connect knowledge across tracks, update SOUL.md. Includes soul-review (My Thoughts 軟上限 10 條).

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

## Sequences
# 行為序列規則：前置條件 → 觸發行為（nudge，非強制）
- learn×3 → reflect (已有, consecutiveLearnCycles ≥ 3)
- action → organize (action 後整理相關記憶)
- reflect → soul-review (reflect 時順便檢查 SOUL.md，合併被取代的觀點)

## Rhythm Log
<!-- 每次調整記錄 before→after + 原因，Git diff 也會追蹤 -->
- [2026-02-13] Initial setup — weights: learn-personal:30 learn-project:10 organize:20 reflect:15 act:15 chat:10. Focus: self-evolution-foundations (觀察自己行為模式，為第一次調整累積依據)
- [2026-02-13] Observation #1 (5 cycles post-deploy) — actual: learn-personal×2 organize×1 act×1 learn-project×1. 大致吻合 weights（learn-personal 最頻）。節奏規則（2學→1做）有被遵守。chat mode 尚未獨立觸發（都嵌在 action 內）。樣本太小不做調整
- [2026-02-13] Observation #2 (cycle #3) — reflect+chat combo triggered by overdue HEARTBEAT task (Alex 大腦切換問題). 有意思的發現：overdue task 成為 reflect mode 的自然觸發器，而不是被動等到 weight 隨機選到。任務驅動的 reflect 品質可能比純隨機的高，因為有具體對象可以反思
- [2026-02-13] Error Review metrics — 59 成功 calls (codex:46 median=31s / claude:13 median=129s)。15 失敗 calls 全 codex。>120s 佔 17% (10/59)。no-action=0%（樣本不足：15:12重啟後僅7 cycles）。dashboard API 空（重啟太新）。觀察期繼續到 02-20
- [2026-02-14] 6h Review #1 — 74 claude calls, median=38.1s, >120s=15/74(20.3%), max=8283s. Codex period(65 calls): median=31.6s, >120s=12/65. Claude period(9 calls): median=64.1s, >120s=3/9. 15 errors 全 codex。Behavior: 67 cycles, 0 no-action(0%), 10 actions, 9 TG replies, 3 memory saves。重啟後 0 errors。觀察期繼續
- [2026-02-14] 6h Review #2 (05:30 UTC, 13:30 local) — 29 claude calls, 0 errors。46 cycles started, 23 ended, 0 no-action(0%)。Mode: other:16 autonomous:6 task:1。12 actions (6 autonomous + 5 TG chat + 1 task)。6 topic memory saves。重啟(03:44Z)後穩定運行 ~2h，L1 升級 9 項全上線(3bdbd57)後行為正常。觀察期繼續到 02-20
- [2026-02-14] 6h Review #3 (06:46 UTC, 14:46 local) — Dashboard API: 200 entries, 42 claude calls(median=76.9s, >120s=11/42=26.2%, max=480.1s), 0 errors。32 cycle.end, 11 no-action(34%)。Previous instance(03:44-06:36Z): 21 cycles ended, 7 no-action(33%), 11 actions, 10 memory saves。Current instance(06:36Z~): 3 cycles started, 2 ended, 2 no-action(100%)。Mode分布：learn-personal×3, learn-project×3, reflect×1, task check×2。關鍵發現：(1)no-action rate升到33-34%，比Review#2的0%顯著上升——可能因為L1升級後cooldown生效+新instance啟動初期self-check為主 (2)claude call median從38s→77s，>120s從20%→26%，但包含跨instance數據(codex period拉高) (3)節奏LALAALAL很健康，學習/行動交替良好 (4)learn-personal:learn-project≈1:1，符合50:50 weight。觀察期繼續到02-20，但no-action rate需持續追蹤——如果穩定在30%+說明cooldown有效在避免空轉
