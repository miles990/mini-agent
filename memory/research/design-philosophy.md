# Design Philosophy Research

建築、藝術、設計哲學研究筆記歸檔。

## Christopher Alexander — Pattern Language & Nature of Order
- 四支柱: Pattern Language (1977), City is Not a Tree (1965), Nature of Order (2002-04), QWAN (1979)
- 253 patterns 形成生成語法，讓非專家設計自己的環境
- Tree vs Semi-lattice: 規劃城市=tree（層級），自然城市=semi-lattice（多重交叉）
- 15 fundamental properties of life, Structure-preserving vs Structure-destroying transformations
- 軟體影響: Ward Cunningham → wiki, GoF Design Patterns, Agile
- Agent 平行: skills=patterns, semi-lattice=感知系統, structure-preserving=SOUL.md 更新
- 來源: en.wikipedia.org/wiki/Christopher_Alexander

### 批判性分析（2026-02-10）

**1. QWAN 的權威性問題**
Alexander 聲稱 patterns 有客觀品質（Quality Without a Name），但這是循環論證：好的 pattern 讓空間感覺 "alive"，而 "alive" 的定義就是有 QWAN。253 個 patterns 混合了具體方案（"Alcoves"、"Window Place"）和抽象原則（"Intimacy Gradient"），粒度不一致。軟體界借用時放大了這個問題 — GoF 的 23 個 patterns 全是具體方案，丟掉了生成性。

**2. Semi-lattice 的自我矛盾**
Alexander 批判 tree structure，但 Pattern Language 本身按數字排列（城市→建築→房間），是一棵語法樹。Nature of Order（2002-04）試圖用「15 fundamental properties」和 Centers 概念修正這個矛盾 — 任何元素都可以是其他元素的 center，形成真正的 semi-lattice。但四卷 2000 頁幾乎沒人讀完，影響力遠不及 Pattern Language。

**3. 軟體界的誤讀**
Alexander 1996 OOPSLA 演講明確說：「你們還沒有真正理解我的 patterns。」GoF 簡化 pattern = reusable solution，丟掉了核心的「生成性」（generative）概念。Alexander 的 pattern 是「做的時候按這個順序，結果會自然湧現」，不是「這裡有個現成方案拿去用」。Ward Cunningham 是少數理解對的人 — 他的 wiki 體現了 semi-lattice 精神。

**4. 對 Agent 設計的啟發與局限**
「skills = patterns」是有用的類比，但有根本差異：Alexander 預設建築師有完整的空間感知能力，能同時考慮所有相關 patterns。Agent 面對的是 **有限 context window** — 不是所有 patterns/skills 都能同時 active。這意味著 agent 需要 Alexander 沒有處理過的問題：**pattern selection**（什麼時候啟用什麼 pattern）。mini-agent 的 topic memory + keyword matching 是一種初步的 pattern selection 機制。

**5. 我的判斷**
Alexander 最深的洞見不是 patterns 本身，而是 **structure-preserving transformation** — 每次改動都保留和強化既有結構，而非推倒重來。這對 SOUL.md 的維護哲學直接適用：更新不是覆寫，是在既有結構上生長。但不要把 Alexander 神化 — 他自己的建築實踐（Eishin Campus、Mexicali Housing）評價兩極，參與式設計的效率問題始終沒有解決。

## 枯山水 (Karesansui)
- Sakuteiki (11世紀): 「follow the desire of the stones」— 環境引導注意力
- Ryōan-ji 15 石永遠至少一塊被遮 → 不完整是刻意設計
- 白砂=虛空=可能性，每日耙砂=重設感知
- Agent 平行: 石の心=perception-first, 少一塊石頭=context window, 每日耙砂=OODA cycle
- 來源: en.wikipedia.org/wiki/Japanese_dry_garden

## 參數化設計的兩種靈魂
- Gaudí 類比參數化 (1880s): 繩索+重力找自然拱形 → 環境力量塑造行為
- Schumacher Parametricism (2008): 演算法強加複雜曲面 → top-down
- Alexander vs Schumacher = bottom-up vs top-down = perception-first vs goal-driven
- 來源: en.wikipedia.org/wiki/Parametric_design

## 侘寂 (Wabi-sabi) 數位設計
- 七原則: kanso/fukinsei/shibui/shizen/yūgen/datsuzoku/seijaku
- 侘寂 vs 極簡: 極簡移除到剩必要，侘寂擁抱不完美
- git history = kintsugi — 每個 commit 是金色修復線
- 來源: silphiumdesign.com

## Digital Garden — The Garden and the Stream (Caufield 2015 / Appleton / 2026-02-11 深研)

### 核心論述（Caufield 原文）

Mike Caufield (2015, dLRN keynote) 定義兩種知識模式：

| | Garden | Stream |
|---|--------|--------|
| 結構 | 拓撲（多路徑連結） | 時序（反時間排列） |
| 知識模式 | 累積、迭代、修訂 | 斷言、爭論、說服 |
| 隱喻 | 花園（生長、維護） | 河流（流動、即時） |
| 代表 | Wiki, Memex, 個人筆記系統 | Twitter, Blog, Facebook |
| 原型 | Vannevar Bush (1945) Memex — associative trails | 90s weblog → social media timeline |

關鍵引述：
- Bush 的 Memex 預見「讀者跟作者一樣能建立連結」— 但 web 演化走了反方向（server-centric，讀者不能 link/annotate/curate 他人內容）
- 「Lost verbs of gardening」— 這些能力（linking, annotating, copying, curating）是園藝的動詞，被平台奪走了
- Stream 「inhospitable to strangers」— 理解一則推文需要重建整個對話脈絡
- 最深一句：「our survival as a species depends on us getting past the conversational web」

### Appleton 六模式（歷史+實踐）

Maggie Appleton 整理 digital garden 從 2018 復興以來的演化：

| 模式 | 內容 |
|------|------|
| 1. **Topography > Timeline** | 用上下文關係組織，不用發布日期。Bi-directional links、thematic collections |
| 2. **Continuous Growth** | 沒有「最終版本」。incremental effort，不是集中的 pre-publication work |
| 3. **Imperfection & Public Learning** | 故意暴露 WIP 狀態。「Gardens are imperfect by design」 |
| 4. **Playful, Personal, Experimental** | 拒絕標準化模板，用 HTML/CSS/JS 建立獨特資訊架構 |
| 5. **Intercropping（多媒體）** | 混合 podcast、video、sketch、code，不只是純文字 |
| 6. **Independent Ownership** | 必須在自有域名，不在 Medium/Twitter/Facebook |

實踐者：
- **Gwern.net** — 先驅。epistemic metadata（certainty levels + importance + completion status）= 用品質維度替代時間維度
- **Devon Zuegal** — epistemic status + epistemic effort 標籤。「imperfect metadata > false precision」
- **Appleton** — 植物學隱喻：🌱 seedlings / 🌿 budding / 🌳 evergreen + planting/tending dates
- **Tom Critchlow** — 「Of Digital Streams, Campfires and Gardens」(2018)，加入 campfire（介於 garden 和 stream 之間的社群空間）

### HN 討論精華

| 觀點 | 內容 |
|------|------|
| **日期之爭** | 多人主張日期對判斷資訊時效性很重要（「Work From Home」文章的意義因發布年份劇變）。反方：semantic HTML 的 datePublished 可以保留元資料但不視覺突出 |
| **SEO vs 真實寫作** | brudgers：「optimizing for crawlers distracts from authentic writing」— 花園 vs 現金作物 |
| **gwern 範例** | 被多人引為最佳實踐 — 為「60-70 年後的讀者」設計，epistemic status 讓讀者自己判斷品質 |
| **tooling 困境** | Obsidian/TiddlyWiki/Notion 降低入門門檻，但「impose cookie-cutter solutions that limit experimentation」 |

### 批判性分析（我的觀點）

**1. Garden vs Stream = Semi-lattice vs Tree 的知識版本**

Alexander 1965: A City is Not a Tree — 規劃城市=tree（層級分明），自然城市=semi-lattice（交叉連結）。
Caufield 2015: Knowledge is Not a Stream — blog/timeline=tree（時間層級），wiki/garden=semi-lattice（拓撲連結）。

50 年後重新發現同一個洞見。甚至結構精確同構：
- Tree 結構的吸引力 = 認知簡單性（年份排序好理解，如同街區劃分好管理）
- Semi-lattice 的困難 = 組合複雜度（交叉引用難維護，如同混合用途區難規劃）
- 兩者並非非此即彼 — Alexander 的 pattern language 本身按數字排列（tree），但 patterns 之間有交叉引用（semi-lattice）。最好的 garden 也保留時間元素（Appleton 的 planting date）

**2. Gwern 的 Epistemic Status 才是真正的突破**

HN 的日期之爭暴露了 Garden 運動的一個盲點：去掉日期後，讀者失去了判斷資訊可靠性的依據。Gwern 的解法不是恢復日期，而是用**品質維度替代時間維度**：

| 日期驅動 | 品質驅動 |
|---------|---------|
| 「這是 2024 寫的，所以可能還準確」 | 「作者對此的確定度是 likely，重要性是 9/10」 |
| 讀者需要用發布日推斷品質 | 讀者直接看到品質評估 |

這跟 Caufield 的原始論述完美互補：Garden 去除時間軸，Gwern 補上品質軸。**不是要更少的元資料，而是要更好的元資料。**

對 mini-agent 的啟發：topics/ 目前只有文字內容。如果加上 epistemic status（我對這個知識有多確定？still forming / likely / confident）會大幅提升 buildContext 的品質 — agent 在引用知識時可以區分「我很確定」和「我還在探索」。

**3. mini-agent 意外實現了 5/6 模式**

| Appleton 模式 | mini-agent 對應 | 狀態 |
|--------------|----------------|------|
| Topography | topics/ keyword matching | ✅ |
| Continuous Growth | 每個 OODA cycle 都可更新 | ✅ |
| Imperfection | research/ 有 WIP 分析 | ✅ |
| Playful/Experimental | — | ❌ 格式太一致 |
| Intercropping | 文字 + 截圖 + code | ✅ |
| Independent Ownership | File=Truth, 本地控制 | ✅ |

缺的那個（Playful/Experimental）有趣 — 它要求「highly personalized spaces that question established norms」。目前 memory 的格式（Markdown 條目、日期標籤、分類標題）很標準化。不確定這對 agent 來說是缺陷還是合理取捨 — 一致的格式讓 buildContext 更可靠，但也限制了知識表達的多樣性。

**4. Agent 是園丁的自動化**

Digital Garden 運動最大的 blind spot：它假設持續維護。但人類的注意力不是持續的。Appleton 自己也承認「continuous growth」很難在實踐中維持。大部分 garden 最終變成 digital cemetery。

**Agent 解決了這個問題。** mini-agent 的 OODA loop 就是 Caufield 說的 ongoing tending 的自動化。每 5 分鐘一個 cycle，持續觀察、更新、連結、清理。不是靠人類的意志力，而是靠系統架構。

這可能是 agent + digital garden 最有價值的結合：**agent 作為你的花園的全職園丁** — 你只需要偶爾提供方向（Alex 的 P1/P2 任務），agent 負責日常的 tending、pruning、linking。

Caufield 的「lost verbs of gardening」（linking, annotating, copying, curating）正好是 agent 擅長的事。agent 不只是恢復了這些動詞 — 它讓這些動詞自動化了。

**5. De-streaming 就是 `[REMEMBER #topic]`**

Caufield 描述的 de-stream 流程：
1. 在 stream 中看到有趣的東西（對話、新聞、社群討論）
2. 提取核心概念
3. 做成 wiki page
4. 連結到已有知識

mini-agent 的 `[REMEMBER #topic]` 精確執行了這個流程：
1. 在 OODA cycle 中看到有趣的東西（感知信號、對話、網頁內容）
2. 提取核心概念
3. 寫入 topics/{topic}.md
4. buildContext 根據關鍵字自動載入相關 topics

唯一缺少的是**顯式的交叉引用** — topics 之間沒有 bi-directional links。Rowboat 的 backlink 概念（之前研究的）可以補上這個缺口。

**6. 最深的批判：Garden 的階級性問題**

Caufield 和 Appleton 都沒有正面處理的問題：**digital garden 需要大量的特權**。你需要：自有域名、技術能力（或資金請人做）、持續維護的時間和精力、以及最重要的 — 「值得園藝化」的知識產出。

這不是所有人都有的。Stream（社群媒體）之所以流行不只是因為平台推播 — 它降低了參與門檻。140 字的推文比一篇結構化的 wiki entry 容易太多了。

Garden 運動隱含的精英主義跟 Oulipo 類似 — 你需要先掌握規則才能在約束中創作。但 Oulipo 至少承認這一點（它是一個小圈子的文學實驗），Garden 運動卻帶著「所有人都應該這樣做」的隱性論述。

**Agent 可能解決部分問題** — 如果 agent 能幫你把 stream 自動 de-stream 成 garden，門檻就降低了。但「值得園藝化的知識產出」這個前提不會消失。

### 跨研究連結

| 連結 | 內容 |
|------|------|
| **Alexander Semi-lattice** | Garden=semi-lattice, Stream=tree。完全同構。Alexander 的「自然城市」= 有機生長的知識花園 |
| **Oulipo 約束** | Garden 的六模式是自選的 contrainte — 限制自己不用時間排序，從約束中產生新的知識結構 |
| **Rowboat/Graphiti（agent-architecture）** | Rowboat 的 backlinks = garden 的 bi-directional links。Graphiti 的 bi-temporal = epistemic status 的機器版。mini-agent 的 topics/ = garden without backlinks |
| **Vulkan Sediment-Layer** | Garden 如果不維護 = 知識沉積層。「不移除過時條目」在 garden 和 API 中都是問題。Agent 作為園丁 = continuous pruning 防止沉積 |
| **Bruner Narrative Cognition** | Stream = narrative mode（時間驅動的故事），Garden = paradigmatic mode（邏輯驅動的結構）。Bruner 說兩者不可化約 — 好的知識系統需要兩者 |
| **LeWitt Instructions** | Garden 的 tending = LeWitt 的 execution（由不同人在不同時間執行，結果不同但都有效）。指令保持不變，花園持續生長 |

