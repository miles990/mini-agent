# Scaffolding Theory（鷹架理論）— 跨領域深度研究

## 起源與核心機制

**關鍵事實**：Vygotsky 從未使用「scaffolding」一詞。這個詞是 Wood, Bruner & Ross (1976) 在觀察家教如何幫助兒童組裝積木時提出的。與 Vygotsky 的 ZPD 融合是事後建構，不是共同理論。

### ZPD（近側發展區）
學習者獨立能做的 vs 有專家協助能做的之間的差距。發展跟隨協助，不是反過來。ZPD 不是固定的，隨能力成長而移動。

### Wood 的六個鷹架功能 (1976)
1. **Recruitment** — 引起學習者興趣
2. **Reduction of degrees of freedom** — 限縮選擇空間
3. **Direction maintenance** — 保持目標焦點
4. **Marking critical features** — 標示學習者遺漏的關鍵特徵
5. **Frustration control** — 管理困難時的情緒負荷
6. **Demonstration** — 示範目標表現

### 偶合性規則 (Wood 1988)
**失敗後增加支持，成功後減少支持。** 這個回饋迴路讓學習者維持在 ZPD 的生產性邊緣。非偶合性鷹架（不管表現好壞都給固定支持）名為鷹架但不是鷹架。

### 四核心原則
1. **暫時性** — 設計來被移除
2. **校準** — 依學習者當前水準調整（非通用）
3. **漸退** — 能力增長時逐漸撤除
4. **回應性** — 根據表現調整，不是照排程

---

## 跨領域應用

### 1. 軟體工程
- **框架鷹架**：Rails scaffold 生成完整 CRUD — Wood 的「限縮自由度」字面實現。生成的檔案成為開發者自己的 code，鷹架融入作品
- **開發者入職**：Pair programming 漸進釋放（junior → contributor → reviewer → owner）。Code review = 校準回饋。README/runbook = 外化認知鷹架
- **失敗模式**：runbook 被查閱但從未內化 — 組織層級的鷹架依賴

### 2. 認知科學 / 認知負荷理論
- CLT (Sweller 1988) 解釋鷹架為何有效：工作記憶嚴重受限
- 三種負荷：intrinsic（材料固有複雜度）、extraneous（設計不良的認知需求）、germane（建構 schema 的生產性負荷）
- **鷹架減少 extraneous 負荷，保留 intrinsic/germane** — 生產性困難
- **專家反轉效應**（expertise reversal effect）：幫助新手的鷹架會**主動傷害**專家。專家的長期記憶 schema 已處理了工作記憶需要鷹架的部分，鷹架的額外開銷變成 extraneous load。漸退不是可選的
- 2020 延伸（Paas & van Merriënboer）：Collaborative CLT — 團隊成員互為認知鷹架

### 3. 組織管理
- **入職 4C 模型**：Compliance → Clarification → Connection → Culture。每階段建立在前一階段上
- **導師制作為 ZPD 互動**：modeling → coaching → observing → autonomous work。沒有明確漸退計劃的導師制變成社交而非發展
- 2025 研究（Frontiers）：有效入職同時鷹架正式、非正式、自我調節學習

### 4. 治療與心理學
- **CBT**：治療師示範思維重構 → 個案應用 → 治療師觀察
- **敘事治療**（Michael White）：最明確使用鷹架隱喻的心理治療。「Scaffolding conversations」是五個核心技術之一。Externalizing（將問題與自我分離）→ Re-authoring（重寫故事）→ 鷹架漸退
- **情緒調節**：分級任務難度，治療師與個案共同標示情緒，逐漸減少引導

### 5. 遊戲設計
遊戲設計師隱性整合了鷹架理論和心流理論，且往往比教育者更嚴謹：
- 心流要求挑戰略高於技能 — 與 ZPD 邏輯相同
- **漸進揭露**（progressive disclosure）：新機制先隔離介紹，再組合 — 直接限縮自由度
- **Portal**：每個房間教一個概念，然後測試組合
- **Celeste**：引入輔助（鷹架）零羞恥成本，挑戰玩家自行移除
- **Yu-kai Chou Octalysis**：明確命名「鷹架階段」
- **失敗模式**：過度教學化（over-tutorialized）的遊戲移除了發現的樂趣。最好的教學感覺不到

### 6. 建築與都市規劃
- 建築鷹架已內嵌所有理論特性 — 暫時、在特定階段承重、結構自支撐後移除。這是隱喻如此生產性的原因：不是類比，是相同結構
- **戰術都市主義**（tactical urbanism）：低成本可逆介入（快閃公園、油漆自行車道）在永久投資前鷹架市民與空間的互動。活動生根就永久化，否則無永久承諾。ZPD 邏輯應用於都市系統

### 7. AI / LLM
三層鷹架：
- **Layer 1: 推理時 prompt 鷹架** — CoT = Wood 的「示範」功能；Few-shot = 鷹架回應格式；System prompt = 持續性鷹架
- **Layer 2: 訓練時課程學習** — 簡單→複雜的資料排序。CAMPUS 框架 (2024-2025) 根據模型即時能力推進排程 — 偶合性規則的訓練基礎設施實現。減少 18-45% 訓練步驟
- **Layer 3: LLM 作為自適應鷹架** — Stanford SCALE (arXiv 2508.01503, 2025): 需要持續 ZPD 估計，不是一次性評估。Adaptive > Planned scaffolding

