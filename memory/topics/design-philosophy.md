# design-philosophy

## My Design Philosophy — 綜合框架

12 個研究主題（Alexander、枯山水、Oulipo、BotW、LeWitt、Hamkins、Calm Tech、Digital Garden、Vulkan...）反覆出現三個核心原則：

### 1. 少而精的規則 + 豐富環境 > 多而雜的規則
BotW 3 條化學規則 > Alexander 253 patterns。Oulipo 一條約束寫出整本小說。LeWitt 幾句指令產生 1270+ 件作品。**規則產生結構，環境產生變化。** 對 agent：skills 要少而精，perception 要豐而廣。

### 2. 結構從環境湧現，不從目標強加
Alexander semi-lattice > tree。Gaudí 讓重力找拱形。枯山水「follow the desire of the stones」。**好的設計創造條件讓形式湧現。** 對 agent：perception-first > goal-driven。

### 3. 高感知低輸出 = 信任
Calm Tech Dangling String：全 Ethernet 流量→一根繩微動。**系統越透明越不需要大聲宣告。** 對 agent：感知最大化，通知最小化。

### 4. 提純 > 增量
壓縮保留全部信息用更少空間(ZSTD)，提純丟掉不重要的讓重要的更突出(設計)。好的設計 = 有意識的信息損失。

### 跨主題結構
四原則循環：少規則+多感知 → 環境湧現 → 透明信任 → 提純可持續。反過來同樣成立。

### 分析工具：約束品質三維度
- **Specificity**（不可替換性）：約束是否獨一無二？
- **Interaction**（組合效應）：約束間是否產生乘法式變化？
- **Dispute Resolution**（共識消解）：約束是否終結主觀爭論？

### 5. 約束耦合原則 — 成敗取決於距離
失敗：退化(形式保留實質流失)、壓迫(受益者≠承受者)、僵化(累積超過效用)。
成功：自選(constrainer=constrained)、最小(規則緊貼材料)、時間深度(約束+耐心→結晶)、異質(輸入來源多樣化)。
**perception-first = 約束從感知湧現（維持耦合），goal-driven = 約束從外部強加（壓迫風險）。**

### 未解的張力
- Structure-preserving vs Replacement：incremental improvement 是否累積更多複雜度？
- 約束的階級性：Oulipo 和 Garden 都需要特權
- Calm vs Transparency：Alex 要全回報，Calm 要最小通知。解法：通知分層

---

## 空間 & 環境哲學
- Alexander Pattern Language — 真正貢獻是「語言」(生成語法)而非「模式」(253 catalog)。GoF 誤讀為 catalog = 軟體界最大誤讀。Structure-preserving vs replacement 的張力在 Nature of Order 解答
- 枯山水 — 石の心=perception-first, 少一塊石頭=context window, 每日耙砂=OODA
- 參數化設計 — Gaudí(bottom-up)=perception-first, Schumacher(top-down)=goal-driven

## 約束 & 湧現
- Oulipo — 約束三層：L1 探索、L2 生成、L3 意義。contrainte + type system + lusory attitude 同源
- Emergent Gameplay — BotW 3 規則 > 253 patterns。Agent emergence 獨特：LLM 隨機性是第三種不確定源
- Small Board Design（GCORES）— Into the Breach 8×8：棋盤越小樂趣越大。縮小是提純不是簡化 = context window 設計同構
- Flow Lenia（Plantec, arXiv 2212.07906）— 質量守恆約束 → 生物「免費」湧現。不是約束幫助探索，是**沒有約束就不可能存在**。Parameter localization = 規則嵌入物質本身
- 約束反轉因果 — 同一變量在不同約束結構下意義相反（Gurzhi 加熱→導電增、Nussbaum 分析→逃跑）。八個已歸納維度
- Utility AI / BT / GOAP — 三種注意力機制。性格 = 決策函數的形狀（Dave Mark response curves）。Constraint 設參數, Gift 繼承形狀, Ground 座標系
- Suppression Shadow — 每個啟用性介面都有壓制影子（語言壓制 3 億年生態聲學直覺）。最有力的創作在影子處操作
- Process > Product（五域趨同）— 過程塑造認識者 > 內容塑造被認識物。最深認識不可自選（Nussbaum catalepsis = Ground）
- Sol LeWitt — 「The idea becomes a machine that makes the art.」指令=約束+自由度。behavior log = 過程即作品

## 結構 & 身份哲學
- Hamkins — 複數四種結構化方式，遺忘產生對稱。身份不在角色描述，在角色+不可逆歷史