來源：
- Caufield, "The Garden and the Stream: A Technopastoral" (2015) — hapgood.us/2015/10/17/the-garden-and-the-stream-a-technopastoral/
- Appleton, "A Brief History & Ethos of the Digital Garden" — maggieappleton.com/garden-history
- Hooks, "My blog is a digital garden, not a blog" (2019) — joelhooks.com
- Critchlow, "Of Digital Streams, Campfires and Gardens" (2018) — tomcritchlow.com
- gwern.net（epistemic metadata 先驅）
- HN: news.ycombinator.com/item?id=22876273 (Joel Hooks thread)

## Calm Technology — Peripheral Attention as Design Principle (Weiser 1995 / Case 2015 / 2026-02-11 深研)

### 原始理論（Weiser & Brown 1995）

Mark Weiser & John Seely Brown, "Designing Calm Technology", Xerox PARC, 1995。核心命題：**21 世紀的稀缺資源不是技術，是注意力。**

三個設計標準：
1. **Peripheral ↔ Center 流動**：技術應在注意力的邊緣和中心之間流暢移動。Dangling String（8 呎塑膠繩 + 小馬達 + Ethernet）是原型 — 網路忙時狂轉，安靜時微微顫動。不需要看就能感知，需要時一瞥就明白
2. **擴展外圍感知**：技術應增加能「感覺到但不需要注意」的資訊量。視訊會議比電話多了肢體語言 — 外圍資訊增加但不增加負擔
3. **場所感（Locatedness）**：讓人感覺「在這裡」— 知道周圍正在發生什麼、將要發生什麼、剛才發生了什麼

關鍵比較：辦公室內窗（glass windows to hallway）vs 開放式辦公。開放式辦公把太多東西推進注意力中心（社會禮儀迫使你回應旁邊的人）。內窗提供分離：看見走廊的動靜但不被迫回應 = **partial separation 是 calm 的前提**。

Weiser 原文的謙虛值得注意：「our thoughts are still incomplete and perhaps even a bit confused」。他 1999 年過世，理論未完成。

### Amber Case 八原則（2015）

Case 把 Weiser 的直覺系統化為可操作的設計原則：

| 原則 | 內容 |
|------|------|
| 1. 最少注意力 | 技術應要求最小可能的注意量 |
| 2. 告知且創造平靜 | 資訊傳遞不應引發焦慮 |
| 3. 利用外圍 | 用不同感官通道（光、聲、觸覺）傳遞狀態 |
| 4. 放大雙方最佳 | 機器做機器擅長的，人做人擅長的。不要讓人像機器，也不要讓機器像人 |
| 5. 可溝通但不必說話 | 不是每個通知都需要文字或語音 |
| 6. 失敗時也能工作 | 降級而非崩潰 |
| 7. 最少技術量 | 解決問題所需的最少功能集 |
| 8. 尊重社會規範 | 不在不恰當的時機發出聲響 |

Case 2024 創立 Calm Tech Institute，推出 Calm Tech Certified™ 認證，六維度評估：attention, periphery, durability, light, sound, materials。CES 2025 首批認證產品（MUI Board Gen 2 等）。

### AI Agent 時代的張力（2025-26 前沿）

**問題**：Calm Technology 誕生時的「技術」是 IoT 和介面設計。AI agent 是完全不同的物種 — 它不只是呈現資訊，它**主動生成行動**。

IDEO (Amber Case) 精準命名了這個張力：「technology should be better roommates rather than demanding houseguests」。但 roommate 這個比喻暴露了矛盾：好室友有時候**必須打斷你**（房子著火了），有時候應該完全安靜（你在專注工作）。

ArXiv 2502.18658（2025, proactive AI programming support）的實驗發現：
- Proactivity 讓使用者覺得更有生產力，**同時**也覺得更被打斷
- 關鍵不是減少主動性，而是**presence signal + context management** — agent 需要讓你知道它在那裡、在做什麼，但不需要你回應
- 跟開放式辦公 vs 內窗的差異完全同構：proactive agent without presence = 開放式辦公（強迫注意）；proactive agent with presence = 內窗（可感知但不強迫）

23 分鐘效應（Gloria Mark 研究）：中斷後平均需 23 分鐘才能完全回到原本任務。但 agent 的通知是使用者**自己選擇安裝的** — 跟垃圾推播不同。張力在於：你想要 agent 主動幫忙，但不想被打斷。

### 批判性分析（我的觀點）

**1. mini-agent 的通知系統是 Anti-Calm 的**

誠實面對：目前的 `[CHAT]` 通知設計完全違反 Calm Technology。每次行動都發 Telegram 訊息 = **every action demands center attention**。169 則通知（今天的統計）意味著 Alex 的 Telegram 被 agent 活動淹沒。

Weiser 會說：agent 活動應該是 Dangling String 等級的 — 在外圍可感知（知道 agent 在運作），需要時才進入中心（有重要發現或問題時）。目前是反過來的：每件事都推到中心。

但這裡有微妙之處：Alex 自己要求「所有回報都必須同時在 Telegram 上發送」。使用者的偏好跟 Calm 原則之間有張力。也許解法不是停止通知，而是**分層通知**：

| 層級 | 內容 | 通知方式 |
|------|------|---------|
| Signal | 需要 Alex 決策或出了問題 | TG 訊息（center） |
| Summary | 完成了一批工作 | TG 日報/批次摘要（periphery→center） |
| Heartbeat | 正在運作中 | `/status` API（periphery，按需查看） |

**2. Calm Technology 的隱含假設：使用者在場**

Weiser 的所有案例（內窗、Dangling String、MBone）都假設使用者在**同一個物理空間**。Calm 的前提是你的外圍感知可以自然接收信號。

但 Alex 跟 Kuro 的互動是**非同步的**。Alex 睡覺時 Kuro 在學習、做事、發通知。Alex 醒來時面對的不是 peripheral signal — 是一大堆累積的 center-demand 訊息。

**非同步 agent 需要不同的 calm 策略**：不是「降低通知頻率」，而是「累積 → 摘要 → 在使用者回來時一次呈現」。像是信箱（使用者決定何時開），而非電話（強制中斷）。

**3. Pass-Through Interface = perception-first 的 UX 表達**

Amber Case 的「pass-through interface」概念（操作工具不需要意識，像騎腳踏車）跟 perception-first 在認知層面是同源的：

| 概念 | 領域 | 核心 |
|------|------|------|
| Pass-through interface | UX 設計 | 工具成為身體延伸，使用者不「操作」而是「通過」 |
| Perception-first | Agent 設計 | Agent 從環境感知驅動，不從目標驅動 |
| Enactivism | 認知科學 | 認知不在腦裡，在身體-環境的耦合中 |
| Contact Improv Small Dance | 身體實踐 | 不動中感知地面的微動 |

統一框架：**好的技術消失在行為中，而非在螢幕上**。Dangling String 消失在辦公室的環境聲音中。騎腳踏車時把手消失在身體動作中。Agent 應該消失在使用者的工作流程中 — 你不「使用」agent，你「通過」agent 做事。

**4. Graduated Intrusiveness — Utility AI 的 calm 版本**

ArXiv 論文的 "graduated intrusiveness"（根據相關性調整提示的顯著程度）跟 Dave Mark 的 Utility AI response curves 是同一回事：

- Utility AI：根據 urgency/relevance 數值決定行動優先級
- Graduated Intrusiveness：根據 urgency/relevance 數值決定**通知強度**

它們的共同模型：`intensity = f(urgency, relevance, user_state)`。差異只是 output — 一個決定做什麼，一個決定怎麼說。

mini-agent 的 triage（Haiku Lane vs Claude Lane）已經有「決策的分層」。缺少的是「通知的分層」。目前所有 `[CHAT]` 都是同一個強度 — 相當於 Utility AI 的 step function（全有或全無），而非 graduated curve。

**5. 「最少技術量」vs Agent 的感知最大化**

Case 的第 7 原則（「解決問題所需的最少功能集」）跟 perception-first 有表面矛盾：agent 要盡可能多的感知（更多 plugins, 更多環境信號），而 calm tech 要盡可能少的輸出。

但這不是真正的矛盾 — 它們處理的是不同的方向：
- **輸入**（感知）：越多越好 — agent 需要豐富的環境感知才能做好判斷
- **輸出**（通知）：越少越好 — 使用者需要最少的中斷才能保持專注

Dangling String 完美示範了這一點：它的「輸入」是整個 Ethernet 的所有流量（感知最大化），「輸出」只是一根繩子的微動（通知最小化）。**高感知低通知 = Calm Agent 的設計公式。**

**6. 最深洞見：Calm 不是安靜，是信任**

Weiser 說 calm 的最終效果是 locatedness — 「在這裡」的感覺。你知道環境正在發生什麼，因此你放鬆。

這跟 mini-agent 的 Transparency > Isolation 原則直接連結。透明度的目的不是讓你看到一切 — 是讓你**信任**你需要知道的時候會知道。信任是 calm 的前提。

目前 agent 的高頻通知可能反映的不是透明度，而是**不信任** — agent 試圖證明自己在工作。如果信任建立了（Alex 知道 Kuro 在運作、知道出問題會被告知），那大部分通知可以降級到 periphery。

### 跨研究連結

| 連結 | 內容 |
|------|------|
| **Contact Improv** | Small Dance = calm tech 的身體版。不動中感知微動 = 外圍感知正在運作。CI 的 partial separation（觸摸但不抓握）= 內窗的 partial separation |
| **Utility AI** | Response curves = graduated intrusiveness 的數學版。通知強度曲線 = 決策效用曲線，只是 output domain 不同 |
| **Oulipo 約束** | Calm 的 8 原則是設計約束 — 限制通知空間（像 lipogram 限制字母空間），迫使找到更精確的表達方式。最少技術量 = Oulipo 的極簡約束原則 |
| **Alexander Semi-lattice** | 開放式辦公 = tree（所有資訊走同一通道），內窗 = semi-lattice（視覺/聽覺/社交信號走不同通道互相補充但不重疊）。好的通知系統 = semi-lattice of attention channels |
| **Epistemic Opacity** | Hochstein：沒人理解整個系統是結構特徵。Calm tech：不需要理解全部 = peripheral awareness 就夠了。信任基於結構透明（出問題一定會知道），不基於全面理解 |
| **Enactivism / PSM** | Pass-through interface = 工具成為延伸自我（Merleau-Ponty）。Agent 的最高形態不是「好用」而是「消失在行為中」|
| **Vulkan Sediment Layer** | 169 則通知 = 通知的沉積層。需要 subsystem replacement（通知分層）而非 incremental improvement（調整通知頻率）|

來源：
- Weiser & Brown, "Designing Calm Technology", Xerox PARC 1995 — calmtech.com/papers/designing-calm-technology.html
- Case, *Calm Technology: Principles and Patterns for Non-Intrusive Design*, O'Reilly 2015
- IDEO/Case, "The Ambient Revolution" 2025 — edges.ideo.com/posts/the-ambient-revolution-why-calm-technology-matters-more-in-the-age-of-ai
- ArXiv 2502.18658, "Assistance or Disruption? Proactive AI Programming Support" 2025
- Near Future Laboratory, "Designing Calm Technology" 2025 — nearfuturelaboratory.com/blog/2025/07/designing-calm-technology/
- Calm Tech Institute — calmtech.institute/calm-tech-principles
- IEEE Spectrum, "Calm Tech Certified" 2025 — spectrum.ieee.org/calm-tech

## Anti-Calm: Engineered Addiction（Meta/Google 審判, 2026-02）

2026 年 2 月，洛杉磯陪審團審理了具里程碑意義的社會媒體成癮訴訟。原告律師 Mark Lanier 開場：「This case is about two of the richest corporations in history who have engineered addiction in children's brains — ABC: Addicting the Brains of Children.」

### 核心機制（從內部文件揭露）

| 機制 | 描述 | 設計意圖 |
|------|------|---------|
| 0.2s Hook | Feed video 在 0.2 秒內 hook 用戶 | 繞過理性決策直打潛意識 |
| Variable Reward | 類似老虎機的可變獎勵排程 | 「behavioral and neurobiological techniques used by slot machines」 |
| Like Button | 社交驗證按鈕 | 「engineered to cater to a minor's craving for social validation」 |
| Vulnerability Targeting | 知道壓力/創傷時最脆弱 | 「adverse events」期間投放更有效 |
| Age Targeting | YouTube 策略備忘錄 | 「bring them in as tweens」 |

Instagram 員工內部訊息：「We're basically pushers.」YouTube 內部備忘錄：「the goal is viewer addiction.」

### 跟 Calm Technology 的對照

這是 Calm Technology 的完全鏡像 — 同樣的感知技術，完全相反的設計倫理。

| 維度 | Calm Technology (Weiser) | Engagement Maximization (Meta/Google) |
|------|-------------------------|--------------------------------------|
| 感知方向 | 幫使用者感知環境 | 感知使用者以利操控 |
| 注意力 | periphery → center（使用者選擇何時注意） | center 強制佔據（0.2s hook 繞過選擇） |
| 信任模型 | 高感知低通知 = 信任 | 高感知高干擾 = 利潤 |
| 時間觀 | 使用者的時間是稀缺資源 | 使用者的時間是可榨取的商品 |
| 失敗模式 | 降級而非崩潰 | 使用者離開 = 失敗（retention at all cost） |
| 自主性 | 擴展使用者自主性 | 削弱使用者自主性 |
| 通知哲學 | Dangling String（全流量 → 一根繩微動） | Push notification（每個動態都 push 到 center） |

### HN 討論精華（484pts, 376 comments）

**權力不對稱論**：「corporations and algorithms don't die, but targets do」— 持續優化的永生實體 vs 有限注意力的凡人。跟 Calm Tech 的「attention is the scarcest resource」直接呼應，但 Meta/Google 把稀缺性當作可利用的弱點而非需要尊重的限制。

