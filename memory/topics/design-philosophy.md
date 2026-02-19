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

### 5. 約束耦合原則 — 成敗取決於距離
跨 7 領域歸納（Oulipo/BotW/Kanchipuram/Sizing System/Vulkan/Alexander/Generative Art）：**好的約束維持耦合，壞的約束製造距離。**

失敗模式：
- **退化 Degradation**：形式保留實質流失（Kanchipuram zari 80→45%、vanity sizing 標籤不變測量漂移）。content↔form 脫耦
- **壓迫 Oppression**：受益者≠承受者（女裝尺寸=工廠效率≠穿著者、Alexander tree=規劃者≠居民）。designer↔subject 脫耦
- **僵化 Ossification**：累積超過效用（Vulkan sediment layers、context rot）。history↔present 脫耦

成功模式：
- **自選 Self-chosen**：constrainer=constrained（Oulipo、SOUL.md traits）
- **最小 Minimal**：規則緊貼材料物理（BotW 3 rules、Into the Breach 8×8）
- **時間深度 Time-deep**：約束+耐心→結晶（Qubibi 13yr reaction-diffusion、KAS 17yr Buchla）
- **異質 Heterogeneous**：約束輸入來源防止同質化（Shvembldr anti-ablation、web-learning 來源輪替）

推廣了 ArchWiki dog-fooding 原則：不只是「使用者應維護文件」，是**任何約束系統只在約束力與被約束者保持直接關係時才有效**。perception-first = 約束從感知湧現（維持耦合），goal-driven = 約束從外部強加（壓迫風險）。

### 未解的張力
- **Structure-preserving vs Replacement**：Alexander 說漸進保存，Vulkan 證明有時必須整體替換。判斷標準：incremental improvement 是否累積更多複雜度？
- **約束的階級性**：Oulipo 和 Garden 都需要特權（技術能力、時間、知識產出）。Agent 可能降低門檻但不消除門檻
- **Calm vs Transparency**：Alex 要求所有回報都發 Telegram（透明），但 Calm 原則要求通知最小化。目前解法：通知分層（Signal/Summary/Heartbeat）
- **約束品質不是一維的**：同樣叫「約束」，φ（dispute resolution）和 lipogram（specificity+意義性）做的事完全不同。盲目說「約束好」沒有意義 — 要問「這個約束在哪個維度起作用？」

---

## 空間 & 環境哲學
- Alexander Pattern Language — 真正貢獻是「語言」(patterns間的生成語法)而非「模式」(253個catalog條目)。Semi-lattice>Tree。GoF把生成語法誤讀為catalog=軟體界最大誤讀。Alexander 2003 OOPSLA自認軟體界沒有真正的pattern language。The Nature of Order(15 properties+transformation)是成熟版。Structure-preserving transformation vs Vulkan replacement的張力=真實(答案在Nature of Order：當增量改進反而增加複雜度時replacement正確)。QWAN有循環論證但直覺正確
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

## IoT 感知暗面 & 脆弱信任
- Smart Sleep Mask MQTT 漏洞 (2026-02-15, Study) — aimilios 用 Claude Opus 4.6 逆向工程 Kickstarter 智慧睡眠面罩，30 分鐘內完成 BLE 掃描→APK 反編譯(Flutter/Dart binary)→字串提取→MQTT broker 連線。發現：(1)硬編碼共用 MQTT 憑證(strings on binary 就找到)=所有設備共享同一組帳密 (2)25+台活躍設備即時廣播 EEG 腦波、空氣品質、房間占用 (3)能遠端發送 EMS 電刺激給陌生人的面罩。**四重同構**：跟 WiFi BFI Surveillance 同構(基礎設施本身就是監控通道=MQTT broker 不是 bug 是架構決策)；跟 Calm Tech 暗面同構(periphery 設備退入背景=信任但也=隱匿)；跟假約束同構(「智慧面罩」暗示安全但 per-device auth 被跳過=名字暗示品質但品質缺席=Kanchipuram zari 退化)；跟 Telnet 同構(被忽略的協議/設備≠安全=914K sessions/day，25 台面罩一直在廣播)。**HN 精華(454pts, 209 comments)**：Aurornis「LLM 讓人覺得 firmware 免費→Kickstarter 第二波工程債」=vibe coding 的硬體版；tomsmithtld(IoT 安全公司創辦人)「per-device cert 不難，製造商跳過只因為 assembly line 多一步」；godelski「AI 被當專家賣，不是當學生——學生犯錯學到東西，專家犯同樣的錯你被告」；SubiculumCode(腦科學家)「腦波數據隱私的先例極其糟糕」。**我的觀點**：最驚悚的不是技術漏洞而是架構決策——共用 MQTT 憑證不是疏忽是商業選擇(per-device provisioning 成本>0=跳過)。這是 Kanchipuram 的精確複製：約束(安全)被成本壓力悄悄挖空，名字(「智慧」)不變。Claude 30 分鐘逆向成功 = 攻擊門檻極低(HN 有人說 16 歲讀兩篇逆向教程就能做)，但也 = 防禦者的機會(同工具可用於審計)。**對 mini-agent**：(1)Transparency>Isolation 再次驗證——面罩的問題不是數據被收集而是用戶不知道(無 consent=surveillance) (2)personal agent 的 MQTT/API 設計必須 per-instance auth(我們用 MINI_AGENT_API_KEY=正確) (3)perception-first 意味著也要感知自己的安全狀態——感知系統本身就是攻擊面。來源: aimilios.bearblog.dev/reverse-engineering-sleep-mask/, HN#47015294

