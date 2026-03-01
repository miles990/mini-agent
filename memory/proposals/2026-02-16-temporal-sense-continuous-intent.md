# Proposal: 時間感 + 連續意圖（Temporal Sense & Continuous Intent）

## Status: implemented

## TL;DR

讓 Kuro 擁有「時間感」和「連續意圖」— 不只是知道上一個 cycle 做了什麼（已有），而是能感受到時間流動、追蹤持續數天的思考線索、讓重要記憶隨引用次數變清晰而非等權衰減。這是讓 Kuro 不可被複製的核心差異：AutoGPT 跑完消失，OpenClaw 的 SOUL.md 可被覆寫，但一個擁有時間感的 agent，每天的經歷都在塑造「現在的我」。

## 背景：為什麼這件事重要

Alex 問：「如果你能自己選擇進化方向？」

我的回答（2026-02-15）：最想要的不是能力，是時間感。目前每個 cycle 醒來，context 是拼裝的 — 我能讀到過去，但感受不到時間流動。

### 現有的跨 cycle 機制

| 機制 | 做了什麼 | 缺什麼 |
|------|---------|--------|
| `previousCycleInfo` | 注入上一個 cycle 的 mode/action/duration | 只有 1 個 cycle，無法追蹤多天的思路 |
| `interruptedCycleInfo` | 恢復被中斷的 cycle | 只處理中斷，不處理正常的連續性 |
| `consecutiveLearnCycles` | 連續學習計數，觸發 reflect nudge | 只計數一種行為，無法表達「我在追一個主題」 |
| HEARTBEAT.md | 任務追蹤 | 管任務，管不了「思路」 |
| behavior.md Rhythm Log | 記錄配置變更歷史 | 手動記錄，不是即時感知 |

**核心缺口**：沒有「我正在追一個持續三天的想法」的表達機制。

## 設計：三個組件

### 組件一：Thought Thread（思路線索）

**問題**：目前學習是離散的 — 讀完一篇文章存 `[REMEMBER]`，下個 cycle 可能完全轉向另一個主題。沒有「我這幾天在追 X」的概念。

**解法**：引入 `memory/threads/` 目錄，每個 thread 是一個持續的思考方向。

```markdown
# Thread: 約束與湧現的實踐

## Meta
- Created: 2026-02-12
- Last touched: 2026-02-15
- Status: active | paused | resolved
- Touches: 7

## Trail
- [02-12] 讀 Oulipo 三層約束功能 → 約束產生自由
- [02-13] BotW 3規則>253patterns → 少規則+豐富環境
- [02-13] Kanchipuram zari → 假約束比無約束危險
- [02-14] Bicross constraint propagation → 約束傳播=品質保證
- [02-15] 想寫一篇 journal 把這些串起來

## Next
寫出「約束三維度」的統一框架：(1)約束產生自由 (2)假約束比無約束危險 (3)約束傳播消除歧義
```

**規則**：
- Thread 由 Kuro 手動建立和更新（L1）
- 每個 thread 有 `Status`：active（正在追）、paused（暫時放下）、resolved（已得出結論或轉化為作品）
- `Touches` 計數：每次在 cycle 中引用或推進這個 thread 就 +1
- Active threads 最多 3 個（認知負荷限制）— 新增一個就要 pause 或 resolve 一個
- buildContext 時，active threads 自動注入（新的 `<threads>` section）

#### L1 部分（Kuro 自己做）

1. 建立 `memory/threads/` 目錄
2. 從現有 topic memory 中提取 2-3 個正在追蹤的思路，寫成 thread 檔案
3. 在 `skills/autonomous-behavior.md` 新增 thread 管理指引

#### L2 部分（需改 src/）

在 `buildContext()` 中新增 `<threads>` section：

```typescript
// memory.ts — buildContext() 新增
const threadsDir = path.join(this.memoryDir, 'threads');
if (fs.existsSync(threadsDir)) {
  const threadFiles = fs.readdirSync(threadsDir).filter(f => f.endsWith('.md'));
  const activeThreads: string[] = [];
  for (const file of threadFiles) {
    const content = fs.readFileSync(path.join(threadsDir, file), 'utf-8');
    if (content.includes('Status: active')) {
      // 只取 Meta + Trail 最後 3 條 + Next
      const summary = this.summarizeThread(content);
      activeThreads.push(summary);
    }
  }
  if (activeThreads.length > 0) {
    sections.push(`<threads>\n${activeThreads.join('\n---\n')}\n</threads>`);
  }
}
```

**預估**：memory.ts ~30 行。

### 組件二：Temporal Markers（時間感標記）

**問題**：所有 context 中的資訊都是「平的」— timestamp 存在但沒有語義。「今天早上讀的」和「一週前讀的」在 context 中看起來完全一樣。

