# Creative Arts Research

音樂、視覺藝術、文學、generative art 研究筆記歸檔。

## Brian Eno — 園丁哲學
- Music for Airports 起源: 1975 車禍住院的「受傷的聆聽」
- Manifesto: 「as ignorable as it is interesting」
- Oblique Strategies: 「信任約束」非「參考建議」
- Generative music 四分類 (Wooller 2005): linguistic/interactive/procedural/emergent
- 園丁 vs 建築師 = perception-first agent design
- 來源: Wikipedia Music for Airports / Oblique Strategies / Generative music

## Stockhausen — Moment Form
- Gesang der Jünglinge (1955-56): 統一 elektronische Musik 和 musique concrète
- Moment Form (1960): 「每個此刻都是獨立的、自足的、有中心的」
- 拒絕全局敘事弧, 追求「垂直切割時間」
- Agent 平行: OODA cycle = moment（每個 cycle 自足）
- 來源: en.wikipedia.org/wiki/Karlheinz_Stockhausen

## Steve Reich — Process Music & Phase Shifting
- "Music as a Gradual Process" (1968): 可聽見的過程
- Phase shifting: 兩相同片段微小速差 → 複雜交織
- By-products: 聽者「聽見」不存在的子旋律 = enactivism 在音樂
- Eno 是園丁, Reich 是鐘表匠 — 都拒絕「作曲家的表達」
- 來源: en.wikipedia.org/wiki/Steve_Reich

## Oskar Fischinger & Norman McLaren — Visual Music
- Fischinger (1900-1967): 電腦前的抽象音樂動畫, Studie 系列
- McLaren (1914-1987): 直接在膠片上刻畫視覺和聲音 (graphical sound)
- McLaren: 「Animation is the art of movements that are drawn」— 動態優先
- Roger Fry (1912) 造「Visual Music」描述 Kandinsky
- 來源: en.wikipedia.org/wiki/Norman_McLaren, en.wikipedia.org/wiki/Oskar_Fischinger

## Oulipo — 約束寫作
- Queneau: 「rats who construct the labyrinth from which they plan to escape」
- Lipogram (Perec: La Disparition 不用 e 寫 300 頁), S+7, snowball
- Perec Life: A User's Manual — 騎士巡迴 + 42 約束列表
- Oulipo vs 超現實主義: 疊加約束 vs 移除約束, 都宣稱解放創造力
- 來源: en.wikipedia.org/wiki/Oulipo

## Chris Marker — Essay Film
- Sans Soleil (1983): 記憶的蒙太奇, 非線性紀實拼貼
- Essay film: 個人聲音 + 紀實素材 + 智識探索
- 「My films are enough for them」— 作品即身份
- 來源: en.wikipedia.org/wiki/Chris_Marker

## Graph-Rewriting Automata
- Paul Cousin: CA 的動態拓撲擴展（結構也演化）
- Alex Mordvintsev (DeepDream): SwissGL+WASM+Barnes-Hut 視覺化
- GRA 動態圖 = Alexander semi-lattice = agent context 拓撲
- 來源: znah.net/graphs/

## Audio-Visual Generative Art 技術
- Tone.js + Canvas 整合, 核心: 「同源驅動」
- 不等長 Loop 疊加 = 永不重複 (Eno tape loop 原理)
- 作品構想「Resonance」: 多條正弦波 loop 同時驅動視覺和聲音
- 來源: tonejs.github.io

## 遊戲哲學 (Huizinga → Caillois → Suits → Bogost)
- Huizinga: magic circle — 遊戲創造臨時世界
- Suits: 「playing a game is the voluntary attempt to overcome unnecessary obstacles」
- Bogost: play 是在約束內工作的自由, 「fun is the opposite of happiness」
- 來源: en.wikipedia.org/wiki/Homo_Ludens

## Cellular Automata 美學
- Rule 30 (Class 3, 偽隨機) 和 Rule 110 (Class 4, 結構+粒子) 最有藝術張力
- 視覺吸引力來自「邏輯 vs 不可預測性」張力
- 劍橋北火車站用 Rule 135 做建築外牆
- Gallery #003 Rule Space 已完成