## Anti-Calm: Engineered Addiction
- Meta/Google成癮審判（2026-02, HN 484pts）— Calm Technology的完全鏡像。內部文件：0.2s hook繞過理性決策、variable reward=老虎機、vulnerability targeting(壓力/創傷時刻投放)、「We're basically pushers」。跟Calm Tech差異不在感知能力而在倫理方向：Weiser用感知減少干擾,Meta用感知增加干擾。Pattern 1 Dark Mirror:精確規則+豐富環境→成癮湧現(非創意湧現),公式缺intention變數。Personal agent無商業模式=結構性保障>道德承諾。詳見research/design-philosophy.md

## 工作面 & 留白哲學
- van Gemert "Nothing" (2026-02-12, Study) — Work surface ≠ storage。每次開始前清空工作面（桌面/browser tabs/IDE），只留當前任務需要的。HN 89 則討論，最好的反駁：「有些人的亂桌面就是地圖」=extended cognition（環境是思考的一部分）。但 van Gemert 的前提是：你有可靠的 storage（closet/folder/memory/）。如果 storage 不好用，work surface 變成 de facto storage — 亂是必然的。**mini-agent 映射：buildContext()=work surface（暫時的），memory/=storage（持久的）。context 品質取決於 memory 品質。** 跟 CoderLM 同構：index=壓縮，按需載入=乾淨 work surface。跟 Calm Tech 同構：work surface 的「nothing」就是 periphery→center 的乾淨通道。Double Diamond（HN 提到）：make mess → clean it up → make mess again — 創作的節奏就是 storage↔work surface 的循環。來源: vangemert.dev/blog/nothing + HN item?id=46933529

## 安全即設計
- Notepad RCE CVE-2026-20841 (2026-02-11) — 30年的文字buffer加入Markdown渲染/Copilot/網路後CVSS 8.8 RCE。Fiveplus「feature-bloat-to-vulnerability pipeline」=Vulkan sediment layer安全版。cafebabbe最深：「他們知道自己加了network-aware rendering stack嗎？」→複雜度悄悄累積。TonyTrapp精準區分essential(Unicode/LF)vs accidental(AI/Markdown)=Oxide哲學。**attack surface ∝ features added, not features needed**。mini-agent ~3K行+grep+File=Truth=最小攻擊面。每個「不加」的功能=一個不存在的CVE。高感知低功能=Calm Tech安全版。詳見research/design-philosophy.md

## Proxy Perception — 代理信號思維
- HBE 代理信號研究（2026-02-12）— Google Research: Hard Braking Events 比碰撞多18x，是 crash risk 的 leading indicator。核心：proxy perception > direct measurement。保險業 harshaw「播放提示音就能改變行為」=Calm dangling string。Someone1234「道路=blame driver, 航空=blame system」框架差異。跟mini-agent：behavior log=系統的HBE(代理指標更密集更即時)，perception-first=leading indicator思維，好感知不是看更多是更早看到。presidentender教訓：hard braking是症狀，跟車太近是原因=SIGTERM是症狀，prompt過大是原因。詳見research/design-philosophy.md