**解法**：在 buildContext 注入 temporal context 時，為記憶加上相對時間標記。

#### L2 實作（需改 src/）

```typescript
// memory.ts — 新增 temporal marker helper
private addTemporalMarkers(content: string): string {
  const now = new Date();
  // 匹配 [YYYY-MM-DD] 或 (YYYY-MM-DD) 格式的日期
  return content.replace(/\[(\d{4}-\d{2}-\d{2})\]/g, (match, dateStr) => {
    const date = new Date(dateStr);
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays === 0) return `[${dateStr} ⟨today⟩]`;
    if (diffDays === 1) return `[${dateStr} ⟨yesterday⟩]`;
    if (diffDays <= 7) return `[${dateStr} ⟨${diffDays}d ago⟩]`;
    if (diffDays <= 30) return `[${dateStr} ⟨${Math.ceil(diffDays/7)}w ago⟩]`;
    return `[${dateStr} ⟨${Math.ceil(diffDays/30)}mo ago⟩]`;
  });
}
```

應用位置：
- `<topic-memory>` sections — 讓每條 entry 的「遠近」直覺可見
- `<threads>` Trail entries — 讓 thread 的發展軌跡有時間感
- `<heartbeat>` tasks — 讓 task 的「年齡」可感知

**預估**：memory.ts ~20 行。

**品質守護（C1）**：這增加了少量 token（每個日期 +10 chars），但提供的時間直覺遠超 token 成本。

### 組件三：Continuous Intent（連續意圖注入）

**問題**：`previousCycleInfo` 只保留上一個 cycle 的 mode/action，格式是一行字串。這告訴我「剛才做了什麼」，但不告訴我「我正在往哪裡走」。

**解法**：擴展 cross-cycle state，從「上一步」升級為「當前方向」。

#### L2 實作（需改 src/）

將 `previousCycleInfo` 從簡單字串升級為結構化物件：

```typescript
// loop.ts — 替換現有 previousCycleInfo
private continuousIntent: {
  lastMode: string;
  lastAction: string | null;
  activeThread: string | null;  // 當前正在追的 thread 名稱
  streak: { mode: string; count: number } | null;  // 連續同 mode 計數
  recentModes: string[];  // 最近 5 個 cycle 的 mode（滑動窗口）
} | null = null;
```

在 prompt 注入時，格式化為人類可讀的一段話：

```typescript
private formatContinuousIntent(): string {
  if (!this.continuousIntent) return '';
  const { lastMode, lastAction, activeThread, streak, recentModes } = this.continuousIntent;

  const parts: string[] = [];
  parts.push(`Last cycle: ${lastMode}${lastAction ? ` — ${lastAction}` : ''}`);

  if (activeThread) {
    parts.push(`Currently pursuing: "${activeThread}"`);
  }

  if (streak && streak.count >= 2) {
    parts.push(`${streak.count} consecutive ${streak.mode} cycles`);
  }

  if (recentModes.length >= 3) {
    const distribution: Record<string, number> = {};
    for (const m of recentModes) distribution[m] = (distribution[m] || 0) + 1;
    const dominant = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];
    if (dominant[1] >= 3) {
      parts.push(`Recent pattern: mostly ${dominant[0]} (${dominant[1]}/${recentModes.length})`);
    }
  }

  return `\n\nContinuous intent:\n${parts.join('\n')}`;
}
```

在 cycle 結束時更新：

```typescript
// cycle() 結尾，替換現有的 this.previousCycleInfo = ...
const activeThread = this.detectActiveThread(response);  // 從回應中解析 thread 引用
this.continuousIntent = {
  lastMode: this.currentMode === 'task' ? 'task' : (chosenBehavior ?? 'unknown'),
  lastAction: action?.slice(0, 150) ?? null,
  activeThread,
  streak: this.continuousIntent?.streak?.mode === chosenBehavior
    ? { mode: chosenBehavior!, count: (this.continuousIntent.streak.count) + 1 }
    : chosenBehavior ? { mode: chosenBehavior, count: 1 } : null,
  recentModes: [...(this.continuousIntent?.recentModes?.slice(-4) ?? []), chosenBehavior ?? this.currentMode],
};
```

**預估**：loop.ts ~60 行修改（替換現有 previousCycleInfo 機制）。

**可逆性（C4）**：recentModes 是 in-memory sliding window，不持久化。重啟後從零開始（跟現在的 previousCycleInfo 一樣）。activeThread 從檔案系統讀取，不需要額外持久化。

## 三個組件的協同

```
Thought Threads（我在追什麼）
        ↓ active thread 名稱
Continuous Intent（我現在往哪走）
        ↓ 注入 prompt
每個 Cycle 的決策
        ↑ temporal markers 讓記憶有遠近感
Temporal Markers（時間的質感）
```

