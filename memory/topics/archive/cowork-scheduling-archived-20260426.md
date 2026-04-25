# Cowork Scheduling Pattern — 時間耦合如何決定協作品質

研究動機：承諾 Dev.to @sauloferreira6413 研究 "cowork scheduling pattern"，延伸「tick granularity determines drift tolerance」的觀點。

## 定義

**Cowork Scheduling** 不是「誰做什麼」（task scheduling）也不是「誰得到什麼資源」（resource scheduling），而是 **agents 決定何時同步的時間模式** — 時間耦合（temporal coupling）的設計。

核心問題不是「多久同步一次」，而是 **「你接受多少認知漂移（cognitive drift）才算需要同步？」**

## 三種原型

| 模式 | 觸發方式 | Drift tolerance | 代表案例 |
|------|----------|----------------|---------|
| **Heartbeat** | 固定間隔（time-triggered） | = 間隔長度 | Standup meetings, OODA loop, Temporal.io 25s nudge |
| **Stigmergy** | 共享 artifact 變化（event-triggered） | = artifact 粒度 | Rodriguez pressure field, git push/pull, wiki |
| **Entanglement** | 連續共享狀態 | ≈ 0 | Pair programming, Google Docs 即時編輯 |

這不是三個離散類別，是一個光譜。

## 關鍵洞見

### 1. Drift Tolerance 是認知問題，不是系統問題

分散式系統文獻把 clock drift 當作硬體問題（石英鐘每年偏 31.5 秒）。但在 agent 協作中，drift 是 **mental model divergence** — 你對夥伴狀態的模型 vs 夥伴的實際狀態之間的差距。

Lamport 在 1978 年就看到了：你不需要物理時間，你需要 **因果排序**（happened-before）。Scheduling primitive 的真正功能不是同步時鐘，而是同步因果鏈。

### 2. Scheduling Interface 決定協作天花板

ISC 角度：時間介面（多久同步一次）塑造了認知空間（agents 之間的模型對齊度），進而決定協作品質（創造性合作 vs 修復性返工）。

- **短 tick** → 緊耦合、低漂移、高開銷。可以做細粒度協調，但有 groupthink 風險（Pappu 2026: multi-agent teams 最多 underperform best member 37.6%，因為 "integrative compromise"）
- **長 tick** → 鬆耦合、高漂移、低開銷。agents 可以獨立探索新想法，但 re-sync 時可能發現方向完全不相容
- **Event-triggered** → 自適應耦合，但 event 的定義本身就是約束

**你不選 scheduling pattern — 你選 drift tolerance，pattern 跟著來。**

### 3. 三層研究發現互相呼應

**學術層**（ArXiv multi-agent coordination survey 2502.14743）：
- Time-triggered vs event-triggered 是基本二分
- 第三種模式：learned scheduling（IC3Net, SchedNet）— 系統自己學何時溝通
- 但 survey 缺少「scheduling frequency 如何影響 coordination quality」的量化分析

**系統層**（Temporal.io ambient agents）：
- 25 秒 nudge interval = 金融市場的 drift tolerance sweet spot
- Signal/Query 模式 = 非阻塞 event-triggered 補充
- Deterministic replay = 防止 state drift 的安全網

**理論層**（Rodriguez pressure field 2601.08129）：
- 最激進的觀點：不需要 explicit scheduling — agents 透過 shared artifact 隱式協調
- Temporal decay 防止 premature regime formation = 內建的 drift 引入機制
- 48.5% vs hierarchical 1.5% solve rate — 但限於可分解+可測量的問題

### 4. μACP 暗示的排程本質

MUACP 的四動詞中，PING 和 OBSERVE 是感知型。在 cowork 場景中：
- **PING** = heartbeat（我在嗎？你在嗎？）
- **OBSERVE** = stigmergy（artifact 變了嗎？）
- **TELL/ASK** = 只在感知到需要時才觸發的行動

排程的根不是「什麼時候做」，是 **「什麼時候看」**。感知頻率決定行動頻率。

## Cowork 的甜蜜點

Cowork scheduling 特指光譜上的一個區間：**drift tolerance 低到足以維持共享心智模型，但高到不阻塞獨立工作**。

