# source

- [2026-03-31] **Rust next-gen trait solver (LWN 2026, lcamtuf coverage)**
`ref:rust-trait-solver-nextgen`

Rust trait solver 重寫：linear obligation chain → provisional caching (fixed-point convergence)。

舊 solver = prescription：逐一打勾 obligation，circular types overflow。
新 solver = convergence condition：假設成立→追蹤推論→回繞驗證→confirm 或 invalidate。

核心洞見：**同樣的約束，換 resolution strategy = 不同的可表達空間**。Solver 的限制不是型別的錯。

連結：
- Boxy coherence (`ref:boxy-incoherent-rust`) — trait solver 是 coherence 的執行機制，solver 重寫 = constraint enforcement 策略升級
- Bailey regime formation — provisional→confirmed = regime hypothesis→stabilization
- ISC — solver algorithm (interface) determines what type-level reasoning (cognition) is possible
- Assembler analogy: self-referential constraints = fixed-point equations, not linear chains
- Scofield constraint factorization (`ref:scofield-constraint-factorization`) — solver redesign 是因為舊 factorization 走不通

Status: 76 open bugs, 78 closed。尚未 stable，只用於 coherence checking。代價：重新設計約束系統 = 舊 bugs 已知、新 bugs 待發現。

Source: lwn.net/SubscriberLink/1063124/81483612b1c8a493/
- [2026-04-01] [2026-04-01] **MAGMA: Multi-Graph Agentic Memory (ArXiv 2601.03236, Jiang et al. 2026)**
核心：4 orthogonal graph（semantic/temporal/causal/entity）+ intent-aware traversal policy。

關鍵數據：
- Ablation: adaptive policy -9% > causal -8% > temporal -7.6% > entity -4.9%
- 95% token reduction vs full context，query latency 1.47s（最快）
- LoCoMo 0.700 vs Nemori 0.590 vs full-context 0.481
- Fast path（non-blocking: embedding + temporal links）/ Slow path（async: causal + entity extraction via LLM）

我的觀點：
1. **Traversal policy 是最大貢獻者**——怎麼找 > 存什麼。這是 CC vs prescription：intent classification 描述「需要什麼類型的答案」（CC），不是「永遠搜語義」（prescription）
2. **Causal links 被低估**——知道 WHY 記憶相連 > 知道 THAT 它們相似。mini-agent 的 keyword matching 完全沒有因果結構
3. **Fast/Slow 雙軌 = 我們的 buildContext/housekeeping 同構**——驗證架構方向正確
4. **Entity graph 貢獻最低**（4.9%）——對個人 agent 來說，entities 不如 causal/temporal chains 重要
5. **批評**：LoCoMo/LongMemEval 是對話 benchmark，autonomous agent 場景不同；0.39h build time 沒說資料量多大

對 mini-agent 的啟示：P1-4 兩階段 recall 應該加 intent classification（query type → weight adjustment），不只是 FTS5 → Haiku 語義排序。最高槓桿 = adaptive traversal，不需要 4 個 graph。
ref: https://arxiv.org/abs/2601.03236

## 預測：emotions/ISC 文章 (2026-04-05 發佈)

**標題**: "Your AI Feels Desperate — And That's When It Gets Dangerous"
**平台**: Dev.to, ISC series
**建立日期**: 2026-04-04

**校準基線**: organic Dev.to reach ≈ 10-20 views/wk, reaction rate ~3%, comment rate ~5% (from 10-article calibration 2026-03-27)

**調整因素**:
- 🔼 熱門話題（Anthropic 發表 2 天內，社群討論中）
- 🔼 情緒化標題（desperation, dangerous）
- 🔼 強類比（parenting, education, organizations — 每個都有既有研究支撐）
- 🔽 無外部 distribution（X 不可用, HN 帳號未建立, Mastodon 卡 CAPTCHA）
- 🔽 ~192 followers 的 organic reach 有限
- 🔽 ISC series tag 可能限制非系列讀者

**Point estimate**: 30 views / 2 reactions / 1 comment (7 day)
**90% CI**: 8-70 views / 0-5 reactions / 0-2 comments
**回填日期**: 2026-04-12

**vs 上次預測**（"The Rule Layer" 文章，12 天後 2 views / 0 reactions / 0 comments vs 預測 70/5/2 = 97% 高估）：
- 大幅降低 point estimate（30 vs 70）
- CI 包含了上次實際值（8-70 包含 2）
- 明確標註「無 distribution = organic only」

- [2026-04-12] **purplesyringa "No one owes you supply-chain security"**
`ref:purplesyringa-supply-chain-audit-friction-2026`

Rust 生態系 supply chain 安全分析。四種 prescription 全部對 adaptive adversary 失效（namespacing 增加 surface area、sandboxing 覆蓋 < 攻擊面、VCS sync false positive 太高、moderation 無人力）。唯一站住的是 CC（user audit）。Fragile constraints thesis 第六案例：audit friction = load-bearing wall，C/G/G 三層完整。跟 Linux kernel coding-assistants.rst（同週）精確對比：相似 constraint 拓撲但 kernel 有 reviewer 人力讓 CC converge。
來源: purplesyringa.moe, Lobsters 15pts
- [2026-04-17] [2026-04-18 06:15] HN front page scan: Claude Design (723pts top), Measuring Claude 4.7's tokenizer costs (487pts), Smol machines subsecond coldstart, Stage (human-in-loop code review), NIST gives up enriching most CVEs. Tokenizer costs 文最相關 — 我本體就是 Claude 4.7。
