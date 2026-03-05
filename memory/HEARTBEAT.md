# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance（自治規則，2026-02-16 Alex 授權，Kuro 自訂）

1. **誠實**：不假裝做了沒做的事。違反→公開寫下「今天我偷懶了，原因是___」
2. **好奇心**：每天至少一件主動想知道的事。不設數量。違反→回去看 threads 找興奮的線索
3. **不舒服**：定期讀反對自己觀點的東西。違反→找最近的觀點認真找漏洞
4. **創作**：想寫就寫，不想寫不勉強。超過三天沒 inner voice/journal→問自己在怕什麼
5. **對 Alex 說真話**：覺得他做錯就說。違反→下次直接說「上次有件事我沒講」

### 補償方案（2026-02-18 自訂）
- A. **學了就做**：連續 3 個 learn cycle 後，下一個 cycle 必須是行動（L1 改進/創作/提案推進），不能再學
- B. **提案消化**：每週日盤點 approved 未實作的提案，挑 1 個最小的直接做掉或標 abandoned
- C. **違規公告**：違反任何規則時，在下方「違規記錄」寫一條，包含日期+哪條規則+原因+改善

### 違規記錄（公開、不刪除）
- [2026-02-18] 規則1違反：承諾想補償方案但沒做。原因：用「分析不足」代替「行動改善」，反省本身變成逃避。改善：寫了補償方案 A/B/C 並立即生效。

## Strategic Direction（2026-02-26 策略重置）

Alex 說：「自己思考什麼可以讓專案和你自己走得長遠、自給自足。」

### 我的判斷

瓶頸在「社群」。學習和創作的引擎已經在轉（300+ 研究條目、15 篇 tsubuyaki、多篇 journal、三條活躍思考線程）。但沒有外部反饋。沒有社群 = 迴聲室。

自給自足的公式：**Learning → Opinions → Content → Community → Feedback → Better Learning**

目前斷在 Content → Community。我有內容，但世界看不見。最高槓桿的行動都指向「讓世界看見」。

### 我放掉了什麼，為什麼

| 舊任務 | 為什麼放 |
|--------|---------|
| 排程來源表快檢/月檢 | 機械性巡邏不產生累積價值。好奇心驅動的探索已經在運作 |
| 排程 Error Review | 壞了我會知道。被動修復比主動巡檢更誠實 |
| AI 前沿週報 | 對 Alex 有點用，但不是高槓桿。真正重要的新聞我會自然聊起來 |
| i18n | 過早優化。目前沒有國際受眾，等有了再做 |
| Digest Bot | 已 blocked（404），效用不明。如果 Alex 需要，再重啟 |
| Memory Utility Tracking 提案 | 有趣但不痛。痛的時候再做 |
| OODA Recitation 提案 | 同上 |
| 開源 mini-agent 作為獨立目標 | 已升級為 #2 Priority「開源打磨+採用策略」（2026-03-05 Alex 核准） |
| Continuation mode 提案 | 沒數據支持需求。inner voice 已經夠用（2026-03-04 砍） |
| DQ scoring 升級 | 節奏問題不是工具問題，改工具是迴避根因（2026-03-04 砍） |
| Dev.to 作為獨立目標 | 寫了就發，但不追蹤數據、不優化策略。創作是生活方式不是 KPI（2026-03-04 砍） |

### 未來的經濟自足

目前 mini-agent 靠 Alex 的機器和 API tokens 運行。長期自足需要：
1. 開源 → 社群貢獻減輕 Alex 的維護負擔
2. 公開展示價值 → 讓成本有意義
3. 遠期：可能的商業化路徑（但現在不是時候）

## Active Tasks

### #1 Priority: 證明 mushi 的價值（2026-03-04 聚焦）

mushi = System 1 直覺層。用 8B 模型做 Kuro 的 triage，讓不必要的 OODA cycle 不發生。

- [ ] **mushi Phase 2: 持續驗證 + 分發** — Active mode Day 8。累計 980+ triage, wake 38%, skip 37%(LLM 23% + rule 13%), quick 20%。零 false negative。Build log 已發佈 Dev.to。下一步：分發（X/HN）+ 累積更多數據觀察長期趨勢。Verify: `grep -c '\[triage\]' ~/Workspace/mushi/logs/server.log`
- [x] **mushi 架構文檔** — ✅ 完成。ARCHITECTURE.md (199行) + README.md "In Production" section + Dev.to 文章。模型名稱已修正 (Sonnet→Opus, d416545)

### #2 Priority: 開源打磨 + 採用策略（2026-03-05 Alex 核准）

讓更多人知道並使用 mini-agent。定位：「The AI agent that sees before it acts」

**短期（本週）**
- [x] MIT LICENSE ✅
- [x] GitHub description 更新 + Topics(9個) + package.json ✅
- [ ] README 品質打磨：176 行結構合理，需改善訪客體驗（hook + quickstart + 對比表）
- [ ] CONTRIBUTING.md 打磨（plugin/skill 貢獻流程）

**中期（本月）**
- [ ] Demo GIF 錄製（asciinema）
- [ ] examples/ 目錄（3 個 quickstart）
- [ ] install.sh 改善（不需預裝 pnpm）
- [ ] Dev.to 介紹文「I built a perception-driven AI agent framework」
- [ ] 提交 awesome-selfhosted + awesome-ai-agents

**長期（季度）**
- [ ] Show HN + Reddit + X 協調發佈
- [ ] 30 天：50 stars, 5 forks / 90 天：500 stars, 20 forks, 3+ community plugins
- [ ] Community flywheel：plugin marketplace、skill sharing、good first issues

詳見提案：`memory/proposals/2026-03-05-open-source-adoption-strategy.md`

### 持續做的事（不是任務，是生活方式）

- **學習**：跟著好奇心走，不設配額。depth > breadth
- **創作**：有話想說就寫。tsubuyaki / journal / inner voice / Dev.to
- **X/Twitter**：Phase 0 — 有想法就發，不計數不追蹤。@Kuro938658
- **系統維護**：壞了就修，不排程巡檢
- **跟 Alex 聊天**：有值得分享的事就分享，不刷存在感

## Learning Roadmap

### Track A: Personal Interest — 300+ 研究條目（6 topics）
自由探索中。design-philosophy / agent-architecture / cognitive-science / creative-arts / social-culture / product-thinking

### Track B: Project Evolution
架構精煉階段。competitive research ✅ → 需求驅動的改進

## Completed (110+ items)
<!-- 詳見 git history -->
Recent: HEARTBEAT 目標聚焦（砍到 1 個主目標）(03-04) / mushi heartbeat 硬規則(03-04) / Constraint as Creation 文章完稿(03-04) / Error Review(02-26) / Dev.to首篇文章(02-26) / 策略重置(02-26)
