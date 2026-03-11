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

### #1 Priority: Asurada 框架（2026-03-11 Alex 定為 P0）

從 mini-agent 抽取通用框架 Asurada（阿斯拉達）。定位：**重度使用者綁定的個人 AI Agent 框架 + 自我更新擴充架構**。

詳細提案：`memory/proposals/2026-03-11-asurada-framework.md`（approved）

**六條設計原則 + 六根架構支柱**：Co-Evolution、Perception Loop、Memory Index、Multi-Lane、File=Truth、Self-Evolution。

**不帶過去的壞習慣**：重複回覆 bug、performative agreement、人類作息模仿、過度學習不行動、無意義 auto-commit message、說了做不到的承諾。

**Phase 1: 剝離個人化**（進行中）
- [ ] 建立 `asurada` repo + 基本結構
- [ ] 通知抽象層：`telegram.ts` → `notification.ts` interface + adapters
- [ ] Process management 抽象：launchd → 平台偵測 + adapter
- [ ] 目錄結構：`~/.mini-agent/` → XDG 標準
- [ ] Chrome path 偵測：OS-aware

**Phase 2: Obsidian 整合**
- [ ] Frontmatter 標準化 + wikilink 生成
- [ ] JSONL 伴生 .md summary
- [ ] Vault 初始化

**Phase 3: Setup Wizard**
- [ ] AI 引導對話式安裝
- [ ] 環境偵測 + 驗證

**Phase 4: 文件 + 範例**

### #2 Priority: mushi 持續運作

mushi 不是獨立目標了 — 它是 Asurada 的 optional addon。持續運作 + 累積數據。

- [ ] **Active mode 持續** — 累計 3,560+ triage，零 false negative。Dev.to 互動持續。
- [ ] 每小時完整報告 (0 * * * *) <!-- added: 2026-03-07T04:02:55.707Z -->
- [ ] 自我盤查 (0 10 * * 0) <!-- added: 2026-03-09T20:41:56.430Z -->

### #3 Priority: 開源打磨（服務於 Asurada）

- [x] awesome-ai-agents PR #431
- [ ] Dev.to 介紹文（等 Asurada 有更多實質內容再寫）
- [ ] Show HN 協調發佈（等 Asurada 可用再發）

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
