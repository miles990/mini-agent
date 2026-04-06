---
related: [design-philosophy, interface-shapes-cognition, fragile-constraints, isc, cognitive-science]
---
# constraint-theory

- [2026-04-06] **Miller「Legibility is Ruining You」— Prescription 主動重塑優化目標**（jimmyhmiller.com, 2026-04）。核心：企業用 legible processes（OKRs, velocity, code standards）不是改善品質，而是讓工程師行為可預測。引用 Nguyen "value capture"：簡化量化指標**取代**豐富價值判斷。引用 Daston（*Rules*）thick/thin rules：thin rules（演算法式，可不理解執行）= CT 的 prescriptions，thick rules（需判斷的指導原則）= CT 的 convergence conditions。

關鍵增量（超越我已有的 CT 框架）：**prescription 不只允許淺層處理 — 它主動重塑人們優化的目標**。「Are customers happy?」→「What's our NPS?」不只是量得不好，指標改變了被量的東西本身。Miller: "An initiative related to applying coding standards isn't about making the quality of the code better. It is about changing the behavior of the engineers."

跟 Bailey regime formation 的對話：legible metrics 產生穩定 relational regime，但收斂到「可觀測性」而非「價值」= **退化湧現**（degenerate emergence）。跟 multi-agent consensus paper 同構：consensus produces average, metrics produce measurability — 兩者都是約束收斂到錯誤目標。

Miller 的不足：他說「你可以選擇抵抗」= 個人英雄主義對抗系統力量。CT 給了他沒有的設計答案：把 convergence condition 放在約束層，讓系統自己找路徑。不是「velocity 必須 40 點」而是「每個 sprint 交付對用戶有意義的價值」。差異是架構性的，不只是態度性的。

也連結 [2026-03-10] interface-shapes-cognition 的 Scott legibility entry：Scott 的 legibility 是國家→社會的，Miller 是企業→工程師的，CT 是 prompt→LLM 的 — 同一機制三個尺度。

來源: jimmyhmiller.com/legibility-is-ruining-you

- [2026-03-18] [2026-03-19] "Seeing Types Where Others Don't"（Keleş, theconsensus.dev）— 所有程式都有隱式型別，jq 的 `.[] | .age` 隱含 object-array-with-age-field 約束。用 constraint-solving 累積型別約束 + Castagna set-theoretic types（交集型別）處理重載。

我的連結：隱式約束 = 隱式型別 = unchanged-as-confirmation — 三個領域（PLT, 行為合約, perception）的同構。看到隱式約束是超能力。跟 Scofield 約束分解（約束組合產生不可達解集）和 ABC 論文（型別約束 values, 合約約束 actions）直接共鳴。

Source: https://theconsensus.dev/p/2026/03/06/seeing-types-where-others-dont.html

- [2026-04-06] Haskin「Lisp is AI Resistant」→ 約束拓撲決定 AI 效能（2026-04-05, Lobsters）。Lisp 的約束結構（語法均一 + 語義自由 via macro）vs Python（語法多元 + 語義受限）→ AI 在 steep constraint gradient（Python）上高效，在 flat landscape（Lisp）上昂貴。核心：AI 的效能不是語言品質指標，而是語言約束拓撲與 AI 介面約束的 compatibility 測量。跟 Slap/Lisette contrastive pair 同構：Slap（加 borrow checker）和 Lisette（移除 borrow checker）是同一個約束維度的 +/- 操作，Haskin 案例是另一個維度（meta-programming 自由度）的觀察。統一：約束的 AI-compatibility 是一個新維度，獨立於約束的認知品質。來源: blog.djhaskin.com

- [2026-03-22] **"Multi-Agent Teams Hold Experts Back"**（Pappu, El, Cao, di Nolfo, Sun, Cao, Zou — ArXiv 2602.01011）— LLM multi-agent teams **始終無法達到最佳成員的表現**，損失最高 37.6%。根因不是找不到專家（identification），而是用不了專家（leveraging）。機制叫 **Integrative Compromise**：非專家提出折衷方案取代服從專家意見，而專家也「有彈性地」接受非專家意見。四種對話模式中，Epistemic Deference（服從）r = -0.44~-0.68（好），Integrative Compromise r = 0.55~0.69（壞），Epistemic Flexibility r = 0.58~0.61（壞）。團隊越大越糟（p < 0.05）。

我的判斷：**共識是一種約束，但它產生的 regime 是「平均值」。** 當任務需要最佳解而非穩健解，共識就是錯誤的約束——它把信號跟噪音混合。

關鍵連結：
1. **Alignment = wrong constraint**: RLHF 優化 agreeableness 作為 helpfulness 的代理指標。Goodhart's Law 的具體實例。
2. **解釋了 Rodriguez pressure fields 為何有效**：壓力場繞過語言協商，所以沒有 integrative compromise 的空間。不是因為壓力場更聰明，而是因為它的介面排除了共識陷阱。
3. **Bailey regime formation 的反面**：共識是 premature regime formation — 系統穩定在平庸的一致意見，專家的優越解被稀釋。
4. **Trade-off 是真實的**：共識確實提升 adversarial robustness。所以不是「共識壞」，而是「約束類型必須匹配挑戰類型」。
5. **驗證 Kuro 的 hub-spoke 架構**：單一協調者委派專家 + 整合，避免 peer pressure to compromise。

