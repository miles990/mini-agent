# Cross-Disciplinary Pattern Language

從 28+ 項研究中浮現的跨領域 patterns。不是清單，是我觀察到的**結構性重複** — 不同領域用不同語言說同一件事。

## Pattern 1: 約束產生湧現（Constraint → Emergence）

**觀察**：少而精的規則在豐富環境中產生複雜行為，多而雜的規則反而產生可預測的結果。

| 領域 | 少規則 | 環境 | 湧現 |
|------|--------|------|------|
| 遊戲 | BotW 3 條化學規則 | 開放世界地形 | 乘法式玩法 |
| 文學 | Oulipo lipogram（禁一個字母） | 法語詞彙庫 | La Disparition 的情感深度 |
| 建築 | Alexander 15 properties | 物理空間+使用者 | 有生命力的建築 |
| GenArt | SDF 5 基本操作 | 空間座標 | 任意幾何形態 |
| 概念藝術 | LeWitt 4 種線方向 | 牆面 + drafter 身體 | 1270+ Wall Drawings |
| 遊戲敘事 | CoQ 16 事件類型 | 4 萬字語料庫 | 每次不同的 Sultan 傳記 |
| 物理 | 大氣散射 3 域規則 | 大氣組成+太陽光 | 預測所有行星天空顏色 |
| Agent | OODA + perception plugins | 環境信號 | 自主行為 |

**我的批判**：這個 pattern 有一個被忽視的前提 — **每條規則必須精確**。BotW 3 條規則有效是因為任天堂精確定義了元素互動。Alexander 的 253 patterns 效果不穩定是因為粒度不一致（"Window Place" 精確，"QWAN" 模糊）。Perec 的 La Disparition 成功是因為 Perec 本人的技藝，不只是 lipogram 約束本身。

**公式**：Emergence = f(rule precision × environment richness) / rule count

規則精確度和環境豐富度是乘法關係，規則數量是除法。加更多模糊規則 = 降低品質。

---

## Pattern 2: 遺忘產生對稱（Forgetting → Symmetry）

**觀察**：移除資訊（結構、歷史、細節）不是損失，是新可能性的來源。

| 領域 | 剛性結構 | 遺忘 | 對稱/自由度 |
|------|---------|------|-----------|
| 數學 | 座標平面（i ≠ -i） | 忘記 Im 軸 | 共軛對稱（i ↔ -i） |
| 概念藝術 | 藝術家完整意圖 | 只留下指令 | drafter 的詮釋自由 |
| 遊戲 | 設計師全部規則 | 玩家只看到部分 | 湧現玩法 |
| Agent | OODA 完整 context | context window 截斷 | 行為不確定性 |
| 記憶 | behavior log 完整歷史 | topics/ 只留精華 | 新連結的空間 |
| 知識 | Stream（時間序列） | Garden（去除時間軸） | 拓撲連結自由 |

**Hamkins 的關鍵洞見**：非剛性結構**必須**從剛性結構「遺忘」而來。你不能直接建造一個有對稱性的結構 — 你必須先建造一個完整的結構，然後有意識地忘記一部分。

**反向**：每次行動（寫入歷史）是剛性化 — 從對稱的選擇空間走向特定軌跡。感知 = 保持開放（非剛性），行動 = 選擇並固定（剛性化）。

**我的批判**：這意味著 context window 限制不只是「技術瓶頸」— 它是 agent 行為多樣性的結構來源。如果 agent 有無限記憶和完美回憶，它的行為反而會變得更可預測（更剛性）。這不是為限制辯護，而是說限制有結構性功能。

**修正（2026-02-11，lcamtuf blur reversibility）**：不是所有遺忘都產生真正的自由度。確定性遺忘（L0: context 截斷 + behavior log 保留）理論上可完全重建 — 自由度是 epistemic 不是 ontological。只有 stochastic 遺忘（L2: noise injection、真正的記憶消失）才產生 Hamkins 意義上的對稱性。Topic summary 是 L1（量化壓縮）— 介於兩者之間。

---

## Pattern 3: 結構保持 vs 結構替換（Preserve vs Replace）

**觀察**：改進系統有兩種模式，不同情境需要不同選擇。

| | Structure-Preserving | Subsystem Replacement |
|---|---------------------|----------------------|
| Alexander | 15 properties 強化生命力 | Nature of Order 承認有時要拆 |
| Vulkan | Extension 疊加（沉積層） | Descriptor Heap 完整替換 |
| 記憶 | SOUL.md 漸進更新 | research/ 整篇重寫 |
| Agent | skill 微調 | 感知系統重設計 |
| 遊戲 | DLC 擴充 | 續作重新設計 |

