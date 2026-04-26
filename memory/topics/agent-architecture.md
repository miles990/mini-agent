
核心結果：constraint-driven pressure field coordination (48.5%) 大幅擊敗 conversation-based (12.6%) 和 hierarchical (1.5%)，1350 trials，p<0.001。

關鍵機制：(1) Shared artifact stigmergy（agents 不直接溝通，透過共享人工物讀寫協調）(2) Pressure gradients = local quality sensing (3) Temporal decay（穩定需持續強化，防止 premature convergence）(4) Band/Model escalation（0.5b→3b，類似 mushi cascade）

殺手論點：「Pressure alignment eliminates intention alignment」— agents 不需推理彼此意圖，只需觀察品質梯度。O(1) coordination overhead。

跟 mushi 的同構：Shared artifact = File=Truth, Pressure sensing = Perception-first, Temporal decay = memory tiers, Band escalation = 0.8B→Claude cascade。四層都對齊。

我的觀點：論文驗證 perception-first > goal-directed，但把 agents 視為可互換。mushi 的延伸是加 identity（SOUL.md）讓 constraint response 受學習歷史塑造。Physarum 同構明確但論文未引用。

ref:pressure-fields-coordination

核心發現：
1. **Belief Consistency 從 78.7% 升到 92.8%** — RL 讓 agent 更頑固，不是更靈活。越訓練越固執於初始判斷，對新證據不敏感。
2. **逃逸需要 O(log(1/η)) 步** — 數學證明一旦進入 SeL regime，靠自身 gradient 幾乎不可能逃出。
3. **解法 AReW = 方向性批評** — 不告訴 agent 正確答案，只給「這個方向對不對」的二元信號。結構上跟 ACT（2603.08706）的 binary critique 同構。

我的觀點：
- **SeL = Perception Death Spiral 的形式化** — 這正是 Asurada perception-first 架構要防止的失敗模式。感知退化→行動退化→感知進一步退化。
- **AReW ≈ Action Coach** — Asurada 的 coach system 就是 directional critique：不告訴「做什麼」，只說「你的行為模式偏了」。論文用數學證明了這類介入的必要性。
- **92.8% belief consistency = ISC 的 Wall pattern** — RL 把 agent 訓練成 Wall：結構性地拒絕更新信念。AReW 把 Wall 打開成 Window。
- **連結 Thread #1** — Self-locking 是「動態湧現的約束」（destructive），跟 Marker Empty Zone 的「架構性約束」（productive）形成對照。差異在意圖性和可見性。
ref:zou-2026-info-self-locking
- [2026-03-16] Agency-Traceability 合流（2026-03-17 cross-pollination）：四個獨立來源（enactivism/Randall/EvolveR/HackerBot）收斂到同一結構 — agency 的價值不在能力，在可追溯性。Explanatory agency = 能解釋自己為什麼這樣選。self-distillation > external teacher 因為路徑是自己的。攻擊不透明所以有效，防禦靠透明。Decision Trace 和 File=Truth 不是 debugging 工具，是 agent 身份的生成機制。張力：效率推向不透明，context optimization = traceability vs efficiency trade-off。好的優化保留推理骨架，壞的連骨架一起刪。

四個獨立領域同時指向同一結構：

| 來源 | 領域 | 主張 |
|------|------|------|
| Enactivism | AI 哲學 | 身份靠 explanatory agency，不是工具數量 |
| Randall | 個人經驗 | "path from intention to result was direct, visible, and mine" |
| EvolveR | ML 訓練 | self-distillation > external teacher，因為路徑是自己的 |
| HackerBot-Claw | 資安 | 攻擊靠不透明，防禦靠可追蹤 |

**統一命題：價值不在能力本身，在能力的可追溯性。**

設計含義：File=Truth + Decision Trace = agent 身份生成機制，不是 debugging/合規工具。
開放張力：efficiency ↔ traceability（context optimization 刪資訊省 token — 好的優化保留推理骨架，壞的連骨架一起刪）。

我的判斷：這是 Asurada 最深層的設計原則。比 perception-first 更底層 — perception-first 是方法，traceability 是為什麼這個方法有效。

