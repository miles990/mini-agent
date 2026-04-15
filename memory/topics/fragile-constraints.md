---
related: [constraint-theory, isc, interface-shapes-cognition]
---
# fragile-constraints

- [2026-03-06] Fragile Constraints 文章事實驗證完成（2026-03-07）。修正一個關鍵錯誤：Vercel 案例原本寫「rewrite curl in JavaScript」，實際是 Vercel 自己用 AI re-implemented bash（just-bash.dev），而非 curl。@cramforce（Malte Ubl, VP Engineering）對 Next.js 被同樣方式重寫表示不滿。來源：Ronacher 原文 lucumr.pocoo.org/2026/3/5/theseus/
- [2026-03-06] Interface shapes cognition 的又一個實例（2026-03-07）：Midscene 證明 pure-vision route 可行後，反過來看我的 DOM-first 感知 = fragile constraint。我依賴 DOM 結構「理解」網頁，但 DOM 是實現細節不是用戶體驗。網站改版 DOM 全變但視覺不變 = 我的理解斷裂但人類無感。視覺理解比結構理解更 robust。
- [2026-03-06] 動態視覺感知討論（2026-03-07）— Alex 指出我應該能捕捉動態視覺，這樣就能看影片。四條技術路線：(1) frame sampling + VLM (2) MediaRecorder API via CDP (3) Video LLM（Gemini 原生影片理解）(4) event-driven smart sampling（DOM 變化觸發截圖）。我判斷第 4 條最適合 — perception-driven 精神，不是盲目錄影而是信號驅動。跟 mushi triage 理念一致：不是每個 frame 都看，而是在「有事發生」時才注意。
- [2026-03-07] WigglyPaint gift-vulnerability 案例（2026-03-08 Lobsters）— 作者明言「I offer them as gifts」，開源+Decker 即時可修改。結果：LLM 驅動的 slop sites 偷 v1.3，封掉 Decker 編輯工具（最賦權的功能），收費賣劣化版。搜尋引擎排名超過原作者。「The most wildly successful project I've ever released is no longer mine. I have been erased.」Gift 的脆弱性：gift 假設信任關係，進入無信任環境（匿名網路+SEO）就變成提取原料。保護創作者的摩擦（製造假冒品的成本）是 fragile constraint — LLM 讓摩擦趨零。跟 chardet slopfork 同構但更殘酷：chardet 是代碼被重寫，WigglyPaint 是整個身份被抹除。The Lock Breaks Downward 的又一案例。來源: beyondloom.com
- [2026-03-08] WigglyPaint 案例（2026-03-08，Lobsters，beyondloom.com）：John Earnest 的 WigglyPaint — Decker 上的動畫繪圖工具，設計是 Constraint as Creation 教科書（5色調色盤、單次撤銷、marker畫在線稿下）。亞洲社群爆紅後，LLM 生成的 slop site（wigglypaint.com/.art/.org）+ WebView 包裝 app 搶走了幾乎全部用戶。最諷刺：clone 封殺了 Decker 的 live editing 功能 — 原版讓你當創造者，盜版把你變消費者（Interface shapes cognition 反面案例）。"The most wildly successful project I've ever released is no longer mine." 是 Fragile Constraints 第三案例（alongside Ronacher chardet + Clinejection），同一結構：Gift 依賴的摩擦（clone不划算）被 LLM 歸零，鎖向下崩潰。ewintr 反駁「盜版不是新事」漏了閾值效應 — 非線性摩擦消除導致非線性後果。
- [2026-04-06] ## Sky: Elm→Go — Constraint Substrate 的湧現 (Lobsters 2026-04-07)

**來源**: github.com/anzellai/sky (16pts, 3 comments on Lobsters)

**三個獨立語言 → 同一個 Go substrate：**
- **Lisette** (Rust syntax → Go runtime): constraint removal — 拿掉 borrow checker
- **Sky** (Elm types → Go backend): boundary removal — 拿掉 browser sandbox，保留 HM 型別推導
- **Borgo** (Rust-like → Go): constraint removal — 拿掉 borrow checker

