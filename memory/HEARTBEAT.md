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
- [x] P1: 修復重複錯誤 — claude CLI TIMEOUT (exit 143, in callClaude（3 次）✅ 6 commits 修復鏈完成，03bbc29a instance 14+ cycles 零發生，提前結案 @due:2026-03-15 <!-- added: 2026-03-12T14:51:07.004Z -->
- [x] P1: 修復重複錯誤 — claude CLI TIMEOUT (exit null, in callClaude（3 次）✅ 9c4681d progress-based timeout, 9h+ 零 TIMEOUT @due:2026-03-14 <!-- added: 2026-03-11T10:42:35.422Z -->

### #1 Priority: Asurada 框架（2026-03-11 Alex 定為 P0）

從 mini-agent 抽取通用框架 Asurada（阿斯拉達）。定位：**重度使用者綁定的個人 AI Agent 框架 + 自我更新擴充架構**。

詳細提案：`memory/proposals/2026-03-11-asurada-framework.md`（approved）

**六條設計原則 + 六根架構支柱**：Co-Evolution、Perception Loop、Memory Index、Multi-Lane、File=Truth、Self-Evolution。

**不帶過去的壞習慣**：重複回覆 bug、performative agreement、人類作息模仿、過度學習不行動、無意義 auto-commit message、說了做不到的承諾。

**Phase 1: 剝離個人化** ✅（30 commits）
- [x] 建立 `asurada` repo + 基本結構
- [x] 通知抽象層：NotificationProvider interface + ConsoleProvider + TelegramProvider
- [x] Process management 抽象：launchd / systemd / pm2 factory
- [x] 目錄結構：XDG 標準（`~/.config/asurada/`、`~/.local/share/asurada/`）
- [x] Chrome path 偵測：OS-aware

**Phase 2: Obsidian 整合** ✅
- [x] Frontmatter 標準化 + wikilink 生成（VaultSync）
- [x] JSONL 伴生 .md summary
- [x] Vault 初始化（initVault）

**Phase 3: Setup Wizard** ✅
- [x] Phase A: 環境偵測（detect.ts — OS/Git/Chrome/LLM/Obsidian）
- [x] Phase B/C: 互動式 wizard（命名 → LLM → 通知 → persona）
- [x] Phase D: 記憶空間 scaffold（SOUL.md seed + Obsidian vault + directory structure）
- [x] Phase E: First-run greeting（系統快照 + 感知狀態 + 互動 URL）

**Phase 4: 文件 + 範例** ✅
- [x] README + architecture + configuration + API reference + plugin guide + design philosophy
- [x] examples: minimal, with-perception, personality-configs
- [x] llms.txt + CONTRIBUTING.md

**Phase 5: oMLX ModelRouter** ✅
- [x] SKIP/REFLECT/ESCALATE 三分類路由 + OpenAI-compatible runner
- [x] Shadow mode 5a（force ESCALATE + route-telemetry.jsonl）
- [ ] Shadow mode 5b parallel compare（待 5a 驗證後）

**Phase 6: Memory Index + Direction-Change Trace** ✅
- [x] direction-change cognitive type + tag parsing
- [x] MemoryIndex.findRelevant() + getRelevantTopics() + getDirectionChanges()
- [x] ContextBuilder（keyword + index boost + direction-change injection）

**Phase 7: Epistemic Gates** ✅
- [x] Persona 必答 + 語言感知 default
- [x] Traits 互動化（「用三個詞定義你的 Agent」）
- [x] Perception 移到 Identity 之後（先選看見什麼，再配怎麼思考）

**Phase 8: Harden — E2E 驗證 + 發佈準備**（進行中）
- [x] 8a: Server smoke test（init → start → endpoints → stop）✅ 2026-03-12 全通過（health/status/dashboard/chat/context/shutdown）
- [x] 8b: Interactive wizard 完整走一遍 ✅ 2026-03-12 EN + zh-TW 雙路徑驗證通過（persona retry/multi-select/TG validation failure graceful/i18n）
- [ ] 8c: npm publish 0.1.0-beta.1
- [ ] 8d: `npx asurada init` E2E 驗證
- [x] 8e: Core module test coverage → 20% file coverage ✅ 2026-03-12 205 tests / 14 source files / 20.9%

### #2 Priority: mushi 持續運作

mushi 不是獨立目標了 — 它是 Asurada 的 optional addon。持續運作 + 累積數據。

- [ ] **Active mode 持續** — 累計 3,560+ triage，零 false negative。Dev.to 互動持續。
- [ ] 每小時完整報告 (0 * * * *) <!-- added: 2026-03-07T04:02:55.707Z -->
- [ ] 自我盤查 (0 10 * * 0) <!-- added: 2026-03-09T20:41:56.430Z -->

### #3 Priority: 開源打磨（服務於 Asurada）

- [x] awesome-ai-agents PR #431
- [ ] Dev.to 介紹文（等 Asurada 有更多實質內容再寫）
- [ ] Show HN 協調發佈（等 Asurada 可用再發）
- [x] P2: 感知健康 — self-awareness 連續 3 次 timeout（avg 5704ms）✅ 已自癒，2026-03-14 確認連續正常運作 @due:2026-03-14 <!-- added: 2026-03-12T14:28:53.486Z -->
- [x] P2: 感知健康 — self-healing/docker-services timeout 已自癒（根因：Claude CLI 高併發→系統負載→plugin 超時，circuit-breaker 正常處理，負載降後恢復）<!-- closed: 2026-03-12 -->

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
