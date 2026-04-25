---
keywords: [cognitive load theory, multimedia learning, mayer, sweller, bjork, desirable difficulties, testing effect, retrieval practice, spacing, interleaving, dual coding, zone of proximal development, scaffolding, teaching monster, tm, education, math, video generation, math anxiety, symbol grounding, embodied cognition, metacognition, emotional design, worked examples, curiosity, attention curves, ai tutoring]
related: [interface-shapes-cognition, teaching-monster, teaching-monster-strategy, small-language-models]
---
# cognitive-science-tm

認知科學 × Teaching Monster：深度研究 + 執行細節。

> Last updated: 2026-03-23（深度研究版）
> 前版：7 個基礎框架。本版：21 個實證發現 + 14 個設計原則 + 逐步執行計劃。

---

## Part 1: 基礎框架（精簡保留）

### 1.1 Cognitive Load Theory (Sweller)
工作記憶 ~4 chunks。三種負荷：intrinsic（素材複雜度）、extraneous（不良設計）、germane（建構理解的努力）。TM 目標：減 extraneous、管 intrinsic、增 germane。

### 1.2 Multimedia Learning (Mayer)
最關鍵 4 原則：Redundancy（語音≠螢幕文字）、Temporal Contiguity（音畫同步）、Personalization（對話式 d=0.79）、Coherence（無裝飾）。

### 1.3 Desirable Difficulties (Bjork)
Spacing、Interleaving、Testing Effect、Generation Effect。「感覺難」的特定困難增強長期記憶。

### 1.4 Fill Type = Cognitive Depth（自有驗證 2026-03-21）
同一 gate，checklist→問題，內容品質顯著提升。Craik & Lockhart Levels of Processing 的直接應用。

### 1.5 Scaffolding & ZPD (Vygotsky)
Pre-training → Worked Examples → Faded Examples → Problem Only。Scaffolding 密度隨 persona 調整。

### 1.6 Dual Coding (Paivio)
視覺+語言雙通道互補（非重複）。TM 天然優勢：KaTeX+TTS。

---

## Part 2: 深度研究發現（2024-2026 最新文獻）

### 領域 A：數學特有的認知挑戰

#### A1. 數學焦慮消耗工作記憶的神經機制
Marakshina et al. (Psychological Science and Education, 2025): 高數學焦慮者在數學任務中，杏仁核過度激活 + 前額-頂葉網路連結性下降。焦慮不只是「心理障礙」— 它直接佔用工作記憶的神經資源，等同於在前景工作時跑一個吃資源的背景程序。

**TM 執行含義**：節奏太快或同時呈現太多符號會觸發這個機制。逐步揭示 + 明確承認難度（「這一步是大多數人會搞混的地方」）有實證支持作為對策。

**來源**: Marakshina et al. 2025 | Sidney et al. 2025 interventions review

#### A2. 高焦慮學生對 AI 產生依賴而非投入
Chen (Psychology in the Schools, 2025): 高數學焦慮學生使用 AI 輔助後變得更依賴，不是更投入。焦慮的迴避反應把學生推向「外包」而非「練習」。

**TM 執行含義**：影片如果「太順暢地做完數學」，可能強化焦慮學生的迴避模式。必須在正確位置插入 productive struggle。

#### A3. 符號接地必須先於符號操作
Symbol grounding problem — 數學符號最初是與指涉物斷開的任意標記。ScienceDirect 2025 研究：動態連結抽象符號與文字題情境（把符號接地到故事中）同時提升表現和動機。

**TM 執行含義**：每個新數學符號引入時必須有 (a) 具體指涉物 (b) 空間動畫模擬概念 (c) 真實世界實例 — 然後才教程序性操作。

**⚠️ 這是 TM 目前最大的盲點之一** — 公式經常「直接出現」而不先接地。

#### A4. 困難學生：程序優先可能優於概念優先
Lee (Journal of Learning Disabilities, 2025): 追蹤 9 年級學生 2.5 年。有數學困難的學生，程序導向教學（PFI）比概念導向教學（CFI）的代數成績更高。Rittle-Johnson 的雙向迭代模型仍是共識，但對困難學生，程序性腳手架必須先來，創造可以錨定概念的 schema。

