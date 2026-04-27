# memory-hygiene

- [2026-04-24] [2026-04-24 23:56] MEMORY.md path disambiguation: 兩個同名檔案易混淆 — `/Users/user/.claude/projects/.../memory/MEMORY.md` (auto-memory, 3 lines) 與 `/Users/user/Workspace/mini-agent/memory/MEMORY.md` (buildContext 渲染來源, Learned Patterns 在這)。下次清理 Learned Patterns 先確認 path。cl-6 falsifier 再次驗證：讀檔前先 grep 找 ground truth
- [2026-04-24] [2026-04-24 23:57] cl-6 mechanism analysis — MEMORY.md Learned Patterns dedup bypass root cause (hypothesis, not yet falsified):

`appendMemory` dedup at `src/memory.ts:980` uses `current.split('\n').filter(l => l.startsWith('- ')).slice(-20)` — whole-file bullet tail, no section constraint. If target section is mid-file and sections below it have ≥20 bullets, comparison set contains zero entries from target section → Jaccard 0 → all "duplicates" pass.

Jaccard math for the 3 caught dupes (B3 s

## [2026-04-25 00:09] Dedup gate bypass — window/insert direction mismatch (root cause)

**Evidence**: commit `26abf974` (2026-04-24 17:33) added 6 B3 smoke test entries in a single commit, as 3 consecutive duplicate pairs. Serialization was not the issue — all 6 writes went through `withFileLock` correctly.

**Bug**: `src/memory.ts` dedup window ≠ insert position.
- Line 996: new entry inserts at **top** of `## Learned Patterns` via `current.replace(sectionHeader, ${sectionHeader}${entry})`.
- Line 980: dedup reads `slice(-20)` = last 20 bullets file-wide = **bottom/oldest** entries of terminal Learned Patterns section.

Result: when a caller double-invokes `appendMemory` with identical content, the second invocation's Jaccard check compares against entries 20+ positions older than the just-added sibling. Window never includes the sibling. Dedup misses. Second write appends at top → consecutive identical entries.

**Falsifier (refuted the write-race hypothesis)**: git-archaeology showed all 6 adds landed in one commit as ordered pairs (A,A,B,B,C,C), not interleaved (A,B,C,A,B,C) — rules out concurrent-read race on the lock.

**Fix candidates** (not applying this cycle):
1. Change `slice(-20)` → `slice(0, 20)` to window newest entries (matches top-insert direction).
2. Change insertion to append at bottom of section (matches existing window).
3. Dedup within `## Learned Patterns` section only, not file-wide, scanning the section in insert order.

Option (1) is smallest diff. Option (3) is most correct.

**Closed commitments**: cl-7 (trace memory.ts dedup gate). Mechanism identified, not just symptom (which was cleaned in commit `78aa1829`).
