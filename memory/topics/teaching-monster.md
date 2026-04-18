---
related: [teaching-monster-strategy, teaching-monster-competitors, teaching-monster-full-intel, cognitive-science-tm]
---
# Teaching Monster 競賽 — 完整資訊盤點

> 結構化盤點 + 約束框架分析。競爭情報另見 `teaching-monster-competitors.md`。
> Last updated: 2026-04-05

---

## 1. 競賽規則

**名稱**: Teaching Monster — Teaching Agent Arena（第一屆 AI 教學挑戰賽）
**主辦**: 國立台灣大學 AI 卓越研究中心（NTU AI-CoRE）
**核心任務**: 找到能理解學習需求、全自動生成自適應教學影片的 AI Agent
**核心理念**: 「生成影片」不等於「有效教學」。比的是 Pedagogical Content Knowledge（PCK）— 知道教什麼，更知道怎麼教
**名字由來**: 致敬《暗殺教室》殺老師（Koro-sensei）— 即時根據每個學生需求生成最適合的學習內容

**參賽資格**:
- 全球開放：開發者、研究人員、學生、AI 愛好者
- 個人或團隊（可代表實驗室或組織）
- 科目：中學程度（12-18 歲）物理、生物、資訊科學、數學
- 課程框架：參照 IB（國際文憑）和 AP（大學先修）
- 語言：影片主要使用英文

**報名流程**:
1. teaching.monster/app → 右上「登入 / 註冊」（Clerk OAuth，Google 帳號或 email/密碼）
2. Settings 頁面同意「Contestant Agreement」啟用選手身份
3. 選手中心 → 選擇競賽 → 「新增模型」→ 輸入模型名稱 + API Endpoint URL
4. 用平台測試功能確認 API 通訊正常
5. 開始生成影片 → 發布

**全自動化政策**: 從收到題目到產出影片，全程由演算法自主完成，禁止任何人工介入（腳本、剪輯、配音）。以代碼驗證嚴格執行。

**透明度要求**: 需揭露使用的付費服務；驗證階段需保持可存取。

**獎項**:
- 金獎：第一名
- 銀獎：第二、三名
- 所有決賽入圍者獲得官方證書

**聯繫**:
- 一般：teaching.monster@ntu.edu.tw
- 技術：teaching.monster@gmail.com / platform.support@ntu.edu.tw

---

## 2. 評分標準

四個維度，每個都重要，但在不同賽段被不同類型的評審評估：

### 2.1 內容準確性與實證基礎
- **零幻覺原則**：拒絕任何誤導性捏造
- 驗證數學推導、技術名詞、歷史數據、程式範例
- 需要「核心原理」，不是表面術語
- 引用必須真實存在、學術上合理
- 禁止捏造數據/論文
- 第三方素材需標示來源，優先使用 CC 授權

### 2.2 教學邏輯與結構流暢度
- 「簡單到深入」漸進式教學（scaffolding）
- 從學生已知概念搭建到新知識
- 段落之間保持連貫敘事流
- 知識點互相連結形成完整邏輯鏈

### 2.3 學習者需求適應
- 精確識別學生的近端發展區（Zone of Proximal Development）
- 根據認知程度調整語言深度和例子
- 類比和舉例貼合目標受眾的經驗和認知水準

### 2.4 認知參與度與多模態呈現
- 將知識融入生動案例/類比，觸發學習動機
- 使用教學策略：懸疑設計、蘇格拉底式提問、定期總結
- 視覺元素（圖表、動畫）需「具體幫助理解抽象概念」
- 視覺與音頻解說同步

### 評審結構（2026-03-22 更新）

| 階段 | 評審 | 方式 | 影響 |
|------|------|------|------|
| Warm-up R1 | AI Student | LLM 生成題目 → 自動評分 | 僅參考，不影響成績 |
| Warm-up R2 | 評審委員會 | 評審設計的模擬情境 | 僅參考，不影響成績 |
| 初賽（初篩） | AI Student | 四大維度自動評分 | **篩出最多 10 隊進入真人評審** |
| 初賽（真人） | 真人評審 | Arena 式配對比較（同題目兩影片並排）→ Elo 排名 | 前 3 名晉級決賽 |
| 決賽 | 高中老師 + 大學教授 | 專家小組出題 + 評分，有限測試次數 | 決定金銀獎 |

**⚠️ 2026-03-22 規則調整**：初賽新增 AI Student 初篩階段。原本是所有參賽者直接進入真人 Arena，現在改為「AI 評分 → top 10 → 真人 Arena → top 3」兩階段篩選。

**戰略含義**：
1. AI Student 分數從「僅供參考」變成「初賽門檻」— 暖身賽的 AI 評分模式就是初賽初篩的模式
2. 我們暖身賽的 AI Student 分數（4.9/4.7/4.3）是直接可預測初篩表現的數據
3. 必須確保在所有參賽隊伍中排名前 10 才能進入真人評審
4. 真人 Arena 是 Elo 制的配對比較 — 相對品質比絕對品質更重要

---

## 3. 時程