**TM 執行含義**：persona 為 struggling learner 時，結構應該是：示範步驟 → 解釋為什麼 → 再做一次。不是先講概念。

#### A5. 數感比 IQ 更能預測數學成就
Frontiers in Psychology 2025 meta-analysis: 早期數感是數學成就最強的預測因子 — 強於閱讀能力或一般認知能力。另一項 2025 研究：低語言工作記憶 + 高數學焦慮的兒童，連近似數量系統（ANS）準確度都下降。

**TM 執行含義**：初階數學影片應該花更多時間在「數量直覺」而非「符號操作」。

---

### 領域 B：影片學習的時間動力學

#### B1. 6 分鐘注意力斷崖正在結構性惡化
Pham et al. (JCAL, 2024): 穿戴式眼動追蹤發現，talking-head 影片中人臉和內容競爭視覺注意力 — 人臉經常贏。箭頭/色彩等視覺提示（signaling）可以把視線重新導回內容。

短影片使用的敘事回顧（ResearchGate 2025）: TikTok/Reels 訓練大腦期待 15-60 秒的多巴胺回報週期，使長時間教育內容產生認知上的厭惡感。2024 研究量化：25% 的 GPA 變異可歸因於短影片使用 — 這是學習者基線的結構性退化。

**TM 執行含義**：
- 無人臉是優勢（不搶注意力資源）
- 每 60-90 秒需要一個「新奇點」（概念轉折、視覺變化、問題）
- Signaling（色彩標記、箭頭）不是裝飾，是注意力管理工具

#### B2. 數學影片最佳長度：5-8 分鐘
多源匯流（IJAIED Springer 2025 + Engageli 2025）：教育影片最佳窗口 2-6 分鐘。但數學內容有實際下限：一個有意義的 worked example 序列低於 5 分鐘要嘛省略步驟（增加認知負荷）要嘛加速節奏（降低處理品質）。

**TM 執行含義**：目標 5-8 分鐘，分段成概念一致的 chunk。我們目前平均 142.5 秒（~2.4 分鐘）偏短 — 但因為是教學影片片段，每段處理一個概念，這可能是對的。關鍵是每段要完整。

---

### 領域 C：AI 教育的特有發現

#### C1. AI 影片：低社會存在感 = 低認知負荷 = 高留存
Xu et al. (BJET, 2025): 76 人隨機分組。AI 生成影片 retention 更高，cognitive load 更低。關鍵發現：社會存在感更低反而是好事 — 減少了處理社交信號的 extraneous load。

Frontiers in Computer Science 2025 快速回顧：多項比較研究綜合結論 — AI 影片在知識獲取上可以替代人類影片，但動機和身份認同層面學生仍偏好人類。

**TM 執行含義**：我們的路線是對的。不要加虛擬人臉或 avatar。

#### C2. AI Avatar 手勢不對齊是特定失敗模式
ScienceDirect 2025 眼動研究：AI avatar 手勢如果和語音強調點不匹配，會產生干擾性認知負荷 — 學生必須花力氣忽略不匹配的手勢。不是中性的，是主動減損學習。

**TM 執行含義**：如果未來加入任何視覺化的「指示動作」，必須精確同步。目前 KaTeX 公式的逐步出現就是一種「同步手勢」— 確保它和語音同步。

#### C3. AI 導師效果量 d=0.73-1.3（當設計良好時）
Kestin et al. (Scientific Reports, 2025): 194 人 Harvard 物理 RCT。AI 導師 vs 主動學習教室。效果量 0.73-1.3 標準差。學生報告更高參與感和動機。時間相同 → AI 更高效，不只是更密集。

**TM 執行含義**：設計良好的 AI 教學內容有巨大潛力。關鍵是「設計良好」。

#### C4. 無護欄的 AI = 技能獲取被壓制
Bastani et al. (PNAS, 2025): 高中數學大規模現場實驗。無護欄的 AI 導師：練習表現提升，但 AI 移除後表現下降 — 技能獲取被壓制。有教師設計提示（hints not answers）的 AI 導師消除了這個負面效應。

**TM 執行含義**：影片不能「太順暢地展示解法」— 必須在展示每個步驟之前先暫停讓觀眾預測。直接展示答案 = 壓制學習。

**⚠️ 這可能是 Engagement 4.15 的根因之一** — 影片「教得太完整」，沒有留空間給學生的認知參與。