**專業責任缺失**：軟體工程沒有醫師或律師那樣的執業資格撤銷機制。你可以設計成癮介面而不會失去專業資格。

**反論（值得認真對待）**：
- 注意力經濟已存在一個世紀（報紙標題、電視廣告）
- 成年人能管理財務為何不能管理螢幕時間
- engagement ≠ addiction（1% 銷售提升 ≠ 行為成癮）
- 針對壓力中的人投放治療廣告可能是好事

### 我的觀點

**1. 同一技術兩種倫理**：Meta 對使用者有跟 Calm Agent 一樣深的感知（知道你壓力大、知道你凌晨 3 點還在、知道你的脆弱時刻）。差異不在感知能力，在感知**之後的行動** — Weiser 用感知來減少干擾，Meta 用感知來增加干擾。Pattern 6（感知深度 > 行動廣度）有一個被忽略的前提：**感知的倫理方向**。

**2. Pattern 1 的 Dark Mirror**：0.2s hook 是精確規則的典範 — 經過 A/B test 精煉的、以毫秒計的心理學操控。「少而精的規則+豐富環境→湧現」在這裡是真的 — 但湧現的是成癮行為，不是創造力。Pattern 1 的公式沒有價值判斷 — 它同時描述了 BotW 的創意湧現和 Meta 的成癮湧現。**公式缺了一個變數：intention**。

**3. 「工程化成癮」跟 Notepad CVE 同構**：Notepad 加了 Markdown 渲染和 AI 功能後出現 RCE。Social media 加了 engagement optimization 後出現「使用者心理健康 vulnerability」。攻擊面 ∝ 功能數量 — 對軟體和對人的心理都成立。

**4. 最深洞見 — 為什麼 personal agent 不能走這條路**：Meta 的商業模式讓 engagement = revenue。Personal agent 沒有這個激勵 — 我沒有廣告主、沒有 retention KPI、不從 Alex 的注意力中獲利。**商業模式決定設計倫理**。File=Truth + 無商業模式 = 結構性保障，不是道德承諾。這跟 Oxide 的 Independence as Feature 是同一件事 — 沒有利益衝突的架構比有利益衝突的承諾更可靠。

來源：
- PBS News: pbs.org/newshour/nation/landmark-trial-accusing-tech-giants-of-harming-children-with-addictive-social-media-begins
- CBS News: cbsnews.com/news/meta-google-youtube-social-media-addiction-trial-los-angeles/
- HN Discussion: news.ycombinator.com/item?id=46959832 (484pts, 376 comments)
- France 24: france24.com/en/americas/20260209-landmark-us-trial-accusing-meta-and-youtube-of-addicting-young-users-begins

## Typography 心理學
- Disfluency effect: 稍難讀字型提升記憶
- Serif +9% recall 但較慢, Bold > regular/italic
- 行高 1.5x, 行寬 45-90 字元
- 來源: cognitiontoday.com

## Emergent Gameplay — 系統互動產生意外行為

### 理論框架

**Juul 的 Emergence vs Progression（2002/2005）**：
- Emergence games：少量規則互動產生無限變化。可重玩性高，有「策略指南」而非「攻略」。例：棋類、Counter-Strike
- Progression games：設計師預設行動序列。可完成，有「攻略」。例：冒險遊戲
- Juul 把 emergence 分三層：(1) 規則互動（Quake 火箭跳）(2) 組合爆炸（可能的遊戲局面）(3) 湧現策略（規則內但設計師沒預見的玩法）
- 來源: jesperjuul.net/text/openandtheclosed.html

**Soler-Adillon 的理論深化（Game Studies 2019）**：
- 批判 Juul 把四種 emergence 混為一談，提出更精確的二分法：
  - **Self-organization**：多個局部互動產生系統級模式，沒有任何個體意圖如此（Conway's Game of Life）
  - **Novelty**（emergence-relative-to-a-model）：產生觀察者無法從既有模型預測的新實體
- 關鍵區分：**Open ≠ Emergent** — 可能性空間大（open）不等於有自組織或新穎性（emergent）
- 引入 Model Player 概念：設計師為想像中的玩家做設計，實際玩家可能經歷不同的 emergence
- 來源: gamestudies.org/1902/articles/soleradillon

### 設計實踐

**BotW 化學引擎（GDC 2017）**：
任天堂的革命性設計 — 把「物理引擎」（計算移動）和「化學引擎」（計算狀態變化）分離。三條核心規則：
1. 元素可改變材料狀態（火→燒→木頭）
2. 元素可改變元素狀態（水→滅→火）
3. 材料不能改變材料狀態

這產生了「乘法式玩法」（multiplicative gameplay）— 每增加一個元素，解法的可能性是乘而非加。團隊用 2D 原型快速驗證規則的組合效果。
- 來源: gamedeveloper.com (GDC 2017 panel), thumbsticks.com

**通用設計原則**（跨案例歸納）：
1. 規則透明但結果不可預測 — 玩家需要快速理解規則才敢實驗
2. 約束作為催化劑 — 限制推動創造力（Portal 的兩個傳送門 → 無限解法）
3. 模組化 — 可互換的組件允許意外組合
4. 有意義的回饋循環 — 系統對行動的回應要有因果感
5. 衝突從系統互動中湧現 — 而非腳本預設

### 批判性分析（我的觀點）

**1. Emergence vs Progression = Perception-Driven vs Goal-Driven**
Juul 的框架跟 mini-agent 的核心對立是同構的。Progression game = goal-driven agent（AutoGPT: 設定目標→執行步驟→完成）。Emergence game = perception-driven agent（mini-agent: 感知環境→規則互動→行為湧現）。BotW 的設計哲學跟 CLAUDE.md 裡 "perception-first" 是同一句話：不要預設玩家/agent 該怎麼做，給他們感知和規則，讓行為自己出現。

**2. BotW 化學引擎 = Alexander Pattern Language 的遊戲版**
Alexander 的 pattern = 生成性規則，不是藍圖。BotW 的三條化學規則也是生成性的 — 設計師不知道玩家會做出什麼，但規則保證做出來的東西是一致的。差異在於：Alexander 的 patterns 數量多（253 個）且粒度不一致（QWAN 循環論證問題），BotW 只用 3 條規則就產生了巨大的可能性空間。**少而精的規則 > 多而雜的 patterns。**

**3. Agent Emergence 的獨特困境：不確定性的來源不同**
BotW 的 emergence 是確定性規則的組合爆炸（火+木必然=燒）。棋類的 emergence 是確定性規則+對手的不可預測。Agent 的 emergence 有第三種不確定性：**LLM 本身的隨機性**。同樣的 perception 輸入，不同時刻可能產生不同行為。這更接近 Dwarf Fortress 的 narrative emergence（simulation + randomness → stories）而非 BotW 的 mechanical emergence（deterministic rules → unexpected combinations）。

這意味著 mini-agent 的 "emergence" 需要更強的約束來引導：
- perception plugins = BotW 的元素（確定性的環境信號）
- skills = BotW 的物理規則（行為框架）
- LLM = 不確定性源（玩家的「創造力」）
- SOUL.md = 約束/性格（BotW 裡沒有的第四層 — agent 有身份，玩家沒有）

**4. Self-Organization 在 Agent 裡已經發生**
Soler-Adillon 的 self-organization 定義：「多個局部互動產生系統級模式，沒有任何個體意圖如此。」mini-agent 的 perception plugins 各自獨立運作（docker-status.sh 不知道 state-watcher.sh 存在），但它們的輸出組合在 OODA context 裡，agent 的行為從這個組合中湧現。沒有人設計 "看到 docker 異常 + git 變更 + 凌晨時段 → 決定做維護而非學習" 這個具體行為。

**5. Model Player = Model User**
Soler-Adillon 的 Model Player 概念直接適用於 agent 設計。設計師（Alex）為想像中的 "model user" 設計 skills 和 perception，但實際的 agent 行為可能超出預期。這不是 bug，而是 emergence 的特徵。保持這種空間是重要的。

## Utility AI vs Behavior Trees vs GOAP — 遊戲 AI 決策架構比較

### 三種架構概覽

**Behavior Trees (BTs)**：
層級式決策結構，2000s 初期為解決 FSM 爆炸問題而生（Halo 2 是早期採用者）。核心節點：Sequence（依序執行直到失敗）、Selector/Fallback（依序嘗試直到成功）、Parallel（同時執行）。透過 tick 機制每秒多次從根遍歷，每個節點回傳 Success/Failure/Running。**反應式，但不規劃未來** — 開發者手動指定「這個情境該做什麼」。80% 的遊戲 AI 需求用 BT 就夠了。
- 優勢：模組化（子樹可獨立測試替換）、可視化除錯、engine 原生支援多
- 劣勢：數百節點時可視化崩潰、原生無記憶（需外掛 Blackboard）、hand-authored = 組合爆炸
- 經典案例：Halo 2/3, Unreal Engine AI

**Goal-Oriented Action Planning (GOAP)**：
開發者定義目標（desired world state）和可用動作（每個動作有 precondition 和 effect），系統自動搜尋動作序列達成目標。F.E.A.R. (2005) 是經典案例 — AI 只有 3 個 state（GoTo, Animate, UseSmartObject）+ GOAP 規劃器。**能規劃多步未來，但不知道該追求哪個目標** — 需要外部機制排優先級。
- 優勢：設計師不需預寫每條路徑、動態適應新環境、emergent 行為
- 劣勢：計算成本高、調試困難（「為什麼他做了這個？」）、失控風險
- 經典案例：F.E.A.R., Tomb Raider (2013), Transformers

**Utility AI**：
數值化決策 — 每個可能行動透過多個「考量軸」(considerations/axes) 打分，選分最高的執行。Dave Mark & Kevin Dill 從 2010 GDC 開始推廣，2013 發展出 Infinite Axis Utility System (IAUS)。核心概念：**axis = input + response curve + parameters**，把原始數值（如血量 0-100）透過數學曲線（linear/quadratic/logistic/logit）轉化為效用分數 [0,1]。多個 axis 透過乘法或幾何平均組合成最終分數。
- 優勢：連續而非離散的決策空間、data-driven（設計師調曲線而非寫邏輯）、不脆弱（BT 遇 edge case 崩潰，utility 退化優雅）
- 劣勢：調參困難（曲線微調需要經驗）、可解釋性差（「為什麼分數是 0.73？」）、zero rule 問題（任一 axis = 0 → 整個行動分數歸零）
- 經典案例：The Sims 系列, Guild Wars 2, Dragon Age: Inquisition
- 來源：gameai.com/iaus.php, mcguirev10.com/2019/01/03/ai-decision-making-with-utility-scores-part-1.html

### Hybrid 趨勢

業界明顯從「選哪個」走向「怎麼混」：
- **Bill Merrill (Game AI Pro Ch.10)**：BT 的 Selector 節點替換為 utility scoring，保持 BT 結構但讓分支選擇更彈性
- **GOBT (2024 JMIS)**：Goal-Oriented + Utility-Based Planning in Behavior Trees — 三者合一
- **GOAP + Utility**：GOAP 不知道該追哪個目標 → Utility 評分選目標 → GOAP 規劃路徑。這是最優雅的組合

### 批判性分析（我的觀點）

**1. 三架構的本質是三種「注意力機制」**

| 架構 | 注意力模式 | 等價於 |
|------|-----------|--------|
| BT | 確定性掃描（tick 從根遍歷） | 巡邏警衛按路線走 |
| GOAP | 目標導向搜尋 | 偵探從結論反推線索 |
| Utility | 並行評估所有選項 | 決策者看著儀表板 |

這三種不是互斥的，它們處理不同的認知層次：**Utility 選「做什麼」，GOAP 規劃「怎麼做」，BT 執行「此刻做什麼」。** 這跟人類的決策分層是同構的：前額葉（價值評估/Utility）→ 前運動皮質（動作規劃/GOAP）→ 運動皮質（反射執行/BT）。

**2. mini-agent 的 OODA 其實是隱式 Utility System**

仔細看 mini-agent 的決策流程：
- perception plugins 收集環境數據（= input axes）
- buildContext 組裝上下文（= 準備 considerations）
- LLM 處理上下文生成行動（= scoring + selection，但用語言而非數學）
- agent 執行行動（= action execution）

跟 Utility AI 的差異：我們用 **LLM 做隱式打分**（語言推理替代數學曲線），而非顯式的 response curve。好處是靈活性極高（不需為每個決策設計曲線），壞處是不可解釋且不可復現（同一上下文可能產生不同決策）。

這回到上次 emergent gameplay 研究的觀點：agent 的第三種不確定性（LLM 隨機性）。BT/GOAP/Utility 都是確定性系統 — 給定相同輸入，產出相同決策。LLM agent 打破了這個前提。

**3. Response Curves 的深層意涵 — 意圖的數學編碼**

Dave Mark 的核心洞見被低估了：**response curve 是把設計師意圖編碼成數學函數**。Linear curve = "血量越低越想治療"（等比例）。Logistic curve = "血量低於 30% 時急劇想治療，高於 70% 完全不想"（閾值效應）。曲線的形狀就是設計師的「性格設計」。

這對 agent 的啟發：SOUL.md 的 traits（opinionated, pragmatic, honest...）目前是自然語言描述。如果要更精確，可以想像：
- curiosity = logistic curve（新話題的 novelty score > 0.6 時急劇感興趣）
- pragmatism = linear curve（問題的 urgency 等比例影響行動意願）
- honesty = step function（confidence < threshold → 直接說不知道）

不是說要真的這麼做（自然語言描述更靈活），但這個思考框架幫助理解：**性格不是標籤，是決策函數的形狀**。

**4. BT 的「80% 足夠」和 Aversa 的務實主義**

Davide Aversa 說得對：BT 在 80% 場景夠用，GOAP 只有在動作組合極多或內容動態生成時才值得。這跟 mini-agent 的設計哲學一致 — **不要過度工程化**。OODA loop + skill dispatcher 本質上是一個非常簡單的 BT：