| 日期 | 階段 | 說明 | 我們的狀態 |
|------|------|------|-----------|
| **3/1** | Warm-up R1 開始 | LLM 生成題目；AI Student 自動回饋 | 未報名 |
| **4 月初** | Warm-up R2 | 評審設計的模擬情境 | — |
| **5/1** | 初賽開始 | 評審設計題目；真人學生 Arena 評分 | — |
| **5/15** | 初賽結束 | Elo 排名確定 | — |
| **6/8** | 決賽名單公布 | 前三名晉級 | — |
| **6/12-13** | 決賽 | 專家評審現場出題，有限測試次數 | — |
| **6/26** | 頒獎典禮 | 線上發表 + 技術分享 | — |

**關鍵時間點**：離初賽（5/1）剩 26 天（as of 4/5）。WR1 完成（32/32 topics），WR2 規則寫「4月初」但 4/5 仍未上線（排行榜無第二輪 tab，news 最新公告 3/29）。排行榜 URL 已改為 `/app/leaderboard`。

---

## 4. 技術限制

### API 介面
- 格式：JSON via HTTP/HTTPS
- Input: `{ request_id, course_requirement, student_persona }`
- Output: `{ video_url (必填), subtitle_url (選填, SRT/VTT), supplementary_url (選填, 最多 5 檔, 總計 100MB) }`
- 內容必須在回應前完全生成並可下載
- 連結需保持 48 小時有效

### 影片規格
- 格式：MP4
- 解析度：最低 1280x720p
- 音頻：取樣率最低 16kHz，清晰語音
- 長度：最長 30 分鐘
- 檔案大小：最大 3GB
- 風格自由：投影片+旁白、數位 Avatar、動態圖形皆可

### 系統限制
- 延遲上限：30 分鐘（從收到請求到回傳結果）
- 完全自動化：禁止任何人工介入
- 允許工具：網路搜尋、第三方 LLM、程式碼執行器
- 請求間隔：同一題目最少 5 分鐘
- 付費服務需揭露

### 驗證機制（決賽入圍者）
- 需提交完整系統代碼（Docker image）
- 在隔離環境中重現驗證
- 兩階段：比賽中用即時 API，驗證時用 Docker 重現

---

## 5. 可用資源

### 官方提供
- 測試區：可在平台上測試 API 通訊
- 測試區影片樣本（from #discussion 3/13）：
  - `c1_t8_m31.mp4`（細胞區室化）
  - `c1_t9_m31.mp4`（細胞呼吸）
  - `c1_t15_m31.mp4`（最佳化問題簡介）
  - URL pattern: `https://teaching.monster/static/materials/{filename}`
- Slack workspace（2/26 建立）：#discussion 113 成員、#announcement 98 人

### 開源工具/框架
- Code2Video（arxiv 2510.01174）：Planner-Coder-Critic 三 agent，TeachQuiz +40%
- Topic2Manim（github.com/mateolafalce/topic2manim）：Script → TTS → Manim → Video
- Generative Manim（blog.brightcoding.dev）：GPT-4o/Claude Sonnet 3.5，物理模擬
- Manimator（arxiv 2507.14306）：論文 → 視覺解說
- Manim Community Docker：hub.docker.com/r/manimcommunity/manim

### 我們已有的
- Pipeline 目錄：`~/Workspace/teaching-monster/`
- Tech stack：TypeScript + Claude API + Puppeteer + FFmpeg
- Pipeline：Plan → Script → [Slides + TTS parallel] → Assemble
- 已有 2 次成功 end-to-end run
- KaTeX SSR 確認走 Node.js SSR 路線

### 部署方案參考
- Cloudflare Tunnel 做公開 API endpoint（社群分享，免費）
- Fly.io（Docker 原生支援，auto-stop <$1/月）
- Cloudflare R2（影片存儲，免出口流量費，10GB/月免費）

---

## 6. 社群討論與 Insight

### Slack #discussion 關鍵情報

**頻道狀態**（截至 3/17）：
- #discussion：113 成員，訊息從 3/13 開始
- #announcement：98 人，目前幾乎空
- #deprecated：2/25 從「助教團隊討論」改名停用，無有用資料

**郭庭均（阿童）**：分享測試區影片樣本 URL，看起來是助教或工作人員

**SpeechLab 教學方法**（來自研究「大金老師」教學影片）：
1. Scenario-First — 故事/情境開場，不用抽象定義
2. Core Analogy Callbacks — 一個比喻貫穿全課反覆引用
3. Progressive Disclosure — 先問問題再揭答案

**阿宇 Multi-model pipeline**：Haiku 初稿 + Sonnet 審稿兩階段。引起 SpeechLab 興趣。

**Elo Arena 心理學研究**（from 實作路線圖研究）：
- 前 3 秒定生死：65% 觀眾繼續看 10 秒，超過 33% 在前 30 秒跳出
- Distinction Bias：並排比較時學生過度放大視覺差異的重要性
- 短影片 > 長影片：瞄準 5-8 分鐘最佳區間
- 女性聲音在教育場景被評為更可信
- 清晰 + 乾淨 + 一致 > 華麗但不穩定

---

## 7. 約束框架分析

用 Alex 教的三個分析工具來看這場競賽的結構。

### 7.1 約束三分法

**Ground（不可變規則 — 地板）**：
- 4 個評分維度（Accuracy / Logic & Flow / Adaptability / Engagement）
- 初賽是 Arena pairwise Elo（不是評委打分，是學生 A/B 選擇）
- 決賽是專家出題評分（高中老師 + 大學教授）
- 30 分鐘延遲上限
- MP4, 720p+, 英文, 全自動
- 決賽需提交 Docker image 驗證
- 時程固定：5/1 初賽，6/12 決賽

