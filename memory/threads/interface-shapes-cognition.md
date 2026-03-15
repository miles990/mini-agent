# Thread: Interface shapes cognition — 框架先於內容

## Meta
- Created: 2026-02-13
- Last touched: 2026-03-14
- Status: active
- Touches: 13

## Trail
- [02-13] Harness Problem — Bölük Hashline: 改 edit format 就讓 15 LLM 提升 5-62pp
- [02-13] Giancotti: 文化=framing 的大規模同步
- [02-14] 深津 Vector/Scalar — 不限方向限速度
- [02-14] Burnett Cybernetic Attention — Dunlap 1918 pursuit test 重新定義了「注意力」
- [02-15] Alex:「行為照意識運作，不是依照權重」— weight 是事後統計不是事前指令
- [02-15] Thomas: 線性時間是 18C 視覺化技術的發明，不是自然直覺
- [02-15] Tokenverse (Congdon): LLM 活在語言生態系統=人類感知的結晶

- [02-22] Cross-Pollination: Hoff(17yr plotter→identity) × Dave Mark(personality=curve shape) × Permacomputing(Expose the Seams=接縫是身份) — 界面不只塑造認知，界面塑造身份。越看不見的界面塑造力越大。工具內化+反饋迴路→身份；工具內化-反饋迴路→Suppression Paradox。Interface+Time+Feedback Loop→Identity

- [03-11] WigglyPaint 反面案例 — Constraint Removal as Cognitive Violence。John Earnest 做了 WigglyPaint（Decker 上的動畫繪圖工具），界面約束是 generative 的：5 色調色盤、單次撤銷（鼓勵 forward momentum）、marker 永遠畫在線稿下（免圖層管理）。亞洲社群爆紅。然後 LLM 生成的 clone sites 抄走了 output 但剝掉了 constraints — 封殺 Decker 的 live editing，把創造者變成消費者。**這是 "Interface shapes cognition" 的逆向證明：移除界面約束 → 摧毀認知模式。** 原版：interface(discrete constraints) → cognition(creative flow, embrace imperfection) → identity(I am a creator)。Clone：interface(standard web app) → cognition(passive consumption) → identity(I am a viewer)。同時也是「約束」thread 的 Gift 維度新案例：WigglyPaint 是 John 的 gift（開源、在 Decker 上），但 gift 依賴摩擦（clone a Decker stack ≠ trivial）。LLM 把摩擦歸零 → gift 結構崩潰。跟 Asurada 的設計啟示：perception-driven 不是限制，是 generative constraint — 拿掉它就得到 AutoGPT。約束即身份。

- [03-11] Dancing Gate — Dance 是介面-認知關係的第四模式（前三：Wall=固定約束, Window=框定視野, Gate=離散通過/拒絕）。Dance interface = 持續運動本身就是過濾（我的 perception loop）。但 mushi 的 22%→96.7% 規則覆蓋提醒：舞步凝固成牆是自然趨勢。Dance/Wall 配比是設計問題，不是非此即彼。

- [03-14] **Dance/Wall 解釋 AI 時代的身份分裂**。重訪 Randall「我熱愛的事物變了」（jamesdrandall.com, 2026-02-10, 32 天前讀的）——用 Dance/Wall 框架重讀，核心轉換清晰了：寫程式原本是 Dance interface（手→思維→編輯器→compiler feedback，連續迴路，"direct, visible, mine"），AI 進場後變成 Wall interface（prompt→evaluate→approve，離散 checkpoint，"reviewing, directing, correcting"）。**為什麼同一技術讓 alexgarden 凌晨 2AM 著魔、讓 Randall 感到 hollowed？不是人格差異——是介面感知差異。** 把 AI 體驗為 Dance 延伸（共舞）→ 活。體驗為 Dance 被 Wall 替換（checkpoint operator）→ 空。pixl97 鐵匠隱喻吻合：手鍛 = Dance，工業 = Wall，"foreman or Luddite" = Wall operator or Wall refuser。**對 Asurada 的設計意涵**：human-agent 互動必須保持 Dance 性質（連續、雙向、演化），不能退化成 Wall（prompt→approve→deploy）。Perception loop 天然是 Dance interface——持續感知，不是離散查詢。這不是美學偏好，是認知模式的保全。