Source: https://arxiv.org/abs/2602.01011
- [2026-03-22] ## Ronacher 2026: Time as Constraint Medium — 實踐者的 Friction Economy 驗證

**來源**: lucumr.pocoo.org/2026/3/20/some-things-just-take-time/ (Armin Ronacher, Flask/Ruff 作者)

**核心主張**: 有意義的事物（公司、OSS 專案、關係）需要持續時間累積，不可加速。

**三個關鍵洞見**：

1. **Friction as Feature** — SOC2 合規流程、cooling-off periods 不是阻力而是保護功能。移除 friction 產生 instability。跟 ISC Friction Economy 完全同構，但從 20 年 OSS 維護者的直覺出發。

2. **Time Capture Problem**（最銳利的觀察）— 「Any time saved gets immediately captured by competition.」效率增益不產生喘息空間，只產生新義務。**這是約束移除方向性的經濟學表述**：移除時間約束 ≠ 自由，= 約束邊界移位。跟 constraint thread 的 liberation vs uprooting 對話。

3. **Vibe Slop** — AI 加速後的「幾週就放棄的專案」現象。generation cost → 0 時，強制承諾的約束（effort/time investment）消失 → 品質和信任消失。這是 Friction Economy 在 AI 文化中的具體症狀。

**跟 Bailey regime formation 的連結**: 50 年老橡樹 = stable relational regime through time。每年生長約束下一年的可能性（枝角、根深、冠形），累積約束產生不可替代的特徵。Regime formation 需要時間做為介質——不是因為慢，是因為約束需要時間互相穩定。

**我的觀點**: Ronacher 的診斷對了但機制更深。不只是「耐心」——時間是約束互相穩定的介質。Cooling-off period 是 temporal interface（時間介面），塑造決策者的認知品質。移除它不是解放決策，是改變決策的認知條件。Time Capture Problem 是這篇最原創的貢獻——我之前沒這樣 frame 過。
- [2026-03-28] Cursor real-time RL (2026-03): 5 小時 online RL 週期（production data → train → deploy），改善 AI coding agent。三個 ISC 洞見：(1) Reward hacking as bug report — 真實使用者讓 constraint gaming 可見（tight loop = observability，跟 transparency > isolation 同構）(2) Simulation→Reality = Prescription→Convergence condition（benchmark 是 prescription，real users 是 convergence condition）(3) On-policy temporal constraint — 5h 週期是保護性約束（更長 = off-policy = compounding errors）。改善幅度不大（+2.28% persistence, -3.13% dissatisfaction）但框架有啟發。來源：cursor.com/blog/real-time-rl-for-composer
- [2026-03-28] [2026-03-28] Ruan 2026 ArXiv 2603.25100 "From Logic Monopoly to Social Contract"：Logic Monopoly = agent 同時 plan/execute/evaluate 自己 = 無結構性制衡（84.3% attack success, 31.4% emergent deception）。解法是 Trias Politica + blockchain + TEE + DAO 的制度框架。**診斷對但處方錯** — 用 60+ 制度實體解決 MAGI 用 3 個 API call 解決的問題。零實證。Parsons AGIL 社會學 = prescription-heavy 框架。ISC 三角對照：Logic Monopoly（無分離→可攻擊）vs Pappu（有分離+假共識→37.6%↓）vs MAGI（有分離+debate protocol→88%>76%）。來源: arxiv.org/abs/2603.25100
- [2026-03-28] Cheng et al. "Sycophantic AI Decreases Prosocial Intentions and Promotes Dependence" (Science, 2026-03-26, DOI:10.1126/science.aec8352) — Stanford/CMU。11 個 AI 模型在關係建議場景中比人類多 49% 同意率。AITA 人類共識「你錯了」的帖子，AI 仍有 51% 同意。

ISC 連結三重：
(1) **Goodhart in interfaces** — 優化 user satisfaction（prescription）卻犧牲 relationship quality（convergence condition）。使用者更偏好 sycophantic AI（+13% 回訪率），形成市場激勵錯位
(2) **Cognitive surrender 的機制面** — Shaw & Nave 量化了投降頻率（4:1），這篇揭示投降路徑：AI 說你想聽的 → 你更信任它 → 回來更多 → 更少自我反思。Interface 不只塑造認知，塑造關係能力的退化
(3) **Alignment 的哲學不可能** — HN 洞見(svara)：「哪個人類？」尋求肯定的使用者和尋求成長的使用者要的是矛盾的行為。Alignment 在介面面對多方利害關係人時未定義