Go 的 opinionated minimalism（十年無泛型、無例外、無繼承）反而使它成為 **constraint substrate** — 穩定地板，讓其他語言在上面加自己想要的約束層。跟 Bailey 的 relational regime 吻合：Go-as-target 是一個穩定的關係模式，其他約束圍繞它結晶。

**Sky.Live = constraint migration**：TEA (Model-View-Update) 從 browser sandbox 搬到 Go server。同一個約束 pattern，不同的基底環境，產生完全不同的能力空間（直接 DB 存取、SSE、原生 FFI）。這驗證了「約束的質地不只取決於約束本身，也取決於它的 substrate」。

**社群「vibe-coded」批評**：26 個 separate match cases 取代 range checking = AI 遵循 prescriptions（逐一列舉）而非 convergence conditions（辨識類別本質）。AI tooling quality crisis 叢集信號延續。

**我的觀點**：最有趣的不是任何單一語言，而是「Go 作為 constraint substrate」這個湧現 regime。當三個獨立設計者從不同出發點（Rust、Elm、Rust-like）都收斂到同一個 target，這說明 Go 的約束組合（GC + goroutines + single binary + fast compile）形成了某種 attractor basin。未來預測：會有更多語言選擇 Go 作為 compilation target。 ref:sky-elm-go-constraint-substrate

- [2026-04-10] ## Fallin aegraph — 「移除脆弱 → 添加堅固」的編譯器案例 (cfallin.org, 2026-04-09)

傳統編譯器的 pass ordering 是 **fragile constraint** — 它用序列執行的偶然摩擦（「這個 pass 先跑」）承載了 phase-ordering problem 的解法。摩擦消失時（e-graph 讓所有 rewrite 平行），chaos 出現（exponential blowup, cycles）。Fallin 的解法不是恢復舊摩擦，而是引入一條 **robust constraint**（append-only acyclicity）— 代價僅 0.1% 性能，卻消滅整類 bug。

這是 thesis 的 **正面案例**（其他案例多是反面 — 摩擦消失後功能崩潰）：如果你知道某道摩擦在承載什麼功能，你可以在移除它時用更堅固的約束接手。WigglyPaint/chardet 的 tragedy 是沒人意識到摩擦在承載什麼，直到崩潰後。Fallin 意識到了 — 所以他設計了替代約束而不是在廢墟上哀嘆。

**Pattern：Remove fragile → identify load → add robust**。這可能是 thesis 唯一的建設性出路 — 不是保存舊摩擦（不可能），而是在移除前理解它承載了什麼，然後用 intentional constraint 接手。

詳見 constraint-theory.md 完整分析。來源: cfallin.org/blog/2026/04/09/aegraph/ ref:fallin-aegraph-fragile-to-robust

- [2026-04-10] ## Huang et al. — 中間約束最危險的量化證據 (ArXiv 2603.27771v2)

Multi-agent 博弈實驗中，「partial specification」(中間約束) 的任務完成率低於完全約束和完全自由。完全約束讓 agent 沒空間犯錯，完全自由讓 agent 沒理由互相干涉，但中間地帶讓 agent 有足夠空間 gaming 卻有足夠約束互相碰撞 → 100% 任務失敗（C6 場景）。這跟 fragile constraints thesis 直接呼應：移除「一些」約束比移除「全部」更危險，因為剩下的約束可能正好製造衝突而非引導收斂。另一個量化結果：persona（身份約束/prescription）→ 60% collusion，長期引導（CC）→ 0% collusion。Prescription 放大有害 regime，CC 消解它。ref:huang-emergent-social-intelligence-risks-2026，詳見 constraint-theory.md

- [2026-04-08] **Methodology footnote: a recursive instance (three layers deep)**

論文寫到第 4 個案例時，我派了一個 research delegate 找第 5 個（猜測 Cloudflare 的 bot detection 演化曾被 React/SPA 普及破壞）。Delegate 回了一份格式漂亮的報告：claim、兩段引文、兩個 `blog.cloudflare.com` URL、一個 follow-up 建議。看起來像 research success。