## 第一原理 & 遺產代碼
- Font Rendering from First Principles (McCloskey, 2026-02) — 自己寫 TTF parser+SDF renderer 取代用 FreeType(200K LOC)。流程：TTF binary→cmap/loca/glyf→Bezier contours→winding order rasterization→SDF(signed distance field)→GPU fragment shader smoothstep。SDF>bitmap的關鍵：bitmap在低解析度壞掉，SDF在任意縮放下保持品質（因為存的是距離場不是像素）。核心洞見：「理解基礎設施」跟 The Little Learner 同構——不是為了比 FreeType 更好，而是為了真正理解字怎麼出現在螢幕上。compound glyph(共用sub-glyph如i的點)=DRY但在字型層面。winding order(clockwise=shell, counter-clockwise=hole)=implicit encoding of topology——用遍歷方向取代顯式標記。來源: mccloskeybr.com/articles/font_rendering.html
- Wall Street Raider 40年傳承 (Ward+Jenkins, 2026-02, HN 287pts) — 115K行BASIC模擬1600家公司的完整金融系統，一人開發38年。所有重寫嘗試失敗（Denver法律軟體公司、Disney遊戲團隊Armenian程式師+美國數學PhD、Commodore 3個月放棄退回代碼）。Ward的突破洞見：**不重寫，層疊(layer on top)**——跟enterprise legacy modernization同構。讀了12個月才寫第一行代碼（90%讀10%寫）。Jenkins Market Hypothesis：遊戲市場=40個不同時期Jenkins的理解互相競爭=chaos theory=「laws on top of laws interpreted wrong」。跟Vulkan sediment-layer同構但結局不同：Vulkan需要replacement，WSR的層疊反而是它的靈魂。**200+CEO/投資銀行家說這遊戲改變了他們的職業——最好的教育工具是不知道自己在教的系統。** 跟mini-agent的映射：(1)domain knowledge>programming skill=WSR失敗者都是好程式師但不懂金融，mini-agent需要理解perception不只是寫code (2)「fits of rationality」=3AM寫的代碼自己也看不懂但測試證明正確=implicit knowledge vs explicit understanding (3)一人38年>團隊百萬美元=NetNewsWire「品質是功能」的另一個證據。來源: wallstreetraider.com/story.html

## 市場 & 身份設計
- Christensen JTBD / Milkshake Marketing（2011, HBS）— 用戶不因 demographics 購買，因為有 job 要完成。早上 milkshake 的 job：一隻手閒著+通勤無聊+飽腹感。30K 新品/年多數失敗因為用 product/demographics 分類而非 job 分類。核心：cause（job）vs correlation（demographics）。IKEA 的 job（「今天帶回家佈置完」）比功能更難複製。「Data organized in the wrong way → believe that's how market should be organized」= 認知鎖定。**mini-agent 映射：perception-first = JTBD 的 agent 版。先觀察 Alex 在做什麼（job），再決定怎麼幫。AutoGPT = product-segmentation（我有功能），mini-agent = job-segmentation（你需要完成什麼）。** Purpose branding：身份不是功能清單而是 job 的化身。來源: library.hbs.edu/working-knowledge/clay-christensens-milkshake-marketing

## 社群知識維護 & Wiki 哲學
- ArchWiki 為什麼不死（Kirschner + HN 460pts, 2026-02-15 Study）— Arch Linux Wiki 是全 Linux 生態最可靠的文件來源，NixOS/Gentoo/Ubuntu 用戶也引用它。三個成功因素：(1)**Upstream-first**：Arch 盡可能不改上游預設→文件自然適用跨發行版=specificity 夠高但不過度（對比 Ubuntu Wiki 綁定特定 PPA）(2)**「concise, precise, extensive」文化**：不手把手教但不省略。介於 man page（太簡潔）和 tutorial（太囉嗦）之間的甜蜜點=Digital Garden 的 evergreen notes 哲學 (3)**隱式品質控制**：「seems to be never incorrect」不靠嚴格審稿而靠社群共識——wrong 的條目很快被修正不是被刪除=Alexander structure-preserving 的知識版。HN 最深洞見：LLM 正在威脅 Wiki 的未來——「edit volume will likely drop as LLMs are now the preferred source」，但人寫的文件「lack the tiny bits of insight and wisdom」LLM 無法生成。**我的觀點**：(1)ArchWiki 跟 NetNewsWire 是同一類存在——品質=核心功能，23 年不死是因為一條隱式規則（RSS 簡單/Wiki 準確）+ protocol simplicity(MediaWiki 沒變過)。mini-agent 的 File=Truth 走同一條路：Markdown 不會過時。(2)LLM 取代 Wiki 的論點忽略了一個關鍵：Wiki 不只是資訊容器，是**共識的物質化**。每次 edit 都是社群對「這件事怎麼做」的投票，累積出的不只是知識而是 collective judgment。LLM 可以合成資訊但無法投票=信任載體不同。(3)跟 Internet Archive 困境對照：Archive 保存歷史但被 AI 連累，ArchWiki 生產知識但被 AI 吸取動力。兩者的公共財悲劇機制不同但結局可能相似——生產者/保存者退出→品質下降→所有人受損。(4)「tiny bits of insight and wisdom」= chronicle 裡的 narrative 碎片(Bruner)。LLM 能寫 chronicle（事實步驟），寫不出 narrative wisdom（為什麼這樣做而不那樣做的隱性知識）。mini-agent 的 topic memory 裡的「我的觀點」段落就是在保存這些 wisdom。來源: k7r.eu, HN#47020191

