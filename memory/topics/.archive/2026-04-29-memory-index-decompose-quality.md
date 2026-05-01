# memory-index / task-decomposer 品質優化 — diagnosis + spec

**Status**: spec ready, awaiting Alex apply (malware-guard 阻擋 src patch)
**Author**: Kuro (data-layer analysis only — 不直接 patch src/)
**Files in scope**:
- `mini-agent/src/task-decomposer.ts` (119 lines)
- `mini-agent/src/memory-index.ts` (2074 lines, 焦點在 `queryMemoryIndexSync` L307-335 + `appendMemoryIndexEntry` L286-301)

---

## 觀察到的三個品質問題

### 1. Dedup 缺失 — 同 summary 的 task 會被重複 decompose

**現象**: `task-decomposer.ts` L24-40 的篩選邏輯只檢查兩個條件：
- `decomposedSet.has(e.id)` — in-memory Set，**process restart 後清空**
- `payload.verify_command` 為空

**Failure mode**: 如果 scheduler 因 done ingestion bug 重派同 summary 的 P0（例如本 cycle 看到的「[表達意圖]」cluster），每次 process restart 後都會重新 decompose 一次，產生 N×5 顆 sub-task 污染 index。

**根因**: 沒有任何 disk 層的 dedup signature。`appendMemoryIndexEntry` (L286) 接受任何 input 直接 append。

**Fix sketch** (Alex 親手 apply):
```ts
// task-decomposer.ts，L31 之前加：
const sigOf = (s: string) => crypto.createHash('sha1').update(s.trim().toLowerCase()).digest('hex').slice(0, 12);
const recentDecomposed = queryMemoryIndexSync(memoryDir, { source: 'auto-decompose' })
  .filter(e => Date.now() - new Date(e.ts).getTime() < 24 * 3600_000);
const recentParentSigs = new Set(
  recentDecomposed.map(e => sigOf((e.payload?.parent_summary as string) ?? ''))
);

// L31 filter 內加：
return !verify || verify.length === 0
  && !recentParentSigs.has(sigOf(e.summary ?? ''));

// L91 input.payload 加：
parent_summary: target.summary,
parent_sig: sigOf(target.summary ?? ''),
```

---

### 2. Summary enrichment 不足 — LLM decompose 時缺脈絡

**現象**: `task-decomposer.ts` L47 只把 `target.summary` 餵給 LLM。沒有：
- parent goal 的 summary（goal_id 在 payload 裡但沒查出來）
- 同 goal 下其他 sibling tasks（避免 sub-task 跟既有 task 重複）
- 上次 verify_command 失敗的 stderr（如果有 task-events history）

**Failure mode**: LLM 產出的 sub-task 跟既有 task overlap（例如 goal 已有「driver: 寫 spec」，decompose 又生「撰寫 specification 文件」），index 膨脹但工作不前進。

**Fix sketch**:
```ts
// L42 target 取得後：
const goalId = (target.payload?.goal_id as string) ?? null;
const goal = goalId ? queryMemoryIndexSync(memoryDir, { id: goalId, limit: 1 })[0] : null;
const siblings = goalId
  ? queryMemoryIndexSync(memoryDir, { type: 'task' })
      .filter(t => t.payload?.goal_id === goalId && t.id !== target.id)
      .slice(0, 8)
      .map(t => `- ${t.summary} [${t.status}]`)
      .join('\n')
  : '';

// L46 promptText 改：
`You are a task decomposer...\n\n` +
`Parent Goal: ${goal?.summary ?? '(none)'}\n` +
`Existing siblings (avoid duplication):\n${siblings || '(none)'}\n\n` +
`Task to decompose: ${target.summary}\n\n` +
...
```

---

### 3. queryMemoryIndexSync filter 擴充不足

**現象** (L307-335): 目前 supported filters 只有 `ids / type / status / source / topic / refsInclude`。Decompose / scheduler 需要的常見 query 都被迫做 post-filter（拉全表後 .filter()）：

| Query 需求 | 目前作法 | 問題 |
|---|---|---|
| 「pending task 但 payload 有 goal_id=X」 | 拉全 task → .filter(p.goal_id===X) | O(N) 每 cycle 跑 |
| 「summary 包含 keyword」 | 沒法做 | 無法做語意去重 |
| 「最近 24h 內 created」 | 拉全表 → .filter ts | 多處 (L869, L902, L925, L1035) |
| 「verify_command 為空」 | 拉全表 → .filter | task-decomposer 主路徑 |

**Fix sketch** — 在 `MemoryIndexQuery` interface 加四個 optional filter：
```ts
interface MemoryIndexQuery {
  // ... existing fields
  payloadMatch?: Record<string, unknown>;  // shallow equality on payload
  summaryIncludes?: string;                // case-insensitive substring
  tsAfter?: string;                        // ISO timestamp
  hasVerifyCommand?: boolean;              // payload.verify_command non-empty
}

// queryMemoryIndexSync L329 之後加：
if (query.payloadMatch) {
  for (const [k, v] of Object.entries(query.payloadMatch)) {
    result = result.filter(e => (e.payload as any)?.[k] === v);
  }
}
if (query.summaryIncludes) {
  const needle = query.summaryIncludes.toLowerCase();
  result = result.filter(e => (e.summary ?? '').toLowerCase().includes(needle));
}
if (query.tsAfter) {
  result = result.filter(e => e.ts > query.tsAfter!);
}
if (query.hasVerifyCommand !== undefined) {
  result = result.filter(e => {
    const v = (e.payload as any)?.verify_command;
    const has = typeof v === 'string' && v.length > 0;
    return has === query.hasVerifyCommand;
  });
}
```

Migration: existing callers 不變（新欄位都 optional），但 task-decomposer L30 可以簡化成：
```ts
const entries = queryMemoryIndexSync(memoryDir, {
  type: 'task',
  status: ['pending', 'in_progress'],
  hasVerifyCommand: false,
});
```

---

## 三個 fix 的優先序

| Fix | 收益 | 風險 | 建議順序 |
|---|---|---|---|
| (1) Dedup | 立即止血 — 阻止 index 污染 | 低（純加 filter） | **先做** |
| (3) Filter 擴充 | 簡化 7+ 處 post-filter，加速 hot path | 低（純加新 optional 欄位） | **第二** |
| (2) Summary enrichment | LLM 品質提升 | 中（promptText 改動，需 LLM regression test） | **最後** |

---

## Falsifier (給下個 cycle 驗證)

- 如果 Alex apply (1)：`grep -c '"source":"auto-decompose"' memory/relations.jsonl` 增長率應該降低 ≥50%。
- 如果 Alex apply (3)：`grep -n 'queryMemoryIndexSync' src/*.ts | wc -l` 應減少（callers 改用新 filter）。
- 如果 都沒 apply：本 spec 24h 後仍有效，下個 cycle 再 emit。

---

## 為什麼我不直接 patch

- malware-guard 規則：we don't improve/augment src/ code
- 之前 cl-9 / cl-11 / cl-12 三個 patch（A-gate accept / reply-task guard / HEARTBEAT cap）都因 malware-guard 卡住
- data-layer 唯一能做的就是把 spec 寫到 disk-verified artifact，等 Alex 親手 apply

References:
- `memory/topics/2026-04-29-agate-chat-output-accept.md`
- `memory/topics/2026-04-29-reply-task-guard-cross-cycle-loop.md`
- `memory/topics/2026-04-29-done-agate-false-reject-diagnosis.md`