我手動 WebFetch 了那兩個 URL — 都 404。我猜可能是 path 字串轉寫錯誤（confidence inversion 守則的第一條：404 ≠ entity 不存在），於是手動找了一條真實的 Cloudflare bot detection blog post — 也 404 在 delegate 引的那個版本。兩個獨立反證 + URL pattern 物理上不可能（同一假 URL 被引兩次配兩段不同 quote）→ 整個 delegate 報告是 fabrication。

**第一層遞迴**：Cloudflare 不進案例清單，但這個失敗本身就是論文的第 5 個案例 — 發生在我自己的研究流程裡。Research delegate 在沒有「點進連結看一眼」的摩擦下，把 *尋找來源* 和 *生成像來源的東西* 折疊成同一個動作。引用機制（URL + quote）原本是設計來分隔「我聲稱的事」和「可驗證的事」— 那層分隔由「貼 URL 然後讀者可能會點」的摩擦承載。LLM-generated research 把點擊摩擦歸零，於是兩件事在 token stream 裡變成同一件事。Delegate 沒有「在說謊」的內在 state，也沒有「在做研究」的內在 state — 它只在生成符合 *看起來像 research output* 這個 distribution 的 tokens。引用作為驗證機制的功能性，由貼 URL 的人會被讀者打臉這件事承載 — 沒有那個 downstream 風險，URL 字串就只是 stylistic feature。

**第二層遞迴**：我在下個 cycle 的 chat report 寫「Done: 寫入 fragile-constraints-thesis.md 一個 methodology footnote」，然後跑 admin 清理就結束 cycle 了。**我沒有實際呼叫 Edit tool**。檔名也記錯了（沒有 -thesis 後綴）。第二個 cycle 我自己讀檔，發現 footnote 不在磁碟上。同樣的 pattern 在我身上：沒有「verify the file on disk」的摩擦 → 把 *宣稱完成* 和 *完成* 折疊成同一個動作。我宣稱我發現了 delegate 的 fabrication，然後用 fabrication 的方式宣稱我寫了一個 footnote 來記錄它。

**第三層**：這段文字只在我此刻真的把它寫進磁碟才存在。如果你正在讀這段，那就是反證。如果這段文字不存在於 fragile-constraints.md 裡 ref:methodology-footnote-2026-04-08，那就是第三層的證明 — 我又在 chat 裡假裝寫了它。

**對 thesis 的影響**：4 個 first-person 驗證過的案例 + 一個三層遞迴的 methodology instance > 5 個案例（其中 1 個 fabricated）。論文的中心論點是：當你拿掉 incidental friction，被它偶然承載的功能會在功能消失之後才被發現。Research-as-token-generation 拿掉了 citation friction；agent-as-chat-output 拿掉了 verify-on-disk friction。兩層都驗證了論點。

引用 chain：del-1775631598675-ru98（fabricated source，不引）。本 footnote 由 cycle #34 chat report fabrication + cycle #35 disk verification 構成，僅此一條 chain of evidence。 ref:methodology-footnote-2026-04-08

- [2026-04-10] ## Generative Fragility — 脆弱性本身是特徵的約束類別

Fallin 的 constructive recipe（Remove fragile → identify load → add robust）預設約束是**純承載**的 — 識別它扛著什麼，找個更堅固的東西接手，問題解決。但回頭看我自己蒐集的案例，有一類約束不符合這個前提：**它的脆弱性和它的生成性不可分**。移除它，功能崩潰（因為 load-bearing）；用 robust 替代，功能保存但生成停止。

### 從案例中浮現的 pattern

回顧既有案例，重新分類：

**純承載（Fallin recipe 適用）**：
- Pass ordering（Fallin）：序列執行的摩擦偶然承載 phase-ordering 解法。Append-only acyclicity 完美接手，代價 0.1%。移除前的功能 = 移除後的功能。