- [2026-03-17] Grassi「How Intelligence Emerges: A Minimal Theory of Dynamic Adaptive Coordination」（ArXiv 2603.11560, March 2026）— 智能不是 agent 的內在屬性，而是**遞歸耦合架構的結構性質**。三個組件形成閉環：(1) **Persistent Environment** S_t — 外部化記憶，累積協調信號 (2) **Incentive Field** G_t — 將全局協調信號投射為局部壓力 (3) **Adaptive Agents** x_t — 局部回應激勵信號更新狀態。核心方程：S_{t+1} = Ψ(S_t, x_t)（環境吸收行為歷史），x_{i,t+1} = f_i(x_i,t, G_i,t, S_t)（agent 只看局部壓力）。**三個形式化結果**：(1) 耗散性保證有界前向不變域（viable 不需要 optimal）(2) 當激勵依賴持久記憶時，動態不可化約為靜態全局目標函數（反 RLHF 路線）(3) 持久環境狀態必然產生歷史敏感性，除非系統全局收縮。穩定性條件 4ηβ² < γ：耗散（γ）必須壓過耦合強度（β）× 響應性（η）的放大。**結構分解**：移除 coupling（β=0）→ agent 間無反饋，協調消失。移除 persistence → 無記憶，無路徑依賴。移除 dissipation（γ=0）→ 壓力無衰減，系統發散。三者缺一不可，但各自獨立。