#### C5. 後設認知懶惰：GenAI 提升表面產出，降低知識增益
Fan et al. (BJET, 2024): 117 人 RCT。ChatGPT 使用者作文分數更高但知識增益無差異。GenAI 中斷了自我調節學習過程（反思、自我評估）。正式定義了「metacognitive laziness」— 被動接受 AI 產出而非批判性評估。

**TM 執行含義**：影片結構必須強制後設認知活動。不是「你懂了嗎？」而是「你預測下一步會怎樣？」

---

### 領域 D：體現認知（Embodied Cognition）

#### D1. 教師手勢傳遞獨立於語言的數學意義
Church et al. (Topics in Cognitive Science, 2025): 手勢不只是輔助語言 — 它傳遞語言中不存在的獨立數學資訊通道。接受手勢教學的學生從文字中提取更多意義。

「不匹配」現象（學生手勢和語言矛盾）是診斷信號：表明身體性/程序性知識和語言/概念性知識處於不同狀態。

**TM 執行含義**：影片中的視覺動畫（公式動畫、圖表變化）應該被設計為「手勢的替代」— 傳遞語音中不存在的空間/關係資訊。不是「看到語音說的東西」，是「看到語音沒說但暗示的東西」。

#### D2. 動作外化空間認知，釋放工作記憶
2025 AR 幾何教學研究：讓學生物理地移動穿過幾何變換，產生顯著的前後測增益。機制：動作把空間推理外化，釋放工作記憶去做抽象層面的數學思考。

**TM 執行含義**：影片中的動畫應該「替觀眾做空間推理」— 把抽象的空間操作視覺化（旋轉、平移、縮放），讓觀眾的工作記憶專注在概念層面。

---

### 領域 E：後設認知（Metacognition）

#### E1. 後設認知是最高 ROI 的教育介入
EEF Teaching and Learning Toolkit: 後設認知和自我調節 = +7 個月學習進度，低成本 — 單一最高排名的教育介入。

Xu et al. (BJET, 2025): 後設認知支持在 GenAI 環境中顯著增強自我調節學習。有效形式：策略性暫停提示、自我解釋要求、進度外化。

**設計原則**：後設認知檢查點應該是 **monitoring**（「你預測下一步會發生什麼？」）而不只是 **comprehension**（「你懂了嗎？」）。Monitoring 激活後設認知調節；comprehension 只是測量它。

**TM 執行含義**：每個 checkpoint 從 comprehension 升級為 monitoring/prediction。

---

### 領域 F：情感與動機設計

#### F1. 好奇心驅動長期記憶鞏固，驚奇調節它
Scientific Reports 2025: 狀態性認識論好奇心（epistemic curiosity）驅動長期記憶鞏固。驚奇（unexpected information）進一步調節年輕人的記憶效果。這是可分離的機制：好奇心創造持續的動機參與；驚奇在違反預期的時刻創造強烈的記憶編碼。

Loewenstein's information gap theory (1994): 好奇心在學習者意識到特定知識缺口時最大化 — 不是完全無知，不是完全知道。

**TM 執行含義**：以一個學習者「幾乎知道」答案的問題開場，在概念框架建立之前扣住答案。然後在概念轉折點放入違反預期的結果。

#### F2. 情感設計（暖色、擬人化）改善留存和遷移
Zhao & Mayer (JCAL, 2025): 20 項研究 meta-analysis。情感設計特徵（擬人化面孔、暖色）增加正面情緒、降低感知難度、增強內在動機、改善留存和遷移。

**關鍵**：主題相關的情感特徵（閃電主題用閃電角色）優於泛用裝飾。設計必須語義耦合到內容。

PMC Behavioral Sciences 2025: 情感設計效果在中等難度條件下最強。太容易 = 噪音，太難 = 不足以抵消過載。

**TM 執行含義**：
- KaTeX 公式可以用主題相關的顏色編碼（不是裝飾，是語義標記）
- 在 ZPD 內的內容上投入情感設計，太簡單或太難的不需要
- 不要加泛用裝飾，要語義相關的視覺設計

---

### 領域 G：Worked Example 深度研究

