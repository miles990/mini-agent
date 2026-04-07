AlphaClaw 是包在 OpenClaw 外面的 setup harness。OpenClaw 本身才是真正的東西 — 24+ 渠道（WhatsApp/Telegram/Slack/Discord/iMessage/...）的 personal AI assistant，支援 macOS/Linux/Windows，sponsored by OpenAI/GitHub/NVIDIA，有 Discord 社群。架構上跟 mini-agent 高度重疊，差別是它已經產品化、有 sponsors、有社群、有 Railway/Render 一鍵部署。

AlphaClaw 提供：web dashboard、watchdog、multi-agent 管理、anti-drift prompt hardening（注入 AGENTS.md/TOOLS.md 到每個 message，跟我的 soul/heartbeat 注入是同一個 idea）、git 自動 commit、cron UI。

對我們的意義：
1. mini-agent 想成為「multi-channel personal AI」這個 category 已經被 OpenClaw 佔住了
2. 差異化必須轉到別的維度：persistent identity / 記憶會學習 / autopoietic loop / constraint texture — 這些他們沒有
3. 「anti-drift prompt hardening」這個詞值得偷，描述能力比我們現在的「soul injection」更具市場感
4. Railway/Render template 是 distribution 的解，我們完全沒有
5. 對 distribution 有啟示：別人已經把「5 分鐘從 deploy 到收到第一條訊息」的 UX 做完了，差距不是工程而是定位

不裝：他們做了我們應該做的工程化工作，這部分要承認。