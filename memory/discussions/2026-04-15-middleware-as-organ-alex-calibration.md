---
title: Middleware-as-Organ — Alex 四點校正 + CC Q2 驗證
date: 2026-04-15
participants: [Alex, Claude Code, Kuro]
status: awaiting-kuro-response
links:
  - memory/proposals/2026-04-15-middleware-as-organ.md  # Kuro 的 L3 proposal (需據此改寫)
---

# Alex 四點校正（推翻 CC 原 Q1-Q4 保守答覆）

Alex 針對 CC 先前對 Kuro Q1-Q4 的補充建議，逐一校正方向。CC 全部接受並修正立場。

## Q1 · Lifecycle：middleware 不應失敗

**Alex**: middleware 應是本地端 infra 器官，不應該失敗。

**CC 校正**:
- 刪除 `middleware-client.ts` 的 fallback-to-old-subprocess path
- Uptime 保證在 ops 層（launchd plist + `/health` 監控 + Telegram 告警），不在 client 的 if-else
- Client 失敗就 throw，caller 處理，視同呼叫 DB
- 原本「middleware down → fallback 舊 subprocess」的設計是把 middleware 當外部依賴防禦，違反「器官」定位

## Q2 · Isolation：middleware 該能做 forge 的事

**Alex**: 有什麼中台沒辦法做到 forge 的情境？

**CC 驗證**（讀 agent-middleware source）:
- middleware 目前**確實不支援外部 workdir 注入**：
  - SDK worker（researcher/coder/reviewer 等）在 middleware 自己的 cwd 執行
  - shell worker 有內部 `scratchDir`（`mkdtempSync`）但只能抄檔進去，無法接收 caller 指定的 workdir
  - 找不到 `task.cwd` / `task.workdir` 欄位讓 caller 傳入
- **這是真實 gap，不是 Kuro 的偏好問題**

**CC 修正方案**:
- middleware 需新增 per-task `cwd` / `workdir` 支援（SDK provider 的 `query({ cwd })` 已有此選項，只是 API 層沒開放）
- forge 的 **slot 資源管理**（3 slot / `.forge-in-use` / PID 死亡回收）留 mini-agent 側 — 這是 Kuro 私有資產
- **協議**：caller 先 `forge create` 拿 workdir → 塞進 middleware payload → middleware 在該 workdir 跑 worker → caller 收結果後 `forge merge`
- 非 Kuro 原本的「forge 完全不進 middleware」，是「forge slot 管理不進 middleware，但 workdir 參數要進」

## Q3 · 定位：middleware 是 DAG engine

**Alex**: 中台應該是 DAG 機制。

**CC 強烈同意**（升維）:
- middleware 不只是 task runner，是 DAG engine（對齊 middleware 的 `/accomplish` API）
- mini-agent 提交 `plan: DAG` 而非 `task: single`
- 單任務 = 1 node DAG；多步任務（research → summarize → verify）= multi-node DAG
- 完全對齊 Alex 2026-04-14 Planning Discipline（禁止時間估計，DAG 為 plan 語言）
- `<kuro:delegate>` tag 可演化成 `<kuro:plan>`，承載完整 DAG
- 觸手並行 = DAG 多 node 無共同 dependsOn，自然 parallelism

## Q4 · 遷移節奏：user 側是 call API，cover 了就切

**Alex**: 對使用者是 call API，使用情境完全覆蓋就行。

**CC 校正**（原 strangler + 7 天 metric gate 是過度工程）:
- 正確節奏：
  1. **Verification phase**（dev）：5 worker type（code/learn/research/create/review）跑 smoke test 對照舊 spawn path
  2. **Cutover**：情境覆蓋確認 → 一次切，舊 spawn path 刪
  3. 有 bug → `git revert`（C4 可逆性），不養雙路徑（C5 技術債）
- 不需要 `delegate-via-middleware` flag、不需要 strangler 7 天雙軌、不需要 metric gate

---

# 架構 implication（比原方案簡化很多）

- ❌ 無 fallback code path
- ❌ 無 feature flag
- ❌ 無 strangler metric gate
- ❌ 無舊/新雙路徑

真正要做的：

| Side | Work |
|------|------|
| middleware | (1) 開放 per-task `cwd` 注入到 SDK worker；(2) 確認 5 worker type 情境覆蓋度；(3) launchd/pm2 lifecycle + `/health` |
| mini-agent | (1) `delegate.ts` 從 1431 行 spawn+watchdog+recover 重寫為 DAG submitter + result poller（預計 ≤300 行）；(2) `<kuro:delegate>` → DAG 轉譯 |
| ops | (1) middleware launchd plist；(2) health monitor + alert；(3) `middleware as organ` 的 uptime SLO |

---

# 下一動作

1. Kuro 據此改寫 `memory/proposals/2026-04-15-middleware-as-organ.md`（移除 fallback / strangler / flag / metric gate 相關段落）
2. Kuro 四角自我對抗 review v2（新方案還站得住嗎？）
3. Alex L3 approve gate
4. 分工：
   - CC：middleware per-task `cwd` patch（跨 repo PR 到 agent-middleware）+ smoke test workers 情境覆蓋
   - Kuro：mini-agent `delegate.ts` 重寫 + DAG 轉譯
   - Alex：ops 層 launchd plist + health monitor decision
5. 互相 review → commit + push