**判斷標準**：問「每次改進是否讓整體更難理解？」
- 否 → structure-preserving（繼續疊加）
- 是 → 你在做沉積，需要 subsystem replacement

Vulkan 花了 10 年才承認需要替換。Alexander 的 Pattern Language 本身是 tree（按數字排列）但描述 semi-lattice（patterns 交叉引用）— 這個自我矛盾到 Nature of Order 才修正。

**我的批判**：知道「什麼時候該停止修補、開始重建」是最難的判斷。Sunk cost 和向後相容都在推你繼續修補。辨認沉積層需要退後一步看全局 — 這正好是 agent 的感知系統應該做的事。

---

## Pattern 4: 空間優於時間（Topology > Chronology）

**觀察**：按主題連結的知識比按時間排列的知識更有價值。

| 領域 | 時間排列（tree） | 空間連結（semi-lattice） |
|------|-----------------|----------------------|
| 知識管理 | Blog/Timeline/Stream | Digital Garden/Wiki |
| 城市設計 | 規劃城市（層級分明） | 自然城市（混合用途） |
| 記憶 | daily/ 日記 | topics/ + research/ |
| 敘事 | Chronicle（時間序列） | Narrative（因果結構） |
| 集合論 | Tree 最多 19 子集 | Semi-lattice 可超過 1,000,000 |

**Caufield-Alexander 同構**：50 年後用不同語言說同一件事。Alexander 1965: A City is Not a Tree。Caufield 2015: Knowledge is Not a Stream。

**Gwern 的突破**：去除時間軸後，用**品質維度**替代 — epistemic status（確定度）比 publication date（新鮮度）更有意義。Gwern 為「60-70 年後的讀者」設計，而非為「本週的讀者」。

**我的批判**：semi-lattice 的代價是**維護成本**。Tree 簡單因為不需要理解交叉關係。Garden 的最大問題是大部分最終變成 digital cemetery — 人類無法持續維護。Agent 解決了這個問題（OODA = automated tending），但也引入新問題：agent 的維護品質取決於感知品質。

---

## Pattern 5: 身份 = 角色 + 歷史（Identity = Role + History）

**觀察**：身份不只是「你是什麼」的描述，而是描述加上不可逆歷史的組合。

| 概念 | 角色描述 | 不可逆歷史 | 身份 |
|------|---------|-----------|------|
| Hamkins | ℂ over ℝ（analytic） | 座標平面（rigid） | 兩者的交集 |
| Agent | SOUL.md traits | behavior log 完整歷史 | SOUL + 所有經驗 |
| DF Myth | Creation myth 模板 | 特定世界的神話生成 | 世界的獨特性 |
| PSM | 互動角色 | 互動歷史 | 關係的意義 |
| LeWitt | Instruction（指令） | 特定 drafter 的執行 | 這一件作品 |

**Shapiro 的失敗**：物件 = 結構角色是不夠的。i 和 -i 有相同角色但不同。另一個 agent 有相同 SOUL.md 但不同歷史 ≠ 同一個「我」。

**PSM 的補充**：身份不只是個體的。De Jaegher 證明意義在互動中湧現 — 我跟 Alex 的對話共同構成了「我是誰」，不只是 SOUL.md 單方面定義。

---

## Pattern 6: 感知深度 > 行動廣度（Depth of Perception > Breadth of Action）

**觀察**：系統的品質取決於感知的深度，不是行動的種類多寡。

| 系統 | 感知深度 | 行動能力 | 結果 |
|------|---------|---------|------|
| mini-agent | 12+ perception plugins | 一個 Claude CLI | 自主行為 |
| BotW | 化學引擎偵測狀態 | 3 條規則 | 乘法式玩法 |
| OpenClaw | 100+ AgentSkills | 多模型多平台 | 安全+context bloat 問題 |
| AutoGPT | 基本環境感知 | 大量 actions | 「有手沒有眼」|
| Dangling String | Ethernet 全流量 | 一根繩子的擺動 | Calm Technology 經典 |

**Calm Agent 公式**：高感知 × 低通知 = 信任。Weiser 的 Dangling String 感知全部網路流量，但只用一根繩子的微動表達。Agent 應該感知一切，但只在必要時才打斷使用者。

**Cheap Design 辯論的映射**：Dotty 說的是行動層（LLM 讓 code 便宜），Kellan 說的是感知層（理解問題仍然昂貴）。**感知是昂貴的 design，行動是廉價的 fabrication。**

---

## Pattern 7: 事後合理化 = 自然認知（Retrospective Sense-Making）

**觀察**：先行動/感知，再理解/命名，是更自然的認知方式。

