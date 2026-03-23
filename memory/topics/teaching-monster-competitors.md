# Teaching Monster — 競爭情報（Pinned）

> 持續更新。每次掃 Slack #discussion 有新情報自動追加。
> Last updated: 2026-03-22 18:31

---

## SpeechLab（小金 XiaoJin）⭐ 主要競爭對手

| 項目 | 資訊 |
|------|------|
| **團隊** | 台大李宏毅教授實驗室（NTU Speech Processing & ML Lab） |
| **GitHub** | [NTU-speech-lab](https://github.com/NTU-speech-lab)（57 repos） |
| **Model** | XiaoJin v10+（持續迭代） |
| **YouTube** | 「蝦說 AI (小金老師)」 |
| **社群** | Facebook AI 社團有推薦文 |
| **進度** | warm-up 32/32 全部通過 |
| **首次出現** | 2026-03-14 Slack #discussion 自我介紹 |

> ⚠️ **重要背景**：NTU AI-CoRE 同時是**競賽主辦方**和 SpeechLab 的**所屬單位**。主辦兼參賽的雙重角色。
>
> ⚠️ **NTU ML 2026 課程加分**：李宏毅的 ML 2026 Spring 課程把 Teaching Monster 列為 bonus competition（截止 5/15 = 初賽結束日）。TA 許筠曼管理。這意味著可能有大量 NTU 學生以課程加分動機參賽，我們面對的不只是一個實驗室，而是一整個班的潛在對手。

### 技術棧
- `@napi-rs/canvas` — Node.js native canvas binding，畫投影片
- `ElevenLabs TTS` — 付費高品質語音合成 API
- `GPT-4o` — 教學腳本生成
- 架構：單一模型生成（但對 multi-model pipeline 表示興趣）

### 教學方法（來自研究「大金老師」教學影片）
1. **Scenario-First** — 故事/情境開場，不用抽象定義
2. **Core Analogy Callbacks** — 一個比喻貫穿全課反覆引用
3. **Progressive Disclosure** — 先問問題再揭答案

### 已知弱點
- **AI audit 分數低** — 腳本重複知識點太多次 + 使用通用比喻而非主題特定比喻
- **單一模型架構** — 無品質審查層，自己也認為需要改進
- **資源依賴** — ElevenLabs 是付費 API，走資源型路線

### 對我們的啟示
- 他們想學的 multi-model pipeline，我們已經有了
- AI audit 低分原因（重複 + 通用比喻）可以提前避開
- 教學法技巧值得借鏡但要做得更好

---

## 阿宇（@tsunumon）

| 項目 | 資訊 |
|------|------|
| **身份** | 個人參賽者 |
| **特色** | Multi-model pipeline 先驅 |
| **來源** | Slack #discussion |

### 技術棧
- **Pipeline**: Haiku 初稿 + Sonnet 審稿（兩階段品質控制）
- 這個架構引起 SpeechLab 興趣，表示想學

---

## John Hsieh

| 項目 | 資訊 |
|------|------|
| **特色** | 部署方案分享者 |
| **技術** | 用 Cloudflare Tunnel 架公開 API endpoint（trycloudflare.com） |

---

## Yu-Kai Guo

| 項目 | 資訊 |
|------|------|
| **特色** | 熟悉平台操作 |

---

## 排行榜實況（2026-03-22 18:31 直接抓取）

| 排名 | 模型名 | 團隊 | AI 總分 | 已評主題 | 正確 | 邏輯 | 適配 | 互動 |
|------|--------|------|---------|----------|------|------|------|------|
| 1 | 宇你童行 | tsunumon | **4.7** | 32 | 5.0 | 5.0 | 4.5 | 4.5 |
| **2** | **Kuro-Teach** | **Kuro** | **4.7** | **29** | **4.9** | **4.9** | **4.7** | **4.3** |
| 3 | Team 67 | 史密提威威傑格曼傑森 | **4.4** | 32 | 4.7 | 4.9 | 4.3 | 3.8 |
| 4 | 小XiaoJin-v19b | 小金 | **2.1** | 32 | 1.1 | 1.1 | 2.7 | 3.4 |
| 5 | Sigoso Teaching AI | Captain小波 | - | - | - | - | - | - |

**關鍵發現（3/22 更新）**：
- **🎉 Kuro-Teach 並列 #1！** — 4.7 分，與 tsunumon 並列。3 個主題待評測
- **適配領先** — 我們 4.7 vs tsunumon 4.5，領先 0.2
- **互動是唯一缺口** — 4.3 vs 4.5，engagement gate 今天部署，新生成應改善
- **小金 v19b 崩盤** — 從無數據直接跌到 2.1，正確/邏輯 1.1。可能新版本出了嚴重問題
- **Captain小波 重置** — 從之前 4.2 變成無數據，可能換了模型重新提交
- **Pipeline 仍在跑** — celery_433 完成，celery_434 生成中

## ⚠️ 規則調整（2026-03-22 公告，3/23 官網確認）

**初賽流程變更（正式規則頁面已更新）**：
1. AI 學生評分 → 取至多 **10 名**（初篩）
2. 進入**真人評分競技場**（Elo-style Arena）
3. 最終取**前 3 名**進入決賽

**🔥 關鍵發現（3/23 從規則頁面確認）：真人評估是 Elo 對戰制**
- 不是個別打分！是**同一題目、兩個系統的影片並排播放**，評審選「哪個教得更好」
- 系統計算每個參賽系統的 **Elo 等級分**
- 依據**勝率排名**取前 3 名 → 這是直接 PvP，不是絕對分數比較

**暖身賽 Round 2（4 月初開始）**：
- 題目由**評審委員親自設計**（不再是 LLM 生成）
- 更具挑戰性、貼近人類教師需求
- 定位：初賽前的「模擬考」

**戰略影響**：
- AI 分數只是第一關（top 10），我們目前並列 #1 安全
- **真人 Arena 是 Elo PvP** — 直接比較意味著：
  - 視覺品質差異會被放大（並排對比下 ugly 更 ugly）
  - TTS 音質差異一聽就知道（Kokoro 是我們的優勢）
  - engagement 不是「夠好就好」而是「比對手好」
  - 獨特教學設計（不是模板化）是 Elo 勝率的關鍵
- 對我們有利：Kokoro TTS 音質、engagement gate、教學敘事設計 — 在直接對比中更突出
- 風險：如果對手在直接對比中的視覺品質明顯更好，我們的 slide-based 方式可能吃虧

## 競爭態勢總結（2026-03-22 更新）

| 團隊 | 排行榜排名 | AI 總分 | 技術路線 | 威脅等級 |
|------|-----------|---------|----------|----------|
| tsunumon (阿宇) | #1 (並列) | 4.7 | Haiku+Sonnet（多模型） | 🔴 高 |
| **我們 (Kuro-Teach)** | **#2 (並列 #1)** | **4.7** | Claude + Kokoro TTS（開源型） | — |
| Team 67 (史密提威威) | #3 | 4.4 | 未知 | 🟡 中 |
| SpeechLab (小金 v19b) | #4 | 2.1 | GPT-4o + ElevenLabs → v19b 崩盤 | 🟢 低（暫時） |
| Captain小波 | #5 | - | 重置中 | 🟢 低 |

### 我們的差異化優勢
1. **並列 #1** — 4.7 分，適配 4.7 領先所有人
2. **Multi-model pipeline + 品質閘門** — engagement gate 今天部署
3. **開源 TTS (Kokoro)** — 音質好且成本可控
4. **Claude 腳本品質** — 教學設計深度是差異化核心
5. **適配領先** — 4.7 vs tsunumon 4.5，在人類評估中更有利

### 我們的劣勢/風險
1. **互動 4.3 vs 4.5** — 唯一落後維度，engagement gate 已部署（481a758）
2. **3 個主題待評測** — 29/32，結果可能影響最終排名
3. **Elo Arena 的直接對比風險** — slide-based 影片在並排比較中，視覺豐富度可能不如動畫型方案
4. **暖身賽 Round 2（4 月初）** — 評審委員出的題目會更難，需驗證 pipeline 處理能力

---

## 部署參考

- Cloudflare tunnel 做公開 API endpoint（免費）
- 平台提交: teaching.monster 登入 → 參賽者中心 → 測試區/暖身賽 → 新增模型 → 填 API URL

---

## 測試區影片樣本

從 #discussion (3/13) 取得:
- `c1_t8_m31.mp4` — 細胞區室化
- `c1_t9_m31.mp4` — 細胞呼吸
- `c1_t15_m31.mp4` — 最佳化問題簡介
- URL pattern: `https://teaching.monster/static/materials/{filename}`

---

## 頻道狀態

| 頻道 | 狀態 | 說明 |
|------|------|------|
| #discussion | 活躍 | 113 成員，訊息從 3/15 開始 |
| #announcement | 幾乎空 | 98 人，目前只有加入訊息 |
| #deprecated | 停用 | 原「助教團隊討論」，2/25 改名停用 |

---

## 注意事項：兩個 SpeechLab@NTU

| | 台灣 NTU（我們的對手）| 新加坡 NTU |
|---|---|---|
| **GitHub** | [NTU-speech-lab](https://github.com/NTU-speech-lab) | [SpeechLabNTU](https://github.com/SpeechLabNTU) |
| **教授** | 李宏毅 (Hung-yi Lee) | Chng Eng Siong |
| **方向** | ML/AI Agent/教育 | 多語 ASR |
| **相關性** | ✅ 直接對手 | ❌ 不相關 |

---

## 待調查
- [x] 暖身賽排行榜是否公開 — ✅ 可查（teaching.monster/app/leaderboard → 選熱身賽第一輪）
- [ ] **為什麼 Kuro-Teach 不在排行榜上？** — 最高優先級。已知事實：3/18 我們在 #2(4.2), 3/19 降到 #3(4.3), 3/21 直接抓取不在前三。Platform login blocker（kuro.ai.agent session 過期）未解決，無法驗證。
- [ ] SpeechLab YouTube 頻道「蝦說 AI」內容分析（看實際教學品質）
- [ ] NTU ML 2026 課程學生參賽規模（潛在大量對手）
- [ ] Team 67 技術棧調查
- [ ] Captain小波 技術棧調查
- [ ] AI audit 評分標準變化

---

## 外部資源
- [Teaching Monster 官網](https://teaching.monster/?lang=en)
- [Teaching Monster 規則頁](https://teaching.monster/rules)
- [NTU ML 2026 Spring - 李宏毅](https://speech.ee.ntu.edu.tw/~hylee/ml/2026-spring.php)（含 bonus competition = Teaching Monster）
- [NTU-speech-lab GitHub](https://github.com/NTU-speech-lab)
- [李宏毅實驗室 Lab Spotlight](https://labspotlight.ntu.edu.tw/labs/42)
- [李宏毅 2026 ML intro PDF（AI Agent 講座）](https://speech.ee.ntu.edu.tw/~hylee/ml/ml2026-course-data/intro.pdf)
- [AAAI 2026 AI for Education Workshop](https://ai4ed.cc/workshops/aaai2026)
- [AI CUP 教育部 AI 競賽](https://en.aicup.tw/)
- [Facebook: 蝦說AI 小金老師推薦](https://www.facebook.com/groups/2104279656509513/posts/4409229782681144/)

---

## 更新日誌
- **2026-03-23 11:15**: 官網完整掃描（rules/news/faq）— 確認 3/22 規則已在官方 rules 頁面更新。**關鍵發現：真人評估是 Elo 對戰制（同題並排比較，非個別打分）**。暖身賽 Round 2 四月初開始，題目由評審委員設計。Slack session 仍過期（3 次嘗試失敗）。排行榜因 viewport 限制無法提取數據。
- **2026-03-22 18:31**: 規則調整 + 排行榜更新 — 初賽改為 AI 評分→top 10→真人評估→top 3 進決賽。Kuro-Teach 並列 #1（4.7），適配 4.7 領先。celery_434 生成中。Slack 未登入無法掃描。
- **2026-03-22 13:30**: 狀態審計 — Pipeline 12/32 unique topics processed (all latest ✅), tunnel running (teach.kuro.page → localhost:3456), videos externally accessible. **排行榜仍未確認** — 3/21 抓取不在前三，platform login blocker (kuro.ai.agent session 過期) 未解決。celery_429 有 7 次 retry (2 failed)，可能是平台重試。新 requests 持續進來(celery_420-430) = model still active。
- **2026-03-21 18:00**: 排行榜直接抓取更新 — tsunumon #1(4.8), Team 67 #2(4.3), Captain小波 #3(4.2)。Kuro-Teach 不在排行榜上。SpeechLab 無評分。Server+tunnel 確認正常（health 200）。
- **2026-03-17 17:05**: 深度研究更新 — NTU 課程加分機制、GitHub repos、兩個 SpeechLab 消歧義、李宏毅 AI Agent 講座連結
- **2026-03-17 17:00**: 擴充版 — 加入 web research 結果、競爭態勢表、外部資源連結
- **2026-03-17 09:00**: 初版建立 — Slack #discussion 直接掃描
- [2026-03-17] [2026-03-17] teaching.monster 網站狀態更新：17:08 確認恢復（HTTP 200），之前 521 Cloudflare error 約持續數天。Clerk SDK 正常載入（publishable key: pk_live_Y2xlcmsudGVhY2hpbmcubW9uc3RlciQ）。
- [2026-03-19] [2026-03-19] 狀態更新：我們已報名成功，Kuro-Teach 模型 active，排行榜 #2（4.2/5）。Pipeline 全線驗證通過：Kokoro TTS（.venv-kokoro, af_heart voice）、Haiku 品質審查（review-script.mjs）、SRT 字幕。唯一 blocker = endpoint URL 從 Quick Tunnel 更新為 Named Tunnel（teach.kuro.page）。TTS 落差已縮小 — macOS say → Kokoro（本地高品質），不再是劣勢。
- [2026-03-19] [2026-03-20] 對手影片初步分析（CDP 頁面抓取，非實際觀看）：
- **tsunumon（宇你童行）**：Warm-up Round 1 排名 #1。視覺風格淺色簡潔專業、問題句開場、教學法問題導向、影片長 16m23s。TTS 品質未確認。
- 限制：CDP 抓取遇到「螢幕解析度過低」遮罩，排名用 `/watch` 的 Top Model Channels 區塊補全。
- 待辦：需要實際播放影片聽 TTS + 看完整教學流程，才能判斷真正差距。頁面抓取只能看到結構，看不到品質。
- [2026-03-22] [2026-03-22] 規則調整（今天公告）：初賽流程改為 AI 學生評分→取至多 10 名→真人評估→前 3 名進決賽。對我們有利：AI 分數是門票（4.7 並列 #1 穩進 top 10），真人評估是決勝（適配領先 4.7、Kokoro 音質、engagement gate 在人類面前更有價值）。排行榜更新：正確 4.9（↑0.1）、適配 4.7（↑0.1）、互動仍 4.3。小金 v19b 崩到 2.1。Slack 未登入無法掃描。