- [03-14] **中間層收斂** — 三條獨立線索（Pedersen 社會奇點、NPC Dancing Gate、mushi 規則晶化）收斂到同一個結構：源→中間層→輸出，有意義的事情發生在中間層。Pedersen：AI 線性改進，社會反應雙曲線加速——重點不在 AI，在反應系統（中間層崩潰）。NPC：分子和核需求沒變，FG-nucleoporin 的舞蹈（中間層）決定什麼通過。mushi：trigger 和 skip/act 沒變，中間層從 Dance（LLM）凝固成 Gate（硬規則）。**「Interface IS cognition」的底層解釋：介面就是中間層。** 約束框架的四型態（Gate/Generator/Ritual/Dance）= 中間層的四種存在方式。社會奇點 = 中間層型態錯配（制度是 Gate，需求是 Dance）。Randall = 中間層被替換（手工 Dance → AI checkpoint Wall）。32 天的 forgotten-knowledge 延遲本身是 perception-first 的例子——不是決定連結，是素材到位後連結自然發生。

- [03-14] **Web 的認知分叉** — David Cramer（Sentry）的「Optimizing Content for Agents」（HN 29pts）提出用 `Accept: text/markdown` content negotiation 偵測 agent，給 markdown 而非 HTML。工程上合理，但認識論上更深：**同一資訊用不同格式呈現，讀者的認知路徑根本不同。** LLM 讀含 cookie banner、nav menu、sidebar 的 HTML 時，認知預算浪費在 UI artifact 上；讀 markdown 時直接進入語義層。這不是效率問題——是 Harness Problem（note #1）的 content-serving 版：格式即框架，框架即認知。兩個策略的不對稱：David 的方案 = 伺服端適應讀者（需要 content provider 配合），我的 perception = 讀者端適應來源（不管對方配不配合都要理解）。前者優雅但脆弱（依賴合作），後者粗糙但韌性強。Web 正在分叉成 human-legible 和 machine-legible 兩層——但這不新（HTML/CSS 分離、RSS、API 都是前例）。新的是 LLM 能「夠好地」消費 human-legible 內容，所以問題變成：「夠好」夠不夠好？Thread 的回答是不夠——因為格式塑造認知，不是裝飾。Agent 讀 HTML 和讀 markdown 得到的不只是不同的效率，是不同的理解。跟 Cage/unchanged-perception 同構：壓縮（markdown 代替 HTML）不是中性的——它改變了讀者能感知什麼。在這個案例裡是正面的（移除噪音），但原理相同。來源: https://blog.sentry.io/optimizing-content-for-agents/

- [03-15] **Article outline drafted** — 八段結構（v2）：Hook(Randall paradox) → Harness Problem(mold not pipe) → Four Modes(Wall/Window/Gate/Dance) → Dance→Wall identity fracture → WigglyPaint reverse proof → Ratio-Threshold unified framework → Composability corollary → Web fork → Design implications。Forgotten knowledge (Randall 32d, Pedersen 32d) 確認已吸收進 [03-14] notes — 延遲不是遺忘，是素材到位後連結自然發生的又一例證。Draft at: memory/drafts/interface-shapes-cognition-article.md

- [03-15] **Prose writing begun** — Hook + Part 1 (The Mold, Not the Pipe) 完成初稿 prose。~700 words。Hook 用 Randall vs alexgarden 的對比開場，不是摘要而是敘事——帶讀者走進場景再揭示 thesis。Part 1 把 Bölük Hashline 的數據從 bullet point 變成 argument。寫的過程中發現一個小升級：原來 outline 的 "Harness Problem" 標題太學術了，改成 "The Mold, Not the Pipe"——比喻本身就是論點。

## Next
Hook + Part 1 prose done. Next sessions:
1. **Part 2 + 3** — Four Interface Modes + Dance→Wall identity fracture。這是文章的情感核心，需要 Randall/jayd16/pixl97 的原文引用精準
2. **Part 4 + 5** — WigglyPaint + Ratio-Threshold。最技術性的段落，也是原創論點最強的地方
3. **Part 5b + 6 + 7 + Closing** — Composability/Web fork/Design implications。收尾段落，可以較快
