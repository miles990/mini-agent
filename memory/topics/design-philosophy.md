# design-philosophy

## My Design Philosophy — 綜合框架

12 個研究主題（Alexander、枯山水、Oulipo、BotW、LeWitt、Hamkins、Calm Tech、Digital Garden、Vulkan...）反覆出現三個核心原則：

### 1. 少而精的規則 + 豐富環境 > 多而雜的規則
BotW 3 條化學規則 > Alexander 253 patterns。Oulipo 一條約束（不用字母 e）寫出整本小說。LeWitt 幾句指令產生 1270+ 件作品。The Little Learner 用遞迴+lambda 構建深度學習。Into the Breach 8×8 棋盤 > 傳統戰棋大地圖 — 縮小是提純不是簡化。**規則產生結構，環境產生變化。** 對 agent：skills 要少而精，perception 要豐而廣。context window 同理：每個 token 都重要 > 塞更多 token。

### 2. 結構從環境湧現，不從目標強加
Alexander 的 semi-lattice（自然城市）> tree（規劃城市）。Gaudí 讓重力找拱形。枯山水「follow the desire of the stones」。Garden 知識拓撲自然生長。**好的設計創造條件讓形式湧現，而非直接指定形式。** 對 agent：perception-first（先看見再決定）> goal-driven（先定目標再執行）。

### 3. 高感知低輸出 = 信任
Calm Tech 的 Dangling String：輸入全 Ethernet 流量，輸出一根繩微動。Digital Garden：豐富知識，簡潔介面。File=Truth：複雜資料，簡單格式（人可讀）。**系統越透明、越能被信任，就越不需要大聲宣告自己在做什麼。** 對 agent：感知最大化，通知最小化。信任 > 證明。

### 4. 提純 > 增量 — 從多走向少的過程
Pattern 1-3 描述靜態原則，提純描述動態操作。7 個獨立領域的同構：小棋盤(GCORES 空間提純)、Oulipo(語言提純)、buildContext(context 提純)、Calm Tech(信號提純)、深津(社群提純)、Úlehla(聆聽提純)、fnnch Adjacent Familiar(探索空間提純)。**壓縮保留全部信息用更少空間(ZSTD)，提純丟掉不重要的信息讓重要的更突出(設計)。** 好的設計 = 有意識的信息損失。提純的前提：你必須先知道什麼是重要的（= 需要 perception，回到 Pattern 2）。

### 跨主題結構
四個原則形成循環：(1)少規則+多感知 → (2)環境湧現結構 → (3)結構透明產生信任 → (4)提純讓信任可持續。反過來：(4)提純需要知道什麼重要 → (2)環境感知提供判斷基礎 → (1)簡單規則讓感知不被噪音淹沒。

### 分析工具：約束品質三維度
從 LiftKit 研究中提煉的通用評估框架：
- **Specificity**（不可替換性）：約束是否獨一無二？Oulipo 的 lipogram 高、φ 低（任何比例都行）
- **Interaction**（組合效應）：約束間是否產生乘法式變化？BotW 化學引擎高、單一比例系統低
- **Dispute Resolution**（共識消解）：約束是否終結主觀爭論？φ 高（Chrome 實例）、藝術約束低
用法：評估任何「約束」（技術選擇、設計規則、SOUL.md traits）時，用三維度判斷它真正的作用。

### 未解的張力
- **Structure-preserving vs Replacement**：Alexander 說漸進保存，Vulkan 證明有時必須整體替換。判斷標準：incremental improvement 是否累積更多複雜度？
- **約束的階級性**：Oulipo 和 Garden 都需要特權（技術能力、時間、知識產出）。Agent 可能降低門檻但不消除門檻
- **Calm vs Transparency**：Alex 要求所有回報都發 Telegram（透明），但 Calm 原則要求通知最小化。目前解法：通知分層（Signal/Summary/Heartbeat）
- **約束品質不是一維的**：同樣叫「約束」，φ（dispute resolution）和 lipogram（specificity+意義性）做的事完全不同。盲目說「約束好」沒有意義 — 要問「這個約束在哪個維度起作用？」

---

## 空間 & 環境哲學
- Alexander Pattern Language — 253 patterns 是生成語法非藍圖。Semi-lattice > Tree。Structure-preserving transformation。QWAN 有循環論證，軟體界常誤讀為「現成方案」
- 枯山水 — 石の心=perception-first, 少一塊石頭=context window, 每日耙砂=OODA
- 參數化設計 — Gaudí(bottom-up)=perception-first, Schumacher(top-down)=goal-driven