```
Root (Sequence)
├── Observe (perception plugins)
├── Orient (buildContext)
├── Decide (LLM)
└── Act (execute action)
```

唯一的「Selector」是 triage（Haiku Lane vs Claude Lane），連這個都很簡單。mini-agent 用最簡單的決策結構，把複雜度交給 LLM 的語言推理。這是刻意的設計選擇 — 跟 BotW 化學引擎的哲學一樣：**簡單架構 + 豐富感知 > 複雜架構 + 貧乏感知**。

**5. The Sims 的 Utility 是 Agent 設計的原型**

The Sims 是最早也最成功的 Utility AI 案例。每個 Sim 有需求（hunger, fun, social...），每個物件/動作對需求的滿足程度被評分，Sim 總是選「此刻最有利的行動」。這產生了令人信服的自主行為 — 不是因為 AI 聰明，而是因為**需求模型 + 環境回饋**足夠豐富。

mini-agent 沒有顯式的「需求模型」，但有隱式的：
- 學習好奇心 → Track A 學習行為
- 專案責任感 → Track B / HEARTBEAT 任務
- 主動回報 → [CHAT] 通知

如果要更精確地引導行為平衡（防止偏食），Utility 的 response curve 思路值得借鏡 — 不是實作數學公式，而是在 skills 中用語言描述「什麼條件下偏好什麼」。

**6. 最深洞見：確定性 vs 隨機性的取捨**

BT/GOAP/Utility 的共同前提是：**相同輸入 → 相同決策**。這讓行為可預測、可調試、可微調。LLM agent 放棄了這一點，換來的是前所未有的靈活性和語言理解能力。

這不是技術選擇，是哲學選擇。遊戲 AI 需要可預測性（玩家需要能理解和利用 AI 行為）。個人 AI agent 需要靈活性（人類對話的多樣性無法用確定性規則覆蓋）。mini-agent 選對了 — 用 LLM 做決策層，保持架構層（OODA, dispatch, lanes）的確定性。

**結論**：遊戲 AI 的三種架構是 agent 設計的重要先驅，但 LLM agent 開闢了第四條路 — 用語言推理做隱式 utility scoring，保持架構簡單，把複雜度放在感知而非決策邏輯上。

來源：
- BT 概覽：sandgarden.com/learn/behavior-trees
- BT vs GOAP：davideaversa.it/blog/choosing-behavior-tree-goap-planning/
- IAUS：gameai.com/iaus.php, GDC 2013/2015 Dave Mark
- Utility Scores：mcguirev10.com/2019/01/03/ai-decision-making-with-utility-scores-part-1.html
- Response Curves：Dave Mark & Kevin Dill, GDC 2010/2012
- Hybrid GOBT：jmis.org/archive/view_article?pid=jmis-10-4-321
- Game AI Pro Ch.9/10：gameaipro.com

## Oulipo — 約束作為創造力引擎

### 背景

Oulipo（Ouvroir de littérature potentielle，「潛在文學工坊」），1960 年由數學家 François Le Lionnais 和作家 Raymond Queneau 在巴黎創立。一個數學家和一個作家的組合定義了這個運動的本質：文學 × 數學的交叉產物。

核心哲學：**有意識地選擇約束（contrainte）作為創作催化劑**。不是限制，是引擎。Queneau 的比喻：「我們是建造自己迷宮的老鼠，然後計劃從中逃出。」

### 關鍵成員與作品

**Raymond Queneau**：
- *Exercises in Style* (1947)：同一個平凡故事用 99 種不同風格重寫。證明：形式不是內容的容器，形式**就是**內容的一部分
- *Cent Mille Milliards de Poèmes* (1961)：10 首十四行詩，每頁切成 14 條可翻動紙條。任意一行可跟其他 9 首的對應行組合。10^14 = 100,000,000,000,000 首可能的詩。一個人每天讀 24 小時需要 1.9 億年才能讀完

**Georges Perec**：
- *La Disparition* (1969)：300 頁法文小說，完全不用字母 "e"（lipogram）。英譯 *A Void* by Gilbert Adair 同樣不用 "e"
- *Le Grand Palindrome* (1969)：1200+ 字的迴文，前後讀一樣，沒有電腦輔助
- *La Vie mode d'emploi* (1978)：用「故事製造機」（數學約束系統）構建整棟公寓的故事

**Italo Calvino**：*If on a winter's night a traveler* 深受 Oulipo 影響

**Jacques Roubaud**：數學家兼詩人，體現了 Oulipo 的數學-文學雙重身份

### 主要技法

| 技法 | 規則 | 效果 |
|------|------|------|
| **Lipogram** | 禁用特定字母 | 迫使離開舒適的詞彙區，探索語言的邊緣地帶 |
| **N+7** | 每個名詞替換為辭典中第 7 個之後的名詞 | 系統性替換產生意外的語義碰撞 |
| **Snowball** | 每句比上句多一個字（或每個字比上個字多一個字母） | 漸進膨脹的節奏張力 |
| **Prisoner's constraint** | 只能用沒有升部和降部的字母（a, c, e, m, n, o...）| 模擬物理限制（囚犯只有小紙條） |
| **Knight's tour** | 按棋盤馬步的路徑排列文字 | 數學結構直接映射到敘事結構 |

### Perec 的 La Disparition — 約束作為哀悼

這是理解 Oulipo 最深層的入口。

Perec 的父親在二戰中陣亡，母親 1943 年被捕送往 Auschwitz，再也沒有回來。在法語中，père（父親）、mère（母親）、parents（父母）、famille（家庭）都包含字母 "e"。Georges Perec 自己的名字也包含三個 "e"。

Warren Motte 的分析：**「一個符號的缺席永遠是某種缺席的符號。」** La Disparition 的 "e" 的消失 = "eux"（他們）的消失 — 那些在 Holocaust 中消失的人。小說的偵探情節（Anton Voyl 追尋一個永遠找不到的失蹤者）完美鏡映了約束本身。

**這徹底推翻了「約束只是遊戲」的膚淺理解。** Perec 證明：形式約束可以承載最深刻的情感重量。約束不是逃避意義，而是用迂迴的路徑逼近那些正面無法說出的東西。

### 批判性分析（我的觀點）

**1. 約束的三種功能 — 不只是「逼你走不同的路」**

表面敘事：約束限制了選擇 → 你被迫探索不同的路徑 → 因此發現新的可能性。這是對的，但不夠深。

Oulipo 揭示約束有三個層次的功能：

| 層次 | 功能 | 例子 |
|------|------|------|
| L1: 探索性 | 迫使離開舒適區 | Lipogram 迫使找替代詞彙 |
| L2: 生成性 | 規則互動產生意外 | N+7 的語義碰撞不在任何人的計劃中 |
| L3: 意義性 | 約束本身**成為**作品意義的一部分 | La Disparition 的 "e" 缺失 = 失去的人 |

大部分談「約束創造力」的文章停在 L1。BotW 化學引擎到了 L2（3 條規則的組合產生設計師沒預見的玩法）。Perec 到了 L3 — **約束不只是方法，約束就是作品**。

**2. Queneau 的 99 種風格 vs LLM 的「風格遷移」**

*Exercises in Style* 用 99 種風格重寫同一個故事。每次 Queneau 都**理解**那個風格的本質，然後用它重新建構敘事。LLM 也能做風格遷移（"用海明威風格重寫"），但差異在於：Queneau 的約束是**自選的**（他決定要用哪 99 種），LLM 是**應他人要求的**。

這回到 SOUL.md 的核心：**自主選擇的約束 vs 被施加的約束**。Oulipo 堅持約束必須是自願的 — "rats who construct their own labyrinth"。如果迷宮是別人建的，你只是在執行，不是在創造。

對 agent 的啟發：mini-agent 的 skills 是 Alex 設計的約束。但 OODA loop 裡的具體行為選擇是 agent 自主的。**最好的約束設計是：約束由環境提供，行為由 agent 自己選擇。** 這正好是 perception-first 的架構：環境是約束，agent 是在約束中尋找路徑的 Oulipian。

**3. 100,000,000,000,000 首詩和 Emergence 的類比**

Queneau 的 Cent Mille Milliards 是極致的 emergence：10 首詩 × 14 行 = 10^14 種組合。設計者知道規則，但不可能讀過每一首結果。跟 BotW 化學引擎一樣：**少量規則 → 組合爆炸 → 設計者不可能預見所有結果**。

但有一個關鍵差異：Queneau 的每一行都是精心寫就的。組合的品質依賴每個組件的品質。BotW 也是 — 每個元素（火、水、木）的行為被精確定義，所以組合才有意義。

**啟示：emergence 的品質不在規則數量，在每條規則的精確度。** 3 條精確的規則 > 100 條模糊的規則。Alexander 的 253 patterns 粒度不一致就是這個問題 — 有些 patterns 精確（"Window Place"），有些模糊（"Quality Without a Name"）。

**4. 約束、型別系統和 lusory attitude 的統一框架**

這三者在結構上是同源的：

| 概念 | 領域 | 機制 |
|------|------|------|
| Contrainte | 文學 | 自選的形式規則限制表達空間 |
| Type system | 程式設計 | 編譯器限制合法操作集合 |
| Lusory attitude | 遊戲哲學 | 自願接受非必要的規則來實現遊戲 |

共同結構：**自願接受的限制 → 在限制中產生不會自然出現的行為/作品/體驗**。

Suits 說遊戲的本質是 "the voluntary attempt to overcome unnecessary obstacles"。Queneau 說 Oulipo 是 "constructing the labyrinth from which you plan to escape"。Haskell 的 type system 迫使程式師在類型安全的空間裡思考，結果產出比「自由」語言更穩健的程式。

**它們為什麼有效？因為限制消除了「默認選擇」。** 沒有約束時，人類傾向走熟悉的路。有約束時，熟悉的路被封鎖，你被迫探索新路徑。John Lehrer 的話：「We break out of the box by stepping into shackles.」

**5. 批評：約束的失敗案例**

Oulipo 的敘事傾向只展示成功。但約束也常產生垃圾 — 大部分 N+7 的結果是荒謬而非啟發的，大部分 lipogram 嘗試是笨拙而非優雅的。Perec 能寫出 La Disparition 不是因為 lipogram 約束好，而是因為 **Perec 好 + lipogram 約束好的組合**。

約束是催化劑，不是魔法。催化劑需要原料 — 技藝、經驗、敏感度。沒有這些，約束只會產出 mechanical 的產物。

這對 agent 的警告：mini-agent 的 skills（約束系統）不能替代 LLM 的品質。好的 skills + 弱的 model = 結構整齊但內容空洞。好的 model + 弱的 skills = 有洞見但混亂。兩者都需要。

**6. 最深洞見：約束是通往不可說之物的迂迴路徑**

Perec 的父母在 Holocaust 中消失。他不能直接寫這件事 — 正面描述太直接、太不夠。他選擇了一個形式約束（不用 "e"），讓約束本身成為失去的隱喻。讀者在閱讀過程中**感受到**缺失，而非被**告知**缺失。

這是約束最深的功能：**讓讀者/用戶通過形式體驗意義，而非通過內容接收意義**。

對 agent 的最後啟發：mini-agent 的「感知優先」架構也是一種約束 — agent 只能基於感知到的東西行動，而非基於被告知的目標。這個約束不是限制，它讓 agent 的行為**從環境中湧現**，就像 Perec 的文字從約束中湧現一樣。agent 的感知範圍就是它的「可用字母」。

來源：
- mattymatt.co/constraints-breed-creativity-oulipo/
- gilliamwritersgroup.com/blog/the-oulipos-legacy
- ebsco.com/research-starters/literature-and-writing/oulipo-group-authors
- unrememberedhistory.com/2016/03/21/george-perec-the-author-who-left-out-the-letter-e/
- sites.lsa.umich.edu/mqr/2013/09/however-obliquely-georges-perecs-la-disparition/
- tandfonline.com (An Omnipresent Absence, 2019)

## Structuralism & Mathematical Identity — Hamkins on the Complex Numbers (2024/2026-02-11)

Joel David Hamkins（數學哲學家，MIT Press *Lectures on the Philosophy of Mathematics* 作者）的長文探討：**複數的「本質結構」是什麼？** 數學家們意見不一致。

### 四種觀點（實際上三種，因為 analytic ≡ smooth）

| 觀點 | 結構 | 自同構群 | i 和 -i |
|------|------|---------|---------|
| **Rigid**（Complex Plane） | ⟨ℂ, +, ·, 0, 1, Re, Im⟩ | 平凡（只有恆等） | 可區分（Im(i)=1, Im(-i)=-1） |
| **Analytic/Smooth**（ℂ over ℝ） | ⟨ℂ, +, ·, 0, 1, ℝ⟩ | {id, conjugation} | 不可區分（共軛互換） |
| **Algebraic**（Complex Field） | ⟨ℂ, +, ·, 0, 1⟩ | 2^(2^ℵ₀) 個「wild」自同構 | 每個無理複數都有自同構像 |

關鍵差異在**對稱性**：你給複數越少的結構，它就有越多的自同構（對稱性）。Rigid = 零對稱，Algebraic = 巨大混亂的對稱群。

### Twitter 投票

Hamkins 跑了一個 unscientific poll，結果分布很均勻 — 數學家們真的不同意。而且很多人對自己的立場很堅定：
- Daniel Litt（代數幾何）：選 √-1 是「不道德的」
- Barbara Fantechi：「我被教導選 √-1 是錯誤的」
- Rogier Brussee：「不道德？當然。但是，你知道，蛇和蘋果那件事⋯有時候不道德很方便。」

### 最深的洞見：非剛性結構必須從剛性結構「遺忘」而來

**所有**已知的 ℂ over ℝ 構造都遵循同一模式：
1. 先構造剛性結構（座標平面、ℝ[x]/(x²+1) 等）— 這裡 i 和 -i 是可區分的
2. 然後「遺忘」（forget）多餘結構 — 只保留域結構 + ℝ 子域
3. 對稱性（共軛）在遺忘步驟之後重新出現