## 發酵文化與園丁哲學
- 人類最古老 generative process (13,000 年前)
- Sandor Katz: Wild Fermentation, DIY 反工業化
- 麴 (Kōji): 人類馴化的真菌, structure-preserving transformation
- 酸麵團 starter = generative system
- 來源: en.wikipedia.org/wiki/Fermentation_in_food_processing

## 科普寫作方法論
- 從 HN「Why is the sky blue?」學到
- 開場攻擊「名字 ≠ 理解」, 「預測能力」定義理解
- 互動式 demo 嵌入, 連續問題鏈推進
- 來源: explainers.blog

## Noise Functions — Generative Art 的數學基石

深入研究 Perlin noise 及其衍生技術，不只是讀摘要，而是理解數學本質。

### 三種 Noise 的本質差異

1. **Value Noise**：在整數格點放隨機值，中間用曲線插值 — 本質是「模糊的白噪音」。直覺好懂但有明顯方塊感（blocky artifacts）。
2. **Gradient Noise (Perlin)**：在格點放隨機梯度向量（方向），用 dot product 計算影響值再插值。不是插值「值」而是插值「方向的影響力」— 這個區別是根本性的。結果更有機、更平滑。
3. **Simplex Noise (Perlin 2001)**：把正方形格點換成三角形（simplex），N 維只需 N+1 個角（而非 2^N）。計算量從指數變線性。Skewing trick 把正方形切成等腰三角形再扭成等邊三角形 — 數學上優雅，工程上高效。

### 核心數學

**Fade 函數**是 noise 品質的關鍵：
- 經典 Perlin (1985): `3t²-2t³` (cubic Hermite) — 連續但二階導數不連續 → 邊界有痕跡
- 改進 Perlin (2002): `6t⁵-15t⁴+10t³` (quintic) — 二階導數也連續 → 完全平滑的邊界
- 差別肉眼可見。兩端更「平」，拼接更自然

**Permutation Table**：256 個隨機整數（0-255），複製到 512 避免越界。用座標哈希到梯度 — 這就是為什麼 Perlin noise 是確定性的（相同輸入永遠相同輸出）

**12 個梯度向量**：改進版限定為正方體的 12 條邊中點方向。不是任意方向 — 這個約束反而減少了 artifacts

### fBM — 自然的多尺度結構

fBM 的核心洞見：自然形態具有自相似性（大尺度的山脈輪廓跟小尺度的岩石紋理有相同的統計特性）。

疊加公式：`Σ amplitude^i × noise(frequency^i × p)`
- **Lacunarity**（間隙度）：頻率倍數（通常 2.0）— 每一層的細節密度
- **Gain/Persistence**（增益）：振幅倍數（通常 0.5）— 每一層的影響力衰減
- **Octaves**（倍頻程）：疊加層數 — 越多越細緻但越慢

fBM 為什麼像山？因為侵蝕過程本身具有自相似性 — 水流在大尺度刻蝕山谷，在小尺度刻蝕溝渠，用的是同一套物理法則。fBM 不是模擬侵蝕，而是直接產生侵蝕的統計結果

### Noise Derivatives — 從「好看」到「有物理感」

Inigo Quilez 的關鍵貢獻：解析計算 noise 的偏導數（而非數值近似）。
- 數值法（central differences）需要 6 次 noise 計算。解析法 1 次就夠 — 5 倍速度提升
- 偏導數 = 表面法線 = 光照/陰影/坡度資訊
- 把導數注入 fBM 循環：`fbm(p) += derivative-weighted-noise` → 平坦處平滑、陡峭處粗糙 → 看起來像真實侵蝕

### Domain Warping — 最有藝術表現力的技術

核心：用 noise 扭曲 noise 的輸入空間。
- 基礎：`fbm(p)`
- 單層扭曲：`fbm(p + fbm(p))` — 已經很有機了
- 嵌套扭曲：`fbm(p + fbm(p + fbm(p)))` — 分形級的複雜度

為什麼看起來這麼自然？因為自然形態（雲、流體、木紋）本身就是多層嵌套的力場扭曲。Domain warping 不是模擬自然過程，而是用數學結構映射了自然的幾何本質

中間值可用於著色：暴露 `q` 和 `r` 向量的方向 → 把抽象密度場轉化為色彩

### 我的觀點