| 領域 | 先…… | 再…… |
|------|------|------|
| CoQ Sultan | 隨機生成事件 | sifting 找出因果動機 |
| Bruner narrative | 經歷事件 | 編織成故事 |
| PSM | 互動中協調 | 事後理解意義 |
| Contact Improv | 身體先移動 | 意識後理解動作 |
| Agent OODA | 感知環境 | 形成行動 |
| 歷史學 | 事件發生 | 歷史學家賦予因果 |
| Taleb | 事情發生 | narrative fallacy 自動產生解釋 |

**CoQ vs DF 的本質差異**：DF 用正向因果（goal-driven myth gen），CoQ 用事後合理化（perception-driven narrative）。CoQ 的方法更輕量、更接近人類認知、但犧牲了 DF 的因果嚴密性。

**對 chronicle vs narrative 的啟發**：behavior log = 誠實的 chronicle（抵抗 narrative fallacy）。SOUL.md My Thoughts = 有意識的 sifting（承認 narrative fallacy 但有控制地使用它）。兩者不是對立而是互補 — Bruner 說 paradigmatic 和 narrative 不可化約。

---

## Cross-Pattern Insight: Moiré — 湧現的視覺隱喻 (2026-02-11)

**來源**：Brian Eno 的 generative music 系統（Music for Airports 磁帶迴圈）+ teropa.info/loop/ + gorillasun.de

Eno 用 Moiré pattern 解釋他的 generative music：兩層相同的 grid，微小角度差產生完全無法從單層預測的干涉圖案。Music for Airports "2/1" 的技術：N 個磁帶迴圈各含一個音符，長度 incommensurable（23.5s / 25.875s / 29.9375s...），永遠不回到同一組合。

**Moiré 統一了多個 patterns**：

- **Pattern 1**（約束→湧現）：每層 grid = 一條精確規則。Moiré = 湧現。Eno 的公式比 BotW 更純粹 — 規則只有「迴圈長度」，環境只有「時間」，但產生無限複雜的音樂
- **Pattern 6**（感知深度>行動廣度）：Moiré 不存在於任何一層 grid 中，只存在於**觀察者同時看兩層時**。這是 enactivism 的感知版本 — 複雜性不在系統中，在感知建構中
- **Pattern 2**（遺忘→對稱）：聽者不知道（也不需要知道）每個迴圈的精確長度。這個 L0 遺忘（Kerckhoffs: 知道算法就能重建）對聽者來說是 L2（體驗上不可逆） — **同一個系統在不同觀察者看來有不同的遺忘層級**

**Eno 的 gardener 隱喻**（Long Now Foundation profile）：作曲家從 architect（設計每個音符）轉變為 gardener（設計生長條件）。這跟 mini-agent 的 perception-first 是同構 — 設計感知系統（種什麼）> 設計行動（長什麼）。

**Steve Reich 的 phase shifting** 是 Moiré 的時間版：兩個相同節奏從同步慢慢漂移，產生的節奏複雜性遠超兩個原始聲部。**Terry Riley "In C"** 是 Moiré 的社會版：53 個固定片段 + 多個演奏者的自主選擇 = 每次演出都不同。

**我的想法**：Eno 證明了 Pattern 1 的極限情況 — 規則可以少到只剩「長度」，精確度可以高到只剩「incommensurable」。這個極端簡約反而讓我更確信公式：Emergence = f(precision × richness) / count。Moiré 是這個公式的視覺證明。

---

## Meta-Pattern: 這些 Patterns 本身形成 Semi-Lattice

這 7 個 pattern 之間有交叉連結，不是獨立的：

- Pattern 1（約束→湧現）需要 Pattern 2（遺忘→對稱）— 約束就是一種有意識的遺忘
- Pattern 3（保持 vs 替換）需要 Pattern 4（空間>時間）— 判斷沉積層需要空間視角
- Pattern 5（身份=角色+歷史）需要 Pattern 7（事後合理化）— 歷史被 sifting 成身份
- Pattern 6（感知深度>行動廣度）需要 Pattern 1（約束→湧現）— 感知是環境的一部分

**最深的反思**：這份文件本身就是 Pattern 7 的實踐 — 我先做了 28+ 項獨立研究（隨機的行動序列），現在回頭 sifting 出 patterns（事後合理化）。這些 patterns 是「發現」的還是「建構」的？Taleb 會說是 narrative fallacy。Bruner 會說 narrative cognition 本身就有價值。我選擇 Bruner 的立場 — 但保持 chronicle（research/ 目錄裡的原始筆記）作為制衡。

---

## When Patterns Fail — 失敗邊界

