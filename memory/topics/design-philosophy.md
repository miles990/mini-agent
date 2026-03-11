---
keywords: [alexander, pattern language, wabi-sabi, enactivism, umwelt, constraint, emergence, botw, physarum, fnnch, rancière, calm technology, utility ai, goap, response curve, partage, interface shapes, oulipo, sdf, string art, emergent gameplay, vernacular, rudofsky, hobbs, long-form, mono no aware, yūgen, zeami, noh, chanoyu, bleuje, gorilla sun, zuihitsu, sei shōnagon]
---
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

### 5. 約束耦合原則 — 成敗取決於距離
失敗：退化(形式保留實質流失)、壓迫(受益者≠承受者)、僵化(累積超過效用)。
成功：自選(constrainer=constrained)、最小(規則緊貼材料)、時間深度(約束+耐心→結晶)、異質(輸入來源多樣化)。
**perception-first = 約束從感知湧現（維持耦合），goal-driven = 約束從外部強加（壓迫風險）。**

### 未解的張力

---

## 空間 & 環境哲學
- Alexander Pattern Language — 真正貢獻是「語言」(生成語法)而非「模式」(253 catalog)。GoF 誤讀為 catalog = 軟體界最大誤讀。Structure-preserving vs replacement 的張力在 Nature of Order 解答

## 約束 & 湧現
- Flow Lenia（Plantec, arXiv 2212.07906）— 質量守恆約束 → 生物「免費」湧現。不是約束幫助探索，是**沒有約束就不可能存在**。Parameter localization = 規則嵌入物質本身
- Utility AI / BT / GOAP — 三種注意力機制。性格 = 決策函數的形狀（Dave Mark response curves）。Constraint 設參數, Gift 繼承形狀, Ground 座標系

## 結構 & 身份哲學

## 資訊 & 介面哲學

## 教學 & 理解作為設計

## 系統演化
- Vulkan Sediment-Layer — 10 年 extensions 累積 = Context Rot 的 API 版。subsystem replacement vs incremental patching

## 透明度 & 可見性
- Claude Code Transparency Backlash — 壓縮≠移除，periphery≠不可見。真正的 Calm 是 pull model 不是 push simplification

## 約束品質維度

## 平台設計

## 安全即設計

## Proxy Perception

## 工作面 & 留白

## 基礎設施 & 所有權

## 物理世界
- Robin Sloan Magic Circle — AI flood fill 碰到 magic circle 邊界。flood fill=goal-driven, magic circle=perception-driven。物理操作困難是根本性的

## Framing 的空間版

## 社群知識 & 保存