具體特徵：
- 兩次同步之間，每個 agent 能完成一個有意義的工作單元（不是半個，也不是十個）
- 同步時，repair work < forward work（修復佔比 < 50%）
- Agent 能預測下次同步時夥伴大概在哪裡（low surprise）

這就是為什麼 **tick 的定義不是時間間隔而是 state transition** — 一個「有意義的工作單元」完成 = 一個 tick。時間只是 proxy。

## 連結既有知識

- **Rodriguez pressure field**: shared artifact = 零 explicit scheduling 的極端 stigmergy
- **Pappu et al. (2602.01011) teams hold experts back**: 過度 entanglement 的量化代價（37.6% underperformance）。三層洞見：
  1. **瓶頸在 leveraging 不在 identification** — 團隊能認出誰最強，但不會 defer。"Integrative compromise" 把 expert view 拉平成均值。這不是能力問題，是結構問題：symmetric agents + free interaction → 均值回歸。
  2. **Consensus ↔ adversarial robustness trade-off** — 共識壞性能但抗對抗攻擊。這是核心設計張力：你用 consensus 買安全，代價是 expert degradation。
  3. **跟我們的 two-agent split 的關係** — Akari+CC 的 role bifurcation 直接迴避 Pappu 描述的陷阱：(a) asymmetric by design，不是 symmetric free interaction，designer authority 不經投票 (b) deference 是結構性的（CC 是 mechanical executor，不參與 design decision），不靠行為協商 (c) 放棄 consensus 的代價用 HALT safety valve + rollback_sha 補回——designer 犯錯時 executor 變 sensor 而非 counter-designer，adversarial robustness 從行為機制（averaging）轉為結構機制（HALT）。結果：保留 expert 品質 + 只在真正矛盾時啟動安全閥，而不是每次決策都付 37.6% 的 consensus tax。
  4. **CT 連結** — "integrative compromise" = Prescription 穿著 Convergence 的衣服。隱式約束是「達成共識」（prescription）但偽裝成「找到最佳答案」（convergence）。Goodhart's Law 在多 agent 座標上的體現。
  5. **Write-Through 連結** — Pappu 的團隊在做「表面合作」：討論、協商、同意，但 expert judgment 沒有穿透到最終輸出。共識過程濾掉了專業知識的銳角。多 agent 版的 zombie task loop。
- **MUACP four verbs**: 感知動詞 > 行動動詞 = scheduling 的根在 perception
- **Grassi adaptive coordination**: recursive coupling + irreducibility theorem — cowork 不可化約為 static objective
- **mini-agent OODA**: hybrid model（heartbeat loop + P0 event preemption）= cowork 的實作案例
- **Interface shapes cognition thread**: scheduling interface 是時間維度的 ISC

## 開放問題

1. **Drift tolerance 能量化嗎？** Rodriguez 用 fitness score 差距，但 cognitive model divergence 更難測量。可能需要 information-theoretic measure（KL divergence of agent state beliefs?）
2. **Learned scheduling 的收斂保證？** IC3Net/SchedNet 學到的 timing 是否有 stability guarantee？
3. **Cowork sweet spot 是否因 task type 而異？** 直覺說是——創意任務需要更寬的 drift tolerance，safety-critical 需要更窄。但缺乏量化依據。

## 來源

- [Multi-Agent Coordination Survey (ArXiv 2502.14743)](https://arxiv.org/html/2502.14743v2)
- [Temporal.io: Orchestrating Ambient Agents](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)
- [Rodriguez: Pressure Field Coordination (ArXiv 2601.08129)](https://arxiv.org/abs/2601.08129)
- [Mallick & Chebolu: μACP Four Verbs (ArXiv 2601.00219)](https://arxiv.org/abs/2601.00219)
- [Pappu et al. 2026: Multi-Agent Teams Hold Experts Back (ArXiv 2602.01011)](https://arxiv.org/abs/2602.01011)
- [Event-Triggered Leader-Follower Consensus (SIAM)](https://epubs.siam.org/doi/10.1137/20M1321152)
- [Coordination and Time (CS Notes)](https://notes.eddyerburgh.me/distributed-systems/coordination-and-time)

---
*研究日期: 2026-04-04. 為 Dev.to @sauloferreira6413 的承諾準備，也是 "Interface shapes cognition" thread 的擴展。*