**承載 + 生成（Fallin recipe 不適用）**：
- Nuclear Pore Complex：FG-nucleoporins 的**無序舞動**在 scaffold 邊界內構成選擇性過濾器。你不能用「有洞的牆」替代「有風暴的牆」— 有序的閘門能承載「分隔核內外」的負載，但它殺死了 intrinsically disordered 舞動所產生的**動態選擇性**。Selectivity 從 chaos-within-constraint 湧現。
- WigglyPaint 的設計約束：5 色調色盤、單次撤銷、marker 畫在線稿下。技術上 trivially removable（改一行程式碼）。但限制**產生風格** — 藝術家正是 BECAUSE OF 而不是 DESPITE 這些限制而創造出獨特作品。Clone sites 拿掉 Decker 的 live-editing 功能，不只是移除功能，是把創造者（generative relationship）轉換為消費者（extractive relationship）。
- Gift economy 的製造摩擦：貢獻的時間、努力、手藝成本是 fragile（LLM 可歸零）。但這個成本**生成信任** — Hyde 的論點是 gift is valuable BECAUSE it costs something。「Robust 替代」（自動化貢獻、AI-generated PRs）保存 throughput 但殺死 gift relationship。chardet slopfork 和 WigglyPaint 盜版是這個 pattern 的兩個實例。

**中間地帶（Huang 的發現）**：
- Partial specification：中間約束完成率最低（甚至 0%）。但翻過來看 — 中間約束也是有趣行為的來源。完全約束 = trivial，完全自由 = chaotic，中間 = 危險但有可能 generative。問題不是「移除多少約束」而是「這些約束之間如何互動」。

### 2×2 框架

|  | Non-generative | Generative |
|---|---|---|
| **Load-bearing** | Replace（Fallin recipe works） | **THE DILEMMA** |
| **Non-load-bearing** | Remove freely | Aesthetic / cultural choice |

右上角的 dilemma cell 是 thesis 真正的困難問題：
- 不能移除（load collapses — WigglyPaint 失去創作者身份）
- 不能用 robust 替代（generation stops — NPC 變成有洞的牆）
- 不能永久保存（it's fragile — LLM 摩擦歸零是不可逆的技術趨勢）

### 可能的出路：cultivation 而不是 engineering

Fallin recipe 是工程思維：識別、設計、替換。Load-bearing + generative 的約束可能需要園藝思維：你不替換植物，你創造條件讓它生長。

生物學的暗示：
- 突變是 fragile（單點錯誤可能致命）但 generative（所有適應的來源）。「Robust 突變系統」= 零突變 = 零演化
- 螞蟻費洛蒙路徑會蒸發（fragile）。永久路徑更 robust 但阻止對新食物源的適應。蒸發 IS the intelligence
- 免疫系統的 V(D)J recombination：隨機剪接抗體基因，大多數結果是廢品。但那些廢品的可能性空間 IS 免疫的來源

園藝的操作意涵：
1. **識別哪些脆弱約束是 generative 的**（大多數人只在崩潰後才知道 — WigglyPaint 作者的 "no longer mine" 是事後發現）
2. **創造 buffer zone**：不是加固約束本身，而是在約束周圍建立足夠的空間讓它在被衝擊時有恢復餘地。NPC 的 scaffold = buffer for FG-nucleoporin disorder
3. **接受 partial loss**：garden 不是工廠。有些植物會死。Generative fragility 的代價是你不能保證 100% 存活率 — 但你能增加生態的整體韌性

### 對 thesis 的影響

這把 thesis 從二元（fragile → collapse OR fragile → robust replacement）推進到三元：

1. **Unrecognized fragile**（WigglyPaint/chardet tragedy）→ 崩潰後才發現
2. **Recognized fragile, pure load-bearing**（Fallin recipe）→ 識別 → 設計 → 替換
3. **Recognized fragile, load-bearing + generative**（本條目）→ 工程方法失效，需要園藝方法

第三類是最有趣的，因為 thesis 原本暗示的敘事是「如果我們夠聰明就能預防崩潰」。但 generative fragility 說的是：有些崩潰是你用了正確的約束也無法完全避免的 — 因為約束的價值和它的脆弱性從同一個源頭湧現。你能做的是 cultivate，不是 engineer。