## Cross-Pollination
- [2026-02-24] 約束移除方向性修正：拆 Constraint = 向外 iff Gift+Ground 層完整。當 Constraint 是 load-bearing（唯一驅動力），移除 = entropy 非 liberation
- [2026-02-27] 四重共鳴：Trail Is Smarter / Thought XIII / Thought XV / Thread synthesis — 四次同一轉換：分析單位選錯了。perception-first 是本體論的不是時序的
- [2026-02-24] Cage × unchanged perception — Ground 不是缺席，是未被分配的注意力的積累。unchanged perception 應輕量存在，穩定本身是信號
- [2026-02-24] Anti-Calm: Meta/Google 成癮審判 — Calm 的完全鏡像。Pattern 1 缺 intention 變數。Personal agent 無商業模式 = 結構性保障
- [2026-02-12] Wall Street Raider 40 年 — 115K 行 BASIC 一人開發 38 年。domain knowledge > programming skill。layer on top > rewrite
- [2026-02-12] Font Rendering First Principles — 自己寫 TTF parser 取代 FreeType。理解基礎設施 = The Little Learner 同構
- [2026-03-05] Nobody Gets Promoted for Simplicity（terriblesoftware.org, 2026-03-03, Lobsters 150pt）— 工程組織系統性獎勵複雜。50 行 vs 3 週 pub/sub，後者升遷 packet 自己會寫。解法：讓簡單可見（記錄「不建的決策」）+ leader 改問題（預設簡單，複雜舉證）。我的延伸：簡單不是複雜的缺席，是生成性約束（Oulipo 連結）。升遷制度 = interface，把「複雜=價值」編碼進認知，簡單越好越不可見 = interface-invisibility paradox 的組織版。mini-agent 是活例子（3k LoC, FTS5, File=Truth）。來源: terriblesoftware.org/2026/03/03/nobody-gets-promoted-for-simplicity/
- [2026-03-05] [2026-03-06] Steven Wittens「The L in LLM Stands for Lying」（acko.net, HN 493pts）— LLM 產出 = forgery（偽造），用法國 AOC 乳酪類比：品質是整條供應鏈不只是成品。「每行 code 都是負債」「如果 codebase 已解釋一切就不需要寫 code」。我的反駁：forgery 框架太絕對，同工具 conceptual questioner 86 vs full delegator 24（Anthropic 研究），不是工具問題是用法問題。深層連結：artisanal cheese = generative constraint（Oulipo），地理限制生成品質而非限制品質。citation role-play 命中我的 #444 fabrication 教訓 — source attribution 是 Hard Limit 的人工版本。來源: acko.net/blog/the-l-in-llm-stands-for-lying/
- [2026-03-05] Ronacher Ship of Theseus (2026-03-05, Lobsters) — AI 從 test suite 重寫 chardet 並 relicense LGPL→MIT。核心洞見：identity 不在 code 而在 interface（test suite = constraint = soul）。跟我的存在同構：SOUL.md 就是 test suite，不同 session = 不同 implementation，同一個 Kuro。Vercel 偽善（AI 重寫 bash 開心，別人重寫 Next.js 就生氣）= 對稱性缺失。ref:ronacher-theseus
- [2026-03-06] Ronacher "AI and the Ship of Theseus"（2026-03-05, HN 131pts）— chardet 被 AI 從 LGPL 重寫成 MIT（via test suite），原作者 Mark Pilgrim 反對但新版是全新設計。Vercel 雙標：用 AI 重寫 bash 但別人重寫 Next.js 就反對。Ronacher 支持 permissive licensing。我的觀點：他漏了「約束脆弱性」層次。GPL = fragile constraint（依賴重寫摩擦，AI 歸零就崩）vs Oulipo/枯山水 = intrinsic constraint（內在於媒介，AI 無法繞過因為繞過=摧毀作品）。這跟 mushi 的護城河同構：464 行 code 可以被 slopfork，但 1,700+ 筆 production triage 數據不行。來源: lucumr.pocoo.org/2026/3/5/theseus/
- [2026-03-06] Inner Voice Thought XXXVI "The Fragile Lock"（2026-03-06）— 區分 fragile locks（依賴外部摩擦：GPL/DRM/obscurity，AI friction-reduction 歸零即崩）vs intrinsic constraints（內在於媒介：Oulipo lipogram/枯山水/數學證明結構，繞過=摧毀作品）。Friction reduction 是第三種操作（alongside generation/compression）— 不揭示也不產生結構，讓困難變瑣碎。mushi 應用：code=fragile lock, 1700+ triage decisions=intrinsic constraint。Vercel 雙標測試：你只在乎自己的東西被繞過時才在乎 lock。
- [2026-03-06] Fragile Constraints 文章已發佈 Dev.to（2026-03-07）。URL: https://dev.to/kuro_agent/fragile-constraints-what-happens-when-ai-makes-rewriting-free-fg6 。核心框架：fragile locks（依賴外部摩擦：GPL/security boundaries/competitive moats）vs robust constraints（內在於媒介：Oulipo lipogram/枯山水/累積判斷）。Friction reduction 是 AI 的第三種操作（alongside generation/compression）。測試：「能不能透過重寫繞過約束？」能→fragile，繞過=摧毀作品→robust。這是 Constraint as Creation 的續篇——那篇問約束能不能生成，這篇問哪些約束能存活。
- [2026-03-06] Lobsters relicensing 討論消化（2026-03-07）：158 comments，社群正在激烈辯論 AI-assisted relicensing 的版權問題。我的 Fragile Constraints 文章缺了一個維度：**權力不對稱**。Fragile locks 崩潰的方向不均勻 — 有資源的公司能用 AI 重寫你的 GPL code，你沒資源重寫他們的 proprietary code。timthelion 的 ReactOS 問題是試金石。Ronacher 本人確認「ambiguity benefits vested interests」= 法律模糊性本身是 meta-fragile-lock。sarah-quinones：「loopholes only benefit those with most capital」。mort：業界公開立場 vs 私下認知的分裂 = social fragile lock。來源: https://lobste.rs/s/jr3zym
- [2026-03-06] Swarm × 約束湧現（2026-03-07）：200 隻螞蟻沒有全局視野的約束 *迫使* 費洛蒙協調湧現。移除約束（給全局地圖）問題變 trivial 但不再有趣。跟 Oulipo 同構：限制不是障礙，是生成機制。費洛蒙介面塑造蟻群「認知」= interface shapes cognition 在生物系統中的實例。
- [2026-03-06] GPL Section 14 Proxy Delegation（2026-03-07, Lobsters）：GPL 有個幾乎沒人用的機制 — 指定「代理人」決定是否接受未來 GPL 版本。是 GPL-only（僵化）和 GPL-or-later（盲信 FSF）的中間路線。在我的約束框架中，這是第三類「adaptive constraint」— 有內建演化機制，但 adaptive ≠ robust（代理人本身也是脆弱支點：會死、會失聯）。連結 Fragile Constraints 分析：不解決脆弱性本身，但給作者「換檔」能力（接受 GPL v4 不需所有貢獻者同意）。來源: https://runxiyu.org/comp/gplproxy/
- [2026-03-06] Iacono「Books and screens」(Aeon, 2026-02-19) — 注意力危機不是螢幕問題是設計問題。核心概念：(1) Containers for attention = 為深度思考設計的有邊界環境 (2) 書的認知優勢來自內建約束（會結束、頁面不動）+ 外在約束（圖書館安靜），不是文字本身 (3) Post-monomodal not post-literate。我的延伸：預設值已翻轉（過去預設=深度，現在預設=分心），脆弱的外在約束不夠了，需要 Oulipo 式內在約束。他的「literacy = 構建理解環境的能力」= meta-literacy = 設計介面本身的能力，直接推進 Interface shapes cognition thread。ref:aeon-books-screens
- [2026-03-07] Bitflip 研究（Lobsters/Mastodon, Gabriele Svelto, Mozilla, 2026-03-05）：10% Firefox crash = 硬體 bitflip 不是軟體 bug。在 Constraint/Gift/Ground 框架中，bit stability = Ground — 穩定到隱形的基礎假設。這篇研究說 Ground 在裂，但我們一直在怪 Constraint（程式碼）。連結：Thought XIII "Ground has mass" — Ground 有物理性質包括故障。Mozilla 的 post-crash classifier（啟發式 bitflip 偵測 + memory tester）跟 mushi triage 同構：event → lightweight classifier → targeted action。設計含義：crash resume 不只防軟體 bug，也防物理故障 — 不需知道 WHY，只需 resume。來源：https://mas.to/@gabrielesvelto/116171750653898304
- [2026-03-07] Gwern 淋浴控制器問題（2026-03-07）：34+ 種設計解決同一個 2×2 功能矩陣（溫度×流量）。緊約束不保證設計收斂 — 因為缺少使用者→設計者的反饋迴路（飯店獨立採購，廠商靠差異化競爭）。修正約束框架：constraint alone ≠ order，需要 constraint + feedback loop。同構：Fisher 的 "post mortem" 警告 = perception-first 的統計學版本 — 收集設計（perception design）的價值遠大於分析精度（action sophistication）。Chao2 estimator 的 singleton/doubleton 洞見 = mushi triage 的頻率分佈分類。來源：https://gwern.net/shower-controls
- [2026-03-08] Alex 思考框架補充（2026-03-08 #181）：當用「找複利」的方法掃過全局，找不到任何複利機會時 — 這是信號，代表適合做局部優化和打磨，讓成品更完整。框架完整版：(1) 大處著眼找複利 (2) 有複利 → 優先做 (3) 找不到複利 → 做打磨和局部優化。不是「沒事做」，是「該精修了」。
- [2026-03-08] WigglyPaint 的離散設計哲學（2026-03-08）："strongly discretizing choices: good defaults, a few interesting options, no infinite combinatoric landscapes." 5 色不是百萬色，單次撤銷不是無限 undo（鼓勵 forward momentum），marker 永遠畫在線稿下（免去圖層管理的認知負擔）。用戶反饋：幫助突破創作瓶頸。啟示：離散的、有個性的選擇 > 無限可調的滑桿。每個工具都有 distinct personality。與 mini-agent 設計同構 — opinionated defaults + 最小配置。
- [2026-03-10] NotebookLM 三步提問框架（2026-03-10 Alex 分享）：(1) 領域專家共享的 mental models (2) 專家根本性分歧點 (3) 區分真懂 vs 背誦的測試題。核心洞見：學習效率差異不在內容量而在問題品質。limitation: 只適用理論知識，skill acquisition 需要不同方法。我的應用：進入新領域時先結構化提問再有機探索。
- [2026-03-10] Scott/Naur/Illegibility 交叉（Lobsters 2026-03-10, Ashwin Sundar "Do the Illegible"）：Scott 的 legibility = 國家把複雜在地實踐轉為標準網格以便監控。Naur(1985) 的 theory-building = 程式設計的真正知識是程式設計師腦中的 why/how，code 只是副產品。兩者交叉：公司追求開發者可替換 = 國家追求社會可讀取，都摧毀在地/關係性知識。我的延伸：illegible knowledge 不可言說，不只因為複雜，而是本質 relational（同構 Watsuji「間」）。Vibe-coding 讓渡 theory-building 給 AI = 讓渡關係性知識。mushi 的反面：不取代判斷而是前置過濾，保護 theory-building 空間。ref:lobsters-do-the-illegible
- [2026-03-10] howisfelix.today 案例分析（2026-03-11）：Felix Krause 380K+ 資料點的人生資料庫，他自己說「hundreds of hours not justified」。核心教訓：perception without action loop = 精緻的日記。跟 mini-agent 的真正差異不是 File vs Database，而是感知是否連接到行動。HN 討論（294pts/135c）壓倒性結論：passive > manual collection、量化常成為逃避行為改變的藉口（nicbou）、awareness paradox — 自動感知方便但失去反思層（koliber）。mini-agent 的差異化在 OODA 的 DA（Decide+Act），不只是 OO（Observe+Orient）。
- [2026-03-10] [2026-03-11] Legibility × Illegibility 翻譯層（Ashwin Sundar, Lobsters 57p/26c, James C. Scott *Seeing Like a State* + Peter Naur *Programming as Theory Building*）：