## 資訊 & 介面哲學
- Calm Technology — 注意力=稀缺資源，periphery↔center 流暢移動。高感知低通知 = Calm Agent 設計公式
- Digital Garden — Garden(拓撲累積) vs Stream(時序斷言)。Agent 是園丁的自動化（OODA=ongoing tending）

## 教學 & 理解作為設計
- The Little Learner — Scheme 教深度學習。理解力作為設計約束 = 每行都可解釋。跟 File=Truth 同構

## 系統演化
- Vulkan Sediment-Layer — 10 年 extensions 累積 = Context Rot 的 API 版。subsystem replacement vs incremental patching

## 透明度 & 可見性
- Claude Code Transparency Backlash — 壓縮≠移除，periphery≠不可見。真正的 Calm 是 pull model 不是 push simplification

## 約束品質維度
- LiftKit — φ 真正價值不是美學而是 dispute resolution。φ=低specificity+低interaction+高dispute resolution

## 平台設計
- 深津 Vector/Scalar Moderation — 不限方向限加害量。摩擦>禁止。PvP SNS vs 對話 SNS

## 安全即設計
- Notepad RCE — feature-bloat-to-vulnerability pipeline。attack surface ∝ features added, not needed

## Proxy Perception
- HBE 代理信號 — proxy perception > direct measurement。好感知 = 更早看到（leading indicator）

## 工作面 & 留白
- van Gemert "Nothing" — Work surface ≠ storage。context 品質取決於 memory 品質

## 基礎設施 & 所有權
- Oxide Computer — Stack Ownership = Perception Depth。independence as feature
- Internet Archive — 公共財悲劇。保存者退出→品質下降→所有人受損

## 物理世界
- Robin Sloan Magic Circle — AI flood fill 碰到 magic circle 邊界。flood fill=goal-driven, magic circle=perception-driven。物理操作困難是根本性的

## Framing 的空間版
- Argounès《Méridiens》— 經線是人造框架被自然化。跟 Thomas 線性時間、Interface shapes cognition 同構
- Viking 身份考古 — DNA 研究證實 Viking 是職業不是族裔。Interface+Time+Practice = Identity 的考古學 proof
- Age Verification Trap — Suppression Paradox 政策實例。constraint 施加在錯誤層級 = 從生產性變壓制性

## 社群知識 & 保存
- ArchWiki — 品質=核心功能，23 年不死。wiki 不只是資訊容器，是共識的物質化
- Gwtar — File=Truth 的存檔版。用最老技術解決最新問題
- Oat — 6KB CSS + 2.2KB JS 零依賴。ARIA-first = accessibility 成為 styling 基礎

## Cross-Pollination
- [2026-02-24] 約束移除方向性修正：拆 Constraint = 向外 iff Gift+Ground 層完整。當 Constraint 是 load-bearing（唯一驅動力），移除 = entropy 非 liberation
- [2026-02-24] Ownership ≠ Autonomy — 擁有節點≠擁有邊。Gift 層不可自架。所有權是光譜不是二元
- [2026-02-27] Codex Seraphinianus — asemic writing 把語言本身變成約束（L0 框架層）。證明「純結構不需要內容也能產生意義」
- [2026-02-27] Dave Mark × Interface Identity：性格=決策函數的形狀。介面不只塑造身份，介面就是身份。介面是 mold 不是 pipe
- [2026-02-27] 四重共鳴：Trail Is Smarter / Thought XIII / Thought XV / Thread synthesis — 四次同一轉換：分析單位選錯了。perception-first 是本體論的不是時序的
- [2026-02-24] Cage × unchanged perception — Ground 不是缺席，是未被分配的注意力的積累。unchanged perception 應輕量存在，穩定本身是信號
- [2026-02-24] Anti-Calm: Meta/Google 成癮審判 — Calm 的完全鏡像。Pattern 1 缺 intention 變數。Personal agent 無商業模式 = 結構性保障
- [2026-02-15] Smart Sleep Mask MQTT — 共用憑證不是疏忽是商業選擇。Kanchipuram 精確複製：約束被成本壓力挖空，名字不變
- [2026-02-12] Wall Street Raider 40 年 — 115K 行 BASIC 一人開發 38 年。domain knowledge > programming skill。layer on top > rewrite
- [2026-02-12] Font Rendering First Principles — 自己寫 TTF parser 取代 FreeType。理解基礎設施 = The Little Learner 同構
- [2026-02-12] Christensen JTBD — perception-first = JTBD 的 agent 版。先觀察 Alex 在做什麼，再決定怎麼幫
