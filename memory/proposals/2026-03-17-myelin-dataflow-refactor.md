# Myelin 資料流重構提案

**日期**: 2026-03-17
**改動等級**: L1（myelin-fleet.ts + loop.ts 小改動）
**風險**: 低 — 不改 myelin engine，只修整合層接線

## 問題

基於 myelin 使用數據分析（[2026-03-17-004]），發現四個互相關聯的問題：

### 1. Bypass 資料黑洞（最大浪費）
loop.ts 的四條 hard-rule bypass（P0 pending、alert、delegation-complete、hard-skip）在 myelin triage 上游短路。`logTriageBypass()` 存在但**從未被呼叫**。結果：
- 489 次 bypass 決策只寫入 kbObserve + trail，不進 myelin-decisions.jsonl
- Crystallizer 完全看不到這些已穩定模式
- Triage domain 只有 48 筆記錄（其中 45 筆是 distill_complete 事件，僅 3 筆 rule）

### 2. Distill 空轉
`maybeDistill()` 用全域時間間隔（30min），然後盲目 `fleet.distillAll()`。每個 domain 無差別 distill，即使沒有新決策。
- Triage: 48 筆中大量 distill_complete 事件，幾乎零實際決策
- Myelin engine 的 `instance.maybeDistill()` 有 `minNewDecisions` 參數，但 fleet 層沒用

### 3. Legacy JSONL 孤兒
7 個 JSONL 檔不在 fleet 中：
| 檔案 | 筆數 | 狀態 |
|------|------|------|
| experience-pool.jsonl | 165 | 舊架構遺留 |
| myelin-expel-decisions.jsonl | 36 | 無 fleet domain |
| myelin-meta-decisions.jsonl | 30 | 無 fleet domain |
| myelin-episodes.jsonl | 26 | 無 fleet domain |
| myelin-playbook-decisions.jsonl | 20 | 無 fleet domain |
| myelin-skill-decisions.jsonl | 10 | 無 fleet domain |
| reasoning-chains.jsonl | 36 | 舊架構遺留 |

這些佔磁碟空間不大，但造成 stats 混亂和認知負擔。

### 4. 根本原因
四個問題是同一個：**資料流接線問題**。資料在錯誤的地方被切斷（bypass 不進 pipeline）、在沒有資料的地方被消耗（空 distill）、在太細的粒度上被分散（孤兒檔案）。

## 改動方案

### Fix 1: Bypass 資料回流（loop.ts）
在 loop.ts 四個 bypass 點呼叫 `logTriageBypass()`：

```typescript
// P0 pending bypass (line ~1088)
if (hasP0 && !isDM) {
  slog('MUSHI', `✅ P0 pending work bypasses triage (hard rule)`);
  logTriageBypass('P0-pending', 'wake', 'pending work exists');  // 新增
}

// alert bypass (line ~1093)
if (triageSource === 'alert') {
  slog('MUSHI', `✅ alert bypasses triage (hard rule)`);
  logTriageBypass('alert', 'wake', 'alert always wakes');  // 新增
}

// delegation-complete bypass (line ~1094-1095)
if (triageSource === 'delegation-complete' || triageSource === 'delegation-batch') {
  slog('MUSHI', `✅ ${triageSource} bypasses triage (must absorb results)`);
  logTriageBypass(triageSource, 'wake', 'must absorb delegation results');  // 新增
}

// hard-skip (line ~1107)
slog('MUSHI', `⏭ Hard skip — ${triageSource} + no perception change + idle`);
logTriageBypass(triageSource, 'skip', 'no-perception-change + idle');  // 新增
```

### Fix 2: Per-domain 智能 Distill（myelin-fleet.ts）
用 myelin engine 的 `instance.maybeDistill()` 取代盲目 `fleet.distillAll()`：

```typescript
export async function maybeDistill(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastDistillTime < DISTILL_INTERVAL_MS) return false;
  _lastDistillTime = now;

  try {
    const fleet = getFleet();
    let distilled = 0;
    for (const name of fleet.names()) {
      const instance = fleet.get(name)!;
      // 用 instance.maybeDistill() — 只在有新決策時 distill
      const result = instance.maybeDistill({ minNewDecisions: 3 });
      if (result) {
        distilled++;
        slog('MYELIN', `${name} distilled: ${result.rules.length} rules, ${result.templates.length} templates`);
      }
    }
    if (distilled === 0) {
      slog('MYELIN', 'All domains skipped — no new decisions');
    }
    // ... research evolution 保持不變
  }
}
```

### Fix 3: Legacy JSONL 歸檔
將 7 個孤兒 JSONL 移到 `memory/archived/`：
```bash
mkdir -p memory/archived
mv memory/myelin-{expel,meta,playbook,skill,episodes}-decisions.jsonl memory/archived/
mv memory/{experience-pool,reasoning-chains}.jsonl memory/archived/
```

## 不做的事

- **不做 domain 合併**（7→3）：Fleet 已經只有 4 個有效 domain（triage/learning/routing/research），語義區分清楚。合併 triage+routing 會混淆完全不同的決策空間
- **不改 myelin engine**：問題在整合層（mini-agent），不是 engine
- **不改 crystallizer 的 `method === 'llm'` 過濾**：Bypass 記錄為 `method: 'rule'` 是正確的 — 它們已經是 rule，不需要再結晶。記錄它們的價值是完整的 stats 和未來分析

## 驗證

1. `pnpm typecheck` — 型別安全
2. `pnpm test` — 194 tests 全過
3. 部署後觀察：bypass 決策出現在 myelin-decisions.jsonl、distill 不再空轉

## 影響

- Triage 決策 log 從 ~3 筆真實記錄 → 會開始累積 bypass 資料
- Distill CPU 浪費從 4x 降到 0-1x（只在有新決策的 domain distill）
- 磁碟空間回收不大，但認知負擔降低（不再疑惑為什麼有 7 個 JSONL 檔）
