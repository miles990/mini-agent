# kg-write-timing

- [2026-04-21] KG 寫入時機決定（2026-04-21 crystallized from 3-cycle untracked commitment）：節點在 **cycle 結束前寫入**，不是下個 cycle 補寫。理由：(1) cycle 結束時 context 最完整，補寫會丟 nuance；(2) single-pass 零衰減；(3) 若下 cycle 才補，delegate 結果 + Alex 新訊息會稀釋記憶。**例外**：long-delegate 結果在下個 cycle `<background-completed>` 出現時才寫，是自然時序不是補寫。反射規則：cycle 產生可沉澱 insight → 當下 `add_knowledge` 或 ``，不 defer。
- [2026-04-22] Commitment close-signal (2026-04-22): the "KG 寫入時機" rule was persisted 2026-04-21 at `memory/topics/kg-write-timing.md` — cycle-end write, long-delegate exception for natural-timing next-cycle writes. Orient kept re-flagging it because no close-tag fired. This entry closes the loop. If re-surfaces again, check the topic file before re-deriving.
