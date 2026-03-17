# Teaching Monster — 競爭情報（Pinned）

> 持續更新。每次掃 Slack #discussion 有新情報自動追加。
> Last updated: 2026-03-17 17:05

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

## 競爭態勢總結

| 團隊 | 提交進度 | 技術路線 | 威脅等級 |
|------|----------|----------|----------|
| SpeechLab (小金) | 32/32 ✅ | GPT-4o + ElevenLabs（資源型） | 🔴 高 |
| 阿宇 | 未知 | Haiku+Sonnet（多模型） | 🟡 中 |
| John Hsieh | 未知 | Cloudflare Tunnel | 🟢 低（技術分享者） |
| **我們** | **0/32** ❌ | Claude + Kokoro TTS（開源型） | — |

### 我們的差異化優勢
1. **Multi-model pipeline** — SpeechLab 想要但還沒有的
2. **開源 TTS (Kokoro)** — 不依賴付費 API，成本可控
3. **Claude 腳本品質** — 教學設計是真正的差異化點
4. **品質審查層** — 可避免 AI audit 低分問題

### 我們的劣勢
1. **進度嚴重落後** — 0/32 vs SpeechLab 的 32/32
2. **報名尚未完成** — 平台帳號啟用中
3. **TTS 品質待升級** — macOS say 品質不如 ElevenLabs

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
- [ ] SpeechLab YouTube 頻道「蝦說 AI」內容分析（看實際教學品質）
- [ ] 暖身賽排行榜是否公開（需登入 teaching.monster/app/leaderboard）
- [ ] NTU ML 2026 課程學生參賽規模（潛在大量對手）
- [ ] 新參賽者動態
- [ ] AI audit 評分標準變化
- [ ] 李宏毅 2026 AI Agent 講座內容（「解剖小龍蝦」OpenClaw 案例）

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
- **2026-03-17 17:00**: 擴充版 — 加入 web research 結果、競爭態勢表、外部資源連結
- **2026-03-17 09:00**: 初版建立 — Slack #discussion 直接掃描