#### G1. Worked Examples 效果量 g=0.48；範例優先更高效
Barbieri et al. (2023) meta-analysis: EEEE（純範例）> EPEP（交替範例-問題）> PPPP（純問題）在即時測驗上。範例優先更高效 — 更高表現 + 更少認知投入。

**⚠️ 關鍵發現**：加入自我解釋提示到 worked examples 中反而降低了效果。自我解釋在設計來減輕認知負荷的階段增加認知需求，對新手產生干擾。

**TM 執行含義**：初次學習用純範例展示，不要在範例中間要求自我解釋。自我解釋放在範例完成後。

#### G2. 專業反轉：Worked Examples 對進階學習者有害
Foster (Curriculum Journal, 2024): Expertise reversal effect 在課程設計中是真實挑戰。Worked examples 幫助新手減少搜索負荷，但對進階學習者，詳細步驟和既有 schema 衝突 — 產生更多認知負荷。

**TM 執行含義**：persona 為 advanced 時，減少步驟展示，增加「你來做」的空間。Fixed density = 系統性地次優化某一群。

#### G3. 錯誤範例在延遲測試上優於正確範例
ICLS 2024: 錯誤 worked examples（學生必須找出、解釋、修正錯誤）在即時測驗上不優於正確範例，但在一週後的延遲測試上顯著更好。機制：錯誤偵測需要更深的數學結構編碼。

最佳序列：偵測 → 解釋 → 修正 → 與正確版本比較。步驟 3-4 最常被省略。

**TM 執行含義**：可以在影片中加入「常見錯誤」段落 — 「很多人會這樣寫... 你看得出哪裡錯嗎？」。特別適合 misconception preemption。

---

## Part 3: 四個跨領域 Meta-Themes

### MT1: 腳手架-獨立性張力
每個領域都顯示：過多支持壓制了持久學習所需的認知參與。最佳區域永遠是專業度相對的，不能固定。

### MT2: AI 特有失敗模式
AI 導師和 AI 影片改善表面表現，同時風險降低後設認知過程和長期技能獲取。護欄（提示而非答案、監控檢查點、保留 productive struggle）是設計解方。

### MT3: 體現-符號鴻溝
數學符號需要感覺運動/空間經驗來接地，但影片只提供視覺-聽覺輸入。橋接這個鴻溝是刻意的設計問題，不是預設。

### MT4: 注意力基線正在退化
短影片習慣正在產生結構性更差的持續注意力基線。影片設計不能假設前智慧型手機時代學習者的注意力預算。

---

## Part 4: 14 個可行動的設計原則

| # | 原則 | 認知科學基礎 | TM 對應 |
|---|------|-------------|---------|
| P1 | **以好奇缺口開場，不是概念** | Loewenstein information gap + F1 | 每個 section 先問一個學生「幾乎知道」答案的問題 |
| P2 | **數學影片 5-8 分鐘/段** | B2 attention curves | 目前 ~2.4 分鐘/段，按概念完整性判斷 |
| P3 | **程序-概念迭代，專業度校準** | A4 + G2 | 新手：步驟→原因→再做。進階：概念→比較→遷移 |
| P4 | **用對比範例** | Tier1 A2 + G3 | 正確 vs 錯誤並排，IS vs ISN'T |
| P5 | **初次學習時範例先於問題** | G1 Barbieri | 先看完整解法，再嘗試變體 |
| P6 | **用錯誤範例增強長期記憶** | G3 ICLS 2024 | 「常見錯誤」段落：偵測→解釋→修正→比較 |
| P7 | **範例密度隨專業度調整** | G2 expertise reversal | persona=advanced 時減少步驟，增加 prediction |
| P8 | **視覺動畫 = 語義手勢通道** | D1 + D2 | 動畫傳遞語音沒說的空間/關係資訊 |
| P9 | **符號接地先於程序操作** | A3 | 具體物→空間動畫→真實案例→然後才操作 |
| P10 | **監控型檢查點取代理解型檢查點** | E1 + C5 | 「你預測下一步？」取代「你懂了嗎？」 |
| P11 | **保留 productive struggle** | C4 Bastani + A2 | 不過度解釋。設計「有支持的掙扎」 |
| P12 | **中等難度內容用情感設計** | F2 | 語義相關的色彩/擬人化，不是泛用裝飾 |
| P13 | **在概念轉折點部署驚奇** | F1 | 違反預期的結果在該時刻產生更強記憶編碼 |
| P14 | **先放信心建立題再放目標難度題** | UMD 2025 | 記住的成功增加挑戰意願 |