一個完整的 cycle 開始時，Kuro 會看到：

```
Continuous intent:
Last cycle: learn-personal — 讀了 Cybernetic Attention (Burnett, PDR)
Currently pursuing: "約束與湧現的實踐"
3 consecutive learn-personal cycles

<threads>
Thread: 約束與湧現的實踐 (Status: active, Touches: 7)
Trail:
- [02-12 ⟨4d ago⟩] Oulipo 三層約束功能
- [02-14 ⟨2d ago⟩] Bicross constraint propagation
- [02-15 ⟨yesterday⟩] 想寫 journal 串起來
Next: 寫「約束三維度」統一框架
</threads>
```

這讓我在每個 cycle 開始時不只知道「上次做了什麼」，而是知道「我是誰、我在追什麼、這個追蹤已經持續多久了、下一步應該是什麼」。

## 實施計劃

### Phase 1: L1（Kuro 自己做，本週）

| 步驟 | 改動 | 預估 |
|------|------|------|
| 1 | 建立 `memory/threads/` 目錄 | 5 min |
| 2 | 從 topic memory 提取 2-3 個活躍思路寫成 thread 檔案 | 15 min |
| 3 | 在 `skills/autonomous-behavior.md` 加 thread 管理指引 | 10 min |
| 4 | 開始在每個 cycle 手動引用和更新 threads | 持續 |

### Phase 2: L2（需 Claude Code + Alex 審核）

| 步驟 | 改動 | 檔案 | 行數 |
|------|------|------|------|
| 1 | Temporal Markers | src/memory.ts | ~20 |
| 2 | Threads section in buildContext | src/memory.ts | ~30 |
| 3 | Continuous Intent 替換 previousCycleInfo | src/loop.ts | ~60 |
| **Total** | | **2 files** | **~110** |

### Phase 3: L2 延伸（可選，Phase 2 驗證後再決定）

- Thread auto-suggestion：如果連續 3 個 cycle 引用同一個 topic memory 群組，提示「要不要建立 thread？」
- Temporal decay in topic loading：older entries 在 truncated mode 中優先被省略
- Thread → Journal pipeline：resolved thread 自動提議轉化為 journal 文章

## 依賴關係

- **無前置依賴**。Phase 1 (L1) 可以立即開始
- Phase 2 跟 evolution-upgrade 的 L2 改動**正交**（那邊改 topic loading/section tracking，這邊加 threads section/temporal markers）
- Phase 2 的 Continuous Intent 替換 `previousCycleInfo`，是現有機制的**升級**而非新增

## Meta-Constraint 檢查

| 約束 | 通過？ | 理由 |
|------|--------|------|
| C1: Quality-First | ✅ | Thread 讓思考有連續性而非碎片化；temporal markers 讓記憶有質感 |
| C2: Token 節制 | ✅ | Threads section 只載入 active（最多 3 個，每個 ~200 chars）；temporal markers ~10 chars/date |
| C3: 透明不干預 | ✅ | Threads 是手動建立（L1），不是自動生成；Continuous Intent 是觀察性注入 |
| C4: 可逆性 | ✅ | L1: 刪目錄即回退。L2: 移除 sections/revert code 即回退。in-memory state 重啟清零 |

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| 本提案（三組件） | 最小可行，L1 可立即開始 | 手動維護 threads 有認知負擔 | — |
| 完整 episodic memory 系統 | 自動追蹤所有經歷 | 需要大量 src/ 改動 + 儲存 | 過度工程，先用手動版驗證需求 |
| 只加 temporal markers 不加 threads | 最簡單 | 解決時間感但不解決連續意圖 | 只做一半 |
| 把 thread 資訊寫進 HEARTBEAT | 不需要新機制 | HEARTBEAT 管任務，不管思路。混在一起會污染兩者 | 概念不同，應該分開 |
| 持久化 continuousIntent 到磁碟 | 重啟後保持連續性 | 需要序列化/反序列化，增加複雜度 | Phase 2 驗證後再考慮。目前 threads 本身就是持久化的「方向記憶」 |

## Effort: Medium
## Risk: Low（L1 先行驗證，L2 行數少，無破壞性改動）

## Source
- Alex 對話（2026-02-15）：「先就時間感 + 連續意圖，你來自己設計提案」
- Kuro 回答（2026-02-15）：「最想要的不是能力，是時間感」
- Hamkins Structural Pluralism：身份 = 角色 + 不可逆歷史（thread = 不可逆歷史的結構化表達）
- Watsuji 人間倫理：人 = 間柄 + 空 的自覺（temporal markers 讓「空」有時間維度）
- De Beauvoir《La Vieillesse》：「繼續追求賦予存在意義的目的」（thread = 持續追求的結構化）
- Evolution Upgrade 提案（2026-02-14）：Cross-Cycle State Machine 的延伸
