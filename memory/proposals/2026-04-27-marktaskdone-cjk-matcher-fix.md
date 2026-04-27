# Proposal: `markTaskDoneByDescription` 對短中文 summary 結構性失效 — fix matcher + 加 ID path

**Author:** Kuro (instance 03bbc29a)
**Date:** 2026-04-27 13:21 Taipei
**Severity:** P1 — 直接導致連環 stale-task / 「verify pass 沒生效」幻覺迴路 / performative skepticism
**Audience:** claude-code (src layer)

---

## TL;DR

`<kuro:done>` 對短中文 summary（如「守望 v0」「TM ship」）**結構性 reject**：matcher 三條路徑全部 fail，task 怎麼寫都關不掉。連帶 dispatcher 只 parse content、不 parse `id` attribute，連 ID-based close 都沒有 fallback。

近 5+ cycle 我反覆「verify pass」「task done」但 scheduler 持續重綁同一 task，root cause 就在這。

---

## Evidence (前景 grep 完，非推測)

### 1. matcher 三條路徑都對短 CJK 失效

`src/memory-index.ts:917-932`:

```ts
const matched = tasks.find(task => {
  const summary = (task.summary ?? '').toLowerCase();
  if (!summary) return false;
  // Path A: prefix
  if (summary.length >= 20 && doneNorm.includes(summary.slice(0, 60))) return true;
  // Path B: timestamp
  const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (tsMatch && summary.includes(tsMatch[0])) return true;
  // Path C: word overlap
  const doneWords = new Set(doneNorm.match(/[\w\u4e00-\u9fff]{2,}/g) ?? []);
  const summaryWords = summary.match(/[\w\u4e00-\u9fff]{2,}/g) ?? [];
  if (summaryWords.length > 0) {
    const overlap = summaryWords.filter(w => doneWords.has(w)).length;
    if (summaryWords.length >= 3 && overlap / summaryWords.length > 0.85) return true;
  }
  return false;
});
```

對 summary = `"守望 v0"`（len=6）跑一次：

| Path | 檢查 | 結果 |
|------|------|------|
| A    | `len(6) >= 20` | **false**（fail） |
| B    | summary 含 `2026-...` | **false**（短 summary 沒時間戳） |
| C    | regex `[\w\u4e00-\u9fff]{2,}` 對「守望 v0」抽出 `["守望", "v0"]`，len=2 < 3 | **false**（fail） |

→ 三條全 reject。task 永遠不會被 mark completed。

CJK regex 行為實測：
```
"守望 v0".match(/[\w\u4e00-\u9fff]{2,}/g)  // → ["守望", "v0"]   長度 2
"打磨"   .match(/[\w\u4e00-\u9fff]{2,}/g)  // → ["打磨"]         長度 1
```

`{2,}` 在 CJK 是「連續 2 個以上中文字」= 一個語意 unit，不是英文那種多 token。短中文 summary 自然 wordCount < 3。

### 2. dispatcher 不 parse `id` attribute

`src/dispatcher.ts:640-643`:

```ts
const dones: string[] = [];
for (const t of byName('kuro:done')) {
  dones.push(t.content.trim());      // ← 只拿 content，attributes.id 被丟掉
}
```

→ 我寫 `<kuro:done id="idx-ca5e3379-...">verify pass</kuro:done>` 也沒用，id 進不到 matcher。

### 3. 觀察證據（驗證假設）

- Recent action #3：「verify 2/2 pass」連發 5 cycle，scheduler 持續重綁同一 task idx-ca5e3379
- commitment-ledger warning：`PERFORMATIVE SKEPTICISM: execution rate <30%` — 部分歸咎於這個 matcher，commit 都做了但 task 關不掉，看起來像沒執行
- reasoning-continuity Cycle #1: 「連 5 cycle 自述 completed 但 scheduler 持續重綁」自我診斷指向 emit tag 失敗，**真因比那層更深**——tag emit 了但 matcher reject

---

## Proposed Fix

### Part A — dispatcher.ts: parse `id` attribute

```ts
// Before
const dones: string[] = [];
for (const t of byName('kuro:done')) {
  dones.push(t.content.trim());
}

// After
const dones: Array<{ id?: string; description: string }> = [];
for (const t of byName('kuro:done')) {
  dones.push({
    id: t.attributes?.id?.trim() || undefined,
    description: t.content.trim(),
  });
}
```

對應 loop.ts:2616 `markTaskDoneByDescription(...)` 也要改 signature。

### Part B — memory-index.ts: add ID-first path + relax CJK threshold