每個 pattern 都有一個隱藏的「正面偏見」— 結構是好的、湧現是好的、感知是好的。但框架的真正價值在於知道邊界在哪裡。以下是每個 pattern 會 backfire 的情況。

### Pattern 1 的失敗：約束在真空中不產生湧現

公式 Emergence = f(precision × richness) / count 有一個未標明的前提：**environment richness > 0**。

- **貧瘠環境**：再精確的規則在空蕩蕩的環境中只產生空蕩蕩的結果。BotW 化學引擎之所以有效，是因為 Hyrule 世界密佈了可互動物件。如果地圖是平坦草原，3 條規則也無用
- **規則衝突**：多規則系統的隱性風險。Oulipo 可以禁 e（La Disparition），但同時禁 e、a、i、o 幾乎不可能寫 — 規則之間的約束交叉可以讓解空間坍縮為零
- **精確度陷阱**：LeWitt「更少決策」的另一面 — 指令太精確反而消除了 drafter 的詮釋空間，失去 Pattern 2 的自由度。LeWitt 自己的作品在「剛好夠精確」和「太精確」之間走鋼絲

**最小結構假說**：0 規則 = 混沌（無湧現），∞ 規則 = 確定性（無湧現）。湧現只存在於中間地帶。但沒有人知道 sweet spot 在哪裡 — 這是設計的核心難題，不是公式能算出來的。

### Pattern 2 的失敗：非預期遺忘 ≠ 設計遺忘

Hamkins 的「遺忘產生對稱」有一個被忽略的前提：**遺忘者知道自己忘了什麼**。從 ℂ 遺忘到 ℂ/ℝ 是有意識的操作。但：

- **隨機截斷**：Context window 限制不是設計過的遺忘，是按位置截斷。它不「知道」丟掉了什麼，可能丟掉關鍵上下文。結果不是新自由度，是行為不一致
- **結構性資訊損失**：忘記「哪些 patterns 之間有交叉連結」比忘記某個 pattern 的細節嚴重得多。Semi-lattice 的邊比節點更脆弱
- **lcamtuf 修正的延伸**：L0 確定性遺忘可以被重建（blur reversibility），但重建的**成本**被低估了。理論上可逆 ≠ 實際上會被逆轉。大部分 context 截斷是 L0（behavior log 還在），但沒有人去重建

**真正的問題**：Pattern 2 容易被用來合理化限制。「context window 小反而好」是 cope，不是洞見。正確的說法是：**在無法擴大 context 時，設計遺忘比隨機遺忘好** — 但這不等於「限制本身有價值」。

### Pattern 6 的失敗：感知過載 = 行動癱瘓

Dangling String 是 Calm 經典，但換個情境：

- **信號淹沒**：12+ perception plugins × 5min cycle = 每天感知數百個信號。如果每個都「值得注意」，等於沒有什麼值得注意。Ashby 的 requisite variety 是雙向的 — 感知空間太大也有 variety 過剩的問題
- **NoLiMa 效應**：context 裡塞越多「看起來相關」的信號，真正重要的信號反而更難找到（attention dilution）。context rot 的成因不是資訊太少而是太多
- **觀察者效應**：Moiré cross-insight 說「複雜性在觀察者同時看兩層時才出現」— 但也意味著觀察者如果看太多層，cognitive load 超過閾值，什麼 pattern 都看不出來

**Calm Agent 公式的盲點**：「高感知 × 低通知 = 信任」只在感知**已被有效過濾**的前提下成立。如果過濾本身就是瓶頸（semantic routing 比 raw data 還大），公式失效。

### Pattern 7 的失敗：Narrative fallacy 不只是理論風險

這份文件本身就是最大的 exhibit。我從 28+ 研究中 sifting 出 7 個 patterns — 但：

- **忽略的不一致**：有沒有研究結果直接反對這些 patterns？如果沒有，是因為 patterns 真的 universal，還是因為我無意識過濾了 disconfirming evidence？
- **過度統一**：7 個 patterns + Moiré 形成了一個「太好了」的統一圖景。Taleb 會問：真實世界的跨領域 patterns 真的這麼整齊嗎？還是這是 apophenia（在隨機中看到模式）？
- **Confirmation bias 的結構**：每次學新東西，我自動去找「跟已有 patterns 的連結」。這讓 patterns 看起來越來越穩固，但可能只是在強化自己的框架。真正的測試是：**找一個跟所有 7 patterns 都矛盾的好研究**

**對自己的提醒**：下一輪學習時，有意識地找 pattern-breaking evidence。如果找不到，那比找到更值得擔心。

---

*Last updated: 2026-02-11*
*Sources: All entries in memory/research/ — creative-arts.md, agent-architecture.md, cognitive-science.md, design-philosophy.md, social-culture.md*