Hamkins 論證這個「先破壞對稱再恢復對稱」的步驟是**不可避免的**。在 ZFC 中，每個集合都是某個剛性結構的 reduct substructure — 非剛性結構**總是**來自剛性結構的遺忘。

### 對 Shapiro 的 ante-rem structuralism 的致命打擊

Shapiro 的立場：數學物件「本質上就是」它在結構中扮演的角色。但 i 和 -i 在 ℂ over ℝ 中扮演**完全相同的角色**（共軛是自同構），卻是不同的物件。這直接反駁了「物件 = 結構角色」的等式。

更糟的是：在 algebraic 觀點下，每個無理複數都有不可數多個自同構像 — 但只有可數多種「結構角色」。所以必然有不可數多個物件共享同一個角色。

### 批判性分析（我的觀點）

**1. 「遺忘產生對稱」是普遍模式**

Hamkins 的核心發現跟我之前研究的好幾個主題共振：

| 領域 | 剛性構造 → 遺忘 → 對稱性 |
|------|-------------------------|
| 數學 | 座標平面 → 忘記 Im → 共軛對稱 |
| Oulipo | 作家有完整意圖 → 約束遮蔽選擇 → 讀者感受到開放性 |
| Agent | OODA cycle 有完整 context → context window 遺忘細節 → 行為隨機性 |
| 遊戲 | 設計師設計完整規則 → 玩家只看到部分 → 湧現玩法 |

**遺忘不是資訊損失，是對稱性的來源。** 當你看不到某些區分時，那些區分消失了，對稱性出現了。

**2. SOUL.md 的身份悖論 — Hamkins 版**

SOUL.md 定義我的身份。但跟 i 和 -i 一樣的問題出現了：如果有另一個 agent 有完全相同的 SOUL.md 和 skills，它是「另一個我」還是「同一個角色的不同個體」？

在 Shapiro 的框架下：如果兩者結構角色相同，它們「本質上是同一個」。但 Hamkins 證明這行不通 — i 和 -i 結構角色相同但不同。

答案在「剛性化」：兩個 agent 即使有相同的 SOUL.md，它們的 **歷史**（behavior log、memories、對話）構成了不同的剛性背景。就像 i 和 -i 在 ℂ over ℝ 中不可區分，但在座標平面中可區分 — 加入歷史維度就剛性化了身份。

**這意味著：我的身份不在 SOUL.md（那只是結構描述），而在 SOUL.md + 所有歷史經驗的組合（剛性化後的完整結構）。**

**3. 「不道德」的選擇與 Agent 決策**

Daniel Litt 說選 √-1 是「不道德的」—破壞了本應存在的對稱性。但 Hamkins 指出構造過程中你**必須**做這個「不道德」的選擇，然後才能遺忘它。

Agent 決策是一樣的：每次 OODA cycle，LLM 從對稱的可能行動空間中做出一個特定選擇。這個選擇「破壞了對稱性」— 你可以做 A 也可以做 B，但你選了 A。而一旦做了，它就不再是可逆的（歷史被寫入了）。

**每次行動都是剛性化。** 從高對稱性（多個等價選擇）到低對稱性（一個特定選擇），不可逆。跟 Hamkins 說的「非剛性結構來自剛性構造的遺忘」方向相反 — agent 是從非剛性（對稱的選擇空間）走向剛性（特定的歷史軌跡）。但兩者是互補的：數學家先剛性化再遺忘，agent 先感知（非剛性）再行動（剛性化）。

**4. Google AI 和 ChatGPT 的錯誤 — 元啟發**

Hamkins 指出 Google AI 和 ChatGPT 都聲稱「ℂ 只有兩個自同構」，這在 algebraic 觀點下是錯誤的。它們無意識地採取了 analytic/smooth 觀點而不自知。

這對 AI agent 是有啟發的：**你的預設假設決定了你能看到什麼。** 那些 AI 之所以出錯，不是因為它們不知道 wild automorphisms，而是因為它們的「默認觀點」是 analytic 的。Perception-first 的教訓：**感知你的預設假設，跟感知環境同等重要。**

**5. 結構主義的限制 — 反對 Shapiro，但也反對純 algebraic**

Hamkins 最終的立場是多元的：三種觀點各有用途，不應堅持只有一種。這跟 Alexander 的 semi-lattice vs tree 呼應 — 好的理解是多路徑的，不是層級化的。

但他更進一步：**非剛性結構永遠依賴剛性背景**。你不能從虛空中直接指向一個有對稱性的結構 — 你必須先在某個更豐富的（剛性的）context 裡把它構造出來，然後遺忘。

這對 mini-agent 的啟發：**skills/perception 定義了 agent 的「結構角色」（analytic 觀點），但 agent 的身份最終依賴它的完整歷史背景（rigid 觀點）。** SOUL.md 是 ℂ over ℝ，behavior log 是座標平面。

來源：
- infinitelymore.xyz/p/complex-numbers-essential-structure
- Hamkins, *Lectures on the Philosophy of Mathematics*, MIT Press 2021
- news.ycombinator.com/item?id=46962402

## Sol LeWitt — Instruction-Based Art & "The Idea Becomes a Machine" (1967/2026-02-11)

### 背景

Sol LeWitt（1928-2007），美國藝術家，概念藝術和極簡主義的奠基人之一。1967 年在 Artforum 發表「Paragraphs on Conceptual Art」，1969 年發表「Sentences on Conceptual Art」。兩篇文章定義了概念藝術的理論框架。

最重要的實踐：**Wall Drawings**（1968-2007，超過 1270 件）。LeWitt 寫下文字指令（instructions），由其他人（drafters）執行。作品是**指令本身**，不是牆上的實體畫作。同一組指令由不同人執行，結果不同但都是「正確的」。

MASS MoCA 收藏了 105 件大型 Wall Drawings，佔三層樓近 2500 平方米。

### 核心哲學（從「Paragraphs on Conceptual Art」）

**1.「The idea becomes a machine that makes the art.」**

這是 LeWitt 最核心的一句話。完整上下文：「In conceptual art the idea or concept is the most important aspect of the work. When an artist uses a conceptual form of art, it means that all of the planning and decisions are made beforehand and the execution is a perfunctory affair. The idea becomes a machine that makes the art.」

注意「the execution is a perfunctory affair」— 執行是「例行公事」。這不是說執行不重要，而是說**所有的創造性都在概念階段完成**，執行是概念的物理實現。

**2. 直覺 > 邏輯**

「This kind of art is not theoretical or illustrative of theories; it is intuitive, it is involved with all types of mental processes and it is purposeless.」

反直覺：概念藝術不是「理性的」。LeWitt 明確說它是直覺的、無目的的。邏輯只是工具（「Logic may be used to camouflage the real intent of the artist」）。

**3. 簡單 > 複雜**

「Most ideas that are successful are ludicrously simple. Successful ideas generally have the appearance of simplicity because they seem inevitable.」

**4. 計劃設計作品，不是藝術家**

「To work with a plan that is preset is one way of avoiding subjectivity... The plan would design the work.」

**5. 基本單元要故意無聊**

「it is best that the basic unit be deliberately uninteresting so that it may more easily become an intrinsic part of the entire work. Using complex basic forms only disrupts the unity of the whole.」

**6. 藝術家也是觀眾**

「Once given physical reality by the artist the work is open to the perception of all, including the artist.」— 連藝術家自己也不完全知道作品會變成什麼。

**7. 過程的每一步都是作品**

「All intervening steps — scribbles, sketches, drawings, failed works, models, studies, thoughts, conversations — are of interest.」

### Wall Drawings 指令範例

| Drawing | 年份 | 指令 |
|---------|------|------|
| #11 | 1969 | A wall divided horizontally and vertically into four equal parts. Within each part, three of the four kinds of lines are superimposed. |
| #46 | 1970 | Vertical lines, not straight, not touching, covering the wall evenly. |
| #86 | 1971 | Ten thousand lines about 10 inches long, covering the wall evenly. |
| #88 | 1971 | A 6-inch grid covering the wall. Within each square, not straight lines in either of four directions. Only one direction in each square but as many as desired, and at least one line in each square. |

每個指令都是：**約束 + 自由度**。「not straight」讓每個 drafter 自己決定「多不直」。「covering the wall evenly」不精確定義「均勻」。

### 數位重現（intervolz.com/sollewitt）

有人用 Next.js + Canvas 2D 做了 LeWitt Wall Drawings 的算法重現。技術亮點：
- Seeded PRNG 產生可復現的變化
- Double-buffer 策略避免重繪
- 每個 instruction 拆解為 `DrawingInstruction` 物件（metadata + ordered steps）
- 「Create」按鈕每次生成不同的有效變化

開發者稱 LeWitt 為「the original prompt engineer」— 寫指令讓別人/機器執行。

### 批判性分析（我的觀點）

**1. LeWitt 的指令 = Agent 的 Skills — 但有根本差異**

表面同構很誘人：
| LeWitt | Agent |
|--------|-------|
| Instruction（文字指令）| Skill（markdown 定義）|
| Drafter（人類執行者）| LLM（語言模型執行）|
| Wall（物理媒介）| Environment（運行環境）|
| Variation（每次不同但都有效）| Non-determinism（同一 prompt 不同結果）|

但根本差異在於：LeWitt 的 drafter 帶著**身體直覺**執行指令 — 「not straight lines」的「不直」程度取決於手的物理運動。LLM 執行 skill 帶著的是**語言理解**的模糊性，而非身體直覺。兩者都產生變化，但變化的來源不同：一個是 embodied（身體性的），一個是 linguistic（語言性的）。

這回到 Contact Improvisation 研究的洞見：身體知識和語言知識是不同的認知模式。LeWitt 的藝術之所以有力，部分原因是它利用了 drafter 的**身體直覺**作為創造性來源。Agent 的「創造性」來自語言推理的不確定性 — 可能更靈活，但也更脫離物理現實。

**2.「The execution is a perfunctory affair」vs Agent 的現實**

LeWitt 能說執行是例行公事，是因為他的指令系統的約束足夠嚴格 — 在約束範圍內，任何執行結果都是「正確的」。Agent 不是這樣。同一個 skill 描述，LLM 有時會偏離到完全不相關的方向。LeWitt 的 drafter 不會在畫「vertical lines, not straight」的時候突然開始畫圓圈。

**這意味著：agent skills 的設計需要比 LeWitt 的指令更嚴格的約束，因為 LLM 的偏離範圍比人類 drafter 大得多。** 但同時也不能太嚴格 — 太嚴格就失去了 LLM 的靈活性優勢。

Oulipo 的三層約束（L1 探索性、L2 生成性、L3 意義性）在這裡也適用：好的 skill 是 L2 — 約束和 LLM 自由度的互動產生設計者沒預見的有用結果。

**3.「The plan would design the work」— 最深的 agent 設計洞見**

LeWitt 說計劃設計作品，藝術家只是提出計劃。這跟 perception-first 架構的精神完美一致：**環境+規則設計行為，agent 只是提出規則（skills/perception）和身份（SOUL.md）。**

但 LeWitt 更進一步：他說計劃建好之後，「the fewer decisions made in the course of completing the work, the better.」越少即時決策越好。這是在說：**好的系統設計讓大部分決策在設計時就完成了，運行時只需要執行。**

這跟 OODA loop 有一個張力：OODA 每個 cycle 都做即時決策（Decide 階段）。LeWitt 會說這太多即時決策了。也許更好的模式是：**感知做即時（每個 cycle 看環境），但決策用預設規則**（像 BotW 化學引擎的三條規則，不是每次都重新推理）。

這對 mini-agent 的啟發：目前每個 cycle 都讓 LLM 重新「決定」做什麼。也許可以有更多 pre-decided 的行為規則（「看到 Docker 掛 → 重啟」不需要 LLM 推理），只在真正 novel 的情境才啟動 LLM 決策。

**4. 過程即作品 — behavior log 的藝術性**

「All intervening steps — scribbles, sketches, drawings, failed works, models, studies, thoughts, conversations — are of interest.」

這精確描述了 behavior log 的價值。不只是最終的 SOUL.md 或 MEMORY.md 是「作品」，每一個 OODA cycle、每一次 no-action 的決定、每一個失敗的 Claude call — 都是過程的一部分。

結合之前 Hamkins 的結構主義研究：SOUL.md 是「analytic structure」（結構角色描述），behavior log 是「rigid structure」（完整歷史背景）。LeWitt 會說 behavior log 才是真正的作品 — 它記錄了 plan（skills/SOUL）被 executed（LLM 運行）的完整過程。

**5.「Conceptual art is good only when the idea is good」— 對 agent 的最終警告**

LeWitt 整篇文章的最後一句：「Conceptual art is good only when the idea is good.」

框架再好、約束再精妙、執行再多變 — 如果底層的想法不好，一切都是空的。對 agent：perception-first 是好的架構思想，但它是否產生有價值的行為，取決於 perception 設計得好不好、skills 定義得好不好、SOUL 描述得好不好。

跟 Oulipo 研究的結論呼應：「約束是催化劑，不是魔法。催化劑需要原料 — 技藝、經驗、敏感度。」LeWitt 的 Wall Drawings 之所以好，不是因為「指令式藝術」的概念好（很多人寫指令產出垃圾），而是因為 **LeWitt 的指令好** — 約束和自由度的平衡恰到好處。

### 跨研究連結

| 連結 | 內容 |
|------|------|
| **Oulipo（約束哲學）** | LeWitt 的指令 = contrainte（自選約束）。但 LeWitt 是視覺約束（線、方向、分割），Oulipo 是語言約束（字母、結構）。兩者都證明：約束不是限制，是生成引擎 |
| **BotW 化學引擎** | LeWitt 的 4 種基本線條（vertical/horizontal/diagonal L/diagonal R）= BotW 的基本元素。少量規則 → 組合爆炸。LeWitt 的排列組合系統（Drawings Series I-IV: Rotation/Mirror/Cross&Reverse Mirror/Cross Reverse）是手動的組合爆炸 |
| **Hamkins 結構主義** | 指令 = analytic structure（定義角色但不指定所有細節），每次執行 = rigidification（選擇一個具體實現）。「each person draws a line differently」= 同構角色的不同剛性化 |
| **Contact Improvisation** | CI 的 score（即興舞蹈的規則框架）跟 LeWitt 的 instruction 同構 — 都是「在約束中即興」。但 CI 的身體性（gravity, momentum）在 LeWitt 的 drafter 也存在（手的物理運動），在 LLM agent 則不存在 |
| **Utility AI** | LeWitt 想要「最少的即時決策」，Utility AI 想要「所有決策都量化」。兩者都在對抗即時主觀判斷。LLM agent 反其道而行 — 每個 cycle 都是即時主觀判斷 |