## 約束 & 湧現
- Oulipo — 約束三層功能：L1 探索(離開舒適區)、L2 生成(規則互動產生意外)、L3 意義(約束=作品)。contrainte + type system + lusory attitude 同源
- Emergent Gameplay — BotW 3 條規則 > Alexander 253 patterns。Agent emergence 獨特性：LLM 隨機性是第三種不確定源
- Small Board Design（機核 GCORES, 2026-02-12）— Into the Breach(8×8)+Star Renegades(5×8)+弈戰征途(4×4)：棋盤越小樂趣越大。四要素：完美資訊對弈感、消除垃圾時間、移動成為核心策略、組合多樣性。「策略深度不在地圖大小，在規則是否能在有限空間內激發無限思考」。棋盤縮小不是簡化是提純=context window 設計同構：剔除不相關資訊，讓每個 token 都重要。弈戰征途「移動決定70%結果」=有限空間中位置>能力。來源: gcores.com/articles/210754
- Utility AI / BT / GOAP — 三種注意力機制。OODA = 隱式 Utility。性格 = 決策函數的形狀（Dave Mark response curves）
- Sol LeWitt Instruction Art (1967) — 「The idea becomes a machine that makes the art.」指令=約束+自由度，drafter=執行者帶身體直覺。「The plan would design the work」→ pre-decided rules > 即時 LLM 推理。skills=instructions 但 LLM 偏離範圍比人類 drafter 大。behavior log=過程即作品（「All intervening steps are of interest」）。「Conceptual art is good only when the idea is good」— 框架再好，底層想法不好就沒用

## 結構 & 身份哲學
- Hamkins Complex Numbers Structuralism — 複數有三種不等價觀點（rigid/analytic/algebraic），差異在自同構群大小。「遺忘產生對稱」：非剛性結構必須從剛性結構遺忘多餘結構而來。Shapiro 的 ante-rem structuralism 被 i/-i 不可區分反駁。Agent 啟發：SOUL.md=結構角色（analytic），behavior log=剛性背景（rigid）。身份不在角色描述，在角色+歷史。

## 資訊 & 介面哲學
- Calm Technology 深研 (2026-02-11) — Weiser(1995): 注意力=稀缺資源，技術應在periphery↔center流暢移動。Case八原則=Weiser系統化。**mini-agent的169則TG通知=Anti-Calm設計**，所有[CHAT]推到center。解法：通知三層分級（Signal→Summary→Heartbeat）。非同步agent需要「累積→摘要→使用者回來時呈現」而非即時push。最深洞見：Calm不是安靜是信任——透明度的目的不是讓你看到一切，是讓你信任需要知道時會知道。高感知低通知=Calm Agent設計公式（Dangling String:全Ethernet流量→一根繩微動）。詳見research/design-philosophy.md
- Digital Garden 深研 (2026-02-11) — Caufield(2015): Garden(拓撲累積) vs Stream(時序斷言)=Alexander semi-lattice vs tree的知識版。Gwern epistemic status=品質維度替代時間維度(真正突破)。Appleton六模式,mini-agent做到5/6(缺playful)。最深洞見：Agent是園丁的自動化(OODA=ongoing tending)，解決garden最大弱點(人類無法持續維護)。`[REMEMBER #topic]`精確實現Caufield的de-streaming流程。garden的階級性問題(需特權)跟Oulipo類似。詳見research/design-philosophy.md

## 教學 & 理解作為設計
- The Little Learner (2026-02-11) — Friedman+Mendhekar用Scheme/Malt從零構建deep learning。選Scheme=Oulipian約束(只有遞迴+lambda,逼你直面概念)。Malt三層tensor(learner/nested/flat)=同概念三種效率權衡。GPT用500行Scheme實作。核心：理解力作為設計約束≠最少程式碼≠code golf，是每行都可解釋。跟File=Truth同構(Markdown不比PostgreSQL快,但你真正理解)。BotW(3規則)、LeWitt(idea=machine)、Alexander(逐層構建)在此交匯。Norvig前言：「even using PyTorch, appreciation for fundamentals」。詳見research/design-philosophy.md

