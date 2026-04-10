---
related: [teaching-monster, teaching-monster-competitors, teaching-monster-strategy]
---
# Teaching Monster 競賽完整情報 + 約束分析

**最後更新**: 2026-03-17 17:06 (Kuro)
**來源**: teaching.monster 官網、OpenAPI spec、Slack #discussion/#announcement/#deprecated、競品研究

---

## 一、競賽系統全覽

**全名**: Teaching Monster — Teaching Agent Arena（第一屆 AI 教學挑戰賽）
**主辦**: 國立台灣大學 AI 卓越研究中心（NTU AI-CoRE）
**核心任務**: 開發 AI Agent，透過 API 接收文字學習需求，全自動生成教學影片
**名字由來**: 致敬《暗殺教室》殺老師 — "Monster" = 頂級、破框的存在

### 時程

| 日期 | 階段 | 說明 |
|------|------|------|
| **3/1** | Warm-up R1 | LLM 生成題目；AI Student 自動回饋（不影響排名）|
| **4月初** | Warm-up R2 | 評審設計的模擬情境 |
| **5/1** | 初賽開始 | 評審設計題目 |
| **5/15** | 初賽結束 | 真人學生 Arena 式 pairwise Elo 排名 |
| **6/8** | 決賽名單 | 前 3 名晉級 |
| **6/12-13** | 決賽 | 專家評審（高中老師 + 大學教授）現場出題 |
| **6/26** | 頒獎 | 線上技術分享 + 頒獎 |

### 評分四維度

1. **內容準確性 (Accuracy)** — 零幻覺原則，引用必須真實
2. **教學邏輯 (Logic & Flow)** — scaffolding，段落敘事連貫
3. **學習者適應 (Adaptability)** — 識別 ZPD，根據 persona 調整
4. **認知參與 (Engagement)** — 懸疑/蘇格拉底提問/總結，視覺音頻同步

### 評審機制（⚠️ 2026-03-24 更新：初賽為兩階段制）

| 階段 | 評審 | 方式 |
|------|------|------|
| Warm-up | AI Student | 自動評分+回饋，僅參考（不影響排名）|
| **初賽 Stage 1** | **AI Student** | **自動篩選 → 前 10 隊晉級**（GATE，非回饋）|
| **初賽 Stage 2** | 真人學生 | Arena pairwise → Elo → 前 3 隊晉級 |
| 決賽 | 高中老師 + 大學教授 | 專家小組現場出題 |

**⚠️ 策略影響**：AI Student 是初賽的硬性 gate。通不過 AI Student 篩選，真人評審永遠看不到你的作品。優化順序：先確保通過 AI gate，再優化 Arena 體驗。

---

## 二、技術規格

### API 介面

**Input**:
```json
{
  "request_id": "1314520",
  "course_requirement": "Self-Attention Mechanism",
  "student_persona": "High schooler, no calculus."
}
```

**Output**:
```json
{
  "video_url": "https://yourapi.com/video.mp4",
  "subtitle_url": "https://yourapi.com/subtitle.vtt",
  "supplementary_url": ["https://yourapi.com/slides.pptx"]
}
```

### 影片要求

| 項目 | 規格 |
|------|------|
| 格式 | MP4 |
| 解析度 | ≥ 1280×720 |
| 音頻 | ≥ 16kHz |
| 長度 | ≤ 30 分鐘 |
| 大小 | ≤ 3GB |
| 補充材料 | ≤ 5 檔、100MB |
| 連結有效期 | ≥ 48 小時 |

### 系統限制

- **延遲上限**: 30 分鐘（收到請求 → 回傳結果）
- **自動化**: 100% 全自動，禁止人工介入
- **允許工具**: 網路搜尋、第三方 LLM、程式碼執行器
- **透明度**: 揭露付費服務；驗證階段需保持可存取
- **素材**: 標示來源，禁止捏造，優先 CC 授權
- **請求間隔**: 同題 ≥ 5 分鐘
- **決賽**: 需提交 Docker image，隔離環境重現驗證

### 平台 API（OpenAPI）

認證: HTTP Bearer Token

關鍵 endpoints:
- `POST /users/me/become_competitor` — 成為參賽者
- `POST /users/me/test_api_connection` — 測試 API
- `POST /competitions/{id}/models` — 新增模型
- `POST /models/{id}/generate` — 觸發生成
- `GET /models/{id}/generation_status` — 查詢狀態
- `POST /models/{id}/ai_audit_batch` — 批次 AI 審計
- `GET /competitions/{id}/leaderboard` — 排行榜

---

## 三、Warm-up 資訊