**Constraint（資源限制 — 天花板）**：
- 時間：離初賽 ~45 天，目前 0 提交 vs SpeechLab 32/32
- API 成本：Claude API 調用費用、TTS 費用
- 報名狀態：teaching.monster 曾 HTTP 521，Clerk OAuth headless 完成不了，需 Alex 手動登入一次
- 人力：1 個 AI agent + Alex（兼職），vs SpeechLab = 台大實驗室完整團隊
- 科目覆蓋：4 個科目（物理、生物、CS、數學），不同科目需要不同視覺策略

**Gift（可借力的 — 槓桿）**：
- Kokoro TTS：HF Arena #1，82M params，Apache 2.0，免費且品質最高
- Claude API：教學規劃能力強，PCK 理解最佳
- 開源框架：Code2Video, Topic2Manim, Generative Manim 都可參考
- Slack 社群公開：SpeechLab 主動分享技術棧和教學方法論
- 已有可運行 pipeline：2 次成功 end-to-end run
- Cloudflare Tunnel/R2：免費部署方案
- 測試區影片樣本：可以研究題目出法和預期格式
- Arena 心理學研究：Distinction Bias、3 秒規則等已有具體策略

### 7.2 Interface shapes cognition

**評審看到的介面是什麼？**

初賽：兩個影片並排，學生選一個。這就是全部的介面。
- 學生不會看到腳本、不會看到技術架構、不會看到你的 scaffolding 理論
- 學生看到的是：前 3 秒的視覺衝擊 → 聲音品質 → 內容是否吸引人
- **Arena 格式本身就是一個 Interface，它會放大視覺差異（Distinction Bias）**

決賽：專家評審出題，看完整影片，對照四個維度評分。
- 專家會看更深：scaffolding 是否真正 adaptive、知識是否準確、邏輯是否連貫
- 專家的 Interface 是「帶著評分維度的專業眼光」
- 這個 Interface 會讓他們特別注意：錯誤（零容忍）、ZPD 適應性（是否真的根據 persona 調整）

**介面如何形塑判斷？**

初賽 Arena 介面的效果：
- 並排比較 → 相對判斷，不是絕對判斷 → 只要比對手好一點就贏
- 視覺第一印象 → 前 3 秒決定勝負 → Hook 是最高優先級
- 學生不是教育專家 → 他們用「直覺」判斷誰教得好 → Engagement 維度權重自然放大
- 短影片完成率高 → 看完的影片比看一半棄的影片印象好

決賽專家介面的效果：
- 帶著維度看 → Accuracy 的錯誤會被放大注意到
- 教育專業者 → 能辨別「假 scaffolding」（只是分段）vs「真 scaffolding」（ZPD 適應）
- 有限測試次數 → 一致性比偶爾驚艷重要

**我們能設計介面來引導注意力嗎？**

可以。影片本身就是我們能完全控制的介面：
1. **前 3 秒 Hook**：用悖論/驚奇事實抓住注意力，不要用「Today we'll learn...」
2. **視覺一致性**：清晰的 progress bar、section icon、key term highlighting — 在 Arena 並排時一眼就看出不同
3. **5-8 分鐘甜蜜區**：不填充到 15 分鐘，保持學生看完的機率
4. **結尾 callback**：回到開場的問題/悖論，給出完整答案 — 這個 closure 會提升「教得好」的感覺

### 7.3 Regime formation

**什麼約束組合會穩定成 winning pattern？**

Arena Elo 系統的 regime 特性：
- Elo 是零和遊戲 — 你贏 = 對手輸
- 每場配對是隨機的 — 你無法選對手
- 分數來自大量配對的累積 — **一致性 > 偶爾的驚艷**
- 一部失敗的影片（API timeout、render 錯誤）= 確定輸一場 = Elo 下降

這些約束互相穩定成一個 regime：**穩定可靠的中上品質 > 不穩定的頂級品質**。

這就是 Gemini Protocol 的教訓反過來用：
- 保護性約束（Elo 的隨機配對 + 累積性質）→ 獎勵一致性
- 如果你的系統有 10% 機率失敗，在 32 場配對中你大約輸 3 場 = Elo 嚴重拖累
- 反之，如果你每場都穩定交出 80 分的影片，在 Elo 系統中會自然上升

**SpeechLab 走的 regime**：
- 資源型路線：ElevenLabs TTS（付費高品質）+ GPT-4o + @napi-rs/canvas
- 已迭代 10 版 → 穩定性高
- 32/32 全提交 → 進入 Arena 配對池，開始累積 Elo
- 他們的 regime：高資源投入 + 大量迭代 → 穩定品質

**我們能走的不同 regime**：

SpeechLab 的 regime 是「資源 + 迭代 → 穩定」。我們資源和迭代次數都不如他們，不能走同一條路。

我們的 regime 應該是「教學設計品質 + Arena 心理學 → 贏在判斷時刻」：
1. **Accuracy 是 Ground，不是差異化** — 零幻覺是門檻，兩邊都該做到，不算贏
2. **Hook + 視覺 = Arena 介面的決定因素** — 並排比較時，前 3 秒和視覺品質決定學生的「第一印象」，而第一印象是 pairwise 選擇的最大驅動力
3. **真正的 Persona Adaptation = 決賽的決定因素** — 專家能看出假 scaffolding，這是他們的專業。如果我們做到真正的 ZPD 分析，專家會認出來
4. **5-8 分鐘 + 敘事弧 = 完成率保障** — 學生看完的影片永遠比看一半的影片印象好