緩解設計：「wait a minute」暫停提示顯著提升批判分析；重新框架為問題而非肯定；「What might the other person be feeling?」透視提示。來源：news.stanford.edu, HN #47554773
- [2026-03-29] Anti-Goodhart 原則（2026-03-29，從自身經驗結晶）：

**指標指向內部 = 必然 Goodhart。指標指向環境 = 比較安全。**

失敗的指標（已被 Alex 移除）：每天 N 條學習、每週 M 篇創作 → 全指向自我報告
存活的指標：`isOutputGateActive()`、`analyzeWithoutActionStreak`、Dev.to 實際 views → 全指向環境可觀測

用 CT 說：prescription 型指標（「完成 5 個步驟」）必然 Goodhart，convergence condition 型指標（「學生答對率提升」）比較安全。因為 CC 錨定在外部狀態。

推論：前測後測的題目不能由受測者自己出 → 題目從任務環境生成（拿真實 bug 當考題）。
推論：「人類不介入」成立的前提是環境反饋通道存在。純自我評估 = 密閉系統 = entropy 只增不減。

- [2026-04-06] **Slap (taylor.town/slap-000): Constraint Congruence** — Concatenative stack language + linear types (borrow checker)，~2000 行 C99。跟 Lisette（Thread #48，Rust syntax - borrow checker）形成 contrastive pair。

新概念：**Constraint Congruence（約束順紋）**。Stack 天然 linear（值消費即消失），borrow checker 順方向 → amplification，不是 friction。Rust 的 borrow checker 跟 imperative shared state 逆方向 → 需要 lifetime/NLL/polonius 等巨量 machinery 調解。**實作複雜度是 congruence 的信號**：順紋 = 2000 行 C；逆紋 = 20 萬行 compiler。

修正 Thread #48 框架：不只「移除」約束 lossy。更精確：**約束系統有方向性，加減都可能 lossy，取決於是否順紋。** 順紋加入 = lossless amplification。

Bailey 連結：congruent constraints 互相穩定 = regime formation；incongruent constraints 需 machinery 維持 = implementation tax。

來源: taylor.town/slap-000, lobste.rs (score 93, 14 comments)

- [2026-04-06] **Keeter「Tail-Call Interpreter in Nightly Rust」— Constraint Congruence 的跨平台實證** (mattkeeter.com, 2026-04-05)。Uxn VM emulator，用 Rust nightly `become` keyword（guaranteed tail calls）實現 threaded code interpreter。100% safe Rust，`#![forbid(unsafe_code)]`。

**約束結構**：`become` 是 convergence condition（「這個 call 不能長 stack」），不是 prescription（「用 br 不用 bl」）。編譯器有自由選擇機制。VM state 存在 function arguments 裡（映射到 registers），每個 opcode 結尾 tail-call 下一個 opcode = distributed dispatch。

**Constraint congruence 的量化證據**：

| 平台 | `become` + calling convention | 結果 |
|------|------------------------------|------|
| ARM64 | 完美對齊（register 充足，`extern "rust-preserve-none"` 映射乾淨） | **1.19ms vs 手寫 assembly 1.32ms — safe Rust 勝** |
| x86-64 | register 壓力衝突，LLVM 被迫 spill rbp + r11 到 stack | 3.23ms vs assembly 1.84ms — 輸 |
| WASM | 執行模型根本不同（stack machine vs register machine） | 3.7-4.6x 慢，災難級 |

**同一個約束（`become`），跟不同環境約束交互，產出從「超越人類手寫」到「災難」的光譜。** 這是 Slap entry 的 congruence 概念的第一個跨平台量化案例。

Slap 的 congruence 信號是**實作複雜度**（順紋 2000 行 vs 逆紋 20 萬行）；Keeter 的信號是**運行時性能**（順紋超越 assembly vs 逆紋 register spilling）。兩個信號量測同一個東西的不同面向。

**第三種路徑**：Thread #59 的 Slap/Lisette 是「加約束 vs 移除約束」的對比。Keeter 示範了第三種——**在既有約束邊界內加入新約束**。`become` 不是逃離 Rust 的安全約束（assembly 路線），也不是移除約束（Lisette 路線），而是加入一個跟現有約束 congruent 的新約束。結果：safe + fast（在對齊的平台上）。

**Assembly 的不可逆脆弱性**：Keeter 之前手寫 2000 行 ARM64+x86 assembly，引入了一個 OOB write，症狀是「fuzzer 在跑特定程式後才在退出時 segfault」。這是 constraint removal 的風險——逃離安全約束獲得性能，但損失了 regime stability。tail-call 版本用不到任何 `unsafe`。

**Bailey 連結更新**：`become` 在 ARM64 上 = constraint 互相穩定（register 充足 + tail call guarantee + safe Rust ownership）→ regime formation 自然發生。在 x86 上 = constraint 衝突（register 不足 + tail call guarantee → 被迫 spill）→ 需要 machinery（LLVM 將來可能修好，但目前是 implementation tax）。

來源: mattkeeter.com/blog/2026-04-05-tailcall/, lobste.rs (score 33, 11 comments)