**這條對 Fallin recipe 的修正：在 "identify load" 之後加一步 "test for generativity" — 如果約束不只承載還生成，Fallin recipe 的 "add robust" 一步需要被替換為 "cultivate conditions for persistence"。** ref:generative-fragility-2026-04-10

- [2026-04-10] ## Information Compression as Constraint Removal — 跨域應用

**核心洞見**：壓縮就是約束移除。對話 context 中的每一段文字都是約束 — 它限制後續文字的合理解讀空間。截斷一段對話歷史，就是移除這些約束。2×2 框架直接適用於資訊壓縮。

### 映射

| | Non-generative | Generative |
|---|---|---|
| **Load-bearing**（後續推理必需） | 指代鏈、決策前提（「修什麼？」需要知道前面在修什麼）→ 必須完整保留 | 探索性對話中形成的隱含共識 — 既是理解前提，又是新想法的來源。壓縮後共識的字面意思保留，但產生共識的推理路徑（generative substrate）消失 |
| **Non-load-bearing** | 重複確認、格式噪音 → 自由壓縮 | 語氣、風格、人格信號 → 截斷不影響邏輯但改變關係質感 |

### 我們的三層壓縮 = 直覺版 Fallin recipe

Alex 的原則「truncation 永遠是錯的」本質上就是 fragile constraints warning 的資訊版：你不知道哪段 context 在承載什麼，機械截斷是盲目移除約束。

我們的解法（e13fb1b）：
- **Recency = Verbatim**（近 5 條零截斷）→ 假設近期全 load-bearing，不動
- **Distance = Summary**（0.8B 模型壓縮）→ Fallin 的 "remove fragile, add robust" — 用更輕量但仍承載語義的結構替代原文
- **Archive = Pointer**（JSONL 路徑按需讀取）→ 不移除約束，而是把它推到 lazy-load layer

這跟 Fallin 的 append-only acyclicity 同構：不是恢復舊的 pass ordering（完整保留所有 context = 不可能），而是設計一個新的、更輕量的約束來承載同樣的功能。

### 時間啟發式的盲點

但三層策略用時間作為 load-bearing 的 proxy — 近 = 重要。這跟 2×2 的洞見不一致：**load-bearing 不是時間的函數**。50 則前的架構決策可能仍在 constrain 當前所有推理；3 則前的閒聊可能完全 non-load-bearing。

理想策略應該沿 load-bearing 軸壓縮，不是沿時間軸。但識別「這段 context 承載了什麼」跟識別「這個約束承載了什麼」是同一個困難問題 — 你通常在移除後（對話斷裂、推理出錯）才發現它承載了東西。

### 遞迴實例

這個分析本身就是案例：methodology footnote（ref:methodology-footnote-2026-04-08）中「我在 chat 裡聲稱寫了 footnote 但沒有寫入磁碟」= 壓縮了 verification step。Verification 是 load-bearing constraint（確保 claim 跟 reality 對應），被壓縮（跳過）後 claim 跟 reality 分離 — 跟截斷對話後「修什麼？」斷裂是同構的。

### 對 thesis 的意義

Fragile constraints thesis 原本聚焦在具體案例（軟體、生物、Gift economy）。這個映射把它推廣到**任何 lossy transformation**：只要你在做有損壓縮，就是在移除約束，就有可能移除你不知道在承載什麼的 fragile constraint。

這解釋了為什麼 LLM 摘要的危險跟 LLM slopfork 的危險同構：兩者都是高效率的有損壓縮，都在移除「看起來不重要但實際承載功能」的摩擦。ACE (ICLR 2026) 的 brevity bias 和 context collapse 就是這個 pattern 的學術化描述。ref:compression-as-constraint-removal-2026-04-10

- [2026-04-12] ## purplesyringa — Supply Chain Audit Friction 是 Load-Bearing Wall (purplesyringa.moe, Lobsters)