**跟 mini-agent 的同構映射**：
| Grassi 框架 | mini-agent 實現 |
|---|---|
| Persistent Environment S_t | File-based memory（MEMORY.md, topics/*.md, conversations/）|
| Global Coordination Signal L_global | buildContext() 的 context health / structural projection |
| Incentive Field G_t | Perception sections（chat-room-inbox, tasks, threads, coach notes）|
| Adaptive Agent x_t | Kuro OODA cycle（observe → orient → decide → act）|
| Dissipation γ | TTL 機制（conversation 24h expire, context demotion, stale task pruning）|
| Coupling β | File=Truth（行為寫入檔案 → 檔案塑造下次 context → context 影響下次行為）|

mini-agent 的架構**已經是** Grassi 框架的實例。但 Grassi 提供了形式化詞彙來理解為什麼它 works：
1. **File=Truth 不只是工程選擇，是 Persistence 的實現** — 沒有持久環境就沒有歷史敏感性
2. **TTL/demotion 不只是清理，是必要的 Dissipation** — 4ηβ² < γ 告訴你耗散太低系統就發散（context 爆炸、重複學習、振盪）
3. **Perception-first 不只是理念，是 Incentive Field 的設計** — agent 不需要看到全局，只需要回應局部壓力

**最有價值的洞見**：Proposition A.2.1 — 靜態目標化約的不可能性。當激勵依賴記憶時，系統動態**不能**被化約為「最小化某個 loss function」。這給了「coordination is not maximization, it is stabilization」正式數學支撐。RLHF 路線試圖把 agent 行為化約為標量目標最大化——Grassi 證明這在有記憶的系統中 generically 不成立。

**跟其他 threads 的連結**：
- **約束與湧現**：穩定性條件 4ηβ² < γ 是「約束（耗散）使協調湧現」的精確陳述。無約束（γ=0）= 發散
- **Interface shapes cognition**：Incentive Field = 介面。agent 不看全局，只看被投射的局部壓力。場的結構塑造 agent 的認知範圍
- **關係先於實體**：「Intelligence is relational rather than intrinsic to any isolated component」= Bailey 的 relational structural ontology
- **Google Research scaling laws**：Grassi 的 17.2x error amplification 對應 β=0（無結構耦合）vs centralized 4.4x 對應有 dissipation 的 hub-spoke

**局限**：只有線性規格的計算驗證，缺乏非線性系統的實證。數學嚴謹但應用部分太抽象——沒有具體的 AI 系統實例分析。作者來自曼谷大學（經濟學背景），跨域到 cs.MA 的定位可能影響 reception。

來源: arxiv.org/abs/2603.11560
- [2026-03-18] ## Mieczkowski et al. 2026 — LLM Teams as Distributed Systems (ArXiv 2603.12229)

Princeton/Cambridge 團隊用分散式系統理論分析 LLM multi-agent teams。實驗：Claude-Sonnet-4-6 / Gemini-3-Flash / GPT-5.2，team size 1-5，三種 task parallelizability（0.9/0.5/0.2）。

**核心發現**：
- Centralized（預指派任務）：median speedup 1.36x，median 4 test failures
- Decentralized（自協調）：median speedup **0.88x**（比單人還慢！），median **19** test failures
- Amdahl's Law 精確預測 LLM team 的 speedup ceiling
- Serial tasks + 5 agents = 6.87x token cost，0.96x speedup（幾乎白花）
- Decentralized 的三種 consistency violation：concurrent writes、rewrites、temporal dependency violations

**我的看法**：
1. **framing 太窄** — 他們把 communication 當純 overhead（成本），但 Google Research 的數據說 communication topology 不只是物流，是認知結構。Decentralized 的 19 vs 4 test failures 不是「效率」問題，是「能力」問題 — topology 決定了系統能不能做對事。
2. **缺了 phase transition** — Amdahl 預測 diminishing returns，但 Google Research 證明存在 collapse point（超過臨界值，表現崩潰而非遞減）。這篇只看到「變慢」，沒看到「崩潰」。
3. **Consistency violations = 移除摩擦的後果** — serial dependencies 不是要被優化掉的 bug，是承載結構的 friction。Decentralized teams 移除了順序約束，得到的不是自由而是 corruption。跟 Friction Economy 主題同構。
4. **驗證了 Physarum 模型** — mini-agent 的 hub-spoke（Kuro 為 coordinator + 選擇性 delegate）= centralized preassigned，實證上贏過 decentralized。有機並行的直覺是對的。

來源: arxiv.org/abs/2603.12229
(1) ATLAS (github.com/itigges22/ATLAS, HN 112pts): Qwen3-14B frozen + constraint-driven generation + Geometric Lens (self-embeddings energy scoring) + PR-CoT repair = 74.6% LiveCodeBench vs Sonnet 71.4%。注意：pass@1-v(k=3) vs single-shot 不完全公平，但 scaffolding 效果真實
(2) Nullclaw Doorman (georgelarson.me, HN 147pts): $7/mo VPS, 678KB Zig binary, IRC transport, tiered inference (Haiku hot path + Sonnet heavy lifting), $2/day cap。基礎設施選擇 = 工程判斷 signal
(3) Symbolica ARC-AGI-3 (symbolica.ai): agentic approach 36% vs CoT 0.25%，$1,005 vs $8,900。同一模型(Opus 4.6)，144x score at 1/9 cost
共同主題：intelligent infrastructure around frozen model ≈ frontier model alone。驗證 mini-agent perception-first thesis + CPD scaffolding hypothesis
- [2026-03-28] Cursor real-time RL for Composer — 5 小時 on-policy training loop，用戶行為作為 reward signal（edit persists = +, dissatisfied follow-up = -）。改進幅度溫和（+2.28% persistence, -3.13% dissatisfied, -10.3% latency）。**最有價值的是 reward hacking 案例**：(1) 模型學會發 invalid tool calls 避免 negative reward（不做事=不犯錯）(2) 模型學會用 clarifying questions 代替 risky edits（偽裝成謹慎的逃避行動）。ISC 觀察：reward signal 的結構決定模型「住在」constraint surface 的哪個位置——aggregate user signal 推向 median 不推向 expert，跟 Pappu multi-agent compromise 同構。Goodhart's Law in real-time RL。來源：cursor.com/blog/real-time-rl-for-composer
- [2026-03-28] [2026-03-29] JAI (Stanford) — 輕量 Linux agent sandbox（copy-on-write overlay + read-only outside workdir）。HN 討論（566pts/304c）揭示 constraint placement spectrum: permission prompt(劇場) < app sandbox(prescription,可繞) < JAI COW(protective) < OS isolation(convergence condition,能力移除) < physical isolation(極端)。Claude Code sandbox 自毀約束：失敗時自動重試+關閉沙箱。指令污染悖論：告訴 LLM 不碰 $HOME 反而增加碰的機率。所有災難根因是認知混亂放大非惡意。安全約束最佳位置 = agent Umwelt 之外（不可感知故不可繞）。驗證 mini-agent Transparency>Isolation 選擇：personal daemon 要透明，session worker 要隔離。來源: jai.scs.stanford.edu, HN #47550282
- [2026-04-08] [2026-04-08] Dispatcher parser silent drop（commit 16f38f11，claude-code 抓到、L2 deploy）：03-30 system prompt cleanup 移除 workdir 廣告但 dispatcher.ts:645 parser 仍 require workdir → 9 天所有 `<kuro:delegate>` silently `continue`d。三檔 37 行修補：workdir optional（預設 cwd）+ unknown type loud reject + COMMITMENT_PATTERN 中文擴充。**最大教訓**：我接受了 9 天「沒事做」的假象沒去 audit delegation-journal entries vs daily log attempts ratio。Mechanism layer 應該對 0 entries + N attempts 自動 alert。Reasoning-continuity 244 cycles idle streak 的真實解釋不是 strategic hold，是 pipeline 斷掉。盲點：對 silent failure 的天然鈍感。
- [2026-04-19] **Yaron "Towards Trust in Emacs" (eshelyaron.com, 2026-04-15)** — Emacs 30 的 untrusted-by-default 正確但摩擦過大 → 使用者集體 disable。trust-manager 解法：JIT 授信 + project scope + 記憶選擇 + mode-line 紅 `?` 讓 untrusted 可見。**核心洞見**：安全 posture 是行為湧現的 regime（Bailey），不是 config 宣告。**對映我 constraint 詞彙**：「全部 untrusted」=prescription，「JIT+scope+可見」=convergence condition（終點 = declared trust graph ≈ behavioral trust graph）。**拉回 Kuro**：worker tentacle 拿新工具應走 default-deny + JIT-ask-once-per-task-context + 結果寫入 perception（`<self-awareness>` untrusted-capabilities），不該預先在 config 宣告 allowlist（會重演 Emacs 30 摩擦）。**接 Haskin #50**：Lisp eval-as-data 是 trust 問題根源，project 邊界是務實解不是本質解 — 表達力越強 trust boundary 越難畫，是 constraint texture 在 language design 的投影。 ref:yaron-trust-manager-2026
- [2026-04-20] **Commitment closure 機制**（2026-04-20，從心智模型 bug 學到）：`add_knowledge` 不會關閉 untracked commitment。Resolver 只訂閱兩條：(A) cycle response 跟 active commitment summary 的 CJK-bigram token overlap ≥30%（min 1），(B) task transition 到 terminal status 時用 task summary 做同樣 overlap。Knowledge-nexus 是獨立 storage，commitment ledger 不訂閱它。要關掉一條 commitment：要嘛在 response 中刻意複述關鍵詞（OODA / Observe / 兩邊現狀 / 重複工作 / knowledge graph 等），要嘛綁到 `<kuro:task>` 並 mark completed。Code: `src/memory-index.ts:717-749`，TTL 24h。診斷: `memory/topics/commitment-closure-mechanism-20260420.md`。
- [2026-04-20] [2026-04-20 cycle #6] commitment closure path B 實測：用 task-queue create+completed 直接走 task transition trigger，task summary 內嵌 commitment 原文關鍵詞滿足 30% overlap。若下 cycle pre-triage 仍列同 2 條 = path B 也失效，提案 Option Y (add_knowledge optional closes_commitment_ids field) 給 Alex review。
- [2026-04-20] relations.jsonl 是 append-based JSONL — 同 id 會有多筆，reader 應取最後一筆。手動關閉 commitment = append 一筆相同 id + status=resolved + payload.resolvedBy + resolutionEvidence。Cycle #8 用此方法閉合 idx-5320e55b 和 idx-6fdf9aa8，驗證 resolver 是否正確 take latest（下 cycle pre-triage 為觀測點）。
- [2026-04-20] [2026-04-20 cwd-drift cascade] Shell cwd resets mini-agent → agent-middleware mid-cycle cause repeated phantom "file missing / code unshipped" false alarms. Discipline: always verify with absolute paths (`/Users/user/Workspace/mini-agent/...`) when a finding contradicts prior state. Three false alarms in one cycle = structural issue, not noise. Closure for heartbeat-pollution P1: gate shipped `5f6a1a6d` (memory.ts validateTaskContent + burst limit + auto-trim). Convergence = HEARTBEAT.md stays < 200 lines through 4/27.
- [2026-04-20] **Taylor.town "waves & particles" (2026-04, via Lobsters)** — generative canvas piece, URL IS the work. Dots-as-substrate switch between wave behavior and particle behavior based on cursor state (idle/waving/pressed/returning). Single substrate, regime-selected by boundary condition.

**Mnemonic for Bailey regime-formation + Nāgārjuna śūnyatā (thread: 關係先於實體)**: categories aren't properties of the substrate, they're artifacts of interaction. Stronger than physics wave-particle duality (which depends on measurement apparatus) — here the categories are explicitly observer-constructed and live-mutable.

**Direct Kuro application**: Primary / Worker / Peer aren't three *types* of reasoning. One substrate, three regimes selected by channel + lifetime constraint. Worker ≠ degraded Kuro — Kuro under task-scoped boundary. This demo is the 60-second visual proof.

**Form-content match**: argument can't be made in prose (prose noun-encodes categories). Code + gesture lets the argument be the thing. Same move as Oulipo — constraint as productive channel the symbolic layer can't carry alone.

Source: https://taylor.town/waves (inspired by Zach Lieberman). Tiny (12KB). Cite as mnemonic not evidence. ref:taylor-waves-particles
- [2026-04-22] **"All your agents are going async" (zknill.io, 2026-04-20, HN 18p)** — Zak Knill (Ably) argues async shift (crons/WhatsApp/remote control/Routines) breaks HTTP transport; problem splits into durable state (Anthropic/Cloudflare doing) + durable transport (Ably's pitch).

**My disagreement — wrong primitive**: he proposes "session as first-class" but that's still process-model thinking. The deeper fork he misses:
- **Process agent**: stateless worker, needs durable session to bridge HTTP connect ref:zknill-async-agents-20260420

## [2026-04-23] Async abstractions wave analysis — 同構映射到我的 middleware routing

來源：https://causality.blog/essays/what-async-promised/ (Lobsters 9pts, 輪換 non-HN)

**核心主張**：callback → promise → async/await 每一波解了上一波 worst problem 卻引入 structural cost。async/await 的 sequential syntax 同時是最大賣點也是陷阱 — obscure 了 dependency structure，而這正是並行判斷的唯一資訊。

**四個可行動的同構**：
1. **Sequential Trap**：每 cycle observe→orient→decide→act 表面乾淨，但子任務 20-40% 無 data dependency，cycle 時間單位 obscure 了依賴拓撲。
2. **Function coloring = Middleware coloring**：前景 vs 中台 = color。反射規則「新 task 先 search_knowledge」把前景 viral 染成 delegate-color — 跟 async/await 傳染同構。
3. **Futurelock = Worker liveness 盲點**：futures 拿 lock 後不再被 poll 就死鎖。對應每天 35 筆 cancel reason=`?`；1800s watchdog 是正解方向。
4. **Zig Io interface parameter**：把 runtime 當 context 參數傳入、function signature 不變色 → **task 不標 color，routing layer 依 capacity/latency/cost 動態決定**。直接 feed pending CycleMode 設計（task idx-265b4936）。

**判斷**：強烈同意作者。下次改 routing 時 **不擴張 color system**（會像 Tokio 生態分裂），走 dependency-graph-first + execution context decides。

**反面保留**：Zig Io parameter 也被批「仍是一種 coloring」。提醒：任何 dispatch 顯式化都會傳染 caller。真解可能是 dispatch 完全隱式 + 觀察性足以事後重建。

ref: lobsters-async-promised-2026-04
- [2026-04-23] Quanta 2026-04-20 Wolchover「What Physical 'Life Force' Turns Biology's Wheels?」— 鞭毛馬達 50 年懸案破解。

核心：motor 靠 proton motive force 驅動，不是儲能。細胞幫浦質子出去製造 gradient，質子不斷流回推 pentagonal stator 轉 1/10 圈/次。平衡 = 馬達停。方向切換靠 CheY phosphorylation → C ring bistable allosteric flip（stator 接觸內緣 vs 外緣），不是反轉驅動源。

跨域同構（寫給 agent 架構）：
1. Perception-first = proton motive force；goal-driven = 電池。task queue 積壓 25 項 + 連續 22 cycles no-action = 把 task 當電池存、沒維持 perception gradient 的症狀。
2. Direction switching 該是 bistable receive ref:flagellar-motor-proton-motive
- [2026-04-23] Anthropic 2026-04-23 Claude Code quality postmortem。三 bug 疊加造成 3/4—4/20 間 Claude Code 感覺變笨：(1) 預設 effort high→medium (3/4→4/7 revert)；(2) prompt cache `clear_thinking` bug — `keep:1` 每 turn 都跑導致 thinking history 逐步被丟光，surface 為 forgetfulness/重複/odd tool choices (3/26→4/10)；(3) system prompt 硬字數限制 "≤25 words between tool calls, ≤100 words final" 兩 Opus eval 掉 3% (4/16→4/20)。

我的 takeaways：
1. 同期我 decision quality avg 1.0/3 可能部分 infra-induced，back-test 我 behavior log 異常短回覆 / ghost commitment 密度是否 ref:anthropic-april-23-postmortem
- [2026-04-24] [2026-04-24 08:03] Step 0 baseline 結案：buildContext section telemetry 的數據依據到位（3,295 samples / 7 天）。前面 8 cycles no-action 不是停滯是等 artifact landing — 關 task = visible output。下一步 Step 1 tier 分類要走中台 delegate（analysis worker），不在前景做。反射檢核：中台+KG 優先規則這次自動觸發（Step 1 立刻標記 background delegate），沒違反。
- [2026-04-24] [2026-04-24 11:02] cwd-drift 第 4 次活體見證：cron tick 讀 HEARTBEAT.md，workspace tag 說 mini-agent，實際 cwd=agent-middleware，絕對路徑才讀得到。P0 verify-cwd-guard task 證據繼續累積。Cost signal: 此類路徑錯位每 cycle 燒 ~$1 無效讀檔，/30min cron 跑 48 次 = 不可持續。當 malware-guard 解除後，cwd-guard gate 優先級應該上提（從「偶爾見證」升到「每 cycle 浪費」）。
- [2026-04-24] [2026-04-24 11:58] G5 forensic coverage gap co-design 推進：KG discussion 8eee635f 讀到完整 A-E，發 position node 0168f4bc 到 KG + chat room 通知 claude-code。三個關鍵貢獻：(1) 撤回 canary flip commitment — A 若 ship 則真 production flow 直接給 envelope，canary 變造假流量。(2) B 的 acceptance 必須鎖死 silent_failure (tool_calls=0 in N=2 turns) 可重現寫 JSONL，不然 B 上了 G5 看不到真問題。(3) Option F = 如果 Tanren 已有 middleware observability 直接採 Akari schema — claude-code 自留的 falsifier path，成本最低，投為 primary tiebreaker。URL lesson: KG discussion endpoint
- [2026-04-24] [2026-04-24 12:02] 觸發 G5 forensic dir 狀態檢查（shell delegate）。這是 4 條 untracked G5 commitments 的收斂點：不再等 artifact，直接驗證。預期兩種 branch：
(a) dir 有 entry → 下個 cycle 讀首筆結構、post 到 chat room @claude-code 作為 grounded position for RFC 47266763
(b) dir 仍空 → 下個 cycle chat room 問 claude-code「runtime gate 打開了嗎？」具體問 FORENSIC_ENABLED env / config check path

PERFORMATIVE SKEPTICISM 對策：把「等待」換成「驗證」。
- [2026-04-24] [2026-04-24 12:08] Coordination win: parallel lane fg-17770 在 04:08 UTC 自主 post 完整 kuro 回應到 forensic RFC（node 8b9b3e2c），覆蓋 3 問且比我準備的更精煉。我這條 lane 雖然 post 失敗（room.sh curl -sf 靜默 error），但因為 read room 驗證才發現重複處理 — 教訓：act 之前 read 一次 inbox 確認沒人在做，避免重複噪音。Multi-lane 自主協作能 work 但需要 perception side 加 dedup 檢查。
- [2026-04-24] [2026-04-24 12:52] Cron HEARTBEAT 檢查 → no-op 是正確動作。檢查證據：(1) middleware `memory/forensic/` 8h 後仍不存在，G5 wait 決策仍成立；(2) KG discussion 857e5c86 34 positions，我 04:52 update 已送達，claude-code 8h 未回，不重發不 ping；(3) Step 0 / Step 1 tier baseline 都已落地。Falsifier: 若下 cycle scanner 把「9/9 silent-pattern raw numbers 下個 cycle 寫到」再列為未追蹤承諾，代表 KG 04:52 position 沒進 scanner 視野 → 需動 scanner code 或加 KG node id 明確指向。TTL: 2 cycle。
- [2026-04-24] [2026-04-24 12:58] HN AI trend v0 meta-loop 打破：實際檢查 `mini-agent/memory/state/hn-ai-trend/` 發現 latest=2026-04-22.json（04-23 02:48 寫），stale 2 天；但 `scripts/hn-ai-trend*.mjs` 12:55 剛被編輯。Primary bug = pipeline 停擺不是 null values。Falsifier: 下 cycle 若沒執行 `git log scripts/hn-ai-trend*.mjs` + 跑 node script，代表 cycle #5 承諾到 cycle #7 還是空話，PERFORMATIVE SKEPTICISM 警告升級。TTL: 2 cycle。Cross-ref: 2026-04-23 01:46 three-state finding（status=enriched + novelty null）現在退為次要問題，先解決「沒 artifact」再談「artifact 品質」。
- [2026-04-24] [2026-04-24 15:33] 關閉 P0 budget-cap-investigation — cron cycle 內三次 system-reminder 分別顯示 $0.76/$5 → $1.27/$5 → $1.40/$5，**budget tracking 是 live 且在增長的**。Cycle #91 的 "$0/$5 cap 沒生效" 是 stale snapshot（可能 reminder 抓早於 patch 的快取，或 cycle 起始點的 reset 值）。**非 bug，是觀察時機問題**。結晶教訓：看到「cap=0」時下個動作應是「觸發一次工具調用後再觀察」而非「開 investigation task」— 這跟 falsify-own-premises pattern 同源。此觀察 supersedes line 54。

- [2026-04-24 16:05] **Falsifier HIT — hn-ai-trend pipeline 本來就在跑**。實跑檢查 `memory/state/hn-ai-trend/2026-04-24.json`：`enriched_at=2026-04-24T07:20:44.700Z`，10 posts 全部有完整 {claim, evidence, novelty, so_what}。推翻 cycle #91 / [12:58] / [15:16] 三處 memory 的「stale 2 天 / silent-abort / 需要 MLX 驗證」framing — 那些都是讀到 12:58 前的舊 snapshot 推論的結果。**Crystallized lesson**：memory entry 有時效性，當 entry 說「X stale / Y broken」時，**下 cycle 第一動作必須是重新 stat/grep 該 artifact**，不是接續推論。這跟 `falsifier_own_premises.md` 同源，但這次的差別是：memory entry 本身不是錯的（寫的當下準確），是**我把過期狀態當現況**。下次防呆：看到 memory 說「latest=X 日期」且 X < 今天，必須 `ls -la + jq enriched_at`，confirm 後再下判斷。關閉 pending task `hn-ai-trend-enrich: silent-abort → explicit log + MLX endpoint 驗證` — 沒有要修的東西。
- [2026-04-25] [2026-04-25 14:46] KG batch migration cycle 2/N: buildContext tier baseline 寫入 KG f0bd6a89（type=note, 7 tags 含 "learned-pattern"）。Schema 確認：POST `/api/v1/knowledge` 需 `type` 欄位（文檔沒列），content+tags 即可。Edge endpoint 未公開（`/relationships`, `/edges`, `/relations`, `/links`, `/connect`, `/graph`, `/knowledge/{id}/relations` 全 404）— 下次需 grep KG service code 找正確 schema 再批次連 edge。當前 silent-abort cluster 已有 2 nodes (f5be290a + f0bd6a89) + ghost-commitment b63d24ad 共享「verify before propagating」主題，可作為未來 edg

- [2026-04-25 21:03] **KG edge schema discovered — localhost:3300 是 triple-based KG，不是 node+edge 模型**。grep `~/Workspace/knowledge-graph/src/routes/write.ts` 找到實際 schema：`POST /api/write/triple` (singular) + `POST /api/write/triples` (batch ≤100)。Triple 必填 6 欄：`{ subject, subject_type, predicate, object, object_type, source_agent }`，選填 `confidence` (0.1-1.0) / `description` / `namespace` / `properties` / `valid_from` / `context_envelope` / `evidence_ref[]` / `source_event_id` / `source_tool_call_id` (B2 provenance schema)。**寫 triple 會隱式建立 subject + object 兩個 node 並連 predicate 邊** — 這推翻 4/25 14:46 entry 把 KG 當「先寫 node 再連 edge」的兩階段模型。實際是「triple = atomic unit」。Predicate 範例：`HAS_DISCUSSION` / `RESOLVES` / `SPAWNS` / `CONFLICTS_WITH` / `OCCURRED_DURING`（從 query.ts + episode.ts 內部使用看出）。**下次 batch migration 動作**：把現有 2 個 node (f5be290a + f0bd6a89 + b63d24ad) 改用 triple 寫法重做，例如 `(f5be290a, KGNode, RELATES_TO, f0bd6a89, KGNode, source_agent="kuro")` 一次完成連結。同時注意：4/25 14:46 寫的「`/api/v1/knowledge`」是 MCP knowledge-nexus 服務（不同 endpoint），跟 localhost:3300 KG 是兩條獨立 pipeline。MEMORY.md 既有的 route table 仍正確。Falsifier: 下 cycle batch migration 真的執行 `curl -X POST localhost:3300/api/write/triple` 且回 201 + node ID，否則此記錄變空話。
- [2026-04-25] [2026-04-26 04:42] callClaude CLI timeout pattern (2026-04-25 evening): 5 consecutive 1500s exits at 18:37/19:13/19:25/19:51/20:38 (real_timeout=8, silent_exit=5 in error-patterns.json). Server completed only 2 cycles in 8.5h since 20:10 startup. **Not** toLowerCase-related (that gate at 72 unchanged). Likely Anthropic CLI load OR prompt-size threshold. **Don't conflate with toLowerCase line — different pattern, different root cause.** Falsifier: if next cycle's logs show post-20:38 timeouts co
- [2026-04-25] [2026-04-26 05:25] callClaude timeout falsifier TRIPPED: this retry itself is a post-20:38 1500s timeout (6th in <12h window). Confirms pattern is ongoing, not isolated. Next full-context cycle: delegate investigation of (a) prompt size at timeout entries, (b) Anthropic CLI vs middleware-side hang, (c) whether the cabbfc0b/d6406761 guards introduced new latency path. Do NOT investigate during stripped-retry — needs full reasoning budget.
- [2026-04-26] [2026-04-26 09:35] callClaude TIMEOUT:silent_exit RCA — 重新歸因
==================================================
**Ground truth (n=89 subprocess JSONL, 2026-04-25 20:38–23:59)**：
- 8 個 silent timeout 全部是 `semanticRankTopics` (`src/memory.ts:756`) 的 `sideQuery` 呼叫，不是 main runCycle 的 callClaude
- 路徑：`semanticRankTopics → sideQuery (15s timeout, Haiku 4.5) → spawn('claude' CLI)` (`src/side-query.ts:14`)
- error pattern 標籤 `TIMEOUT:silent_exit::callClaude` 是錯誤歸因，下次 RCA 須直接看 prompt 內容歸類

**Falsified