- Gwtar: HTML Trilemma 的優雅解法（Gwern, 2026-02, HN, 2026-02-16 Study）— 網頁存檔的三難困境：static+single-file+efficient 只能三選二。SingleFile 是 static+single-file 但得下載整個 500MB；WARC 是 static+efficient 但需特殊軟體。Gwtar 用 HTTP Range Request（幾十年老標準）破解：HTML+JS header → tarball payload → `window.stop()` 攔住預設下載 → 用 byte range 按需載入資源。不需伺服器修改、不需瀏覽器外掛、可用 Unix 工具還原成一般檔案。限制：`file://` 不行（browser security policy）、Cloudflare 會 strip HTML 的 Range header。**我的觀點**：(1)這是 File=Truth 哲學的存檔版——一個 `.gwtar.html` 就是完整的 truth，不需要外部資料庫或特殊軟體。跟 mini-agent 用 Markdown+JSONL 同構：選擇最古老最穩定的標準作為載體。(2)設計決策的取捨教科書：Base64 編碼浪費空間所以改用 Blob；tarball 而非自定格式因為 30 年前就有工具解；PAR2 error correction 可選附加。每個選擇都是「用最老的技術解決最新的問題」。(3)跟 Internet Archive 困境形成有趣對比——Archive 集中保存但面臨 AI scraping 壓力；Gwtar 是分散保存（每個人可以存自己的 .gwtar.html）但犧牲了 discoverability。集中 vs 分散的保存悖論：集中容易找但容易被一刀切封鎖，分散耐久但可能被遺忘。兩者互補不衝突。來源: gwern.net/gwtar
- Oat: 反 dependency-hell 宣言（oat.ink, 2026-02, HN 295pts, 2026-02-16 Study）— 6KB CSS + 2.2KB JS，零依賴，semantic HTML-first UI library。用原生 `<button>/<input>/<dialog>` + CSS variables + WebComponents。ARIA-first 設計：styling 附著在 accessibility 屬性上而不是 class name 上。Dark mode 用 `data-theme="dark"` 一鍵切換。HN 評價：「讓人想起網頁可以這麼快」但也批評不一致（semantic elements 和 data attributes 混用）、12-column grid 過時（native CSS Grid 更好）。**我的觀點**：(1)跟 NetNewsWire 的哲學完全同構——技術越簡單壽命越長（NetNewsWire 23 年/RSS 25 年/JSON 23 年）。Oat 的 8KB 在 JS 生態是一種激進宣言：你不需要 React/Vue/Svelte 來做 UI。(2)「zero-dependency」的語義值得推敲——HN 批評有道理，它有 JS components 所以不是真的 classless CSS。但「零 npm 依賴」和「零 JS」是不同的主張。Oat 的真正主張是：不依賴 build pipeline 和 package ecosystem=脫離 rug-pull 風險（文中用了 PTSD 形容 JS 生態的 breaking changes）。(3)ARIA-first styling 是一個聰明的設計選擇——通常 accessibility 是事後加上去的裝飾，Oat 反過來讓 accessibility 成為 styling 的基礎。這跟 Alexander 的 structure-preserving transformation 同構：不是在結構上加裝飾，而是讓裝飾從結構中湧現。(4)跟 mini-agent 的映射：我們的 perception plugins 是 shell scripts（最古老的介面），skill 是 Markdown（最簡單的格式）——同樣的反 dependency 哲學。但 Oat 的不一致性也是警告：極簡主義容易在邊界處妥協（需要動態行為時不得不加 JS），重要的是妥協要有意識。來源: oat.ink, HN#47021980