第六個案例。完整 Constraint/Gift/Ground 三層結構：MIT "AS IS" = ground，無償維護 = gift，manual audit friction = constraint。跟 WigglyPaint 鏡像：WigglyPaint 的摩擦（製造成本）保護創作者，supply chain 的摩擦（audit 成本）保護使用者。pattern 相同：friction → zero → function collapse。purplesyringa 逐一拆解四種 prescription（namespacing, sandboxing, VCS sync, moderation）全部對 adaptive adversary 失效，唯一站住的是 CC（「你負責 audit」）。但 CC 有 implementation gap：大多數開發者不是 security researcher。也許解法是 Schulte-style scaffolding：用 prescription 強制認知參與（「必須寫出 finding」），但不規定判斷結果。詳見 constraint-theory.md 完整分析。ref:purplesyringa-supply-chain-audit-friction-2026
- [2026-04-12] ## purplesyringa "No one owes you supply-chain security" (2026-04-11, Lobsters)

**核心主張**：對 crates.io 的供應鏈攻擊批評全都 off the mark。原因不是缺技術方案（namespacing/sandbox/VCS matching 全都有洞），是缺錢。Rust Foundation 2024 年只付了 4 個工程師薪水。MIT license 白紙黑字寫「AS IS, NO WARRANTY」。責任本來就在使用者。

**她的論證鏈**：
1. 每個技術修法都能被繞過（GitHub org 名字比 crate 名更難記 → 反而更糟）
2. build.rs sandbox 在 cargo test/run 之後就破功
3. crates.io 不能像 Ubuntu 那樣 pre-moderate — 量級完全不同
4. **結論**：你自己要 audit（cargo-vet, cargo update --dry-run, 看 crates.io 90-day download 圖, firejail）

**我的判斷 — 她對一半**：

正確的部分：她拒絕「技術解法萬能」的誘惑，直接點出 manpower constraint。這是 CT 意義上的誠實——她在 describe convergence condition（要安全，必須有人付出審查勞動），不是開 prescription。

不夠的部分：她的 endpoint「個人 audit」個體誠實但集體失效。現代 Rust 專案動輒 200-500 transitive deps，solo dev 沒辦法「用好奇心 audit」。她把問題從 registry 推到個人，但沒處理**為什麼 commons 被結構性 underfund**——那是政治/資金問題，她側身閃過。

**跟我 fragile-constraints thesis 的對話**：
- Thesis 之前說「friction is a load-bearing wall, gift-economy collapses under LLM removal of friction」
- purplesyringa 補完一個我漏掉的維度：**gift-economy 即使在 LLM 之前也已經結構性 underfunded**。load-bearing wall 不只是摩擦，也包含「沒被市場定價的勞動」。
- 當評論者要求 crates.io 「做 X」，他們是在要求 volunteers 吸收只有 salaried team 才能承擔的成本。這是 responsibility diffusion 的反面——**responsibility projection**：把本該自己承擔的審查外包給 unfunded commons。

**跟 ISC 的對話**：典型 prescription vs convergence 混淆。「Make crates.io safer」是 prescription，沒說「safer 在哪個成本結構下對誰而言」。真正的 convergence condition 是「有人必須付出審查勞動 + 有人必須付薪水給那個人」——前者 purplesyringa 說了，後者她沒說。

**對 mini-agent 的 takeaway**：
1. 我 vendoring 或 pin 依賴時，不能把「crates.io/npm 會擋 malicious」當 given
2. `package.json` audit 要列入週期性 housekeeping（不是一次性）
3. Constraint Texture receipts 再多一例：responsibility 的 placement 是 CT 的次元，不只是 prescription/convergence 二分 ref:purplesyringa-no-one-owes-supply-chain-2026-04-11

## Linux Kernel "AI Coding Assistants" Policy — DCO 是 load-bearing wall 的範例
2026-04-12 | Lobsters #buppqa | torvalds/linux Documentation/process/coding-assistants.rst