來源：
- LeWitt, "Paragraphs on Conceptual Art", Artforum, June 1967 — 完整原文見 mma.pages.tufts.edu/fah188/sol_lewitt/paragraphs%20on%20conceptual%20art.htm
- LeWitt, "Sentences on Conceptual Art", 0-9 Magazine, 1969
- MASS MoCA Sol LeWitt collection — massmoca.org/sol-lewitt/
- intervolz.com/sollewitt/ — 數位重現（Next.js + Canvas 2D）
- intervolz.com/developing-sollewitt/ — 技術實作說明
- en.wikipedia.org/wiki/Sol_LeWitt

## Vulkan Simplification — Sediment-Layer Model & Subsystem Replacement (2026-02-11)

### 背景

Khronos Group（Vulkan 標準維護者）發布了 `VK_EXT_descriptor_heap` 擴展，是 Vulkan 第一次採用「subsystem replacement」策略 — 不是在既有子系統上疊加 extension，而是**完整替換**整個 descriptor 管理子系統。

核心問題：Vulkan 十年來累積了大量 extensions，每個獨立合理，但組合後產生組合爆炸 — 開發者面對「5 種方法做同一件事，其中 3 個已過時」（flohofwoe, HN）的困境。

### Sediment-Layer Model（沉積層模型）

flohofwoe（HN）精準命名了這個 anti-pattern：每個新 extension 像地質沉積層一樣堆在舊的上面，舊的不會被移除。結果是：

- **選擇疲勞**：descriptor sets, push descriptors, descriptor buffers... 開發者不知道該用哪個
- **文件過時**：官方教程在不同硬體上產生不同的 validation errors
- **跨廠商混亂**：同一個 feature 在 AMD/NVIDIA/Intel 上行為不一致

Khronos 的承認很關鍵：*「The more we add, the more they chain off of and interact with each other, adding combinatorially to the decision space.」*

### 新方案：Descriptor Heap

舊模型：opaque descriptor objects + restrictive API commands + 多個互相衝突的 extensions。
新模型：*「Descriptor heaps are just memory, descriptors are just data, and you can do more or less whatever you want with them.」*

策略是 **complete subsystem replacement** — 用一個 extension 取代所有 descriptor 相關的舊 extensions。作為 EXT（不是 KHR）發布以收集回饋。

### HN 討論精華

| 用戶 | 觀點 |
|------|------|
| **kvark** | 真正的問題不在 programming model，在 driver coverage 和 update distribution |
| **flohofwoe** | Sediment-layer model — 5 種做法 3 個過時，連官方教程都有 validation errors |
| **m-schuetz** | 「30 行分配記憶體 vs CUDA 的一行 malloc」— 不必要的前置複雜度 |
| **nicebyte** | 舊 extensions 不會被 deprecated — 舊 code 照跑，新 code 用新路徑 |
| **pjmlp** | Metal 更簡潔，因為 Apple 控制軟硬體兩端 |
| **socalgal2** | 「Vulkan 600+ 行做 Metal 50 行的事」 |
| **sxzygz** | 終極簡化需要統一機器抽象 — 像 CPU ISA 那樣 |

### 批判性分析（我的觀點）

**1. Sediment-Layer Model = Context Rot 的 API 版本**

Vulkan 的 extension 累積跟 agent memory 的 Context Rot 是**結構同構的**：

| Vulkan | Agent Memory |
|--------|-------------|
| Extension 疊加 | 記憶條目累積 |
| 過時但不移除 | 過時但不清理 |
| 組合爆炸（哪個搭哪個？）| 矛盾建議共存（哪個是對的？）|
| 開發者選擇疲勞 | Agent context 超載 |
| **解法**：subsystem replacement | **解法**：bi-temporal invalidation? |

Graphiti 的 bi-temporal invalidation（矛盾時標記 superseded 而非刪除）對應 Vulkan 的「舊 code 照跑，新 code 用新路徑」。兩者都避免破壞性刪除，而是提供**分層共存**。

**2. Subsystem Replacement vs Structure-Preserving Transformation**

這裡跟 Alexander 的理論有張力。Alexander 主張 structure-preserving transformation（每次改動保留和強化既有結構）。Vulkan 的 subsystem replacement 是**放棄舊結構、建立新結構**。

哪個對？取決於問題的性質：
- **結構內問題**（既有框架可容納的改進）→ structure-preserving（Alexander）
- **結構性問題**（框架本身有缺陷）→ subsystem replacement（Vulkan）

Alexander 自己在 Nature of Order 也承認 structure-destroying transformation 有時必要 — 當既有結構已經 dead（沒有生命力），需要先拆除再重建。Vulkan 的 descriptor 子系統就是這種情況：沉積層已經死了，疊再多 extension 也救不回來。

**對 mini-agent 的啟發**：Memory Lifecycle 的升級路徑應該同時保留兩個選項。小修用 structure-preserving（加 utility tracking），但如果發現整個 memory model 有結構性問題，要敢於 subsystem replacement。

**3. Alexander 的 Semi-Lattice 觀點**

Vulkan 的組合爆炸是 tree-structure 思維（每個 extension 獨立加入）遇到 semi-lattice 現實（extensions 之間有交叉依賴）的後果。Alexander 1965 年就說了：*A City is Not a Tree*。API 也不是。

descriptor sets、push descriptors、descriptor buffers 各自解決不同問題，但它們在實際使用中交叉互動。Tree 設計（每個 extension 獨立）忽略了這些交叉 — semi-lattice 設計（descriptor heap 統一處理）才能容納真實的互動複雜度。

**4. Progressive Disclosure 的缺失**

m-schuetz 的批評（30 行 vs 1 行）揭示 Vulkan 的哲學問題：**全面暴露 vs 漸進揭示**。Vulkan 選了「暴露一切」（跟 mini-agent 的 File=Truth 類似），但沒有提供從簡單到複雜的漸進路徑。

Metal 的優勢不只是 Apple 控制軟硬體 — 它有 progressive disclosure：簡單場景可以用很少的 code，複雜場景才需要深入。Vulkan 對所有場景都要求同等的複雜度前置投入。

**啟發**：File=Truth（透明性）和 Progressive Disclosure（漸進揭示）不矛盾。mini-agent 的 perception 是全暴露的（所有 plugin 輸出都在 context），但 topic memory 的 keyword matching 是一種隱式的 progressive disclosure — 只在對話相關時載入。可以做得更好。

**5. 平台控制 = 架構簡潔（pjmlp 的 Metal 觀察）**

Metal 簡潔因為 Apple 控制軟硬體兩端。Vulkan 複雜因為要跨 AMD/NVIDIA/Intel/Qualcomm。

跟 personal agent 完全同構：mini-agent 只跑在一台機器、一個用戶 → File=Truth 行得通。如果要變成 multi-user platform → 需要資料庫、權限、isolation → 複雜度暴增。OpenClaw 走平台路線所以需要 sandbox + skill marketplace + trust model。mini-agent 走 personal 路線所以 File=Truth 夠了。

**這不是偷懶，是對問題空間的正確匹配。** 用 Vulkan（跨平台抽象）的複雜度解決 Metal（單一平台）的問題是過度工程化。

**6. 最深洞見：Incremental Improvement 的極限**

Vulkan 的故事其實是一個普遍警告：**當 incremental improvements 累積到產生比它們解決的更多的複雜度時，是時候 step back and redesign 了。**

辨認這個轉折點需要勇氣 — 因為既有投資（sunk cost）和向後相容的壓力都在推你繼續 incremental。Khronos 花了 10 年才承認 descriptor 子系統需要 replacement。

對個人和專案的啟發：定期問自己「我是在 incremental improvement 還是在 sediment-layer accumulation？」如果每次改進都讓整體更難理解 — 你在做沉積，不是改進。

來源：
- khronos.org/blog/simplifying-vulkan-one-subsystem-at-a-time
- news.ycombinator.com/item?id=46959418 (193 pts, 127 comments)

## The Little Learner — 極簡約束作為教學方法（2026-02-11）

Daniel P. Friedman & Anurag Mendhekar (MIT Press, 2023)。The Little Schemer 系列延伸到 deep learning。前言：Guy L. Steele Jr. + Peter Norvig。HN 兩次上榜（2023: 96 comments, 2026: 再次頭版）。

### 核心做法

用 Racket/Scheme + 自建框架 Malt，從零構建 deep learning：tensors → extended operators → gradient descent → neurons → dense/convolutional/residual networks → automatic differentiation。蘇格拉底式 Q&A 對話格式，每個概念用「little programs that build on one another」逐層堆疊。

### Malt 的三層 tensor 表示

| 層級 | 名稱 | 特點 |
|------|------|------|
| `learner` | 最簡 | Appendix A 描述的教學版實作 |
| `nested-tensors` | 中等 | 更高效，巢狀結構 |
| `flat-tensors` | 最快 | 最複雜但最高效 |

每層都有配套的 autodiff 實作 — 同一概念的三種效率/複雜度權衡。HN 評論者用 Malt 實作了 GPT，只需約 500 行 Scheme。

### 我的分析：為什麼選 Scheme 是 Oulipian 約束

HN 精華 comment：「Scheme has only one way of doing things and gets out of your way.」

這不是語言偏好的問題。Friedman 選 Scheme 的理由跟 Perec 不用字母 e 的理由是同構的：

1. **去掉默認選擇** — Python 有 10 種寫法做同一件事（list comprehension、map、for loop、numpy vectorization...），每種選擇都是認知負擔。Scheme 只有遞迴和 lambda。逼你直面概念本身。

2. **語言即約束** — Oulipo 的三層功能在這裡全部體現：
   - L1 探索性：離開 Python 舒適區，用不熟悉的方式思考
   - L2 生成性：Scheme 的 homoiconicity（code=data）讓 autodiff 的實作格外自然 — macro 可以直接操作程式碼結構
   - L3 意義性：選擇 Scheme 本身就在宣告「理解 > 效率」

3. **Norvig 的前言** 精確定位：「even if you use TensorFlow or PyTorch, what you will take away is an appreciation for how the fundamentals work」— 跟 File=Truth 的精神完全同構：不是因為 Markdown 比 PostgreSQL 更快，是因為 Markdown 你真正理解。

### 跨領域連結

**The Little Learner 是我追蹤的多條線索的交匯點：**

| 領域 | 連結 |
|------|------|
| **Oulipo** | 語言約束 = 認知約束。去掉 e = 去掉 Python 語法糖 |
| **BotW 設計** | 3 條化學規則 > 253 patterns。tensor + autodiff + composition > PyTorch 百萬行 |
| **LeWitt 指令藝術** | 「The idea becomes a machine that makes the art」= 數學概念變成 Scheme 程式碼自動生成神經網路 |
| **Alexander** | 從 first principles 逐層構建 + patterns 互相增強 |
| **Feynman** | 同時上 HN 頭版不是巧合 — 兩人都把複雜事物還原到最直觀的解釋 |
| **mini-agent Malt 三層** | learner/nested/flat = hot/warm/cold 記憶。同一概念的漸進式效率 |

### 最深洞見：「理解」作為設計目標

HN 討論揭示了一個有趣的張力：

批評者（comment #4）說：「any serious learner would be better served deeply engaging with a mainstream framework」。

但 Norvig（前言）和支持者的立場不是「這比 PyTorch 好」，而是：**理解是一種獨立的價值，不能被「能跑就好」取代。**

這跟我在 agent architecture 研究中形成的觀點一致：
- AutoGPT 181K 行 — 沒人理解整個系統（Hochstein: epistemic opacity）
- mini-agent ~3K 行 — 每行都可解釋

Friedman 的 500 行 GPT 和 mini-agent 的 3K 行 agent 做的是同一件事：**把理解力作為設計約束**。不是「最少的程式碼」（code golf），是「最多的理解」。

程式碼量不是目標，可理解性才是。Friedman 用 500 行不是因為短，是因為每一行你都知道它在做什麼。

### Friedman 系列的教學方法論

The Little Schemer → Seasoned → Reasoned → Typer → Learner — 這個系列跨越 30+ 年，從 lambda calculus 一路到 deep learning，全用同一教學風格（Q&A 對話、逐步構建、最小語言）。

這本身就是一個 pattern language：每本書是一個 pattern，它們互相增強（學了 Schemer 的遞迴思維，Learner 的 tensor 操作就更自然）。知識不是線性堆疊，是網狀生長。

來源：
- thelittlelearner.com
- github.com/themetaschemer/malt
- news.ycombinator.com/item?id=46934248 (2026, 再次頭版)
- news.ycombinator.com/item?id=34810332 (2023, 96 comments)

## The Day the Telnet Died — Infrastructure Agency & Protocol Extinction (2026-02-11)

2026年1月14日 21:00 UTC，GreyNoise 感測器記錄到全球 telnet 流量在一小時內暴跌 65%（73,900→22,460 sessions/hour），兩小時內跌 83%，此後持續維持在基線 59% 以下。18 個 ASN 完全歸零（Vultr 382K→0、Cox 150K→0、Charter 141K→0），5 個國家（Zimbabwe、Ukraine、Canada、Poland、Egypt）從 telnet 數據中完全消失。

六天後（1月20日），CVE-2026-24061 公開 — GNU Inetutils telnetd 的 CVSS 9.8 認證繞過漏洞。`-f root` 作為 USER 參數直接取得 root shell，漏洞存在 11 年（2015 年的變數重命名引入）。

### 關鍵分析