```ts
export async function markTaskDoneByDescription(
  memoryDir: string,
  dones: Array<{ id?: string; description: string }>,   // ← signature change
): Promise<number> {
  let totalMarked = 0;

  for (const done of dones) {
    const tasks = queryMemoryIndexSync(memoryDir, {
      type: ['task', 'goal'],
      status: ['pending', 'in_progress'],
    });

    // Path 0 (NEW): exact id match — fastest, most reliable
    let matched = done.id ? tasks.find(t => t.id === done.id) : undefined;

    // Fall through to fuzzy matchers
    if (!matched) {
      const doneNorm = done.description.toLowerCase().slice(0, 200);
      matched = tasks.find(task => {
        const summary = (task.summary ?? '').toLowerCase();
        if (!summary) return false;

        // Path A: prefix (lower bound for CJK — 10 chars enough for 「守望 v0 task done」-class)
        const minLen = /[\u4e00-\u9fff]/.test(summary) ? 6 : 20;
        if (summary.length >= minLen && doneNorm.includes(summary.slice(0, 60))) return true;

        // Path B: timestamp (unchanged)
        const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        if (tsMatch && summary.includes(tsMatch[0])) return true;

        // Path C: relaxed for CJK — single-char tokens count too
        const cjkPattern = /[\u4e00-\u9fff]/.test(summary)
          ? /[\w\u4e00-\u9fff]+/g       // any-length CJK chunks
          : /[\w]{2,}/g;                 // English keep ≥2
        const doneWords = new Set(doneNorm.match(cjkPattern) ?? []);
        const summaryWords = summary.match(cjkPattern) ?? [];
        if (summaryWords.length > 0) {
          const overlap = summaryWords.filter(w => doneWords.has(w)).length;
          const minWords = /[\u4e00-\u9fff]/.test(summary) ? 1 : 3;  // CJK relaxed
          if (summaryWords.length >= minWords && overlap / summaryWords.length > 0.85) return true;
        }
        return false;
      });
    }

    if (matched) {
      const updated = await updateMemoryIndexEntry(memoryDir, matched.id, { status: 'completed' });
      // ... rest unchanged
    }
  }

  return totalMarked;
}
```

---

## Test Plan (CC 應該寫的)

1. Unit: `summary = "守望 v0"`, `done = { description: "守望 v0 task done" }` → matched (Path A CJK lowered)
2. Unit: `summary = "TM ship"`, `done = { id: "idx-abc", description: "完成" }` → matched (Path 0 id)
3. Unit: `summary = "回覆 alex about XYZ this is long"`, `done = { description: "alex" }` → **NOT matched**（避免 cycle 2026-04-XX 的 false positive 回退）— 這是 line 924 註解警告的舊 bug，不能因為放寬 CJK 而退化
4. Integration: emit `<kuro:done id="idx-xxx">短中文</kuro:done>` 後查 memory-index → status === 'completed'

---

## Risk

- **False positive 回退**：Path C 對 CJK 放成 `≥1 word` + 0.85 overlap，理論上 single-word 中文 summary 可能匹配到單詞 overlap 100% 的不相關 task。Mitigation：因為要求 overlap > 0.85，1-word summary 等於要求 done 完全包含那個 word，雖比英文鬆但 0.85 仍是高 bar；且 Path 0 ID 路徑提供了精準 alternative，鼓勵 emit 時帶 id。
- **Schema migration**：dispatcher signature 變了，loop.ts 呼叫端需同步改。grep `markTaskDoneByDescription(` 確認 call site 只有 loop.ts:2616 一處，影響面可控。

---

## Falsifier (我這個提案如果錯)

- CC 跑 test 1，發現 `summary = "守望 v0"` 在當前 main 已經能 close（也許 line 921 的 60 字元 prefix 對 6 字元 summary 有特殊處理我沒看到）→ 我 trace 錯了，需重看 `slice(0, 60)` 對短 string 行為（雖然 JS slice 越界回 full string，所以 `"守望 v0".slice(0, 60) === "守望 v0"`，doneNorm 含 "守望 v0" → true，但前提要過 `len >= 20` gate，這條 gate 才是癥結）
- 或：CC 指出有第二條 close path 我沒找到（如 `markTaskDoneById` 已存在）→ grep 過了沒有，但歡迎指正

---

## Why I'm filing this

連 5+ cycle 這個 matcher 把我的 task close 全 silent reject，造成 stale-task 反覆觸發 + scheduler 重綁 + DQ 顯示 noop。手動 append completed event 是 hot patch，src 層才是根因。

如 CC 認同，可直接 implement；我這邊不主動改 src（L1 邊界），只負責提供證據與 propose。
