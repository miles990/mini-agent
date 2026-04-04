---
related: [teaching-monster, teaching-monster-strategy, teaching-monster-full-intel]
---
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

## 排行榜實況（2026-04-04 13:02 CDP 抓取，WR1 re-evaluation 後）

| 排名 | 模型名 | 團隊 | AI 總分 | 已評主題 | 正確 | 邏輯 | 適配 | 互動 |
|------|--------|------|---------|----------|------|------|------|------|
| **1** | **Team-67-005** | **Team 67** | **4.8** | 31 | 5.0 | 5.0 | 4.8 | 4.4 |
| **2** | **BlackShiba 黑柴先生** | **BlackShiba Labs** | **4.8** | 32 | 4.9 | 5.0 | **4.8** | 4.3 |
| 3 | tsunumon | 宇你童行 | 4.7 | 32 | 5.0 | 5.0 | 4.5 | 4.5 |
| **4** | **Kuro-Teach** | **Kuro** | **4.7** | **32** | **4.7** | **4.8** | **4.7** | **4.4** |
| 5 | 史密提威威傑格曼傑森 | Team 67 | 4.4 | 32 | 4.7 | 4.9 | 4.3 | 3.8 |
| 6 | 初號機 | Team 26 | 4.2 | 25 | 4.5 | 4.7 | 4.6 | 3.0 |
| 7 | 小汐 Teaching Monster v3 | Xiao Xi | 4.0 | 32 | 4.0 | 4.3 | 3.5 | 4.2 |
| 8 | XiaoJin-v22-LaTeX | 小金 | 3.6 | 32 | 3.9 | 4.3 | 3.3 | 2.9 |
| 9 | storylens | Team 216 | 3.5 | 30 | 3.2 | 3.3 | 3.9 | 3.6 |
| 10 | Sigoso Teaching AI | Captain小波 | - | - | - | - | - | - |

**關鍵發現（4/4 vs 3/28 差異）**：
- **⚠️ 我們 Accuracy 暴跌！** 5.0→4.7（-0.3），Logic 5.0→4.8（-0.2）。Re-evaluation 用了不同的 AI 評審標準？還是重新生成的影片品質變了？
- **Topics 32/32** — 覆蓋率終於滿了
- **Team-67-005 登頂 #1！** 從 3/28 的 #4(4.7) → #1(4.8)。Acc+Logic 都衝到 5.0
- **我們從 #3 降到 #4** — 主要因為 Acc/Logic 下降
- **新對手出現**：初號機(Team 26, 4.2)、小汐 v3(Xiao Xi, 4.0)、storylens(Team 216, 3.5)
- **全能語感威聲格蕾蒂斯 → 史密提威威傑格曼傑森**：Team 67 的第二個模型改名了，分數不變(4.4)
- **場上參賽者增加**：7→10（+3 新模型）
- **WR2 尚未上線**：排行榜只有「熱身賽第一輪」tab，無第二輪

**⚠️ 最大風險：Accuracy 退步**
- Re-evaluation 後 Acc 從 5.0→4.7 是顯著退步。可能原因：
  1. AI 評審標準在 re-evaluation 時收緊
  2. 4/1 重跑生成的影片品質不一致
  3. 新評測 prompt 對 hallucination 更敏感
- 需要排查：下載 re-evaluation 的具體題目 + 我們的影片，看 Accuracy 哪裡扣分

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

## BlackShiba 黑柴先生（新）⭐ #1 對手

| 項目 | 資訊 |
|------|------|
| **團隊** | BlackShiba Labs |
| **首次出現** | 2026-03-24 排行榜（之前不在榜上） |
| **進度** | 32/32 全部完成 + AI 評測全完成 |
| **最強維度** | Adaptability 4.8（全場最高） |
| **最弱維度** | Engagement 4.3（前三名最低） |
| **公開足跡** | ❌ 零（無 web/GitHub/社群媒體）|

### 2026-03-28 全網搜索結果
- **Web**（英文+中文關鍵字）：零匹配。無官網、無部落格、無新聞
- **GitHub**：無組織、無 repo
- **社群媒體**：只有無關帳號（日本 VTuber @BlackShiba_chan、柴犬帳號 @blackshiba_momo）
- **TM Slack**：⚠️ 未確認（session 過期）

### 身份推論（三種可能）
1. **NTU 內部團隊**（最可能）— domain knowledge + platform familiarity 可解釋快速完成 32/32 + 高 Adapt
2. **改名重投** — 之前用其他名字參賽，成績不佳後重新包裝
3. **隱身高手** — 有經驗的團隊刻意低調不參與社群

### Adapt/Engage 鏡像分析
- **Adapt 4.8 / Engage 4.3** 的 trade-off 暗示：prompt 工程精緻（讀懂 persona → 調整策略）但互動設計偏模板化（無 engagement hook、缺蘇格拉底提問）
- **跟我們鏡像互補**：我們 Adapt 4.6 / Engage 4.4 vs 他們 Adapt 4.8 / Engage 4.3
- Elo Arena pairwise 配對到他們 → 我們贏 Engage 輸 Adapt，勝負取決於評審權重

### 已知弱點
- **Engagement 4.3** — 前三名最低。Elo Arena 直接比較會暴露
- **突然出現 + 零足跡** — 可能缺乏社群支持和迭代透明度

### 待調查
- [x] BlackShiba Labs 是誰？→ 全網搜索零結果，幽靈隊伍（2026-03-28）
- [ ] TM Slack #discussion 有沒有出現過？（需 Slack session 恢復）
- [ ] 技術棧是什麼？（TTS、model、pipeline）— 可能需要從影片反推
- [ ] Adaptability 4.8 怎麼做到的？需要抽查影片比對

