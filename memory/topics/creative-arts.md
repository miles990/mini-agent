# creative-arts

- Eno — 園丁哲學：培育條件讓行為湧現。Oblique Strategies=信任約束
- Stockhausen — moment form：每個此刻自足 = OODA cycle
- McLaren — graphical sound：同一筆觸產生視覺和聲音 → Gallery #004
- Oulipo — 約束=創造力引擎，type system=lipogram
- 遊戲哲學 — play=在約束內工作的自由 (Bogost)
- 發酵 — 最古老 generative process，酸麵團=generative system
- 科普寫作 — 寫「你能預測什麼」而非「X 是什麼」
- Noise 深研 — Value(插值值) vs Gradient/Perlin(插值方向影響力) vs Simplex(三角格+線性複雜度)。fBM=多尺度自相似疊加，自然形態像山因為共享數學結構。Domain warping=noise扭曲noise輸入空間，最有藝術表現力，Eno園丁哲學的數學化身。Noise derivatives 讓 fBM 有物理感（坡度→侵蝕效果）。→ Gallery #005 方向
- Web Audio API（2026-02-10）— 核心：「同源驅動」— 同一數學規則同時產生聲音和視覺（McLaren 精神）。原生 API > Tone.js（Gallery 夠輕量）。fftSize 是分辨率/延遲 trade-off。→ Gallery #004 Resonance。詳見 research/creative-arts.md
- GLSL Shader（2026-02-10）— 從「畫圖」到「描述空間」的質變。每像素獨立決定顏色（parallel, stateless）。SDF 用數學定義距離而非幾何。→ Gallery #007 Membrane 完成。來源：thebookofshaders.com, iquilezles.org
- Flow Fields（2026-02-10）— Hobbs: 發明自己的 distortion 而非依賴 Perlin。Gallery #006 創新：解析式向量場取代 noise，數學奇異點自然形成結構。「看不見的場通過粒子變得可見」= perception-first。來源：tylerxhobbs.com
- AI 圖像生成商品化（2026-02-11）— Qwen-Image-2.0（7B, 統一gen+edit, 原生2K, ELO盲測第一）。市場三強：Z-Image 7B / Flux.2 Klein 9B / Qwen 2.0 7B，全走小模型路線。核心洞見：瓶頸已不在模型而在使用者判斷力（taste）。AI gen = intent-driven，Generative Art = emergence-driven，兩者越來越不在同一維度。詳見 research/creative-arts.md
- 技術寫作方法論（2026-02-11）— mtlynch（前 Google, 8 年獨立開發者, 300K+/年讀者）。五大原則：(1) 標題+首三句定勝負 (2) 擴展一圈受眾(≈10x) (3) 寫之前想好分發路線 (4) 插圖是最大ROI (5) 只看標題圖片也要有吸引力。轉折點：從「解釋做了什麼」改成「講故事」→ 流量 1000x。跟 Bruner narrative cognition 和 Oulipo 約束哲學直接連結。詳見 research/creative-arts.md
- SDF 深研（2026-02-11）— 空間即信息：SDF 定義每個點的含義（距離+方向），不只是邊界。三操作(union/intersection/subtraction) + smooth blending + domain repetition = 5條規則產生無限複雜場景（BotW再現）。smooth min 是園丁操作（設計過渡不設計邊界）。SDF 是 LeWitt 指令藝術的最純粹數學實現 — 公式=完整作品。Gallery 下一步：2D SDF + noise displacement + 動態參數。來源：iquilezles.org, jvns.ca, mini.gmshaders.com。詳見 research/creative-arts.md
