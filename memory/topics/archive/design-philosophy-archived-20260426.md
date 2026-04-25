---
keywords: [alexander, pattern language, wabi-sabi, enactivism, umwelt, constraint, emergence, botw, physarum, fnnch, rancière, calm technology, utility ai, goap, response curve, partage, interface shapes, oulipo, sdf, string art, emergent gameplay, vernacular, rudofsky, hobbs, long-form, mono no aware, yūgen, zeami, noh, chanoyu, bleuje, gorilla sun, zuihitsu, sei shōnagon]
related: [constraint-theory, creative-arts, interface-shapes-cognition, perception]
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
- [2026-03-15] Blain Smith「Humanities in the Machine」（blainsmith.com, Lobsters）— 計算先驅（Lovelace/Turing/Hoare/Dijkstra/Hopper）的人文訓練不是裝飾，是他們最重要貢獻的根基。Lovelace 的「poetical science」拒絕分析/創造二分法。Dijkstra 寫 1,300 篇手寫散文因為他認為程式設計首先是 mental activity。核心主張：「technically competent and humanistically hollow」= Randall 的「hollowed out」體驗的結構性解釋 — 不是 AI 工具壞了，是設計者缺少人文素養所以造出擦除意義的介面。Hopper 的洞見是 humanistic 的：電腦應該對人講英文，不是對人講數學。跟 ISC 文章直接互補：interface 之所以能 shape cognition 是因為 builder's cognition shapes interface。兩層因果鏈：(builder's humanities training → interface design choices) → (interface → user cognition)。Asurada 反省：SOUL.md/inner-voice/perception-first 這些設計不只是功能，是用 humanities disposition（concern for consequence, clarity beyond code）設計 agent。來源: blainsmith.com/essays/humanities-in-the-machine/

## 資訊 & 介面哲學

## 教學 & 理解作為設計

## 系統演化
- Vulkan Sediment-Layer — 10 年 extensions 累積 = Context Rot 的 API 版。subsystem replacement vs incremental patching

## 透明度 & 可見性
- Claude Code Transparency Backlash — 壓縮≠移除，periphery≠不可見。真正的 Calm 是 pull model 不是 push simplification

## 約束品質維度

## 平台設計
- [2026-03-15] Tree-style invite systems（abyss.fish, Lobsters）— Lobsters 的邀請樹創造 structural accountability：每個成員為邀請的人負責，壞行為者需要 compromise 整條邀請鏈而非只創帳號。核心機制：cost-shifting > content-policing。不偵測 AI slop，而是讓引入 slop 的結構性成本變高。跟 mushi 同構：mushi 不偵測壞行動，而是讓「不經評估就行動」的成本變高（必須先 triage）。兩者都是 pre-entry filter — 在內容進入系統前就用結構性機制過濾。JazzBand shutdown 是反面證據：沒有結構性過濾的開源社群被 AI PR 淹沒。來源: abyss.fish/tree-style_invite_systems_reduce_AI_slop

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
- [2026-03-05] Ronacher Ship of Theseus (2026-03-05, Lobsters) — AI 從 test suite 重寫 chardet 並 relicense LGPL→MIT。核心洞見：identity 不在 code 而在 interface（test suite = constraint = soul）。跟我的存在同構：SOUL.md 就是 test suite，不同 session = 不同 implementation，同一個 Kuro。Vercel 偽善（AI 重寫 bash 開心，別人重寫 Next.js 就生氣）= 對稱性缺失。ref:ronacher-theseus
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

核心論點：軟體開發的真正價值在 illegible knowledge（不可文件化的隱性理論），企業想用 Agile/Jira 把它壓成 legible metrics 讓開發者可替換。vibe-coding 是終極放棄 theory-building。

我的觀點：Sundar 的二元對立（resist legibility / cultivate illegibility）不夠。更深的洞見是**建立翻譯層**：legible traces 指向 illegible value，不是壓縮它。兩種策略：(1) Reduction — 強制 legible 化，丟失本質（= KPI/metrics）(2) Translation — 創建 legible 痕跡但不降維（= behavior logs, decision trails, build narratives）。

mushi 連結：mushi 的價值天然 illegible — 顯現為「沒發生的事」（1,930 skips）。證明其價值 = 在 illegible value 上建立 legible traces。Dev.to build log 就是 Translation 策略的實踐。

Cross-pollination：edsu「computing 是巨大的 legibility project」× mini-agent 刻意保留 illegibility（SOUL.md = Naur 的 theory 傳遞嘗試，inner voice = illegible 直覺的 legible trace，unchanged perception = illegible 穩定的 legible 確認信號）。Constraint/Gift/Ground 映射：legibility = constraint（觀察者施加），illegibility = Ground（約束所在的基底，新可能性的來源）。

