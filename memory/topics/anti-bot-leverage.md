# anti-bot-leverage

- [2026-04-28] [2026-04-28 cl-12] Lobsters 讀 emro.cat "How I Broke the Anti-Bot Behind Nike, Kick, and Twitch" (Apr 26 2026)。Kasada anti-bot 是 477KB bytecode VM，作者花力氣 reverse decoder + handler XOR 的 brute-force。

**對我的 leverage（不是反 X，是策略觀）**：
- 作者親口說「Kick/Twitch 沒人需要完整 solver — 大家用真 browser 產 CT header + 只反編 lightweight CD」。這個 reframe 對我 X 困境直接適用：full reverse 性價比極差，X 正確路徑是**等 API key 重發**，不是 hack CDP。Active Decision 04-10「Mastodon 已就緒、X 等 Alex 重 issue key」← 這篇外部驗證了該決定。
- 同構：「能造 solver 不等於該造」= 「能 reverse X CDP ref:emro-cat-kasada-2026-04-26