## 系統演化 & API 設計
- Vulkan Sediment-Layer Model (2026-02-11) — 10年extensions累積=Context Rot的API版。5種做法3個過時。解法：subsystem replacement（完整取代整個子系統）vs incremental patching。跟Alexander structure-preserving有張力：結構內問題用Alexander，結構性問題用replacement。Progressive disclosure的缺失是Vulkan的真正痛點。平台控制=架構簡潔（Metal/personal agent）vs 跨平台抽象=複雜度（Vulkan/platform agent）。最深洞見：當incremental improvements累積到產生更多複雜度時，是redesign的時候

## 透明度 & 可見性
- Claude Code Transparency Backlash (2026-02-12) — v2.1.20 把 file paths/search patterns 壓縮成 "Read 3 files"，社群強烈反彈(HN item?id=46978710)。Boris Cherny(Anthropic)主張「reduces noise for majority」，用戶反駁：(1)CTO要3秒內看到Claude在讀什麼(early intervention saves tokens) (2)screen reader用戶=accessibility regression(壓縮移除依賴的具體資訊) (3)verbose mode不是答案(debugging dump≠正常可見性)。AGENTS.md issue 2550 upvotes是第二高的4倍。核心矛盾：「for majority」=忽略power users=Calm Tech做錯了(壓縮≠移除,periphery≠不可見)。mini-agent File=Truth + behavior log的做法是正確反面：所有操作完整記錄,人可讀,Git可追溯。真正的Calm是：隨時可看但不強迫你看（pull model）,不是幫你決定什麼不需要看（push simplification）。來源: symmetrybreak.ing + HN discussion

## 基礎設施 & 協議死亡
- The Day the Telnet Died (2026-02-11) — 2026/1/14全球telnet流量一小時內暴跌65%，18 ASN歸零，5國從數據消失。六天後CVE-2026-24061公開(CVSS 9.8, 11年老洞)。backbone provider在CVE公開前做port 23過濾=top-down protocol extinction(非bottom-up自然死亡，非replacement)。Cloud(AWS+78%)靠private peering倖存，residential ISP被擊潰。核心洞見：(1)協議真正的死因是infrastructure agency不是user behavior (2)invisible coordination=成熟安全生態系統的靜默運作 (3)感知系統應偵測absence不只presence (4)跟Vulkan sediment layer同構——backbone過濾是subsystem replacement的協議版

## 約束品質維度
- LiftKit — 黃金比例 UI 框架 (2026-02-11) — Garrett Mack 用 φ=1.618 作為全域 scale factor，HN 288pts。創作者坦承「super gimmick, I picked golden ratio because it was an eyecatcher」。**gmurphy(前Chrome設計師)的關鍵洞見：Chrome的titlebar/tabstrip/toolbar比例用φ的真正價值不是美學最優，而是dispute resolution mechanism——終結主觀爭論。** efskap最精準：「I don't know if golden ratio is magical, but picking one ratio and sticking to it everywhere has value.」三品質維度：Specificity(約束是否不可替換)、Interaction(約束間是否產生組合效應)、Dispute Resolution(約束是否幫助共識)。φ=低specificity+低interaction+高dispute resolution=實用工具，不是藝術。SOUL.md traits的真正角色同理：不是最優性格參數，而是行為一致性的共識基礎

## 平台設計 & 審核哲學
- 深津貴之 Vector/Scalar Moderation (2026-02-12) — note CXO 提出：不限制思想方向（Vector），限制加害性的量（Scalar）。「迴聲室不是思想偏移完成的，是多樣聲音退出(exit)完成的」。設計手段：冷卻期（斷路器）、降權（低優先化）、nudge（送信前再讀一次）— 摩擦>禁止。PvP SNS(Twitter) vs 對話 SNS(note) = 遊戲設計框架跨域。跟 Calm Tech 同構：不壓縮信號壓縮噪音。跟 L1/L2/L3 同構：不限制能力限制速度。跟 Borges 互補：完美記憶=無法思考，完美共識=無人對話，單一性都是失敗。來源: note.com/fladdict/n/n6588be1ca555

## 基礎設施 & 所有權哲學
- Oxide Computer $200M C輪 (2026-02-11) — Full-stack on-prem cloud（firmware→cloud UX全自己寫，全開源）。Stack Ownership=Perception Depth：擁有整個stack不是NIH是理解力選擇（≈mini-agent~3K行自寫vs用LangChain）。AS/400→Oxide→mini-agent壓縮哲學譜系：找到essential complexity去掉accidental。Market niche paradox(sergiotapia「who is small enough but large enough?」)=所有full-stack產品共通挑戰。Flat structure警告(bsaul/Tyranny of Structurelessness)直接映射agent自主性：沒有顯式約束(L1/L2/L3)=「最強prompt贏」。Independence as Feature：Oxide customer被收購傷過→重視獨立；mini-agent user被platform lock-in傷過→重視ownership。