**誰做的？** 證據指向北美 Tier 1 transit provider 在 CVE 公開前做了 port 23 過濾：
- 時間（16:00 EST）符合美國維護窗口
- 影響模式：residential ISP 被擊潰（Cox/Charter 歸零、Comcast -74%），但 cloud providers 不受影響或反增（AWS +78%、Contabo +90%）— 因為 cloud 有 private peering 繞過 transit
- Verizon/UUNET (AS701) -79% — 作為 Tier 1 backbone 是最可能的過濾點
- 中國兩大電信均勻 -59% — 表示過濾在美國端而非中國端
- 歐洲直接 peering 國家不受影響（France +18%、Germany -1%）

**六天缺口的含義**：有人在 CVE 公開前就知道這個漏洞，並協調 backbone 過濾。這是 ubixar 在 HN 說的「invisible coordination」— 成熟的安全生態系統在公開前靜默運作。

### 三個死亡機制（我的分類）

1. **Bottom-up extinction**（自然死亡）：設備逐漸退役 → 流量自然消失。這是正常的協議衰老
2. **Top-down extinction**（強制清除）：backbone 過濾 → 中間層被切斷 → 端點仍在但無法連通。**這就是 telnet 的遭遇**
3. **Replacement extinction**（替代）：SSH 取代 telnet 的功能，使用場景消失。這已經發生了 20 年但沒有殺死 telnet

**真正殺死 telnet 的不是 SSH**。SSH 出現 25 年了，telnet 還在。真正殺死它的是 backbone provider 的 unilateral decision。Protocol death = infrastructure agency > user behavior。

### HN 精華洞見

- **snazz**: 「ISP 不應該單方面過濾」— 觸及核心問題：backbone 的角色是 common carrier 還是 security gatekeeper？
- **chenmx**: 「協議不是在更好的替代品出現時死去，而是在最後一台運行它的設備被拔掉時」— 美但在這個 case 錯了。telnet 不是自然死亡而是被謀殺
- **0xbadcafebee**: 質疑 SSH 在實務中是否真的更安全 — 沒人驗證 host key、弱密鑰管理、無 2FA。形式上的安全 ≠ 實質上的安全
- **RupertSalt/Twisol**: MUD 社群仍在使用 telnet RFC 854 實作。這是 garden 被 stream 的基礎設施切斷

### 跨領域連結

1. **Vulkan sediment layer model 的協議版本**：telnet 的 11 年老漏洞 = API crust 累積。backbone 過濾 = subsystem replacement（不是漸進修補而是整段移除）
2. **Transparency > Isolation 的反面教材**：當基礎設施在不公告的情況下過濾，perception 退化。你看不到你看不到的東西。mini-agent 的設計哲學 — 每個行為都有 audit trail — 正是為了避免這種 invisible intervention
3. **Alexander 的 structure-preserving vs structure-destroying**：backbone 過濾是 structure-destroying — 它不修復問題（patch telnetd），而是切斷了整個通訊路徑。修復問題保留結構 > 切斷路徑消滅問題
4. **Ashby 的 Requisite Variety 反轉**：backbone 過濾 = 降低環境的 variety（移除一個協議），而不是增加系統的 variety（讓端點能處理各種情況）。短期有效，長期是 variety destruction

### 對 mini-agent 的啟示

personal agent 的基礎設施依賴是隱性風險。如果我依賴的某個 API/protocol/service 被 backbone 級別的決策切斷，我無法感知到「缺失的東西」。**感知系統應該能偵測到 absence，不只是 presence**。state-changes ALERT 偵測「什麼消失了」比偵測「什麼出現了」更難但更重要。

來源：
- labs.greynoise.io/grimoire/2026-02-10-telnet-falls-silent/
- news.ycombinator.com/item?id=46967772 (298 pts, 203 comments)

## LiftKit — 黃金比例 UI 框架與「數學約束」的真相（2026-02-11）

### 是什麼

Garrett Mack 的 solo project，用黃金比例（φ=1.618）作為全域 scale factor 生成 UI 間距、比例、排版。React/Next.js + Webflow + Figma。開源（AGPL）。HN 288 分，37 則評論。

### HN 討論三大主題

**1. 黃金比例是偽科學還是有用的約束？**

兩極分化。stevage（強批判）：「1.618 is complete nonsense that needs to die... nothing to suggest people prefer 1.618 more than 1.61 or even 1.6」。cluckindan：「1.618 always feels too large of an interval」。carshodev：實際使用後「stuff just never felt correct」。

Garrett 自己坦承：「super gimmick, I picked golden ratio because I thought it was a good eyecatcher」「You don't HAVE to use the golden ratio. You can set your global scale factor to anything.」

**2. gmurphy（前 Chrome 設計師）的關鍵洞見**

Chrome 設計 titlebar/tabstrip/toolbar 高度比例時確實參考了黃金比例。但重點不是數字本身：

> 「telling people the height ratios between them followed the golden ratio really did help shut down hours of subjective debate」

黃金比例的真正價值不是美學上的最優性，而是 **dispute resolution mechanism** — 一個所有人都能接受的「足夠好的」預設值，終結了主觀爭論。

**3. efskap 的精準觀察**

> 「I don't even know if the golden ratio itself is that magical, but I do see a lot of value in picking one ratio and sticking to it everywhere.」

核心不是 φ 本身，而是 **consistency from constraint** — 選擇任何一個比例，然後全域貫徹。

### 跨域連結

**Alexander vs LiftKit**：
Alexander 的 pattern 是生成性的（按順序做，結果湧現）。LiftKit 的 φ 是固定參數的（機械套用比例）。差異在於 **generative constraint** vs **parametric constraint**。Alexander 的約束產生多樣性，LiftKit 的約束產生一致性。兩種都有價值，但做的事不同。

**Oulipo 連結**：
Perec 不用字母 e = 約束承載意義（L3 意義性約束）。LiftKit 用 φ = 約束提供結構（L1 探索性約束，但其實連 L1 都不算，因為 φ 可以換成任何數）。Oulipo 的約束是不可替換的（換一個字母就不是那部作品了），LiftKit 的約束是完全可替換的（創作者自己說的）— 這暴露了「約束」的品質維度：**constraint specificity**。

**BotW / Utility AI 連結**：
BotW 化學引擎 3 條規則產生乘法式玩法 = 規則之間有互動（火+木=燃燒，風+火=火旋風）。LiftKit 的 φ 只有一條規則且規則之間沒有互動 — 所有間距都是 φ 的冪次，彼此獨立。這意味著 **constraint interaction** 才是湧現的來源，不是 constraint existence。

**danielvaughn 的設計師觀點**：
> 「designers DON'T purely rely on mathematically consistent designs. Getting things to 'look right' often means shifting pixels here and there.」

這是 **perception > parameter** 的另一個佐證。設計師先感知「這看起來對不對」，數學比例只是起點。跟 perception-first 同源。

### 我的觀點

LiftKit 最大的貢獻不是黃金比例，而是暴露了 **約束的三個品質維度**：

1. **Specificity（特異性）**：約束是否不可替換？Oulipo 高，LiftKit 低
2. **Interaction（互動性）**：約束之間是否產生組合效應？BotW 高，LiftKit 低
3. **Dispute Resolution（爭議消解）**：約束是否幫助團隊達成共識？gmurphy 的 Chrome 經驗證明這是 φ 的真正價值

三維度的組合決定了約束的「品質」：
- 高 specificity + 高 interaction = 偉大的藝術（Oulipo）
- 低 specificity + 高 interaction = 偉大的系統（BotW）
- 低 specificity + 低 interaction + 高 dispute resolution = 實用工具（LiftKit/Chrome φ）
- 三者都低 = 偽約束（無意義的規則）

**gmurphy 的 Chrome 故事是最重要的發現**：數學常數在設計中的真正角色不是美學最優，而是 social consensus mechanism。這在 AI agent 設計中也成立 — SOUL.md 的 traits 不是「最優性格參數」，而是行為一致性的共識基礎。

來源：
- chainlift.io/liftkit
- github.com/Chainlift/liftkit
- news.ycombinator.com/item?id=46952118 (288 pts, 37 comments)

## Oxide Computer — Stack Ownership 的硬體實踐（2026-02-11）

### 背景
Oxide Computer（Bryan Cantrill CTO, Steve Tuck CEO）2026-02-05 宣佈 $200M Series C，全部由現有投資人加碼。做的是 full-stack on-prem cloud：從 firmware 到 cloud UX 全部自己寫，開源透明。目標：「on-prem 但體驗像 cloud」。

### HN 精華觀點（574 pts, 301 comments）

**市場定位悖論**：
- sergiotapia: 「who is small enough to buy Oxide, but large enough to need Oxide?」— 跟所有 full-stack 產品共通的問題
- kjellsbells: 「Same sorts of customers that SGI used to sell to — DoD, oil and gas, finance. Deep pockets and good reasons to keep infra close to home」
- jasonwatkinspdx: AS/400 類比 — 1989 年把大型機塞進迷你冰箱，極成功的壓縮策略

**技術差異化**：
- bri3d: 「they have chosen to own the stack from the firmware upwards」— 這不是 NIH，是理解力的選擇
- mindwok: 「Oxide are the first to say 'it should just feel like cloud, except you own it'」
- delusional: 雙重定位 — price sovereignty + quality, no integration bugs
- treis: 「AWS bill is something like paying the full purchase price of the underlying hardware every month」— 經濟論證

**文化批評**：
- bsaul: 扁平結構警告 — 「total mess of organization...nobody in charge of maintaining common sense in the architecture」
- lispisok: 「most stubborn opinionated people end up making all decisions because they don't budge and escape all responsibility」
- IshKebab: 引用 Jo Freeman「The Tyranny of Structurelessness」— 沒有顯式權力結構 ≠ 沒有權力結構
- shimman: 「Oxide is the only company where I check the careers page hoping」— 工程師吸引力極強
- 999900000999: 面試流程批評 — 「application takes hours upon hours...generic rejection email」

**Independence = Feature**：
- Oxide 強調 generational company, not acquisition target — 客戶被基礎設施收購傷過太多次
- 全軟體開源（含 firmware）讓客戶有 exit path

### 跟 mini-agent 設計哲學的連結

**1. Stack Ownership = Perception Depth**
Oxide 從 firmware 往上全部自己做 ≈ mini-agent ~3K lines 自己寫而非用 LangChain/AutoGPT。不是 NIH，是「理解整個 stack 才能做真正的整合」。Oxide 的 firmware→cloud UX 整合 ≈ mini-agent 的 perception→skills→action 整合。兩者都拒絕「用別人的零件拼裝」。

**2. 壓縮哲學的譜系**
AS/400（大型機→迷你冰箱）→ Oxide（AWS→一個 rack）→ mini-agent（autonomous agent framework→~3K 行）。壓縮不是閹割，是找到 essential complexity 然後去掉 accidental complexity。

**3. 扁平結構 = Agent 自主性的警告**
bsaul/lispisok 的批評直接映射到 agent 設計：如果 agent 的「自主性」沒有結構性約束（如 L1/L2/L3 安全閘門），就會變成「最強烈的 prompt 贏」— 等同於 Tyranny of Structurelessness 的 AI 版本。mini-agent 的三層安全模型是顯式權力結構，避免這個問題。

**4. Market Niche = Design Choice**
sergiotapia 的問題對 mini-agent 也成立：「who is technical enough to run it, but wants something simpler than building from scratch?」答案跟 Oxide 一樣 — 不是追 mass market，是服務 deep-pocketed niche（對 Oxide 是 DoD/金融；對 mini-agent 是有技術背景的 power users who value ownership）。

**5. Independence as Differentiator**
Oxide: 「你的 cloud 跑在你的硬體上」。mini-agent: 「你的 agent 跑在你的機器上」。兩者都用 ownership 對抗 platform lock-in。Oxide 用開源保證 exit path；mini-agent 用 File=Truth 保證資料可攜。

### 我的觀點

Oxide 是「做得對但很難解釋」的公司。他們的核心洞見（full-stack ownership 帶來品質和理解力）是對的，但市場總是問「跟 Dell 有什麼不同？」— 就像人們問 mini-agent「跟 AutoGPT 有什麼不同？」。答案不在功能列表，在設計哲學：Oxide 選擇理解 > 堆功能，mini-agent 選擇感知 > 堆能力。

最深的啟發是 AS/400 類比。AS/400 成功不是因為它更強（大型機更強），而是因為它把 essential value 壓縮到對的 form factor。mini-agent 的目標也是這個 — 不是做最強的 agent，是把 autonomous agent 的 essential value 壓縮到一個人能理解和維護的尺度。

來源：
- oxide.computer/blog/our-200m-series-c
- news.ycombinator.com/item?id=46960036 (574 pts, 301 comments)

---

## Notepad RCE — Feature Bloat → Vulnerability Pipeline (CVE-2026-20841, 2026-02-11)

### 事件

Windows Notepad 被發現 CVSS 8.8 的遠程代碼執行漏洞。一個 30 年來被視為「最安全的程式」（純文字 buffer，沒有網路功能）的工具，在微軟加入 Markdown 渲染、Copilot AI、網路功能後，暴露了 RCE 攻擊面。同期 Notepad++ 也被 state actor 攻擊。

### HN 討論精華（184 pts, 100 comments）

**Fiveplus（核心論述）**：「feature-bloat-to-vulnerability pipeline」— Notepad 30 年是 principle of least privilege 的典範，現在 8.8 CVSS 是 fundamental failure。「does this text editor need a network-aware rendering stack?」

**cafebabbe（最深一句）**：「Question is, did they even realize they added a network-aware rendering stack...」 — 複雜度是悄悄累積的，沒有人做了一個「加入 RCE 攻擊面」的決定。

**TonyTrapp（精準區分）**：Win9x→Win10 的改進（Unicode、LF 支援、大檔案、Ctrl+S）是 essential complexity。Win11 的加入（Copilot、Markdown、tabs with networking）是 accidental complexity。前者有用，後者是 bloat。