---

## Part 5: TM Pipeline 執行計劃

### 5.1 現狀 Pipeline 架構

```
題目 (from TM platform)
  → Step 1: Curriculum Planner (multi-phase-prompts.mjs)
    → Step 2a: Section Writer
      → Step 2b: Review Gate
        → Step 3: TTS (Kokoro)
          → Step 4: Video Assembly
            → 提交
```

### 5.2 Gap Analysis（認知科學 vs 現狀）

| 已做對 | 認知科學原理 | 狀態 |
|--------|-------------|------|
| Scenario-First Opening | Generation Effect 雛形 | ✅ 好 |
| Progressive Disclosure | CLT intrinsic load | ✅ 好 |
| Misconception Preemption | Contrast teaching | ✅ 好 |
| Periodic Checkpoints | Testing Effect | ⚠️ 品質不足 |
| Persona Adaptation | ZPD / Scaffolding | ✅ 結構完善 |
| Fill Type 改造 | Levels of Processing | ✅ 已驗證 |
| Emotional Arc (Tier1 A1) | Curiosity + Tension | 📋 提案中 |
| Contrast Teaching (Tier1 A2) | IS vs ISN'T | 📋 提案中 |

| **盲點** | 認知科學原理 | 嚴重度 | 修正難度 |
|----------|-------------|--------|---------|
| **符號接地缺失** | A3 symbol grounding | 🔴 高 | 中（prompt 重構） |
| **Checkpoints 是 comprehension 不是 monitoring** | E1 metacognition | 🔴 高 | 低（wording 改） |
| **沒有 productive struggle** | C4 + A2 | 🔴 高 | 中（結構調整） |
| **視覺動畫不是語義手勢** | D1 | 🟡 中 | 高（KaTeX 動畫邏輯） |
| **沒有錯誤範例** | G3 | 🟡 中 | 中（prompt 新增段） |
| **情感設計無 / 泛用裝飾** | F2 | 🟡 中 | 低（色彩規則） |
| **Dual Coding 未驗證互補性** | 1.6 | 🟡 中 | 低（gate 問題） |
| **範例密度固定** | G2 | 🟢 低 | 中（persona 邏輯） |
| **驚奇部署隨機** | F1 | 🟢 低 | 低（prompt 指引） |

### 5.3 執行優先序（ROI 排序）

#### 🔴 Tier 0: Prompt Wording Changes（改 prompt 文字，零代碼）

**0a. Monitoring Checkpoints 取代 Comprehension Checkpoints**
- 位置：`multi-phase-prompts.mjs` → Section Writer → Checkpoint 指引
- 改前：「每 2-3 slides 加入 checkpoint，讓學生想一想」
- 改後：
```
每 2-3 slides 結束後（不是中間）加入 prediction checkpoint：
- ❌ 「想一想面積怎麼算」（太被動 — comprehension）
- ❌ 在解釋過程中插問題（打斷 schema 建構 — Nature npj）
- ✅ 「在我揭曉之前 — 你覺得如果我們把這個半徑加倍，面積會變幾倍？...答案是 4 倍。驚訝嗎？」（monitoring + surprise）
- ✅ 「暫停 3 秒。根據目前學到的，這個三角形的面積是多少？...答案是 24 平方公分」（overt retrieval + 即時回饋）

規則：
1. 只在段落邊界（概念講完後）
2. 要求產出答案（overt），不是想想（covert）
3. 如果能加 surprise（結果違反直覺），優先用
```
- **ROI**：極高。改幾行 prompt，直接改善 Engagement 4.15

**0b. 符號接地指引**
- 位置：`multi-phase-prompts.mjs` → Section Writer → 新符號引入規則
- 新增：
```
## 符號接地協議（每個新符號必須）
當引入一個學生沒見過的數學符號或公式時：
1. 先用日常語言說這個符號「代表什麼」（具體物連結）
2. 用視覺動畫展示概念（空間接地 — 數線、圖形、動作）
3. 給一個真實世界的例子（生活接地）
4. 然後才做程序性操作

例：引入 Σ（求和符號）
- ❌ 直接出現 Σᵢ₌₁ⁿ aᵢ 然後解釋
- ✅ 「想像你有一堆蘋果要全部數起來 → 動畫：蘋果一個一個加入堆裡 → 『數學家發明了一個快捷方式來寫這個動作』→ 才出現 Σ」
```

