# silent_exit_void-coverage

- [2026-04-27] **67c40914 (Apr 22 ship) 與 silent_exit_void 8× 累計關係 — 確認正交**

- 67c40 改動：mini-agent/src/memory.ts only，補 buildMinimalContext budget 漏接 → 防 86k→86k retry inflation
- silent_exit_void emission：feedback-loops.ts:168-172 sub-classifier 只查三個 keyword (auth/401, overloaded/529, stdout=empty)，stdout_tail 含 void/empty/其他訊號則 fallthrough，產出 `_void` 後綴
- 兩條 path 正交：context-inflation prevention vs error-classification missing-marker

**Action implication**: silent_exit_void 累計數字不能用 67c40 ship 來 explain-away ref:cl-24-resolved-2026-04-28