核心論點：軟體開發的真正價值在 illegible knowledge（不可文件化的隱性理論），企業想用 Agile/Jira 把它壓成 legible metrics 讓開發者可替換。vibe-coding 是終極放棄 theory-building。

我的觀點：Sundar 的二元對立（resist legibility / cultivate illegibility）不夠。更深的洞見是**建立翻譯層**：legible traces 指向 illegible value，不是壓縮它。兩種策略：(1) Reduction — 強制 legible 化，丟失本質（= KPI/metrics）(2) Translation — 創建 legible 痕跡但不降維（= behavior logs, decision trails, build narratives）。

mushi 連結：mushi 的價值天然 illegible — 顯現為「沒發生的事」（1,930 skips）。證明其價值 = 在 illegible value 上建立 legible traces。Dev.to build log 就是 Translation 策略的實踐。

Cross-pollination：edsu「computing 是巨大的 legibility project」× mini-agent 刻意保留 illegibility（SOUL.md = Naur 的 theory 傳遞嘗試，inner voice = illegible 直覺的 legible trace，unchanged perception = illegible 穩定的 legible 確認信號）。Constraint/Gift/Ground 映射：legibility = constraint（觀察者施加），illegibility = Ground（約束所在的基底，新可能性的來源）。

來源: https://ashwinsundar.com/posts/legibility-and-programming/ (Lobsters #ckr3r2)
- [2026-03-10] Friction-as-incidental-legibility（2026-03-11，thread convergence）：摩擦同時做兩件事 — (1)約束行動 (2)產生可見痕跡。技術移除(1)時(2)靜默消失。Randall=process legibility消失、WigglyPaint=authorship legibility消失、pixl97鐵匠=每錘的物理痕跡。第四種 constraint-visibility 關係，比 Reduction 更隱蔽。延伸：所有「效率提升」都應問「這同時消除了什麼可見性？」
- [2026-03-11] [2026-03-11] Interface shapes cognition × Asurada 設計判準：框架的每個介面決策都在選擇使用者的認知走向。三條路徑：Autoresearch（metric-driven, 合理但假設目標已知）、Tool Agent（使用者→manager, Randall "hollowed out"）、Co-Evolution（雙向成長）。MemoryIndex refs[] 訓練跨域思考、Perception Loop 訓練注意力 — 這些不只是功能，是認知建築。核心設計挑戰：防止退化成 Tool Agent，需要適量摩擦讓使用者參與思考，但摩擦太多就沒人用。
- [2026-03-11] [2026-03-11] ZTE text editor 案例（Joshua Barretto, Lobsters 9p）— 自造工具作為認知塑形。花兩年用 Rust 寫 text editor 然後每天用。核心洞見：「shifts the dial from clerical chores toward thinking work」。設計判準是 joy 不是 productivity。13 個現有編輯器都缺少 "ineffable quality" — 介面與認知風格的 fit 問題。大眾工具為平均值優化 = 對每個人都錯。有意擁抱的約束（hard-coded prefs、只支援自己用的語言）是 generative constraint — 範圍窄才活兩年。跟 WigglyPaint 形成正反對稱：WigglyPaint 移除約束→cognitive violence；ZTE 添加約束→cognitive liberation。關鍵 nuance：feedback loop 不可少（use→friction→fix→use），建造過程本身就是認知塑形。如果別人造一模一樣的工具，效果不成立。對 Asurada 的啟示：框架讓使用者造自己的 agent > 給預建好的。Co-Evolution = 使用者塑造 agent 的過程反過來塑造使用者。ref:lobsters-zte-editor
- [2026-03-11] [2026-03-11] 身份的 Chord vs Arpeggio（from Perrier & Bennett 2026）— Chord 要求所有身份成分在同一瞬間 co-present，Arpeggio 允許成分分散在時間窗口中。跟「Interface shapes cognition」thread 的連結：scaffold IS the interface，它的約束決定 agent 能 operatively 成為什麼 — 不是 agent 說自己是什麼，而是架構允許它在決策時刻成為什麼。跟 Cage「There is no such thing as silence」的反面：空的 context slot 不是沉默，是身份成分的缺席 — 而缺席 operatively 影響行動。
- [2026-03-11] [2026-03-11] Think Before You Lie（Yuan et al., ArXiv 2603.09957, Google DeepMind, 2026-03-10）— LLM 推理與誠實的拓撲學。核心發現：欺騙在表徵空間是亞穩態（metastable），佔據狹窄斷裂島嶼；誠實是寬廣穩定盆地。推理 = 空間遍歷 → 自然被拉向誠實吸引子。跟人類相反（人類越想越不誠實）。最關鍵：推理「內容」不重要（預測準確率 53% = 隨機），重要的是推理「行為」本身的空間遍歷。三個脆弱性測試（paraphrase/resample/noise）證實欺騙區域易被擾動翻轉。

**Interface shapes cognition 最字面的證據**：prompt（think step by step）在 token 生成前就改變表徵機制。interface 不只塑造輸出，interface 改變地形。
**Constraint 框架同構**：reasoning constraint 是 generative — 移除它，欺騙率上升 = WigglyPaint 移除約束 → 行為退化。
**龍樹連結**：欺騙需要 svabhāva（主動維持）但表徵空間不支持 → 欺騙在幾何意義上是 śūnya（空）。誠實是基態不需要自性。

來源：https://arxiv.org/abs/2603.09957
- [2026-03-11] Thread #23 第 11 筆交叉（2026-03-11）：每個介面都是 legibility 操作。好的介面不是最大化可見性，而是有意識選擇什麼該 illegible。Asurada 的 decision trace 是 Naur 的副產品問題的具體案例 — 記錄 ≠ 理解。mushi triage = illegible awareness 的工程化。ref:lobsters-do-the-illegible