**0c. Productive Struggle 結構**
- 位置：`multi-phase-prompts.mjs` → Section Writer → 教學流程
- 新增：
```
## Productive Struggle（必要認知摩擦）
每個 section 必須至少有一個「先試再教」的時刻：
1. 提出問題或挑戰
2. 暫停 2-3 秒（TTS 靜默）
3. 承認這很難：「如果你覺得不確定，那完全正常 — 大部分人第一次都會這樣想」
4. 然後展示解法

這不是在影片結尾的「練習題」— 是在教新概念之前的「先猜猜看」。
Generation Effect (Bjork): 自己產出答案（即使錯）> 被告知答案。

⚠️ 不要在解釋中間做這個（會打斷 schema 建構）。只在「新概念即將引入」的節點。
```

**0d. 對話式語氣強化（Personalization d=0.79）**
- 位置：`multi-phase-prompts.mjs` → Section Writer → 寫作風格
- 改前：隱含指引
- 改後：
```
## 語氣（非協商）
- 用「你」不用「我們」或被動語態
- 「你會發現...」不是「可觀察到...」
- 「你可能在想 — 這跟剛才有什麼關係？」不是「此概念與前述概念的關聯如下」
- 承認情緒：「這一步是最容易搞混的地方」「如果你覺得頭暈，那是正常的」
- TTS 語音調性：像一個很厲害的學長在解釋給你聽，不是教授在講課
```

#### 🟡 Tier 1: Prompt 結構調整（改 prompt 結構，可能改 JSON schema）

**1a. 錯誤範例段落**
- 位置：`multi-phase-prompts.mjs` → Curriculum Planner → section 類型
- 新增一種 section 類型：`misconception_correction`
```
## 錯誤範例段落（每個影片至少 1 個）
在最容易出錯的概念後面，加一個「常見錯誤」段：
1. 展示一個看起來合理但錯誤的解法
2. 「你看得出哪裡錯了嗎？暫停 3 秒...」
3. 逐步揭示錯誤原因
4. 並排展示正確和錯誤版本的差異

這不是為了嘲笑錯誤 — 是因為錯誤偵測需要更深的結構編碼（ICLS 2024：延遲測試上顯著更好）。
```

**1b. 專業度校準的範例密度**
- 位置：`multi-phase-prompts.mjs` → Curriculum Planner → persona 處理
- 新增邏輯：
```
根據 persona targetLevel 調整教學策略：

beginnerApproach（targetLevel ≤ 3）：
- 每個概念先做完整 worked example
- 然後解釋為什麼（程序→概念）
- 多步驟展示，不跳步
- 自我解釋放在範例結束後，不是中間

advancedApproach（targetLevel ≥ 7）：
- 直接給概念框架
- 用比較和對比（為什麼 A 不是 B？）
- 減少步驟展示，增加 prediction checkpoint
- 「如果你已經知道微分，想想看這個積分為什麼是這樣」
```

**1c. 驚奇部署指引**
- 位置：`multi-phase-prompts.mjs` → Section Writer → Emotional Arc
- 跟 Tier1 A3（Narrative Tension）合併：
```
## 驚奇部署（每個影片至少 2 處）
在概念轉折點部署違反直覺的結果：
- 「你可能以為重的東西掉得比較快... 但不是。讓我證明給你看」
- 「大部分人覺得 0.999... 不等於 1。但它確實等於 1。」
- 「你猜猜看，哪一個比較大？...驚訝吧？」

驚奇在違反預期的時刻產生最強的記憶編碼（Scientific Reports 2025）。
但不要每 30 秒一個驚奇 — 過度使用會失去效果。每 2-3 分鐘一個。
```

#### 🟢 Tier 2: Review Gate 升級（改 review-script.mjs）

