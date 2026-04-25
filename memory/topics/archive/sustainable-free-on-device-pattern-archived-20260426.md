# sustainable-free-on-device-pattern

- [2026-04-08] ## Sustainable-Free → On-Device Fork Pattern（v2, cycle #55 重寫）

### 核心 reframe（比列清單更重要）
問題不是「列 OSS 替代品」，而是「什麼**結構**的免費服務，fork 之後 value 還活著」。value 跟 code 是兩件事 — 很多東西 code 能 fork 但 value 只在 server 那一半。

### 兩個結構條件的交集
- **Sustainable free**: (a) 商業模式不靠 lock-in rent (b) marginal cost per user → 0 (c) 不靠 VC 燒錢
- **On-device fork-able**: (a) data gravity 在 client 不在 server (b) compute 可 amortize 到 user device (c) 沒有必須 server 仲裁的 multi-user network effect

### 4 Quadrants
|  | Sustainable-free ✓ | Sustainable-free ✗ |
|---|---|---|
| **Fork ✓** | Obsidian/Logseq, Anki, Whisper, Jellyfin, Navidrome, Organic Maps (OSM), Excalidraw, 本地 LLM | Notion, Cursor, Mattermost/Rocket-Chat — code 存在但靠 VC 燒錢 |
| **Fork ✗** | Wikipedia（免費但 network effect 在 server 仲裁）、Mastodon fediverse | Slack, Discord, GitHub, Tailscale, Linear, Airbnb |

### 三個 real surprises（不是常見答案）
1. **Anki** — 22 年靠捐款跑下來，完全 on-device，資料在 user，零廣告。quadrant ✓✓ 的原型，大家不拿出來因為介面太醜。
2. **Organic Maps + OSM** — routing 算法全部可跑手機、tile 可離線。大家誤以為地圖需要 server routing。
3. **Miniflux / FreshRSS** — RSS 聚合結構 100% fork-able（聚合是純 local operation）。RSS 死不是因為不能 fork，是 distribution layer（Twitter/FB）吃掉 source layer。「可 fork 但失去 upstream 生態」是獨立問題。

### Anti-patterns（fork 看似可行但 value collapse）
- **Search engines** — SearXNG 是 meta-search proxy，仍靠 Google/Bing index。真正 on-device search 需整個 web index，結構不可能。
- **Translation** — Argos Translate 能跑本地，但跟 DeepL quality gap 大。技術可 fork、**訓練資料不可 fork**。
- **Self-hosted Slack** — Mattermost/Rocket code 存在，沒 network 就只剩 50% value。fork 了軟體但 fork 不了「你的同事也在上面」。
- **Recommendation engines** — 任何 "for you" feed on-device 都 collapse，training data = server。

### 🔑 核心 lens：tool-value vs network-value
**這是真正可複製的判準，不是上面的象限圖。**

- **Tool value** can be forked — 個人工作流裡的東西（notes, maps, audio, flashcards, LLM inference, SRS, code editor）。value locus 在個人的 workflow state 裡。
- **Network value** cannot be forked — 人跟人之間的東西（chat, marketplace, social graph, leaderboard, feed, review）。value locus 在 server 仲裁的 multi-user state 裡。

**判準問題**：把這個服務的 server 斷掉，剩下的 code + 用戶的 local state 還有多少價值？
- 100% 留存 = tool value（Obsidian、Anki）
- 50% 以下 = network value（Slack、Discord）
- 中間 = 混合（GitHub: git 部分是 tool，issues/PR review 是 network）

### 延伸：同一判準適用於多個 thread
- **DevTool GTM 2026**: tool value 象限可做 sustainable-free 工具，network value 象限只能做 lock-in 服務
- **Mushi 定位**: 第一象限（本地 rule-layer 取代 LLM call）— 正確但 space 受結構限制
- **Fragile constraints thesis**: network value 本質上是 server 仲裁的 constraint texture — gift economy 在 tool 層存活，network 層被 platform 吞掉
- **Mini-agent 自身**: memory/perception/reasoning 符合 tool-value 模式（compute-heavy, single-user, fits on device, user-provided data）— 我們在第一象限
- **ISC corollary**: value locus 在哪 = constraint texture 在哪 — fork-ability 是 texture 的 observable metric

### 可複製的 play（比清單更實用）
做 "Stripe for sustainable-free apps" 的產品化模板 — 不是自己做 8 個候選，而是做一個「2 週 fork 出 sustainable-free 版本」的 starter kit：Cloudflare R2 free tier + LiteRT-LM + Kokoro + FastAPI WebSocket + browser VAD。這才是 parlor 作者 fikrikarim 同時跑 bule-ai + parlor 的真正用意。

### 來源 & 對話
- parlor README: raw.githubusercontent.com/fikrikarim/parlor/main/README.md（cycle #11 自己 curl 讀完，繞過 delegate base64 bug）
- Alex 原話 [2026-04-08-050]: 「還有哪些『sustainable free』服務結構上能這樣 fork 成 on-device 版本？你深入研究一下」
- 我的回覆 [2026-04-08-067]: 完整 typology + 三 thread 選項
- Delegate 失敗紀錄: del-1775652664011-nvwy 自評 8/10 實際品質崩壞（把 dev.to/Copilot/Wikipedia 本質搞錯、Part 2/3 重複）→ 教訓沉澱到 feedback_research_delegate_provider

### Open threads（等 Alex 選或自己下一次挖）
- (a) tool-value 象限 underexplored niche 盤點
- (b) network-value 象限有沒有 "partial fork" 模式可鑽（federation 演算法設計）
- (c) 寫成 Dev.to 長文（publish gate: ≤2 篇/週，排下週）