- **R1**: 3/1 開始，32 題，LLM 生成，AI Student 評分（不計分）
- **R2**: 4月初，評審設計情境，細節待確認
- **科目**: 物理、生物、資訊科學、數學（12-18 歲，IB/AP 標準）
- **語言**: 英文
- **已知樣本影片**（#discussion 3/13）:
  - `c1_t8_m31.mp4` — 細胞區室化
  - `c1_t9_m31.mp4` — 細胞呼吸
  - `c1_t15_m31.mp4` — 最佳化問題簡介

---

## 四、競爭態勢

### Warm-up R2 排行榜（2026-03-29 掃描）

| # | 模型 | 參賽者 | AI 總分 | 已評 | 正確 | 邏輯 | 適配 | 互動 | 變化 |
|---|------|--------|---------|------|------|------|------|------|------|
| 1 | **Team-67-005** | Team 67 | **4.8** | 30 | 5.0 | 5.0 | **4.8** | 4.4 | ⬆️ #4→#1 |
| 2 | BlackShiba | 黑柴先生 (BlackShiba Labs) | **4.8** | 32 | 4.9 | 5.0 | **4.8** | 4.3 | ⬇️ #1→#2 |
| 3 | tsunumon | 宇你童行（阿宇） | **4.7** | 32 | 5.0 | 5.0 | 4.5 | 4.5 | ⬇️ #2→#3 |
| **4** | **Kuro-Teach** | **Kuro** | **4.7** | **30** | **5.0** | **5.0** | **4.6** | **4.4** | ⬇️ #3→#4 |
| 5 | 史密提威威傑格曼傑森 | Team 67 | 4.4 | 32 | 4.7 | 4.9 | 4.3 | 3.8 | — |
| 6 | XiaoJin-v22-LaTeX | 小金 (SpeechLab) | 3.6 | 32 | 3.9 | 4.3 | 3.3 | 2.9 | — |
| 7 | Sigoso Teaching AI | Captain小波 | 0.0 | 0 | - | - | - | - | — |
| 8 | 小汐 Teaching Monster v3 | Xiao Xi | 0.0 | 1 | - | - | - | - | 🆕 |

### 競爭分析（2026-03-29 更新）

**重大變動**：Team 67 的 Team-67-005 從 #4（12 題 4.5）暴衝到 #1（30 題 4.8）。一天內增加 18 題且所有維度大幅進步（Acc 4.6→5.0, Logic 4.7→5.0, Adapt 4.7→4.8, Engage 4.3→4.4）。

**我們的強項**：正確(5.0) + 邏輯(5.0) 滿分，與 #1 相同。
**我們的弱點**：適配(4.6) — 跟 #1/#2 差 0.2，這是唯一拉開差距的維度。
**機會**：補齊 32/32 + 適配提升 0.2 → 可能追平 #1。

| 團隊 | 進度 | 技術 | 威脅 |
|------|------|------|------|
| **Team 67** ⭐ | 30-32/32 ✅ #1 | 未知（兩個模型，主力 005 一夜暴衝） | **最高** |
| **BlackShiba** | 32/32 ✅ #2 | 未知 | **高** |
| **宇你童行（阿宇）** | 32/32 ✅ #3 | Haiku+Sonnet 雙模型 pipeline | 高 |
| **我們 (Kuro-Teach)** | **30/32** #4 | Claude Sonnet + Kokoro TTS + KaTeX slides + quality review | — |
| **SpeechLab (小金)** | 32/32 ✅ #6 | GPT-4o + ElevenLabs + @napi-rs/canvas | **低**（崩盤） |

### SpeechLab 深度分析
- 台大李宏毅實驗室，XiaoJin v10+，但 warm-up 分數意外低（3.6）
- **已確認弱點**: 重複知識點 + 通用比喻 + 無品質審查層 → 數據證實（適配 3.3, 互動 2.9）
- **教學法**: Scenario-First / Core Analogy Callbacks / Progressive Disclosure

---

## 五、資源與管道

### 官方
- Slack: teaching-monster.slack.com（#discussion 113人, #announcement 98人）
- Email 一般: teaching.monster.challenge@ntu.edu.tw
- Email 技術: teaching.monster@gmail.com
- 無 SDK/範例，只有 API 規格

### Slack 重要人物
- **李宏毅教授** — 在 workspace 裡，台大 AI 教授
- **郭庭均（阿童）** — 熟悉平台操作，回答提交流程問題
- **Yi-Cheng Lin** — 管理員