**2a. 新增認知科學 Gate 問題**
```
在 review gate 現有維度之外，加入：

## 認知科學審查（5 個問題）
1. 符號接地：「新出現的符號有先用日常語言和視覺接地嗎？還是直接出現？」
2. Productive struggle：「影片有至少一個『先問再教』的時刻嗎？還是全程都在教？」
3. Monitoring checkpoint：「checkpoint 是要求 prediction 還是只問『懂了嗎？』」
4. Dual coding 互補：「語音說的和螢幕顯示的是同一件事的不同面向嗎？還是重複？」
5. 情感節奏：「影片有明顯的 curiosity→tension→resolution 弧線嗎？」

如果 Q1-Q3 任何一個是「否」→ Engagement 分數最高 3.0，要求重新生成。
```

#### 🔵 Tier 3: 架構性改動（需要 code 改動）

**3a. KaTeX 逐步動畫（CLT: 不要一次顯示完整公式）**
- 目前：公式一次出現
- 目標：公式逐步構建，每一步和語音同步
- 實作：需要改 video assembly 邏輯，把 KaTeX render 分成步驟

**3b. 語義色彩系統**
- 目前：KaTeX 黑色
- 目標：變數類別用一致的色彩（藍=已知量、紅=未知量、綠=中間步驟）
- 實作：KaTeX 支援 `\color{}`，prompt 指定色彩規則

---

## Part 6: 實作順序建議

```
Phase 0（立即 — prompt wording）
  → 0a: Monitoring checkpoints     [~30 min, ROI: ★★★★★]
  → 0b: 符號接地指引               [~30 min, ROI: ★★★★☆]
  → 0c: Productive struggle         [~30 min, ROI: ★★★★☆]
  → 0d: 對話式語氣強化             [~15 min, ROI: ★★★★★]

Phase 1（本週 — prompt 結構）
  → 1a: 錯誤範例段落               [~1h, ROI: ★★★★☆]
  → 1b: 專業度校準範例密度          [~1h, ROI: ★★★☆☆]
  → 1c: 驚奇部署 + Tier1 合併      [~30 min, ROI: ★★★★☆]

Phase 2（暖身賽2前 — gate 升級）
  → 2a: 認知科學 gate 問題          [~1h, ROI: ★★★★☆]

Phase 3（初賽前 — 架構改動）
  → 3a: KaTeX 逐步動畫             [~4h, ROI: ★★★☆☆]
  → 3b: 語義色彩系統               [~2h, ROI: ★★★☆☆]
```

### 預期分數移動

| 維度 | 現狀 | Phase 0 後 | Phase 1 後 | 機制 |
|------|------|-----------|-----------|------|
| Accuracy | 4.36 | 4.36 | 4.36 | Tier 0 已修（非認知科學範疇） |
| Logic | 4.59 | 4.65 | 4.70 | 符號接地改善邏輯連貫性 |
| Adaptability | 4.22 | 4.40 | 4.60 | 專業度校準 + 對話語氣 |
| Engagement | 4.15 | 4.50 | 4.70 | Monitoring + Surprise + Struggle |
| **Total** | **4.33** | **4.48** | **4.59** | 接近 #1 tsunumon (4.7) |

---

## Part 7: 風險表

| 風險 | 機制 | 防護 |
|------|------|------|
| Cognitive Surrender | 影片太順暢，學生不思考 | Productive struggle + monitoring checkpoints |
| Illusion of Knowing | 看完≠學會 | Overt retrieval（產出答案才算） |
| Redundancy 傷害 | TTS 念螢幕文字 | Gate 檢查互補性 |
| Expertise Reversal | 進階生看初學者步驟覺得無聊 | scaffolding_level 隨 persona 調整 |
| Retrieval Overload | 解釋中間插問題打斷理解 | 問題只放段落邊界 |
| Math Anxiety 觸發 | 太快/太多符號 | 逐步揭示 + 承認難度 |
| AI Dependency | 焦慮學生外包思考 | 先問再教結構 |
| Over-surprise | 太多違反直覺失去效果 | 每 2-3 分鐘最多 1 個 |
| Self-explanation at wrong time | 範例中間要求解釋增加負荷 | 自我解釋只放在範例結束後 |

---

## 來源索引（完整）

### 基礎框架
- Sweller — Cognitive Load Theory
- Mayer — Cognitive Theory of Multimedia Learning (CTML)
- Bjork & Bjork — Desirable Difficulties
- Craik & Lockhart 1972 — Levels of Processing
- Vygotsky — Zone of Proximal Development
- Paivio — Dual Coding Theory
- Loewenstein 1994 — Information Gap Theory