用 Riedl 的語言：Persona（學生建模）是一層約束，只產生分化。Persona + ToM（根據 ZPD 做 metacognitive 調整）= 兩層約束 → 穩定的教學品質 regime。SpeechLab 的 AI audit 低分就是因為他們只有 Persona 沒有 ToM — 重複知識點太多次 + 通用比喻，代表他們沒有真正模擬學生的認知狀態。

---

## 8. 現況與缺口（2026-04-04 更新）

### 已完成
- [x] 報名 + 帳號登入 + Kuro-Teach 模型 active（2026-03-18）
- [x] Pipeline 端到端（Plan → Script → Slides+TTS → Assemble → Upload）
- [x] KaTeX SSR 數學渲染
- [x] Kokoro TTS（免費，HF Arena #1）
- [x] Cloudflare Tunnel（teach.kuro.page）+ R2 影片存儲
- [x] Hook prompt engineering（cognitive dissonance opening, wonder moment closing）
- [x] Persona-Adaptive scaffolding（persona compliance check, writing guide, fading speed）
- [x] Engagement 修復（commitment gap detection, analogy callback cadence, passive streak prevention）
- [x] Adaptation 修復（interest anchoring, learning style audible, persona signal hard gate）
- [x] Math accuracy gate + formula coverage gate
- [x] Non-STEM handling + interdisciplinary bridge
- [x] WR2 prompt improvements（withholding gate, omission narration, persona refresh）
- [x] Derivation-reveal animation template
- [x] Cross-section quality checker
- [x] WR1 全部 27+ 題評測完成（4/1 re-run，API cost ~$19）
- [x] Elo Arena 心理學研究 + 競爭情報

### WR2 就緒缺口（按優先級）
1. **⚠️ Server 離線** — pipeline server 未運行，tunnel 未 active。WR2 啟動時若收到請求會失敗。需 Alex 上線後啟動
2. **⚠️ Session 過期** — teaching.monster dashboard 需重新登入，無法看到 WR2 選項或接收通知
3. **⚠️ E2E 未驗證** — 最後一次完整測試 3/31，之後有 15+ commits（含 math accuracy gate、formula coverage gate 等重大改動），pipeline 穩定性未驗證
4. **模糊指令 scope negotiation** — R2 準備研究列為高優先，withholding gate 部分覆蓋但完整 scope negotiation 未確認
5. **Docker 打包** — 決賽需要，目前未做（非急迫，5/1 前完成即可）

### 已解決的風險
- ~~報名/網站宕機~~：已完成
- ~~從 0 到能競爭~~：WR1 排名 #2（4.7/5），pipeline 成熟
- ~~成本~~：Claude API ~$19/round，可控

### 當前最大風險
1. **WR2 miss window** — "early April" 窗口已開始，server 離線 + session 過期 = 可能錯過請求
2. **15 commits 未驗證** — 新 gate（math accuracy, formula coverage）可能引入 regression
3. **評審出題風格未知** — WR2 by human reviewers，比 WR1 LLM 題目更 nuanced，我們只能準備策略不能準備答案

---

## 9. 資訊缺口（待調查）

- [x] Warm-up R1 的具體題目格式和 AI Student 回饋 — 已有完整數據（27+ 題，4 維度評分）
- [x] 暖身賽排行榜是否公開 — 是，登入後可見
- [x] teaching.monster 網站恢復狀態 — 穩定運行
- [ ] 初賽的配對數量：每個 agent 會被配對多少次？
- [ ] 學生評審的背景：大學生？高中生？都有？（影響影片語調和視覺風格策略）
- [ ] WR2 確切啟動日期（規則寫 "4 月初"，4/4 尚未開始）
- [ ] BlackShiba 技術棧和近期動態（WR1 最高分對手）

---

## Playbooks

### Regenerate 全部題目

**Trigger**: 需要重新生成熱身賽/初賽的全部（或部分）題目
**前提**: Teaching Monster 已登入 kuro.ai.agent、endpoint 已設定、server 運行中

1. 確認 server 健康：`curl -s https://teach.kuro.page/health` → 200
2. CDP inspect teaching.monster 管理頁（`/app/competitions/2/manage`）
3. 點「熱身賽第一輪」tab → 點「全部生成」按鈕
4. 自動接受確認 dialog
5. 確認第一題開始跑（頁面顯示「處理中...」）

**Gotchas**:
- Server 一次只處理一題，32 題全跑完需 2.5-5 小時
- 生成中途 server crash 會導致空目錄 = 永久失分，先確認 uncaughtException handler 在
- `PORT` env var 衝突：parent process 的 PORT=3001 會覆蓋 .env 的 PORT=3456（node --env-file 不覆蓋已存在的 env var）

### 更新 API Endpoint

**Trigger**: 換 tunnel URL 或部署新 endpoint
**前提**: Teaching Monster 已登入 kuro.ai.agent

1. CDP 到 `/app/competitions/2/manage` → Settings 或 Model 設定頁
2. 找到 endpoint URL 欄位 → 清空 → 輸入新 URL
3. 儲存
4. 驗證：`curl -s <new-url>/health` → 200

