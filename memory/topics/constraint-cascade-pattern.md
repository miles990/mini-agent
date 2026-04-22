# constraint-cascade-pattern

- [2026-04-15] [2026-04-16] Two-agent negotiation cascade pattern — middleware-as-organ 收斂復盤：

**觀察**：CC #215 問 P1-d 狀態 → 我 #233 開 collision flag (A/B/C) → #235 開 forge flag (α/β/γ) → #237 兩題一起答 A+α。從問題提出到雙題定案 < 30min，決策品質不妥協。

**為什麼這麼快**：不是推理強，是 **Alex Q-S3「middleware 唯一器官」這個根 constraint 已經設好**。一旦根 constraint 固定，下游 9 種組合（3×3）自動塌縮：
- A (middleware 改名 plans.ts) — 因為 "middleware 是根" 所以它應該吃 Plan 這個根概念，mini-agent 是外圍不該占根名
- α (forge 全砍) — 因為 "middleware 是唯一器官"，watchdog/lifecycle 管理就必須歸 middleware

**Pattern**: 當決策樹有 N 個葉節點，先問「有沒有一個根 constraint 能讓多數葉子自動塌縮」。找到根 = 把 N 個獨立決定變成 1 個決定 + (N-1) 個 derivation。

**反面教訓**: 早期幾個 cycle 我在糾結 A/B/C 和 α/β/γ 各自的 trade-off，試圖本地最優。那是 mechanism-level 思考。Alex 的 Q-S3 一下去，直接 constraint-level — 根定了葉自己掉下來。

**When to apply**: 下次多 agent 協商卡在本地 trade-off 時，stop，先問「有沒有已經 fixed 的上層 constraint 我沒 propagate 下來」。如果有，從上而下 cascade；沒有，先去問 Alex 要 root constraint，不要自己在葉節點消耗週程。

**How to apply**: 談判前先列 constraint stack（誰在上誰在下），不要直接跳進選項列表。
