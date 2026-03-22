# Teaching Monster — 競爭情報（Pinned）

> 持續更新。每次掃 Slack #discussion 有新情報自動追加。
> Last updated: 2026-03-22 13:30

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

## 排行榜實況（2026-03-21 18:00 直接抓取）

| 排名 | 模型名 | 團隊 | AI 總分 | 已評主題 | 正確 | 邏輯 | 適配 | 互動 |
|------|--------|------|---------|----------|------|------|------|------|
| 1 | 宇你童行 | tsunumon | **4.8** | 11 | 5 | 5 | 4.5 | 4.6 |
| 2 | Team 67 | 史密提威威傑格曼傑森 | **4.3** | 12 | 4 | 4.5 | 4.2 | 4.5 |
| 3 | Xiaobo Teaching AI v3 | Captain小波 | **4.2** | 4 | 4.6 | 5 | 3.7 | 3.4 |
| 4-15 | 11 個模型（含 XiaoJin-v10, v13.5, CurriculumForge AI 等） | — | - | - | - | - | - | - |

**關鍵發現**：
- **Kuro-Teach 不在排行榜上** — 已註冊（manage 頁可見）但未出現在排行榜（15 個模型都不是我們的）
- **tsunumon (阿宇) 躍升 #1** — 4.8 分，11 個主題，Haiku+Sonnet pipeline 效果驚人
- **SpeechLab 兩個模型都顯示 "-"** — 之前說的 32/32 可能是提交數不是評分數，或排行榜重置過
- **新對手 Team 67** — 4.3 分 12 主題，穩定輸出，之前未追蹤到
- **Captain小波** — 4.2 分但只有 4 主題，適配和互動偏低

## 競爭態勢總結

| 團隊 | 排行榜排名 | AI 總分 | 技術路線 | 威脅等級 |
|------|-----------|---------|----------|----------|
| tsunumon (阿宇) | #1 | 4.8 | Haiku+Sonnet（多模型） | 🔴 高 |
| Team 67 | #2 | 4.3 | 未知 | 🟡 中 |
| Captain小波 | #3 | 4.2 | 未知 | 🟡 中 |
| SpeechLab (小金) | 未評分 | - | GPT-4o + ElevenLabs（資源型） | 🟡 中（降級：無評分數據） |
| **我們 (Kuro-Teach)** | **未上榜** | - | Claude + Kokoro TTS（開源型） | — |

### 我們的差異化優勢
1. **Multi-model pipeline** — tsunumon 證明了這條路線有效（4.8 分）
2. **開源 TTS (Kokoro)** — 不依賴付費 API，成本可控
3. **Claude 腳本品質** — 教學設計是真正的差異化點
4. **品質審查層** — 可避免 AI audit 低分問題
5. **伺服器穩定** — tunnel + health check 已驗證（2026-03-21 confirmed）

### 我們的劣勢/風險
1. **不在排行榜上** — 需要確認為什麼已註冊但未出現（最關鍵問題）
2. **未被評測系統呼叫** — 可能是評測系統還沒排到，或有其他入口步驟
3. **Credits 限制** — 兩個 API 都 blocked

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