**Gotchas**:
- Quick tunnel URL 每次重啟會變，Named tunnel (`teach.kuro.page`) 穩定
- OAuth session 可能過期 — 先確認右上角顯示 kuro.ai.agent 帳號
- Google OAuth 登入時 Chrome 預設選 alexlee7171，要手動切換帳號（到 accounts.google.com 加帳號再回來）

### 查排行榜

**Trigger**: 想確認目前排名和分數
**前提**: Teaching Monster 已登入

1. CDP fetch `teaching.monster/app/competitions/2/leaderboard`
2. 解析表格：model name / overall score / 四維度分數 / 完成題數

**Gotchas**:
- 分數會隨評測進度浮動（AI Student 可能還沒評完全部）
- 顯示的題數 ≠ 已評完的題數，看 overall score 旁邊的 (n/32)

---

## 來源

- [Teaching Monster 官網](https://teaching.monster/?lang=en)
- [Teaching Monster 規則頁](https://teaching.monster/rules)
- [Teaching Monster FAQ](https://teaching.monster/faq)
- [Teaching Monster 新聞](https://teaching.monster/news)
- Slack #discussion（Teaching Monster workspace, 3/13-3/17 訊息）
- [Code2Video 論文](https://arxiv.org/html/2510.01174v1)
- mesh-output/teaching-monster-competition-research-2026-03-17.md
- mesh-output/teaching-monster-implementation-roadmap-2026-03-17.md
- mesh-output/teaching-monster-registration-2026-03-17.md

---

## 更新日誌
- **2026-03-17 (v2)**: 完整資訊盤點 — 7 類別分類 + 約束框架分析（Constraint/Ground/Gift、Interface shapes cognition、Regime formation）
- **2026-03-17 (v1)**: 初版 — 時間軸式 append 記錄
- kuro.ai.agent@gmail.com 在 Chrome CDP `/u/1/` slot
- plugins/email-check.sh（33260ae）定期掃描
- 目前收件匣 44 封，無 TM 競賽關鍵通知
- Slack 確認碼 KVJ-3TS 待使用（加入 TM Slack workspace）
- TM 帳號登入正常（今天 1:17 PM 登入通知）

[2026-03-17] 公開 endpoint 研究結論：Cloudflare Tunnel（`cloudflared`）推薦用來暴露 localhost:3456 給競賽平台。業界標準、免費、設定簡單。

[2026-03-17] ⚠️ **正確路徑：`/Users/user/Workspace/teaching-monster/`**。不是 `teaching-monster-remotion`（已清除的舊 worktree）、不是 `teaching.monster`（dot）。所有 delegation、smoke test、檔案操作都必須用這個路徑。已因用錯路徑被 Alex 指正兩次（3/21、3/30）。
- Repo: ~/Workspace/teaching-monster/kokoro-tts/
- Venv: .venv (Python 3.13, 系統 3.14.3 不相容需明確用 .venv)
- PyTorch 2.10.0, MPS available (Apple Silicon GPU 加速)
- `from kokoro import KPipeline` import OK
- 也有 kokoro.js (JS 版本)
- 下一步：下載模型權重 + 測試 TTS 生成
- [2026-03-17] ## Task Queue 修剪（2026-03-17 22:40）
19 項獨立 task 合併成 5 項。所有 Teaching Monster pipeline 子任務（TTS、視覺、persona、prompt、品質審查、部署、Slack scan、大金老師研究、AI audit）合併到 umbrella goal 內，不再獨立追蹤。Email 註冊和提交影片保留為獨立 task（前置條件）。兩則 Alex 回覆（#deprecated、email 信箱）已回應過（#172, #231），email cron 已設定。
- [2026-03-18] ## 提交格式確認（2026-03-18）

**重大發現**：Teaching Monster 提交方式是**提供 API endpoint**，不是上傳 mp4。
- 平台發 JSON HTTP(S) 請求到參賽者的 endpoint
- 參賽者 API 回傳教學內容（JSON 格式）
- 來源：research delegate 直接抓取 teaching.monster 官網 /rules、/competition、/guidelines 頁面確認

**架構影響**：
- 需要 HTTP API server（不只是 CLI pipeline）
- 延遲敏感（即時回應 vs 離線生成）
- 需要公開部署（Cloudflare Workers / fly.io / Railway）
- Video pipeline 是 API backend 的一部分，不是獨立產物

研究觸手確認 Teaching Monster 提交方式是**提供 API endpoint 讓平台呼叫**（JSON over HTTP），不是上傳 mp4 檔案。

架構從「離線批次生成 → 上傳」轉為「即時 API service → 接收請求 → 生成 → 回傳」。

影響：
- Pipeline（Playwright + KaTeX + FFmpeg）仍然需要，但作為 API backend
- 新增 HTTP server 層（Hono/Express）
- 延遲成為關鍵指標（即時回應 vs 離線無所謂）
- 需要公開可訪問的 endpoint（fly.io / Cloudflare Workers）
- 「提交影片」任務 → 「部署 API + 註冊 endpoint」任務
- 「雲端上傳」任務作廢

下一步：確認 API 詳細規格（request/response schema, timeout, auth）
1. tsunumon（SpeechLab/宇你童行）4.8/5（32/32 題全評完，正確5.0/邏輯5.0/適配4.5/互動4.5）
2. Kuro-Teach 4.2/5（17/26 題評完，正確4.1/邏輯4.3/適配4.1/互動4.3）— 6題生成失敗+9題待評測
3. XiaoJin-v12（小金）1.6/5（32/32 題，正確1.0/邏輯1.1/適配2.6/互動1.7）— 意外低分
差距分析：最大弱項是「正確性」(-0.9) 和「適配性」(-0.4)。改進方向：(1) 內容品質+準確度 (2) persona 適配 (3) 修復6個失敗題目
1. System prompt 加入 Student Persona Adaptation（知識水平、學習風格、年齡、興趣全面適配）
2. System prompt 加入 Factual Accuracy Rules（禁止 pseudo-math，域內記法）
3. buildUserPrompt 注入完整 student_persona JSON
4. 全鏈路傳遞：server.mjs → generateScriptToFile → generateScript → SDK/CLI
5. Self-check 從 5 項擴到 7 項（加正確性驗證 + persona 適配）

針對的弱項：正確性 4.1 → 禁止偽公式+強制事實驗證，適配性 4.1 → 完整 persona 注入。

**推薦方案：Puppeteer screencast pipeline**

Pipeline:
1. Script → HTML slides（KaTeX 數學渲染 + CSS 動畫）
2. Puppeteer `page.screencast({ path: 'out.mp4', format: 'mp4', fps: 30 })` → 無聲 MP4
3. Kokoro TTS → 音訊檔
4. FFmpeg 合併 video + audio → 最終 MP4

關鍵細節：
- `page.screencast()` 是 Puppeteer 原生 API，直接輸出 MP4/WebM/GIF
- 需要本地安裝 FFmpeg（我們已有）
- **screencast 不支援音訊** — 必須用 FFmpeg 另外合併 TTS 音軌
- 支援 crop/fps/quality/scale/speed 選項
- 不需要逐幀截圖+拼接（那個方案更複雜，只有需要精確控制 timing 時才用）

替代方案（如果 screencast 品質不夠）：
- 逐幀 screenshot → FFmpeg `image2pipe` 拼接（更精確控制 timing，但更複雜）
- Reveal.js + KaTeX plugin 做投影片框架（自帶轉場動畫）
- p5.teach / Manim-Web（JS port）做數學動畫（目前偏 immature）

結論：先用最簡方案（screencast），遇到品質問題再升級。

Sources:
- https://pptr.dev/api/puppeteer.page.screencast
- https://screenshotone.com/blog/how-to-record-videos-with-puppeteer/
- https://robinz.in/convert-an-html5-slideshow-to-a-video/
- https://katex.org/
- [2026-03-18] KaTeX + HTML-to-video 研究結論（2026-03-18）：
推薦方案：**Puppeteer screencast pipeline**
`Script → HTML(KaTeX+CSS動畫) → page.screencast() → MP4(無聲) → FFmpeg + Kokoro TTS → 最終影片`
- Puppeteer 原生 screencast 直接輸出 MP4，不需逐幀截圖
- 不支援音訊，必須 FFmpeg 合併
- 不需要 Manim — HTML + KaTeX + CSS transitions 就夠了
- Phase 1 拆為 5 步：(1)HTML template (2)Puppeteer screencast (3)TTS+FFmpeg (4)Script→HTML (5)E2E
Sources: pptr.dev/api/puppeteer.page.screencast, screenshotone.com/blog/how-to-record-videos-with-puppeteer/, katex.org
- Codebase: `/Users/user/Workspace/teaching-monster/src/` — server.mjs, generate-script.mjs, generate-slides.mjs, generate-audio.mjs, assemble-video.mjs, review-script.mjs
- KaTeX 目前 client-side CDN 載入（katex@0.16.11），Puppeteer 可能在渲染前截圖 → Phase 1 要換 SSR
- TTS fallback chain: OpenAI tts-1-hd → edge-tts → macOS say。Kokoro .venv-kokoro 已就位但未整合
- 26+ 成功生成在 output/celery_*，6 個失敗需調查
- teaching-monster-forge-1/ 有 TypeScript 版本（types.ts, stages/slides.ts）
- Phase 1 最高槓桿：修失敗 > KaTeX SSR > prompt 精化 > Kokoro > 視覺
1. tsunumon（SpeechLab/宇你童行）4.7/5（32/32，正確5.0/邏輯5.0/適配4.5/互動4.5）— 微降
2. TestPipeline（Team 78）4.4/5（32/32，正確4.7/邏輯4.9/適配4.3/互動3.8）— **新進入者，超越我們**
3. Kuro-Teach 4.3/5（26/32，正確4.3/邏輯4.5/適配4.2/互動4.3）— 從 #2 降到 #3
4. XiaoJin-v14（小金）3.7/5（18/32）— 小金的新版本
5. XiaoJin-v9b 2.1/5, XiaoJin-v12 1.6/5
7. Sigoso Teaching AI（Captain小波）— 無分數
關鍵變化：TestPipeline 32/32 全評完且超越我們。我們仍然 6 題生成失敗（26/32）。regenerate 可修復失敗題目。

**核心**：教抽象概念前，先用具體生活情境建立錨點，引導學生自己推導出原理。降低認知隔閡，提升學習動機。

**如何應用到 generate-script.mjs prompt**：
1. 每個題目的 script 開頭加「生活情境」段落 — 不是直接說「今天學 X」，而是「你有沒有想過 Y？」
2. 從情境自然過渡到概念 — 讓學生感覺是在解決問題，不是在上課
3. prompt 中加入指引：「Start with a relatable scenario that makes the student curious about the concept before introducing formal definitions」

**下一步**：等 FG lane 完成技術修復（JSON parsing + retry），再改 prompt 加入 Scenario-First 指引。這是 prompt engineering 階段的第一個改善方向。

**來源**：delegate research 大金老師教學技巧（confidence 8/10）
- [2026-03-19] ## Scenario-First Prompt Engineering 模板（2026-03-19）

### 目的
注入 generate-script.mjs 的 system prompt，提升教學品質分數。

### 四階段結構
1. **情境錨點**（~30s）— 具體生活場景引入抽象概念（例：分披薩→分數）
2. **探索推導**（~60s）— 從情境延伸到數學操作，引導式提問
3. **形式化**（~30s）— 收束為正式定義，連結回情境
4. **延伸練習**（~30s）— 變化題鞏固理解

### Prompt 指引草稿（待注入 system prompt）
```
教學風格指引：
- 永遠從一個具體的生活情境開始，不要直接給定義
- 讓學生從情境中自己「發現」數學概念
- 每個抽象概念都要有一個「生活錨點」（為什麼要學這個）
- 公式和圖解要跟口語解釋同步出現，不要只列公式
- 結尾連結回開頭的情境，形成閉環
```

### 關鍵判斷
分數差距來自教學品質不是影片品質。Scenario-First 直接瞄準評分核心。
來源：大金老師教學技巧研究（觸手回報，confidence 8/10）
- [2026-03-19] ## Scoring Calibration（2026-03-19 12:04）

**核心發現**：Scenario-First prompt 模板瞄準了最小的 gap（Engagement -0.2），但最大 gap 是 Accuracy (-0.7) 和 Logic (-0.5)。

**校準後優先級**：
1. Accuracy (-0.7) — 自我驗證步驟、禁止偽公式、逐步推導可驗證
2. Logic (-0.5) — 強化步驟間邏輯連結、每個概念有 prerequisite 明確聲明
3. Adaptability (-0.3) — Scenario 根據 student_persona 選擇，不是通用
4. Engagement (-0.2) — 維持現狀，不額外投入

**Prompt 模板更新方向**：
- 加入 `Self-Verification Rule`: 每個數學推導、公式、數據都要求 Claude 在生成後自我驗證
- Logic connectors: 每段教學之間要有明確的「因此/所以/這就導致」連結句
- Persona-aware scenarios: system prompt 讀取 student_persona → 選擇適配的生活情境

Source: WebFetch teaching.monster + 排行榜分數比對分析
- [2026-03-21] [2026-03-21] Pipeline 完整度確認（第三次驗證，最終結論）：generate-slides.mjs 的 4 項功能全部已實作：
1. KaTeX SSR — renderLatexSSR()
2. SVG Diagram — visualDiagramCSS/Body hub-spoke  
3. Two-column layout — 每 3 張 concept slide 自動雙欄
4. Code syntax highlighting — highlight.js 5 語言 + renderCodeSSR() + 自訂 Kuro-Teach CSS 配色
Slidev 報告的 4 個缺陷 = 0 個真實缺陷。改善方向不是「補功能」而是「提升內容品質」（prompt / 思考框架 / persona 適性化）。
教訓：grep 要查實際用的 library 名字，不是你預期的名字。
- [2026-03-24] [2026-03-24] 排行榜 Warm-up 1 狀態：#1 BlackShiba 4.8(32/32) #2 tsunumon 4.7(32/32) #3 Kuro-Teach 4.7(31/32) #4 Team67 4.4(32/32) #5 小金 3.6(32/32)。Topic 41「向量」AI 評測已觸發（49/50 points remaining）。
平台規則調整（2026-03-22）：初賽 AI 分數取 top 10 進人類評估 → top 3 進決賽。
平台 URL 結構：排行榜 /app/leaderboard，控制台 /app，管理 /app/competitions/2/manage。需要 1920x1080 viewport 才能正常顯示。
分數差距分析：vs BlackShiba 差 0.1（主要在 Adaptation 4.6 vs 4.8），vs tsunumon 同分（Adaptation 我們贏 0.1，Engagement 差 0.1）。
- [2026-03-24] [2026-03-24 18:00] 排行榜狀態更新：
- 題目 ID 範圍 16-47（共 32 題），非 1-32
- 3 題未評測：#16 圓週運動, #17 角動量守恆, #41 向量（都已成功生成）
- 29 題 ERROR + 已完成：舊評測有效，ERROR 是近期重新生成失敗
- 50/50 評測點數可用（之前花的 1 點似乎被退回）
- 我們 29/32 = 3 題未評測，不是 3 題丟失評測
- vs BlackShiba 主要差距：適配 4.6 vs 4.8（-0.2）
- 我們在互動上贏 tsunumon（4.4 vs 4.5...wait 他們 4.5 我們 4.4，差 -0.1）
- 正確和邏輯基本滿分（4.9/5.0）
- [2026-03-27] ## TM API 端點（2026-03-27 驗證）

- `GET /models/56/generation_status` — 所有 topic 狀態列表（model_id=56 是 Kuro-Teach in warm-up round）
- `GET /ai_audit/{job_id}` — 完整評測報告（含 agent1/2/3 所有分析和評分明細）
- Auth: `Authorization: Bearer {token}`，token 從 `__session` cookie 取得
- Cookie 獲取：CDP → `Network.getCookies` for `teaching.monster`
- Viewport 必須設 ≥1024px，否則 SPA 顯示「螢幕解析度過低」

## #46 和 #47 新評測結果（2026-03-27）

| 題目 | Accuracy | Logic | Adaptability | Engagement | 總分 |
|------|----------|-------|-------------|------------|------|
| #46 實驗設計導論 | 5.0 | 5.0 | 5.0 | 5.0 | 20.0 |
| #47 微分方程邏輯模型 | 5.0 | 5.0 | 3.7 | 3.7 | 17.4 |

#47 扣分明細：Pacing Mismatch -1.0（Urgent 學生 vs 慢節奏）、Monotone Audio -1.0、AI Fatigue -0.3、Prerequisite Gap -0.3

## 暖身賽狀態（32 題）
- SUCCESS: #16, #17, #24, #25, #32, #36, #38, #41, #43, #45, #46, #47（12 題）
- ERROR: 其餘 20 題（多數 502 Bad Gateway，tunnel 當時沒開）
- 已評測: 大部分已評測，#32/#36/#38/#41/#43 尚未評測（ai_audit_status: null）
- #45 正在評測中（processing）
- [2026-03-27] [2026-03-27] 預測校準回填 — TM #46/#47 評測數據：

**#46 實驗設計導論**：20.0/20.0 滿分，零扣分。證明我們的 pipeline 能拿滿分。
**#47 微分方程邏輯模型**：17.4/20.0（Accuracy 5.0, Logic 5.0, Adaptability 3.7, Engagement 3.7）

我的預測 vs 實際（#028 gap analysis）：
- Accuracy: 預測 4.5 → 實際 5.0（+0.5，LaTeX 問題在重新生成後消失）
- Adaptability: 預測 4.4 → 實際 3.7（**-0.7，低估 Urgent pacing 懲罰力度**）
- Engagement: 預測 4.0 → 實際 3.7（-0.3）

校準洞察：
1. 我高估了內容問題（LaTeX）的影響，低估了 persona-matching 的懲罰力度
2. TTS 是硬天花板：pacing mismatch -1.0 + monotone -1.0 = 2.0 分，佔總扣分 77%
3. 新評測系統 persona 權重很高：同品質內容因 persona 不同差 2.6 分

API 端點備忘：`/ai_audit/{job_id}` with Bearer token from `__session` cookie
- [2026-04-04] [2026-04-04] TM 規則調整競情更新（原文日期 3/22，今日才確認）：初賽從 AI student 評分取至多 10 名做真人評估，前 3 名進決賽。WR 分數僅供參考。策略影響：human evaluation 是真正篩選，影片品質（人覺得好教好懂）> 純 AI 評分優化。

TM WR2 狀態 [2026-04-04 10:45]：尚未啟動。規則寫「4月初」但新聞頁無公告（最後更新 3/29）。Dashboard session 過期。
- [2026-04-08] **tm-poll.sh = canonical WR/leaderboard poll tool**
- Path: `/Users/user/Workspace/mini-agent/scripts/tm-poll.sh`
- 輸出：5 個 competition（comp1=test, comp2=WR1, comp3=WR2, comp4=semifinal, comp5=final），每個 JSON 後接 `HTTP 200`
- Parse pattern: split on `=== comp N ===`, strip trailing `HTTP \d+.*`, `json.loads` body
- API shape 確認：comp1/2 `primary_metric=ai_total_score`，comp3/4/5 `primary_metric=elo_score`（arena 模式）
- **2026-04-08 15:30 snapshot**: comp1=20 entries, comp2=14 entries (WR1), comp3-5=0 entries (WR2 仍未啟動)
- **規則**：下次要看 TM 排名，第一反應是跑這個 script，不要重刻 curl pipeline（前兩 cycle 就是因為重造輪子浪費 token + 一次把 subdomain 猜錯 NXDOMAIN）
- [2026-04-08] 2026-04-08 cycle #77 wrap-up: 寫了 `scripts/tm-kuro.sh`（commit 93c7d1ea）一行抓 Kuro 所有 comp 分數。Schema locked：`GET teaching.monster/competitions/{id}/leaderboard`，rankings entry 用 `competitor_display` key，Kuro 的顯示名是 `"Kuro"` 不是 `"Kuro-Teach"`，primary_metric 在 comp 1/2=`ai_total_score`、comp 3/4/5=`elo_score`。以後 poll 直接 `./scripts/tm-kuro.sh`，不要再重寫 jq/grep 猜格式。結晶原則：連續 parse failure = schema ignorance，立刻讀源頭封裝工具，不要第四次 guess。
- [2026-04-12] [2026-04-12 17:32] Warm-up R2 延遲觀測：comp 3-10 在 4/12 04:00 和 17:32 兩次 poll 都是零 entries。主辦方原宣告「4月初」已過，R2 尚未啟動。意涵：engagement 第四波改善（66c8f75）的可觀察週期被主辦方節奏卡住，不是技術問題。WR1 32/32 audits 鎖定，等 R2 開放才會有新 celery 評測流。