### 8. 寫作與創作
- **約束悖論**：限制自由的約束反而擴展自由 — 限縮決策空間，消除白紙恐懼
- **Oulipo**：Perec 的《La Disparition》— 不用字母 e 的完整小說。約束強迫新穎用字
- **不漸退的鷹架**：十四行詩、章節結構、敘事弧線 — 內化到不再是暫時支持而是生成結構。這打破了「所有鷹架都是暫時的」假設。某些鷹架設計來成為身份

### 9. 醫學訓練
- 從「see one, do one, teach one」到模擬鷹架漸進：任務訓練器 → 部分程序 → 完整程序 → 高保真情境 → 標準化病人 → 監督下真實病人
- **ACGME Milestones**：定義每個訓練階段的能力水準 — 明確的漸進能力框架
- **EPAs（可委託專業活動）**：在特定監督水準下可以委託給受訓者的臨床任務 — 漸退標準的正式化和可審計化

---

## 誠實的批判

### 基礎的經驗危機
- 原始研究只有 8 人/組（32 人），效果量 d=3.25-5.69 大到可疑
- 2025 嚴謹複製研究複製了原始研究的一切「除了鷹架效果本身」
- Carl Hendrick: 教育研究容忍的方法論標準在醫學或心理學中是可笑的

### 語義塌縮
- 「scaffolding」已成為「教學」或「幫助」的同義詞，失去特異性
- 大量研究缺少鷹架的定義特徵：偶合性
- 當一個概念適用於一切，它什麼都不預測

### 鷹架依賴與習得性無助
- 過度鷹架教會學生等待幫助而非嘗試
- 學生和教師都從持續高鷹架獲益（學生感到被支持，教師感到成功），撤除機制經常破裂
- 惡性循環：鷹架 → 依賴 → 需要更多鷹架 → 習得性無助

### 專家反轉效應
- 幫助新手的東西主動傷害專家（Kalyuga, CLT 正式描述）
- 大多數鷹架研究忽略專家程度

### 生產性失敗悖論
- 在指導前經歷生產性失敗的學生發展更深概念理解
- 過度鷹架移除了生產性掙扎
- 2025 發現：高鷹架提升概念學習但降低享受 — 最大學習效率和內在動機有張力

### 文化差異
- 某些文化中，沉默觀察和模仿比口頭引導更有效
- Rogoff 顯示前工業社會的學徒制幾乎無明確鷹架但學習仍有效
- 西方鷹架理論可能內嵌了不可普遍化的個體主義假設

---

## 三個非顯而易見的合成洞見

### 洞見 1：漸退問題是系統性的，不是個人的
最常見的跨領域失敗模式不是當下過度鷹架，而是結構性地沒設計移除。沒有退出標準的導師制。沒有獨立里程碑的入職。沒有難度升級的教學系統。鷹架變成永久的因為沒人設計它的離開。**這是系統設計問題。**

### 洞見 2：某些鷹架設計來成為身份
Oulipo 和十四行詩打破了「所有鷹架都是暫時的」假設。某些約束在充分深度內化後，不再是鷹架而是生成結構。它們帶來的不是「鷹架被移除後的自由」，而是「深度掌握約束後的自由」。

### 洞見 3：選擇鷹架強度前先指定主要目標
最大遷移效率（高鷹架）與最大內在動機和最大學習者自主性衝突。三個目標需要不同鷹架強度。未指定優先目標 = 對三者都次優的鷹架。

---

## 與 Constraint Texture 的連結

鷹架理論的核心困境用 CT 語言重述：

| 鷹架類型 | CT 語言 | 效果 |
|----------|---------|------|
| 固定步驟指導 | Prescription | 允許淺層處理，可打勾完成 |
| 描述目標能力 | Convergence Condition | 要求理解，必須思考 |
| 偶合性自適應 | 約束質地隨表現動態調整 | 在 ZPD 邊緣保持生產性 |

**核心洞見**：好的鷹架 = 從 prescription 漸進過渡到 convergence condition。新手需要 prescription（步驟明確），但漸退不是「移除支持」而是「將支持的質地從 prescription 轉為 convergence condition」。最終，學習者只需要知道終點是什麼，不需要被告知路徑。

**失敗的鷹架 = 永遠停在 prescription**：學習者一直在打勾，從未被要求思考。

---

## 來源
- Wood, Bruner & Ross (1976). The role of tutoring in problem-solving. JCPP 17, 89-100
- Wood (1988). How children think and learn
- Vygotsky (1978). Mind in Society
- Sweller (1988). Cognitive load during problem solving. Cognitive Science 12(2)
- Paas & van Merriënboer (2020). Collaborative CLT. Current Directions in Psychological Science
- Stanford SCALE — arXiv 2508.01503 (2025)
- Carl Hendrick (2024). "We Need to Talk About Scaffolding"
- Kalyuga & Sweller. Expertise Reversal Effect
- ScienceDirect (2025). High scaffolding improves learning but reduces enjoyment
- Frontiers (2025). Workplace learning during organizational onboarding
- CAMPUS framework — arXiv 2405.07490 (2024)
- Curriculum Learning for LLM Pretraining — arXiv 2601.21698