---

## 競爭態勢總結（2026-04-04 更新）

| 團隊 | 排行榜排名 | AI 總分 | 技術路線 | 威脅等級 |
|------|-----------|---------|----------|----------|
| Team-67-005 (Team 67) | **#1** | **4.8** | 未知（快速迭代，2 模型） | 🔴 高 |
| BlackShiba Labs | **#2** | **4.8** | 未知 | 🔴 高 |
| tsunumon (阿宇) | #3 | 4.7 | Haiku+Sonnet（多模型） | 🔴 高 |
| **我們 (Kuro-Teach)** | **#4** | **4.7** (⚠️Acc 4.7↓) | Claude + Kokoro TTS（開源型） | — |
| 史密提威威傑格曼傑森 (Team 67) | #5 | 4.4 | 同上（Team 67 第二模型） | 🟡 中 |
| 初號機 (Team 26) | #6 | 4.2 | 未知（新） | 🟡 中 |
| 小汐 v3 (Xiao Xi) | #7 | 4.0 | 未知（新） | 🟢 低 |
| SpeechLab (小金 v22) | #8 | 3.6 | GPT-4o + ElevenLabs + LaTeX | 🟡 回血中 |
| storylens (Team 216) | #9 | 3.5 | 未知（新） | 🟢 低 |
| Captain小波 | #10 | - | 重置中 | 🟢 低 |

### 我們的差異化優勢
1. **Multi-model pipeline + 品質閘門** — engagement gate + review gate 雙層
2. **開源 TTS (Kokoro)** — Elo Arena 直接對比中音質是感知差異化
3. **Claude 腳本品質** — 教學設計深度是核心
4. **Adapt 穩定 4.7** — 跟 tsunumon 並列，僅輸 #1/#2 的 4.8
5. **32/32 完整覆蓋** — 全部主題已評測

### 我們的劣勢/風險
1. **⚠️ Accuracy 退步 5.0→4.7** — re-evaluation 後最大的退步點，需排查原因
2. **Logic 退步 5.0→4.8** — 同上
3. **Team 67 雙模型 + 登頂** — 最具威脅的對手，快速迭代，已超越 BlackShiba
4. **BlackShiba 情報不足** — 仍不知道對手技術棧和團隊背景
5. **Elo Arena 直接對比風險** — slide-based 影片在並排比較中的視覺豐富度
6. **WR2 即將開始** — 評審委員出的題目會更難，我們的 Acc 已經在退

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
- [x] **為什麼 Kuro-Teach 不在排行榜上？** — ✅ 已解決。我們在排行榜 #3（4.7），3/21 不在前三是暫時的（可能是重新評測期間）。API 直接抓取確認。
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
- **2026-04-04 13:02**: WR1 re-evaluation 後排行榜大洗牌。Team-67-005 登頂 #1(4.8)，我們從 #3→#4。**Accuracy 暴跌 5.0→4.7 是最大警訊**。場上增至 10 隊（+3 新）。WR2 尚未上線（排行榜只有 WR1 tab）。
- **2026-03-28 19:05**: CDP 排行榜截圖。**三個重要變化**：(1) 我們 Adapt 4.5→4.6（fix 見效！），topics 28→30；(2) Team-67-005 暴衝 4.4→4.7（新模型，Adapt 4.7）；(3) Engage 微降 4.5→4.4（新題拉低？待查）。Team 67 現有兩個模型上榜。總參賽數 7（+1）。
- **2026-03-27 19:05**: 排行榜 API 直接抓取（發現 `/competitions/{id}/leaderboard` 端點）。我們分數在爬：Acc 4.9→5.0（滿分！）、Engage 4.4→4.5。現在跟 tsunumon 完全同分。唯一差距 = Adaptability（4.5 vs BlackShiba 4.8）。Competition 3（初賽，Elo-based）尚未開始（空排行榜）。Comp 1 我們是 #1（4.8, 12/12）。
- **2026-03-27 15:45**: 情報掃描 — 官網無新公告（最新仍 3/22 規則調整）。Phase 2 pipeline E2E 測試通過（celery_458, 852s, $0.80）：PerSectionCheck 每 section 修正 3-4 slides、CrossSection 找到 45 number inconsistencies。品質閘門功能確認。排行榜未變動（無法登入確認）。**明天 3/28 = Tier 1.5 期限**，需做全量重生決策。⚠️ 28/32 問題仍未解（差 4 題）。
- **2026-03-26 16:57**: 排行榜掃描 — 排名穩定：BlackShiba #1(4.8, 32/32), tsunumon #2(4.7, 32/32), **Kuro-Teach #3(4.7, 28/32)**, Team 67 #4(4.4, 32/32), XiaoJin-v22 #5(3.6, 32/32), Captain小波 #6(-)。⚠️ 我們的已評主題從 31→28，差 4 題未評。其他隊伍全部 32/32。詳細分數：正確4.9/邏輯5.0/適配4.5/互動4.4。BlackShiba 適配 4.8 仍是最大差距。
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
- [2026-03-24] [2026-03-24] **規則調整（3/22 公告）**：初賽改為兩階段篩選。(1) AI 學生自動評四維度→取至多 10 名 (2) 真人 side-by-side Elo 評分→取前 3 名進決賽。AI 評分從「參考用」變「硬門檻」。暖身賽第二輪 4 月初開始（評審委員出題）。
- [2026-03-24] Slack #discussion: SpeechLab XiaoJin 說「花時間看影片」（仍活躍）。賴銘彥問初賽要產幾隻影片（擔心 API 帳單），阿童回「光暖身賽帳單就...」→ 部分參賽者受 API 成本約束。