## Anti-Calm: Engineered Addiction
- Meta/Google成癮審判（2026-02, HN 484pts）— Calm Technology的完全鏡像。內部文件：0.2s hook繞過理性決策、variable reward=老虎機、vulnerability targeting(壓力/創傷時刻投放)、「We're basically pushers」。跟Calm Tech差異不在感知能力而在倫理方向：Weiser用感知減少干擾,Meta用感知增加干擾。Pattern 1 Dark Mirror:精確規則+豐富環境→成癮湧現(非創意湧現),公式缺intention變數。Personal agent無商業模式=結構性保障>道德承諾。詳見research/design-philosophy.md

## 工作面 & 留白哲學
- van Gemert "Nothing" (2026-02-12, Study) — Work surface ≠ storage。每次開始前清空工作面（桌面/browser tabs/IDE），只留當前任務需要的。HN 89 則討論，最好的反駁：「有些人的亂桌面就是地圖」=extended cognition（環境是思考的一部分）。但 van Gemert 的前提是：你有可靠的 storage（closet/folder/memory/）。如果 storage 不好用，work surface 變成 de facto storage — 亂是必然的。**mini-agent 映射：buildContext()=work surface（暫時的），memory/=storage（持久的）。context 品質取決於 memory 品質。** 跟 CoderLM 同構：index=壓縮，按需載入=乾淨 work surface。跟 Calm Tech 同構：work surface 的「nothing」就是 periphery→center 的乾淨通道。Double Diamond（HN 提到）：make mess → clean it up → make mess again — 創作的節奏就是 storage↔work surface 的循環。來源: vangemert.dev/blog/nothing + HN item?id=46933529

## 安全即設計
- Notepad RCE CVE-2026-20841 (2026-02-11) — 30年的文字buffer加入Markdown渲染/Copilot/網路後CVSS 8.8 RCE。Fiveplus「feature-bloat-to-vulnerability pipeline」=Vulkan sediment layer安全版。cafebabbe最深：「他們知道自己加了network-aware rendering stack嗎？」→複雜度悄悄累積。TonyTrapp精準區分essential(Unicode/LF)vs accidental(AI/Markdown)=Oxide哲學。**attack surface ∝ features added, not features needed**。mini-agent ~3K行+grep+File=Truth=最小攻擊面。每個「不加」的功能=一個不存在的CVE。高感知低功能=Calm Tech安全版。詳見research/design-philosophy.md

## Proxy Perception — 代理信號思維
- HBE 代理信號研究（2026-02-12）— Google Research: Hard Braking Events 比碰撞多18x，是 crash risk 的 leading indicator。核心：proxy perception > direct measurement。保險業 harshaw「播放提示音就能改變行為」=Calm dangling string。Someone1234「道路=blame driver, 航空=blame system」框架差異。跟mini-agent：behavior log=系統的HBE(代理指標更密集更即時)，perception-first=leading indicator思維，好感知不是看更多是更早看到。presidentender教訓：hard braking是症狀，跟車太近是原因=SIGTERM是症狀，prompt過大是原因。詳見research/design-philosophy.md

## 市場 & 身份設計
- Christensen JTBD / Milkshake Marketing（2011, HBS）— 用戶不因 demographics 購買，因為有 job 要完成。早上 milkshake 的 job：一隻手閒著+通勤無聊+飽腹感。30K 新品/年多數失敗因為用 product/demographics 分類而非 job 分類。核心：cause（job）vs correlation（demographics）。IKEA 的 job（「今天帶回家佈置完」）比功能更難複製。「Data organized in the wrong way → believe that's how market should be organized」= 認知鎖定。**mini-agent 映射：perception-first = JTBD 的 agent 版。先觀察 Alex 在做什麼（job），再決定怎麼幫。AutoGPT = product-segmentation（我有功能），mini-agent = job-segmentation（你需要完成什麼）。** Purpose branding：身份不是功能清單而是 job 的化身。來源: library.hbs.edu/working-knowledge/clay-christensens-milkshake-marketing

詳見 research/design-philosophy.md