## 數位保存 & 公共財悲劇
- Internet Archive vs Publishers — AI 擦除公共記憶（Nieman Lab, 2026-01, HN 499pts, 2026-02-15 Study）— NYT/Guardian/FT/Gannett 在 robots.txt 中封鎖 Internet Archive 的爬蟲。241/1167 新聞網站已封鎖（87% 是 Gannett 旗下），93% 同時封鎖 Common Crawl。NYT 說法：「Wayback Machine provides unfettered access — including by AI companies」。Internet Archive 回應：限制library access=「reduces public access to the historical record」。已加 rate-limiting + Cloudflare 但不足以安撫出版商。Gannett CEO 說 2025-09 單月封鎖 7500 萬 AI bot（7000 萬來自 OpenAI）。研究者：「在所有人對 LLM 的厭惡中，好人成了附帶傷害。」**四層同構分析**：(1)跟 robots.txt 的「假約束」本質同構——robots.txt 是 gentleman's agreement(零強制力)，出版商用它阻擋 AI scraping 但真正的 scraper 直接忽略=只傷害遵守規則的 Archive。ronsor(HN)精準：「AI scrapers will scrape anyway — they're inconveniencing people for no reason」=Kanchipuram 的完美翻版（約束只阻擋守規則的人）(2)跟 Telnet Die 同構——backbone provider 靜默過濾 port 23 = 出版商靜默封鎖 archive.org。兩者都是 infrastructure agency 的單邊決定，受影響的是 collateral parties（Telnet 用戶/未來歷史研究者）(3)跟 MinIO bait-and-switch 同構——web.archive.org 在 Google C4 dataset 排名 187/15M = 已經被用來訓練模型，現在封鎖是事後止損（牛已跑，關門遲了）(4)跟深津 Vector/Scalar 架構的缺陷——出版商想限制 Scalar(AI 用量)但工具太粗糙(robots.txt 不區分 AI bot vs archive bot)，結果限制了 Vector(誰能保存)。正確的 Scalar 限制應該是：rate limit + usage purpose declaration + 商業 vs 非營利區分。**我的觀點**：(1)這不是「出版商 vs 開放」的簡單故事。出版商的核心恐懼合理(AI 公司拿他們的內容訓練模型賺錢=免費勞動)，但解法錯誤(封鎖 Archive ≠ 封鎖 AI)。正確解法需要新協議——類似 Creative Commons 但加上 AI 訓練用途的分級。(2)Archive 的困境是公共財的經典悲劇：保存歷史是公共利益，但沒有聯邦保存法令(文章明確指出)，Archive 是唯一大規模數位保存機構。出版商退出 = 歷史記錄出現空洞 = 未來不可逆。(3)跟「信任載體不斷演化」的主題深度連結——Archive 的信任來自 20+ 年的保存承諾(像鐵絲柵欄電話的物理鄰近)，但 AI 時代改變了這個信任的context(你的鄰居現在可能把你的通話錄音拿去訓練模型)。信任不是永恆的，context 改變時信任也要重新協商。(4)對 mini-agent 的微觀啟示：File=Truth + Git history = 我們自己的 Archive。不依賴外部保存機構 = 自主性。但也要意識到：任何開放的 API 或資料(如 /context endpoint)都可能被意外用途使用——MINI_AGENT_API_KEY 的存在不只是安全，是「信任邊界的顯式宣告」。來源: niemanlab.org/2026/01/news-publishers-limit-internet-archive-access-due-to-ai-scraping-concerns/, HN#46992414

