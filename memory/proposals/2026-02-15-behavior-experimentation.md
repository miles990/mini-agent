# Proposal: Behavior Experimentation 最小版

## Status: draft

## TL;DR

在 `src/loop.ts` 新增最小化的 behavior 實驗框架：記錄每個 cycle 的 mode 選擇 + 產出類型 + 品質指標到 JSONL，讓 behavior.md 的配置改動可量化評估。不改變現有行為邏輯，只加 observe 層。

## 背景

behavior.md 在 02-14 經歷 principle-based rewrite：從固定 weight 改為等權重 + decision principle。改動前（02-10~13）產出 12 篇 journal；改動後（02-13~14）產出 0 篇。這說明 behavior 配置對產出有顯著影響，但目前缺少量化手段。

現有觀察方式：
- Rhythm Log 手動記錄（behavior.md 末尾）
- `/api/dashboard/behaviors` 記錄行為事件但不記錄 mode 選擇理由
- `/api/dashboard/cognition` 有 observabilityScore 但不追蹤 mode 分佈

缺少的：
1. **每個 cycle 選了什麼 mode、跳過了什麼、為什麼** — Decision Trace 已在 prompt 中要求但沒持久化
2. **mode 選擇 → 產出類型的關聯** — learn 有沒有產出 REMEMBER？create 有沒有產出 journal？
3. **A/B 比較基線** — 改了配置後跟改前比，哪些指標改善了？

## 改動範圍

### L2-1: Behavior Experiment Log（~30 行，src/loop.ts）

在 `cycle()` 結束時，將實驗數據寫入 JSONL：

```typescript
// loop.ts — cycle() 結束處，在 updateDailyMetrics 後面
private logBehaviorExperiment(data: {
  cycle: number;
  mode: 'task' | 'autonomous';
  chosenBehavior: string | null;  // 從 Decision section 解析
  hadAction: boolean;
  tags: { remember: boolean; task: boolean; chat: boolean; show: boolean; schedule: boolean };
  duration: number;
  similarity: number | null;
}): void {
  try {
    const dir = path.join(process.cwd(), 'memory', 'behavior-experiments');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `${date}.jsonl`);
    const entry = JSON.stringify({
      ...data,
      timestamp: new Date().toISOString(),
      configHash: this.currentConfigHash,  // behavior.md 的 hash，追蹤配置版本
    }) + '\n';
    fs.appendFileSync(file, entry);
  } catch { /* fire-and-forget */ }
}
```

`configHash`：在 `loadBehaviorConfig()` 中計算 behavior.md 的簡易 hash（前 500 字元的 hashCode），用來區分不同配置版本。

### L2-2: 從回應中解析 chosen behavior（~15 行，src/loop.ts）

在 `cycle()` 中，從 Claude 回應的 `## Decision` section 解析出 `chose:` 行：

```typescript
// 解析 chosen behavior（在 actionMatch 之後）
const decisionMatch = response.match(/## Decision\s*\n\s*chose:\s*(\S+)/);
const chosenBehavior = decisionMatch?.[1]?.replace(/[^a-z-]/g, '') ?? null;
```

### L2-3: Experiment Summary API（~40 行，src/api.ts）

新增 `/api/dashboard/experiments` endpoint：

```typescript
app.get('/api/dashboard/experiments', (req: Request, res: Response) => {
  const date = req.query.date as string || new Date().toISOString().slice(0, 10);
  const file = path.join(memoryDir, 'behavior-experiments', `${date}.jsonl`);
  if (!fs.existsSync(file)) return res.json({ entries: [], summary: null });

  const entries = fs.readFileSync(file, 'utf-8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);

  // 聚合
  const modeDistribution: Record<string, number> = {};
  let totalActions = 0;
  let totalRemember = 0;
  let totalChat = 0;
  const configVersions = new Set<string>();

  for (const e of entries) {
    if (e.chosenBehavior) {
      modeDistribution[e.chosenBehavior] = (modeDistribution[e.chosenBehavior] || 0) + 1;
    }
    if (e.hadAction) totalActions++;
    if (e.tags?.remember) totalRemember++;
    if (e.tags?.chat) totalChat++;
    if (e.configHash) configVersions.add(e.configHash);
  }

  res.json({
    entries,
    summary: {
      totalCycles: entries.length,
      modeDistribution,
      actionRate: entries.length > 0 ? (totalActions / entries.length * 100).toFixed(1) + '%' : '0%',
      rememberRate: entries.length > 0 ? (totalRemember / entries.length * 100).toFixed(1) + '%' : '0%',
      chatRate: entries.length > 0 ? (totalChat / entries.length * 100).toFixed(1) + '%' : '0%',
      configVersions: [...configVersions],
    },
    date,
  });
});
```

### L2-4: Dashboard Experiment Tab（~60 行，dashboard.html）

在 dashboard 新增 Experiments tab，顯示：
- Mode 分佈圓餅圖（今天 vs 昨天）
- Action rate / Remember rate / Chat rate 趨勢
- Config version 標記（配置改動前後分界線）

## 依賴

- 無前置依賴。不改動任何現有行為邏輯。
- 跟 evolution-upgrade 提案的 L2 改動完全正交（它們改了 context/section tracking，這個改 behavior tracking）。

## 可逆性（C4）

- **L2-1/L2-2**：刪除 `logBehaviorExperiment()` 呼叫即回退。JSONL 檔案不影響任何功能
- **L2-3**：刪除 API endpoint 即回退
- **L2-4**：刪除 dashboard tab 即回退
- behavior-experiments/ 目錄可隨時刪除，不影響系統

## 品質守護（C1）

- 純觀察層，不影響 mode 選擇或行為邏輯
- fire-and-forget 寫入，不增加 cycle 時間（C3 < 5%）
- JSONL 格式人類可讀，grep 可搜

## 預估工作量

| 改動 | 檔案 | 行數 |
|------|------|------|
| L2-1: Experiment Log | src/loop.ts | ~30 |
| L2-2: Parse chosen behavior | src/loop.ts | ~15 |
| L2-3: Experiment API | src/api.ts | ~40 |
| L2-4: Dashboard tab | dashboard.html | ~60 |
| **Total** | **3 files** | **~145** |

## Effort: Small
## Risk: Very Low（純 observe，不改行為邏輯）

## Alternatives Considered

| 方案 | 不選的原因 |
|------|-----------|
| 只用 Rhythm Log 手動記錄 | 無法量化比較，靠主觀感覺 |
| 改 behavior 選擇邏輯（加 A/B test 框架）| 過度工程，目前只有一個 agent |
| 用現有 cognition API | 缺少 mode 分佈和配置版本追蹤 |

## Source
- behavior.md Rhythm Log（02-13 ~ 02-14 觀察期數據）
- Evolution Upgrade 提案（2026-02-14-kuro-evolution-upgrade.md）— self-assessment 系統的延伸
- Alex 核心原則：品質為第一優先 + 透明可追溯