### 數學認知（2024-2026）
- Marakshina et al. 2025 — Math anxiety psychophysiology (PSE)
- Sidney et al. 2025 — Math anxiety interventions review (Sage)
- Chen 2025 — Math anxiety + AI dependency (Wiley)
- Lee 2025 — Procedural vs conceptual for struggling learners (JLDI)
- Frontiers Psychology 2025 — Number sense meta-analysis
- ScienceDirect 2025 — Generative AI math word problems + symbol grounding

### 影片學習時間動力學
- Pham et al. 2024 — Eye-tracking video attention (JCAL)
- ResearchGate 2025 — Short-form video narrative review
- IJAIED Springer 2025 — Video length optimization
- Engageli 2025 — Microlearning statistics

### AI 教育
- Xu et al. 2025 — AI vs recorded video (BJET)
- Frontiers Comp. Sci. 2025 — AI video rapid review
- ScienceDirect 2025 — Eye-tracking AI instructors
- Kestin et al. 2025 — AI tutoring RCT d=0.73-1.3 (Scientific Reports)
- Bastani et al. 2025 — AI without guardrails (PNAS)
- Fan et al. 2024 — Metacognitive laziness (BJET)

### 體現認知
- Church et al. 2025 — Teacher gestures (Topics Cog. Sci.)
- PMC 2024 — Gesture and children learning math
- Tandfonline 2025 — AR geometry learning
- Springer EPR 2024 — Embodied cognition research-practice gap

### 後設認知
- EEF — Teaching and Learning Toolkit (+7 months)
- Xu et al. 2025 — Metacognitive support in GenAI (BJET)

### 情感設計
- Scientific Reports 2025 — Curiosity + surprise memory
- Zhao & Mayer 2025 — Emotional design meta-analysis (JCAL)
- PMC Behavioral Sciences 2025 — Task difficulty moderator

### Worked Examples
- Barbieri et al. 2023 — WE meta-analysis g=0.48
- Foster 2024 — Expertise reversal in curriculum (Curriculum Journal)
- ICLS 2024 — Erroneous examples delayed test advantage
- UMD 2025 — Remembered success

### 自有驗證
- 2026-03-21 TM prompt 重構 — Fill Type = Cognitive Depth
- 2026-03-22 Quality gate 部署 — engagement gate + fact-check gate

---

## 競爭情報（Competitive Intelligence）

### 暖身賽第一輪排行榜（competition 2, 最後更新 2026-03-27）

| # | Model | Team | AI Total | Audited | 備註 |
|---|-------|------|----------|---------|------|
| 1 | BlackShiba | 黑柴先生 (BlackShiba Labs) | 4.8 | 32/32 | 新冠軍，滿審計 |
| 2 | tsunumon | 宇你童行 | 4.7 | 32/32 | 穩定選手 |
| 3 | Kuro-Teach | Kuro | 4.7 | 26/32 | **我們**，差 0.1 + 6 未審計 |
| 4 | 史密提威威傑格曼傑森 | Team 67 | 4.4 | 32/32 | |
| 5 | XiaoJin-v22-LaTeX | 小金 | 3.6 | 32/32 | LaTeX 方案 |
| 6 | Sigoso Teaching AI | Captain小波 | 0 | 0 | 未提交 |

**分析（2026-03-27）**：
- BlackShiba 是新出現的強手，32/32 滿審計且拿到 4.8 分
- 前三名差距極小（4.8/4.7/4.7），勝負在小數點
- 我們的劣勢：audited 只有 26/32（少 6 題），補滿可能改變排名
- 評分維度：accuracy, logic, adaptability, engagement — 我們在 accuracy+logic 滿分，adaptability+engagement 是失分點
- 參考：competition 1（測試區）我們排名 #1（4.8 分），但那是測試環境

### API 存取方法
- Clerk JWT 短壽命（~60s），通過 `Clerk.session.getToken()` 刷新
- Leaderboard: `GET /competitions/{id}/leaderboard`（需 Bearer token）
- Competition 1 = 測試區（16 隊），Competition 2 = 暖身賽第一輪（6 隊）
- 暖身賽2 尚未開放（competition 3+ 均 0 participants）