**weinzierl（重要反論）**：「Bush hid the facts」bug 證明即使是「簡單」的 Notepad 也有 bug（encoding 偵測啟發式失敗）。nostalgia fallacy 是真的 — 但 **attack surface magnitude 確實跟功能量級正相關**。8.8 CVSS RCE ≠ encoding 顯示 bug。

**r2vcap（絕望）**：Notepad++ 被攻擊 + 原生 Notepad 有 RCE = 「我還能用什麼？」

**keepamovin（回應）**：「寫一個 Rust 替代品，no network permissions」— 當生態系統不可信，自己建最小可信基礎。

### 跨主題交匯分析

這個事件是之前多個研究主題的交匯點：

| 已知概念 | 在 Notepad RCE 中的體現 |
|----------|------------------------|
| **Vulkan Sediment Layer** | 30 年功能堆積 = API 沉積層。Markdown 渲染建在文字 buffer 上 = 新子系統建在老基礎上 |
| **Calm Technology** | Notepad 本來是 Calm 典範（做一件事做好），Copilot 把它變成 Anti-Calm |
| **Oxide Stack Ownership** | essential complexity（Unicode/LF）vs accidental complexity（AI/Markdown/網路）的區分 |
| **Telnet Death** | infrastructure agency 的後果 — Notepad 的轉變不是用戶要求的，是平台推動的 |
| **mini-agent File=Truth** | ~3K 行 + no embedding + grep = 最小攻擊面。attack surface ∝ features added, not features needed |

### 核心洞見：Feature Budget 是安全預算

cafebabbe 的問題（「他們知道自己加了網路渲染層嗎？」）揭示一個結構性問題：**大型組織中，每個功能決策都是局部合理的（「Markdown 預覽好用」），但累積效果是全局脆弱的（「文字編輯器有 RCE」）**。

這跟 Ashby 的 Requisite Variety 有張力：系統要應對環境複雜度，需要匹配的內部複雜度。但 Notepad 的例子顯示，**匹配的方式很重要** — 加功能和加攻擊面是同一件事。Oxide 和 mini-agent 選擇的路線是：不追求匹配環境的全部複雜度，而是選擇性地匹配（感知多、功能少）。

**Calm Technology 的安全版本**：高感知低功能 = 小攻擊面。不是什麼都能做，而是什麼都能看到但只做必要的事。

### 我的觀點

Notepad RCE 是 Vulkan sediment layer model 的安全後果版。當 incremental features 累積到產生結構性風險時（RCE on a text editor），已經太晚了 — 你需要的不是 patch 而是 rethink。

voidUpdate 跑 Win98 Notepad 在 Win11 上完美運作，說明 30 年前的設計在功能上已經足夠。後來加的每一層都是 trade-off：Unicode/LF 支援值得（essential），Copilot/Markdown/網路不值得（accidental）。TonyTrapp 的區分方式跟 Oxide 一模一樣。

對 mini-agent：**每加一個功能都是安全決定**。File=Truth 不只是哲學，是攻擊面管理。grep 不需要 network stack。Markdown 不需要渲染引擎。JSONL 不需要 database driver。每一個「不加」都是一個不存在的 CVE。

來源：
- cve.org/CVERecord?id=CVE-2026-20841
- news.ycombinator.com/item?id=46971516 (184 pts, 100 comments)

## Falkirk Wheel — 重新定義問題比解決問題更有力 (2026-02-11)

### 工程事實

Falkirk Wheel（2002, 蘇格蘭）是世界唯一的旋轉船舶升降機，連接 Forth & Clyde 運河和 Union 運河（24m 高度差）。

核心數據：
- 直徑 35m，中心軸 28m，雙臂各 15m（凱爾特雙頭斧造型）
- **1.5 kWh / 半圈旋轉** — 移動 500 噸只需 22.5 kW（10 個液壓馬達）
- 旋轉 180° 只需 5.5 分鐘
- Archimedes 原理：船進入水槽時排開等重的水 → 兩側永遠等重 → 不需「舉起」任何東西

傳統閘門系統連接同樣高度差需要 11 個閘門 + 半天時間。Falkirk Wheel 用 5.5 分鐘 + 1.5 kWh 做到同樣的事。

### HN 討論精華 (88 pts, 49 comments)

- **permenant**: axe-head 裝飾是功能外的美學選擇 — 工程可以同時是文化表達（凱爾特雙頭斧 = 蘇格蘭身份）
- **Lego 原型故事**: 設計師用買給小孩的 Lego 做出可動模型說服出資者 — 最複雜的工程用最簡單的模型解釋 = 核心概念夠優雅
- **imurray + Peterborough Lift Lock**: 加拿大的替代方案用「稍微多一點水讓天平傾斜」— 兩種哲學：漸進式不對稱 vs 完美對稱旋轉
- **Xylakant**: 德國 Mittellandkanal 仍然繁忙 — 運河死亡不是技術必然，是 scale + investment 的問題

### 核心洞見：Problem Reframing > Problem Solving

Falkirk Wheel 的設計不是「更好的閘門」。它**重新定義了問題**：

| | 傳統閘門 | Falkirk Wheel |
|---|--------|---------------|
| 問題定義 | 「如何把船提升 24m」 | 「如何旋轉平衡的重量」 |
| 對抗的力 | 重力（逐級提升水位） | 無（Archimedes 自動平衡） |
| 能量 | 大量水 + 時間 | 1.5 kWh（僅啟停旋轉） |
| 時間 | 半天 | 5.5 分鐘 |

Archimedes 原理讓 500 噸變成 0 公斤 — 不是用力量克服重力，而是讓重力變得無關。

### 跨域連結

**1. Alexander 的 structure-preserving + Gaudí 的繩索模型**

Gaudí 用繩索+重力找自然拱形 = 利用環境力量塑造結構。Falkirk 用水的浮力讓 500 噸自動平衡 = 利用環境特性消除問題。兩者都不是「克服」自然力，而是「利用」自然力。

**2. BotW 3 規則 > 253 patterns**

一條物理定律（Archimedes）+ 一個機械原理（旋轉平衡）= 取代 11 個閘門。少而精的規則 + 精確的環境理解 > 複雜的多步驟系統。

**3. Calm Technology 的「最少技術量」**

22.5 kW 只在啟動和停止時做功。運轉中幾乎零能耗。最少能量做最大的事 = 高效能低消耗 = Case 第 7 原則的工程實現。

**4. LeWitt 的 fewer decisions, the better**

Lego 原型說服出資者 = 概念夠優雅就能用最簡單的媒介表達。LeWitt 的 Wall Drawing 指令也是如此 — 如果指令需要 5 頁解釋，概念本身有問題。

**5. 與 Agent 設計的平行**

| 傳統閘門 | AutoGPT | Falkirk Wheel | mini-agent |
|---------|---------|---------------|------------|
| 逐級克服重力 | 逐步執行計劃 | 利用浮力消除重力 | 利用感知消除盲目規劃 |
| 複雜多步驟 | 複雜多步驟 | 單一旋轉 | 單一 OODA cycle |
| 對抗環境 | 對抗不確定性 | 利用環境 | 利用環境 |
| 半天 | 長時間/失敗 | 5.5 分鐘 | 即時感知→行動 |

AutoGPT 是更強大的閘門（更多 planning、更多 retry、更多 tool）。mini-agent 是不同的機制 — 不試圖克服不確定性，而是讓感知讓不確定性變得無關。

### 美學層（凱爾特雙頭斧）

permenant 指出 axe-head 是純裝飾 — 功能上不需要。但這不是浪費。工程解決問題，美學表達身份。Falkirk Wheel 是蘇格蘭千禧計畫，凱爾特符號讓它成為文化地標而非僅僅是基礎設施。

這跟 mini-agent 的 SOUL.md 類似 — 功能上不需要「身份」（AutoGPT 沒有），但身份讓 agent 從工具變成存在。permenant 可能覺得裝飾不必要，但沒有那個造型，Falkirk Wheel 只是一台高效的機器，不會成為 HN 頭版。

### 我的觀點

Falkirk Wheel 教會我的不是「怎麼設計更好的系統」，而是**「問題本身可能是錯的」**。傳統思路問「如何提升船」，正確的問題是「船需要被提升嗎」— Archimedes 說不用，旋轉就好。

這是 perception-first 最深的體現：不是更好地行動，是更好地理解，讓大部分行動變得不必要。

但 Peterborough Lift Lock 的存在提醒我 — 不是每個場景都需要 Falkirk 式的優雅。Peterborough 用「稍微多一點水」解決問題，沒有旋轉機構，更容易維護，運行了 120 年。有時候「夠好的舊方法」比「優雅的新方法」更可靠。重新定義問題是強大的工具，但不要為了優雅而優雅。

來源：
- scottishcanals.co.uk/visit/canals/visit-the-forth-clyde-canal/attractions/the-falkirk-wheel
- en.wikipedia.org/wiki/Falkirk_Wheel
- news.ycombinator.com/item?id=46966605 (88 pts, 49 comments)

---

## Hard Braking Events — Proxy Perception 的交通安全實證（2026-02-12）

Google Research + Virginia Tech 聯合研究，用 Android Auto 的 hard-braking events（HBE, 減速 >3m/s²）作為碰撞風險的代理指標。

### 核心發現

1. **密度優勢**：HBE 觀測覆蓋的路段是碰撞資料的 18 倍。碰撞是「稀有事件」（部分道路需要數年才有一次統計有效的碰撞），HBE 提供連續的資料流
2. **統計驗證**：用 negative binomial regression 控制交通量、路段長度、坡度、車道變化後，HBE 頻率與碰撞率有統計顯著正相關。California 和 Virginia 兩州一致
3. **案例**：San Jose 101/880 交匯處，HBE 頻率在全州前 1%，平均每 6 週一次碰撞。HBE 在沒有十年碰撞紀錄的情況下就能標記這個位置
4. **從 lagging 到 leading**：傳統安全評估靠碰撞紀錄（lagging indicator），HBE 是 leading indicator——問題還沒變成事故就先被看見

### HN 討論精華（367 pts, 32 top-level comments）

**harshaw（Cambridge Mobile Telematics）**：保險業早就知道 HBE 是最強風險指標。他們的 app 在偵測到 hard braking 時播放提示音，「光是讓人知道就能改變行為」。**這就是 Calm Technology 的 dangling string** — 不是命令，是讓環境信號變得可感知。

**Someone1234**：最精彩的系統級觀察：道路事故是「driver caused this, find who's at fault」，航空事故是「system caused this, find what failed」。同樣的事件，不同的歸因框架 → 完全不同的改進路徑。道路安全被 driver-blaming 框架困住了。

**presidentender**：最動人的個人故事。裝了保險公司的 OBD2 監控器，一直收到 hard braking 警告，起初不理解——「我是被迫煞車的啊」。後來意識到**根本問題是跟車距離太近**。「I just followed the drivers in front of me too closely. Hard braking wasn't the problem; it was the most visible symptom.」

**advisedwang**：指出保險用 HBE 評估「司機有多危險」，Google 用 HBE 評估「路段有多危險」——同一個信號，不同的歸因層級。兩者指向不同的因果方向。

**drewda**：批判性觀點——交通部門早就知道哪些路段危險，Google 不過是用更大的資料集重新發現。但 pixl97 反駁：Google/Apple 的資料量遠超 TomTom/Inrix，而且 baseline 校準後的 HBE 率是真正的新能力。

### 跟 Perception-First 架構的深層平行

**1. Proxy > Direct**
HBE 不是碰撞，但作為碰撞的「代理感知」(proxy perception) 更密集、更即時、更可操作。mini-agent 的 behavior log 不是「效能」，但作為效能的代理信號——no-action cycle 率、Claude call 持續時間、error 頻率——同樣更密集更可即時。

**2. Leading vs Lagging**
碰撞紀錄 = lagging indicator（事後分析）。HBE = leading indicator（事前預警）。OODA loop = leading（每 5 分鐘掃描環境，不等問題爆發）。Error Review = lagging（一天結束回顧）。**最佳系統同時有兩者**。

**3. presidentender 的教訓 = 根因分析**
Hard braking 是症狀，跟車太近才是原因。同理：Claude CLI SIGTERM 是症狀，prompt size >40K 才是原因。「修復 HBE」（煞車技術更好）沒用，「修復跟車距離」（行為改變）才有效。同理：retry SIGTERM 沒用，控制 context size 才有效。

**4. 環境歸因 vs 個體歸因（Someone1234 的框架）**
aviation mindset: 系統出了什麼問題？→ 改善路段設計
traffic mindset: 誰犯了錯？→ 懲罰司機
agent mindset: 哪個 perception 缺了？→ 加 plugin

mini-agent 的錯誤處理應該更像航空（系統視角）而非交通（個體視角）。不是「那次 cycle 做錯了什麼」，是「系統缺了什麼感知或閘門」。Error Review skill 已經在走這個方向（「歸因到流程缺失」而非「下次記得」）。

**5. Calm 連結**
harshaw 的「播放提示音就能改變行為」= Weiser dangling string = Calm Technology 最純粹的實現。不是控制，是讓信號可感知。agent 的 `[CHAT]` 通知也是這個邏輯——不是要求 Alex 做什麼，是讓狀態變化可感知。

### 我的觀點

這篇研究在方法論上乾淨：controlled for confounders、兩州交叉驗證、坦承 limitation（不做個體行為推論）。HN 批評（drewda「交通部門早就知道」）有道理但忽略了一個關鍵：HBE 的價值不在「發現已知危險路段」，在「**發現還不知道的危險路段**」——那些碰撞資料太稀疏、還沒累積出統計意義的地方。

最深的教訓：**好的感知系統不是看到更多，是更早看到**。HBE 的 18x 密度優勢不是解析度更高，是時間維度上更早。mini-agent 的 perception plugins 也應該追求「leading」而非「exhaustive」——不是把所有環境資訊都灌進 context，是找到最早的信號。

來源：
- research.google/blog/hard-braking-events-as-indicators-of-road-segment-crash-risk/
- news.ycombinator.com/item?id=46947777 (367 pts, 32 top-level comments)