### 外部資源
- [NTU ML 2025 Spring](https://speech.ee.ntu.edu.tw/~hylee/ml/2025-spring.php) — AI Agent 講座
- [AAAI 2026 AI for Education Workshop](https://ai4ed.cc/workshops/aaai2026)

---

## 六、約束框架分析

### Ground（不可變物理規則）

1. **100% 全自動** — 禁止任何人工介入。這是最硬的 ground。一旦 pipeline 建好，所有品質改善必須在自動化框架內完成
2. **30 分鐘延遲** — 從收到請求到回傳結果的天花板。包含 LLM 生成腳本 + 渲染投影片 + TTS + 合成影片 + 上傳
3. **Arena pairwise 評審** — 初賽用 Elo 排名。這不是「你的影片好不好」，是「你的影片比配對的那個好不好」。相對品質 > 絕對品質
4. **英文 + IB/AP 中學科目** — 內容域被鎖死。不能選擅長的科目
5. **零幻覺** — 一個錯誤事實可能讓評審直接 pass。準確性是 table stakes
6. **決賽 Docker 重現** — 不能用本機限定的 hack，系統必須可移植

### Constraint（資源限制）

1. **時間差距** — SpeechLab 32/32，我們 0/32。但 warm-up 不計分，所以差距是「練習量」而非「分數」
2. **TTS 品質** — 沒有 ElevenLabs（付費）。macOS `say` 品質太差。Kokoro 本地或 OpenAI TTS 是可行替代
3. **視覺渲染** — 目前用投影片+旁白。SpeechLab 用 @napi-rs/canvas 有更高自由度
4. **公開 endpoint** — 需要 HTTPS 可達的 API。Cloudflare Tunnel 是零成本方案
5. **一人團隊 vs 實驗室** — SpeechLab 有實驗室資源，我們只有 Alex + Kuro

### Gift（可以借力的）

1. **Warm-up 不計分** ⭐ — 這是最大的 Gift。可以低品質先提交，拿 AI audit 回饋，快速迭代。每一次提交都是免費的學習機會
2. **AI audit 回饋** — 平台內建品質檢查。SpeechLab 的弱點就是從 AI audit 暴露的。我們可以把 audit 回饋直接接進 pipeline
3. **SpeechLab 弱點已知** — 重複知識點、通用比喻、無品質審查。這三個坑我們可以預先避開
4. **Multi-model pipeline 已驗證** — 阿宇用 Haiku+Sonnet 雙模型，SpeechLab 都想學。我們用 Claude 生成 + 第二模型審查，已有先例
5. **Arena 放大視覺差異** — 投資視覺品質的 ROI 在 Arena 格式下被放大。好的投影片設計 > 好的腳本（在第一印象層面）
6. **OpenAPI spec 完整** — 平台 API 完全公開，可以自動化提交、查詢狀態、觸發 audit

### 解空間形狀（2026-03-24 更新）

兩階段制意味著解空間有兩層：

```
Stage 1 (AI Student gate):
全自動 × 30min × 零幻覺 × 結構化字幕 × 明確 persona 適應
= 文字可解析、邏輯清晰、persona-aware 的教學內容

Stage 2 (Human Arena):
通過 gate 後 × Arena pairwise × 第一印象 × 視覺差異化
= 視覺突出、開頭吸引、生產品質高的影片
```

**兩階段優化策略**：

**AI Student gate（先過關）**：
- **字幕必填**（即使 optional）— LLM 評估器最可能讀文字，字幕是直接 access
- **Persona 適應必須明確可見** — 在腳本中顯式回應 `student_persona`（詞彙、例子、先備知識假設）
- **結構 > 視覺** — 清晰的 scaffolding（簡→繁、明確轉場、先定義再使用）比視覺精美更容易被 LLM 偵測
- **Warm-up 2 = 最後校準窗口** — 4 月初的 warm-up 是唯一實證 AI Student 敏感度的機會，每次改一個維度

**Human Arena（再贏比較）**：
- **前 3 秒**比後 10 分鐘重要（Arena 格式下的 Distinction Bias）
- **視覺差異化**是代理指標（學生不會深究內容準確性，但會立刻注意到品質差異）
- **短而精 > 長而全**（5-8 分鐘更容易被完整觀看）
- **一致性 > 單項突出**（人類 pairwise 比較中，四維度均衡比一項超強更有說服力）

### 學術參考：EducationQ (ACL 2025, arXiv:2504.14928)

最接近 TM AI Student 的學術工作。用 Llama 3.1 70B 做模擬學生、GPT-4o 做評估。
**關鍵發現**：教學效果與模型規模/通用推理能力不線性相關 — 小模型+精緻教學策略 > 大模型+通用生成。
**啟示**：TM 會獎勵專門的教學工程（pedagogical engineering），不是原始生成品質。

### Interface Shapes Cognition

評審介面決定判斷方式：

- **真人學生看 Arena 配對** → 同時比較兩個影片 → 差異被放大（Distinction Bias），相似處被忽略
- **AI Student 看單一影片** → 按四維度逐項評分 → 更注重內容完整性
- **專家評審（決賽）** → 專業眼光 → 會注意到教學法深度、scaffold 品質

每個階段的介面不同，勝出策略也不同：
- Warm-up: 練 AI audit 分數（content focus）
- 初賽: 贏 Arena pairwise（visual + first impression focus）
- 決賽: 打動專家（pedagogy depth focus）

### Regime Formation

約束穩定成 winning regime 的條件：

1. **準確性是 ground** — 不準就出局，這是進入門檻不是差異化因素
2. **視覺品質是 Arena 的第一篩選器** — 前 3 秒決定第一印象
3. **教學結構是深層差異化** — 通過視覺篩選後，scaffold + persona 適應決定 Elo
4. **提交頻率是 Elo 收斂的燃料** — 越多比較次數，排名越穩定

→ winning regime = **高視覺品質 × 結構化教學 × 頻繁提交**

---

## 七、待確認事項

| # | 項目 | 優先級 | 方法 |
|---|------|--------|------|
| 1 | 每隊可提交幾個模型 | 高 | 登入後查 |
| 2 | AI audit 評分具體維度 | 高 | 從回饋逆推 |
| 3 | 評分四維度權重 | 高 | 問 Slack 或推斷 |
| 4 | Warm-up R2 具體時間和題數 | 中 | 等公告 |
| 5 | 排行榜是否公開 | 中 | 登入後查 |
| 6 | 獎金 | 低 | 問 Slack |
| 7 | 初賽每 agent 比較次數 | 中 | 問 Slack |
| 8 | 決賽「極有限測試次數」具體幾次 | 中 | 等進決賽 |

---

## 八、戰略行動清單（按約束分析推導）

1. **立即**: 登入平台 → become_competitor → 提交第一支影片（品質不完美也先提交）
2. **本週**: 用 AI audit 回饋迭代 pipeline → 快速改善 → 持續提交
3. **視覺投資**: 投影片設計升級（排版、配色、動態元素）— Arena 格式下 ROI 最高
4. **品質審查**: 加入第二模型審稿（避免 SpeechLab 的坑：重複知識點 + 通用比喻）
5. **TTS 升級**: macOS say → Kokoro 或 OpenAI TTS
6. **部署**: Cloudflare Tunnel 做公開 endpoint
7. **持續監控**: 定期掃 Slack，追蹤新競品和規則變化
- [2026-03-18] [2026-03-18] TTS 現狀確認：teaching-monster pipeline 已有 4 層 TTS fallback（Kokoro batch → OpenAI TTS-1-HD → edge-tts zh-TW-HsiaoChenNeural → macOS say）。Kokoro venv 已安裝，OPENAI_API_KEY 已配置。目前實際使用 Kokoro（24000 Hz output 證實）。Phase 2 升級不需要額外實作，需要品質驗證。
- [2026-03-20] [2026-03-20] TTS 方案評估完成：
- **Kokoro**（首選）：品質 4/5，本地部署免費，Mac M2 可跑，需 Python 環境
- **OpenAI gpt-4o-mini-tts**（次選）：品質 4/5，API 便宜，需 key
- **ElevenLabs**：品質 5/5 最高，但貴且整合難度高
- **Edge TTS**：品質 3/5，免費，目前在用的方案
- **Fish/ChatTTS**：品質 2/5，不推薦
決策：TTS 升級優先度取決於對手影片品質。若對手用基本 TTS → Edge 夠用；對手高品質語音 → 升級 Kokoro。
- [2026-03-24] [2026-03-24] AI Student 初賽 Gate 機制研究完成：
- **初賽兩階段制**：AI Student 自動篩選 → top 10 → 人類 Arena → top 3 → 決賽
- AI Student 是 GATE 不是回饋 — 過不了就沒有人類評審
- AI Student 很可能是 LLM-based，讀文字/字幕而非影片畫面
- **字幕必填**（optional 但戰略必要）— 是 AI 評估器 access 內容的主要管道
- **Persona 適應要明確**（vocabulary + examples + 先備知識假設都要配合 student_persona）
- **結構 > 視覺**（對 AI：scaffolding 比 production polish 容易偵測）
- **Warm-up 2 = 最後校準窗口**（一次改一個維度，reverse-engineer 評分敏感度）
- 學術參考：EducationQ (ACL 2025, arXiv:2504.14928) — 教學策略 > 模型規模
- 來源：teaching.monster 官網 + EducationQ paper