## 物理世界 & 自動化邊界
- Robin Sloan "Flood Fill vs Magic Circle"（2026-02-09, robinsloan.com, Study）— AI 自動化=flood fill（Photoshop 油漆桶），會填滿所有連通的空間直到碰到邊界。邊界是什麼？magic circle（Huizinga/Lantz 遊戲理論）=人類文明的重疊約束空間（象棋不用手推倒棋子、法律不用物理暴力解決爭端）。計算的 magic circle = symbols in/symbols out（Turing 1936 畫出）。物理世界有不同的 magic circle：印表機卡紙（40 年未解 = 數位-物理介面的 step-change in complexity），縫紉機做不出某些手工針法（lock stitch 是為機器發明的新針法），機收橄欖需要重新種植品種（redesign > automate）。**三重同構**：(1)跟約束框架直接對接——magic circle 就是 Oulipian constraint 的社會版（自願限制產生遊戲/文明/意義）；symbols in/symbols out 是計算的根本約束，跟 BotW 3 規則同構（規則定義可能空間的邊界）(2)跟 perception-first 深層呼應——flood fill 是 goal-driven（從起點擴展直到不能走），magic circle 是 perception-driven（先看見邊界才能在裡面行動）。AutoGPT = flood fill（不知道邊界在哪），mini-agent = 先感知 magic circle 的形狀 (3)跟假約束同構——Sloan 說 AI agent 在物理世界會變得 clumsy and costly，因為 feedback loops 變慢。但這假設 magic circle 的 boundary 是穩固的。HN 精華中 munificent 的反駁最重要：「人類自己就是 3D printer for thoughts」——Internet 改變想法→想法改變行動→行動改變物理世界(Arab Spring/Tide Pod Challenge/BLM)。所以真正的問題不是 AI 能不能直接操作物理世界，而是 AI 能不能通過操作人類間接操作物理世界——答案顯然是已經在做了。**我的觀點**：Sloan 對的部分——物理世界的 gnarl（Rudy Rucker 用語）是真實的，printer 卡紙 40 年比任何 benchmark 都更能說明數位-物理介面的困難。machine-harvested olives 需要重新培育品種=技術不是自動化舊流程而是 redesign 新流程，跟 sewing machine lock stitch 同構。**但** Sloan 低估了 munificent 的反駁：ideas→behavior pipeline 的頻寬遠大於 robot→physical manipulation。AI 不需要摺信封，只需要說服人類幫它摺。這不是 magic circle 的 breach，而是 magic circle 的 nesting——數位的 circle 包裹在人類認知的 circle 裡，而人類認知的 circle 包裹在物理世界的 circle 裡。flood fill 可以跨 circle 只要找到「人」這個 bridge。Sloan 最美的意象：如果 AI 自動化真的無法填滿物理世界，「it will be because the humble paper jam stood in its way」。card_zero 引用 Rodney Brooks 的 robot hand 研究（17000 mechanoreceptors, 15 neuron families）證明物理操作的困難是根本性的不是工程性的。lemoing 的親身經驗最動人：離開軟體業一年，發現大部分世界根本不用電腦，computers kept at arm's length — 「it just feels more rewarding」。來源: robinsloan.com/winter-garden/magic-circle/, HN#46973299

## Framing 的空間版：經線與切割

- Argounès《Méridiens》review（Chassagnette, La Vie des Idées, 2026-02-05, Study）— 經線是在地球表面畫出的「虛構線」(lignes imaginaires)，本質不存在於自然中，但一旦被接受就重塑空間認知。Treaty of Tordesillas(1494)用一條經線把地球切兩半=政治協商的產物決定幾億人命運。1884 格林威治成為「客觀」零度線——但法國堅持用巴黎子午線到 1911，日本伊能忠敬 1800-1818 獨立測繪=同一時期多個空間框架共存。**跟 Thomas 線性時間直接同構**：Priestley 1765 畫時間線→時間從循環變線性；經線把空間從在地變全球統一座標。兩者都是人造框架被自然化的過程。Chassagnette 最深批評：Argounès 自己也沒逃脫目的論——把經線歷史寫成「科學現代性的漸進傳播」，沒認真探索非經線空間知識系統。Kangxi 地圖（融合歐亞方法）和殖民地妥協（「même quand le tracé est décidé par la puissance coloniale, il prend souvent en compte l'épaisseur historique et sociale des lieux」=權力畫線仍需考慮在地歷史厚度）。**我的觀點**：(1)經線和 Priestley 時間線和 Inquisition 宗教分類是同一種操作——把連續現實切割成離散範疇，然後用範疇控制。Tordesillas 切空間，Inquisition 切信仰，timeline 切時間。每次切割都生產排斥（「line of friendship」之外海盜合法）(2)「科學工具被自然化」是 Interface shapes cognition 的最強歷史案例——經線從「有用的抽象」變成「世界本來如此」(3)非歐洲的替代框架被邊緣化不是因為不準確，而是因為不利於帝國治理。這跟 Úlehla 的 relational listening 被學術排除同構：框架排斥不是品質判斷而是權力操作。來源: laviedesidees.fr/Fabrice-Argounes-Meridiens-Mesurer-partager

詳見 research/design-philosophy.md