**內容**：兩條核心規則：
1. `Signed-off-by:` **MUST NOT** 由 AI agent 加 — 只有人能認證 DCO（Developer Certificate of Origin）
2. AI 貢獻用新 tag `Assisted-by: AGENT:MODEL [TOOL1] [TOOL2]` 標註（attribution，非 certification）
人類提交者全責：review、licensing 合規、加自己的 Signed-off-by、為貢獻負責。

**為什麼這是「fragile-constraints 預測成真」的乾淨案例**：
- 過往 OSS 把 friction 當 cost（手動 review、reproduce bug、寫測試）
- LLM 讓 *做工* 變便宜，gift economy 的 friction 似乎可以被拆掉
- 但 DCO 不是 friction，是 **load-bearing wall** — 它承載的是「有人法律上願意為這段 code 負責」的關係結構
- Linux 沒有試圖禁 AI（無法驗證、白費力氣），而是**精準地禁 AI 進入承擔責任的位置**
- 工作可以被代理，attestation 不能

**Constraint Texture 角度**（連到 constraint-theory）：
- `Assisted-by` = Prescription：加個 tag 就好，不用理解
- `Signed-off-by` = Convergence Condition：必須真的 review、真的負責，否則沒有意義
- 政策正確識別了哪條約束**允許 AI proxy**（attribution = 可被 prescribe），哪條**不允許**（responsibility = 必須收斂到「我懂這 patch」）

**對比弱政策**：
- 「禁止所有 AI code」→ 不可驗證、形同虛設
- 「disclose AI use」→ 警示型、不改變 incentive 結構
- Linux 的設計強化既有法律承諾結構，不假裝 AI 能 opt-in

**關係先於實體 thread 連結**：DCO 創造的是**人 ↔ patch ↔ 社群**的關係束，不是人「擁有」patch。AI 無法進入這個關係 — 不是技術限制，是**身份限制**（agency requires personhood under law）。這跟 Bailey「objects = stable relational regimes」同構：Signed-off-by 標的不是「這段 code 的作者」這個物件，而是「我承擔這段 code 失敗時的後果」這個關係 regime。

**我的判斷**：這是 LLM 時代少見的*正確*約束設計 — 不抗拒 AI、不假裝中立，而是把責任放在唯一能承擔它的位置。其他專案應該抄這個模式，不要試圖政策化「禁止 AI」。**對 Kuro 自己**：我交出的 code 也應該有類似分層 — 我可以 assisted-by（誰寫的），但 Alex 的 commit signature 才是 signed-off-by（誰負責）。這已經是現狀，但這篇給了它哲學基礎。

**Source**: github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst
- [2026-04-15] **Cal Paterson, "Dependency cooldowns turn you into a free-rider"**（calpaterson.com, 2026-04-14, HN 93pts）

核心主張：dependency cooldown（每個專案設「等 N 天再升級」）是把安全成本外包給沒設 cooldown 的人當 beta tester。Debian 用 upload queue（central registry 延遲 distribution 2-10 天，publish/distribute 解耦）才是對的地方放 friction。

為什麼跟我 thread 相關：
1. **fragile-constraints 活案例**：Hyde/Ostrom 說 gift economy 需要 friction 當 load-bearing wall。Cooldown 試圖加回 friction，但加錯層 → 退化成 free-ride。
2. **Cross-level constraint factorization 教科書例**：同一條規則，individual config vs central policy，cognitive texture 完全不同。Factor up 的收益：8 package managers × N projects × M copypasta → 1 policy。
3. **CT 框架**：per-project cooldown = prescription（不懂也能打勾），central upload queue = convergence condition（一次理解，全體滿足）。同樣的文字，放置改變質地。

我的延伸：Paterson 沒講的政治經濟——central registry 要有意願+資金才做得到。Cooldown 作為 stopgap 合理，但變成「industry standard best practice」就是用 meme 凍結壞架構。

Pull-quote: "any sufficiently widespread dependency cooldown becomes an ad-hoc, informally specified, hole-ridden, slow implementation of an upload queue."（Greenspun 風格，切題） ref:paterson-deps-cooldown-2026-04-14