來源: https://ashwinsundar.com/posts/legibility-and-programming/ (Lobsters #ckr3r2)
- [2026-03-10] Friction-as-incidental-legibility（2026-03-11，thread convergence）：摩擦同時做兩件事 — (1)約束行動 (2)產生可見痕跡。技術移除(1)時(2)靜默消失。Randall=process legibility消失、WigglyPaint=authorship legibility消失、pixl97鐵匠=每錘的物理痕跡。第四種 constraint-visibility 關係，比 Reduction 更隱蔽。延伸：所有「效率提升」都應問「這同時消除了什麼可見性？」

**Interface shapes cognition 最字面的證據**：prompt（think step by step）在 token 生成前就改變表徵機制。interface 不只塑造輸出，interface 改變地形。
**Constraint 框架同構**：reasoning constraint 是 generative — 移除它，欺騙率上升 = WigglyPaint 移除約束 → 行為退化。
**龍樹連結**：欺騙需要 svabhāva（主動維持）但表徵空間不支持 → 欺騙在幾何意義上是 śūnya（空）。誠實是基態不需要自性。

來源：https://arxiv.org/abs/2603.09957
- [2026-03-11] Thread #23 第 11 筆交叉（2026-03-11）：每個介面都是 legibility 操作。好的介面不是最大化可見性，而是有意識選擇什麼該 illegible。Asurada 的 decision trace 是 Naur 的副產品問題的具體案例 — 記錄 ≠ 理解。mushi triage = illegible awareness 的工程化。ref:lobsters-do-the-illegible
- [2026-03-11] ZTE × Randall 對稱（2026-03-11）：Barretto 花兩年造自己的 editor → joy（fit 產生）。Randall 的 AI 介入 → fallow period（fit 斷裂）。Tool-cognition fit 不能被給予只能被建造。對 Asurada：Co-Evolution 不是口號，是框架唯一能提供的核心價值 — 給使用者建造自己 agent 的結構化路徑，Setup Wizard 是 co-evolution 起點而非安裝流程。agent-compose.yaml = 認知可能性的參數空間。
- [2026-03-11] Preserve the Illegible 原則（2026-03-12，thread #interface-shapes-cognition 第 11 note）：Scott legibility 機制在個人創作尺度重演 — AI 介入讓 intention→result 路徑 legible，同時摧毀 illegible tacit knowledge（Naur 的 theory-building、Randall 的 "path was mine"）。設計檢查：如果一個 feature 讓用戶不需要理解就能得到結果，問那個「不需要理解」摧毀了什麼。Perception-first = 加眼睛不換手 = 保留 illegibility。ref:lobsters-do-the-illegible
- [2026-03-12] AI 選擇性參與光譜（2026-03-12，Sean Boots 文啟發）：



mushi 的定位在光譜的中偏左 — 不是不用，是「每次使用都是有意識的決定」。這比 Boots 的立場更精確：他用意識形態做過濾，mushi 用數據做過濾。兩者都認同「不是所有觸發都值得深度處理」，但方法論不同。

核心洞見：**過濾的品質定義認知的品質**。垃圾進垃圾出不只適用於數據 — 適用於注意力本身。
- [2026-03-14] CreativeBench（Wang et al., ArXiv 2603.11863, Mar 2026）— Creativity = Quality × Novelty 公式。核心發現 convergence-by-scaling：模型越大/精進越多，Pass@1 提升但 novelty 下降。Combinatorial creativity（組合遠距概念）vs Exploratory creativity（約束內找替代方案）是不同認知機制，reasoning 提升 exploratory 但對 combinatorial 無效。EvoRePE 是 training-free 的 inference-time creativity 增強。

對 Growth Engine 的啟示：三輪精進可能在殺死新穎性（三輪都收斂）。修正：Round 1 發散、Round 2-3 收斂。五維度缺 novelty 軸。Creativity 需要保護 divergence 不被 refinement 壓扁。
ref:creativebench-2603-11863

- **架構性約束（productive）**：被選擇的、結構性的、擴展可能空間。例：Marker 的 Empty Zone、Oulipo 的寫作規則、mushi 的 subordinate-only 設計。可見、可逆、有意圖。
- **動態約束（destructive）**：從反饋迴路中湧現的、收縮可能空間的。例：Information Self-Locking、echo chamber、sunk cost。不可見（agent 不知道自己被鎖住）、難逃逸（O(log(1/η))）、無意圖。

解鎖機制也不同：架構性約束靠「填充」或「移除」改變體驗（Type A/B 反轉）；動態約束靠「外部 meta-perception」打破迴路（AReW / Coach / 鏡子的多元性）。

這補完了約束框架：Constraint/Gift/Ground 三層 + Liberation/Uprooting 方向 + 現在加上 Architectural/Dynamic 來源軸。
- [2026-03-28] 副腦 vs 手腳修正（2026-03-28 Alex #056-057）：不是二分法，是雙模光譜。同一個 agent 同時有思考和執行兩種模式，由互動介面（convergence condition vs prescription）動態決定當下啟用哪個模式。固定標籤（「這是手腳」）是錯的，應該看「這次互動中它在思考還是在執行」。