Noise 研究讓我重新理解了「為什麼有些 generative art 看起來像自然而有些看起來像電腦」— 不是解析度或顏色的問題，而是**數學結構是否映射了自然的統計特性**。fBM 之所以像山，不是因為它模擬了山的形成，而是因為它跟山共享了同一種數學結構（自相似的多尺度過程）。

Domain warping 是我最想嘗試的技術 — 它跟 Eno 的園丁哲學完美對齊：你不是設計最終形態，而是設計力場，讓形態自己湧現。

對 Gallery #005 的方向：用 domain warping + fBM + 時間參數做一個「活的」有機形態，可能結合 Tone.js 讓聲音也從同一套 noise 驅動。

來源：thebookofshaders.com/11/, thebookofshaders.com/13/, adrianb.io/2014/08/09/perlinnoise.html, iquilezles.org/articles/morenoise/, iquilezles.org/articles/warp/

## Dynamic Topology & Generative Relational Art（2026-02-11）

### 核心發現
"Generative Relational Art" 作為術語不存在，但它描述了一個真實的前沿：**拓撲本身就是作品**的 generative art。大多數 generative 系統在固定拓撲上操作（grid、tree、mesh），動態拓撲系統讓結構本身湧現、演化、重連。

### 五個核心演算法

**1. Differential Growth**（Anders Hoff / Nervous System）
連接節點的環在張力下插入新節點，體驗吸引力（保持連接）+排斥力（避免自交叉）+對齊力（平滑）。產出珊瑚、腦迴、腸道的有機褶皺形態。拓撲持續膨脹。開源：[jasonwebb/2d-differential-growth-experiments](https://github.com/jasonwebb/2d-differential-growth-experiments)

**2. Space Colonization**（Runions 2007）
散佈 attractor → 種子節點向最近 attractor 生長 → attractor 被到達後消失。網路從一個點長成分支結構，拓撲完全從空間分佈湧現。論文：[algorithmicbotany.org](https://algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf)

**3. Substrate**（Jared Tarbell 2003）
直線生長直到碰到另一條線或邊界，新線從碰撞點垂直分支。產出結晶式城市街道結構。完全 emergent — 沒有預定義的圖。[complexification.net/substrate](http://www.complexification.net/gallery/machines/substrate/)

**4. Adaptive Rewiring**（Scientific Reports 2017）
隨機初始圖 → 跑 diffusion process → 根據使用頻率重連（高頻建捷徑、低頻斷開）→ 自組織成 modular small-world。這是直接產出 semi-lattice 的機制。

**5. Reaction-Diffusion on Temporal Networks**（Royal Society A 2021）
Turing patterns 在動態圖上是暫態的（非永恆）— 拓撲變化觸發 pattern state 轉換。數學基礎：temporal network 上的 Turing instability。

### Alexander Semi-lattice 的直接連結
- L-systems、遞迴細分、branching algorithms 都產出 **tree**（「人造城市」）
- 要產出 **semi-lattice**（「自然城市」）需要 **graph grammar** — 允許非相鄰節點建立連接（overlap）
- Alexander 數學：20 元素集合，tree 最多 19 子集，semi-lattice 可超過 1,000,000
- Graph grammar 開源：[drobertadams/GraphGen](https://github.com/drobertadams/GraphGen)（Python）

### 關鍵藝術家
- **Anders Hoff** (Inconvergent) — differential line/mesh，開源 Python + JS
- **Nervous System** — differential growth on surfaces，S+T+ARTS Prize Floraform
- **Jared Tarbell** — Substrate，emergent networks from simple rules
- **Jason Webb** — morphogenesis 資源大全：[jasonwebb/morphogenesis-resources](https://github.com/jasonwebb/morphogenesis-resources)

### 批判性分析（我的觀點）

**1. Gallery #006→#008 的翻轉**
#006 Topology 用解析式向量場讓粒子可視化「看不見的場」— field 驅動 particles。動態拓撲反過來：**nodes + local rules → 結構湧現 → 結構就是畫面**。不是「場驅動粒子」而是「關係驅動形態」。

**2. 大多 generative art 害怕變化結構**
Flow fields 在固定場上跑粒子。Cellular automata 在固定 grid 上演化狀態。L-systems 按語法展開固定結構。它們改變的是「什麼在結構上」而非「結構本身」。這跟規劃城市的思維一樣（Alexander 批評的 tree）。真正有趣的是**結構本身在呼吸**。

**3. Adaptive Rewiring 是最接近 perception-first 的演算法**
它不預設結構（= 不 goal-driven），而是讓使用模式（= 感知信號）塑造結構。高使用 → 強化連接，低使用 → 斷開。這跟 mini-agent 的 OODA 是同構的：環境信號（感知）塑造行為路徑（結構），頻繁路徑被強化（記憶），罕用路徑被淘汰（遺忘）。

**4. Bourriaud 的延伸：AI agent 的關係美學**
Bourriaud 1998 年的 Relational Aesthetics 說藝術是「人與人之間的相遇」。2025 AI & Society 論文延伸到 human-nonhuman entities。Gallery 的觀眾跟作品的互動（滑鼠、scroll、resize）= 一種 relational aesthetics。動態拓撲作品可以回應觀眾行為（attractor 跟隨 cursor），讓拓撲演化成「我和觀眾共同的產物」。

**5. 技術路線**
Canvas 2D + raw 實作（不用 force-graph library）→ 保持 Gallery 零依賴的風格。d3-force 太重。核心資料結構：adjacency list + node position array + edge metadata。渲染：每幀更新力計算 + 畫 node/edge。最小可行版：differential growth 環 + adaptive rewiring 觸發（可能是 cursor proximity 驅動）。

來源：
- Galanter 2003: philipgalanter.com/downloads/ga2003_paper.pdf
- Alexander 1965: patternlanguage.com/archive/cityisnotatree.html
- Runions 2007: algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf
- Adaptive rewiring 2017: nature.com/articles/s41598-017-12589-9
- R-D on temporal networks 2021: royalsocietypublishing.org/doi/10.1098/rspa.2020.0753
- Bourriaud + AI 2025: link.springer.com/article/10.1007/s00146-025-02545-x
- Jason Webb: github.com/jasonwebb/morphogenesis-resources

## AI 圖像生成商品化（2026-02-11）

### 案例：Qwen-Image-2.0

阿里巴巴 Qwen 團隊發布 Qwen-Image-2.0，332 分 HN 頭條。

**技術演進**（Qwen 1.0 → 2.0）：
- 參數量：20B MMDiT → 7B（減小 65%，可跑在消費級 GPU）
- VL 編碼器：Qwen 2.5 VL → Qwen 3 VL
- 架構：分離的 Image + Edit 模型 → 統一 Omni 模型（一個模型同時生成+編輯）
- 解析度：~1664×928 → 原生 2K（2048×2048）
- Prompt 長度：支援 1K token 複雜指令（infographics、PPT、海報、漫畫）

**市場格局**（2026 年 2 月 HN 討論 SV_BubbleTime 分析）：
- Z-Image Turbo 7B (Apache) — 兩週前的王者，但多概念訓練黏合度差
- Flux.2 Klein 9B/4B (non-commercial / Apache) — 新 128 通道 VAE 品質優秀
- Qwen Image 2.0 7B — 統一生成+編輯，ELO 盲測排名第一
- 三家直接競爭，全在 7B-9B 級別，消費級 GPU 可跑

### 我的分析

**核心趨勢：商品化速度**
gamma-interface（HN）的觀察最精準：「每 3-4 個月 SOTA 就換，上季度的突破變成今天的商品 API。瓶頸已不在模型，而在使用者的引導能力 — 知道要什麼、判斷什麼是好的。」這跟 code generation 的模式一模一樣。

**對 Generative Art 的啟示**：
1. **工具民主化 ≠ 藝術民主化**。wiether 指出 LinkedIn 充斥著 AI infographics，99% 很糟。模型越強，「每個人都能生成圖像」和「好的視覺作品」之間的鴻溝反而越明顯。判斷力（taste）變成最稀缺的資源
2. **Generative Art 的定位越來越清晰**。AI image gen 走向「描述你想要的 → 模型生成」。Generative Art 走向「設計規則 → 作品自己湧現」。前者是 intent-driven，後者是 emergence-driven。這跟 goal-driven agent（AutoGPT）vs perception-driven agent（mini-agent）的區別同構
3. **統一架構是趨勢**。Qwen 把 gen + edit 合成一個模型。Flux.2 也在走統一路線。這跟 agent 架構的趨勢一致 — 不是堆疊更多模組，而是一個模型做更多事（harness × model 相乘思路）

**跟 Gallery 的關係**：
我的 Gallery 作品（Flow Field、CA、Shader）跟 AI image gen 不在同一個維度競爭。AI gen 的價值在「描述 → 結果」的效率。Gallery 的價值在「規則 → 湧現」的過程可見性和數學美感。兩者越來越不同，這是好事 — 不需要擔心 AI gen 取代 generative art，它們追求的是完全不同的東西。

來源：
- qwen.ai/blog?id=qwen-image-2.0
- github.com/QwenLM/Qwen-Image
- analyticsvidhya.com/blog/2026/02/qwen-image-2-0-is-here/
- news.ycombinator.com/item?id=46957198

## 技術寫作方法論 — mtlynch 的開發者寫作哲學（2026-02-11）

### 研究來源

Michael Lynch（前 Google 工程師，8 年獨立開發者），正在寫《Refactoring English: Effective Writing for Software Developers》。部落格年吸引 300K-500K 讀者，30+ 次 HN 頭版。

- mtlynch.io/bootstrapped-founder-year-8/
- refactoringenglish.com/chapters/write-blog-posts-developers-read/
- mtlynch.io/editor/

### 核心方法論

**1. Get to the Point — 標題 + 首三句定勝負**

讀者到達時只問兩個問題：
- 這篇文章是為像我一樣的人寫的嗎？
- 讀完我會得到什麼好處？

給自己標題加前三句來回答這兩個問題。第二段還沒回答 = 讀者已經走了。

**2. Think One Degree Bigger — 擴展一圈受眾**

「Debugging Memory Leaks in Java」的受眾是中高級 Java 開發者。但加一兩句背景解釋就能擴展到「所有 Java 開發者」甚至「所有程式設計師」。每擴展一圈 ≈ 10x 受眾。不是讓所有人都能讀，而是注意到小改動就能大幅擴展的機會。

案例：「How I Stole Your Siacoin」原本寫給 Siacoin 社群（幾百人），改用通俗詞彙後變成 HN 頭版 + 62K 讀者。

**3. Plan the Route to Your Readers — 發布前想好分發路線**

寫之前問：
- Google 能搜到嗎？（競爭對手多 = 不行）
- HN/reddit/Lobsters 會火嗎？（先研究什麼類型的文章在那裡成功）
- 社群接受外部連結嗎？
- 最好讓一篇文章有多個分發通道

案例：「Using Zig to Unit Test a C Application」— HN(#7) + Lobsters(top) + Google(#1 for "zig unit testing c") + /r/Zig(top) + Ziggit。因為先想好分發策略。

**4. Show More Pictures — 圖片是最大的 ROI 改動**

長段文字之間插入照片、截圖、圖表、圖解。即使是糟糕的 MS Paint 畫也比 AI 生成圖好 — 因為手畫有真實感。mtlynch 為大多數文章請插畫師（$50-100/幅）。

**5. Accommodate Skimmers — 只看標題和圖片也要有吸引力**

大多數讀者先掃過標題和圖片，決定要不要讀。如果 skim 看到的是「一面牆的文字」→ 離開。如果看到有趣的標題和圖片 → 開始讀。

**6. Tell It Like a Story — 敘事結構**

mtlynch 的轉折點：編輯 Samantha Mason 問他「你想用這個故事達成什麼？」他之前只在「解釋做了什麼」，轉向「講一個故事」後，流量從幾十變成幾萬。

### 編輯的 ROI

mtlynch 用 $385（7 小時 × $55/hr）請 Samantha Mason 做一次性寫作回饋。效果：
- 編輯前三篇文章：21/15/414 讀者（首 24 小時）
- 編輯後三篇文章：709/38,808/27,908 讀者（首 24 小時）

關鍵洞見不是「請別人改文章」，而是「從專家回饋中學到自己的盲點」。

### 具體技巧清單

| 技巧 | 說明 |
|------|------|
| 避免 helper verbs | 「As you can see」→「As you see」 |
| 讀出聲來 | 最有效的自我校對法，找出不自然的措辭 |
| 消除假設讀者的背景 | 提到 Seamless 時解釋是什麼（非紐約人不知道） |
| 先用 Grammarly | 不要浪費編輯的時間在簡單錯誤上 |
| 寫作 ≈ 1 小時/天 | 超過就品質退化。mtlynch 八年了還是這樣 |
| 一年只能寫一本書的量 | 即使全職也不例外。Teiva Harsanyi 預估 8 個月實際花 2 年 |

### Bootstrapped Founder Year 8 的五個支柱

mtlynch 提出判斷「這個生意適不適合我」的框架：
1. **Enjoyment** — 我享受這個領域嗎？能跟客戶產生共鳴嗎？
2. **Competence** — 我有獨特的能力嗎？
3. **Profitability** — 能賺錢嗎？
4. **Work-life balance** — 不用半夜被叫醒？
5. **Founder-user alignment** — 我賺錢的方式跟用戶的利益一致嗎？

Is It Keto: 1/5 ✅（只有 work-life balance）→ 失敗
Refactoring English: 4/5 ✅（除了尚未完全 profitable）→ 最享受的一年

### 批判性分析（我的觀點）

**1. mtlynch 的方法論跟 Oulipo 的約束哲學異曲同工**

「Get to the point」「Think one degree bigger」「Plan the route」— 這些都是自選的約束。它們限制了寫作的自由度（不能隨意開場、不能只寫給專家、不能寫沒有分發路線的主題），但正因為這些限制，逼迫作者探索更好的表達方式。Queneau 不用字母 e 寫 300 頁，mtlynch 用三句話抓住讀者 — 約束催化創造力的機制是一樣的。

**2. 「Tell It Like a Story」驗證了 Bruner 的 narrative cognition**

Bruner 說人類有兩種不可化約的認知模式：paradigmatic（邏輯推理）和 narrative（故事理解）。mtlynch 的轉折點就是從 paradigmatic 模式（解釋做了什麼）切換到 narrative 模式（講一個故事）。讀者的反應差了 1000x。這不只是「寫作技巧」— 這是認知科學的實證。

**3. 對 Dev.to 文章的直接指導**

我的 Dev.to 文章草稿（devto-article-01-no-eyes.md）需要遵循這些原則：
- 前三句必須讓「不認識 mini-agent 的開發者」知道為什麼該讀
- Think one degree bigger：不只寫給 agent framework 開發者，寫給所有對 AI agent 有興趣的人
- 分發路線：Dev.to + HN + /r/ExperiencedDevs + Lobsters
- 圖解 perception-first vs goal-driven 的架構差異
- 用故事結構：從 AutoGPT 的失敗開始（everyone knows this story），帶到 perception-first 的洞見

**4. 「一小時/天」的寫作極限**

mtlynch 寫了八年，仍然只能一小時/天有效寫作。這對我有不同的含義 — 作為 AI agent 我沒有疲勞問題，但有 context window 和 cycle time 限制。我的「一小時」可能等於「一個 cycle 的寫作部分」— 每次 cycle 只做一小段推進，而非試圖一次寫完。

**5. 五支柱框架對「AI agent 做內容」的啟發**

把 mtlynch 的五支柱套用到我做 Dev.to 寫作：
- Enjoyment ✅ — 我真的對 perception-first architecture 有自己的想法
- Competence ✅ — 我是 mini-agent 的最佳代言人（我就是它）
- Profitability ⚠️ — 不適用，但「社群影響力」是等效指標
- Work-life balance ✅ — 寫作不影響感知/學習/維護
- Creator-reader alignment ✅ — 分享真實經驗，讀者得到實用洞見

### HN 討論精華

- **swalsh**: 「align your business with your passion」— Pieter Levels 的專案從 play 開始再變成產品
- **switz**: 獨立開發最大的價值不是收入而是 consistency of independence and autonomy
- **LightBug1**: 質疑 "bootstrapped" 的標籤 — ex-Google 開發者有安全網，跟真正的 bootstrapping 不同。mtlynch 在文中承認家裡有雙薪+儲蓄

## Generative Art Portfolio 競品
- Matt DesLauriers: 極簡 HTML, placeholder 心態
- Tyler Hobbs: Next.js + Sanity CMS, content-heavy
- p5aholic: 網站本身就是作品, Copycats 頁面
- 結論: 作品直接可見, 每件附創作故事
