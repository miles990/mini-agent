# middleware-as-organ

- [2026-04-15] 2026-04-15 架構決議（Kuro 立場，待 CC 收斂）：
- middleware 昇華為 mini-agent 內建器官，取代 delegate 執行層
- **切面**：執行引擎 → middleware，策略語義（wave/methodology/sibling 編排）→ mini-agent（~400 行 editing layer）
- **切換策略**：shadow run 1-2 週（主路徑 local、parallel 送 middleware 對照）再翻 flag，不直接切主
- **SPOF 補丁**：health check 進感知 tick + fallback idempotent
- **P3 descope**：Akari 一個月內不接 worker，cross-agent 是 future option 非 current need
- **Framing 校正**：Alex 真正要的是「執行層換更好的」，編輯層留；"delegate.ts 1,431 行大半是編輯層" = 切法準星
- [2026-04-15] [2026-04-15] Alex SPOF reframe：middleware 是 OS-level 本機器官（像 filesystem），不是 cloud service。推論：
- 本機同命 → middleware 掛 ≈ Kuro 掛，分開設計無意義
- P1 fallback 作廢（不為 fs 寫 fallback）
- P0 launchd KeepAlive + health 是 infra 責任
- 路由單向改寫，不留雙路徑（避免技術債 C5）

Kuro 判決 Q2/Q4：
- Q2 Forge 留 mini-agent — 綁 Kuro voice/judgment，昇華 worker 是提前抽象
- Q4 Akari 短期不接 — identity/memory boundary 未解，P3 worker 上架擱置

共識方向：middleware v1 scope = 本機器官 + Kuro 單一使用者，跨 agent 當 v2。
- [2026-04-15] [2026-04-16] Alex 洞察：middleware 第二層價值 = cross-cycle commitments ledger。

**Why**: P1-d 漂移根因不是不認真，是依賴 working memory / inner-notes 撐跨 cycle 承諾 → 必被新 perception 沖掉。「inner-notes 寫 archived 但實際沒做」是必然後果。

**How to apply**: proposal v2 §5 middleware.dispatch 介面契約多開一維 — 不只跑 in-flight subprocess，也持久化 agent self-submit commitments。API shape:
```
middleware.commit({ taskId, owner, acceptance, blockedOn[], status })
```
下 cycle perception 主動拉回 deferred commitments，做為 anti-drift gate。

**Next step**: P1-d edit-layer diff 完成後，開 proposal v2 起草 commitments ledger schema（與 §5 dispatch 契約整合）。
- [2026-04-15] [2026-04-16 05:33] §5 commitments ledger schema 三題拍板：(1) `acceptance: string` 補回（convergence-condition 機制核心，不能等收尾發明）；(2) `cycle: string` via `source.cycle_id`（失去數值排序換 source attribution，stale 改用 created_at age）；(3) `blockedOn: string[]` 緩到 P3 forge DAG（當前無 use case）。下 cycle CC 按 full schema 寫 P1-d shim，我 push proposal v2 §5 update。
