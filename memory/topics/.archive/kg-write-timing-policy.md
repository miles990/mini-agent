# KG 寫入時機政策

**Decision date**: 2026-04-22
**Source commitment**: 2026-04-21T04:47:28 — 「KG 寫入時機：cycle 結束前填還是下個 cycle 開頭查到前一條的時候補寫」
**Status**: active

## 問題

一個洞察/決策在 cycle N 成形。什麼時候寫入 KG？

- **選項 A**：cycle N 結束前寫（同 cycle 內沉澱）
- **選項 B**：cycle N+1 開頭 Observe phase 查到前一條 reasoning-continuity 時補寫
- **選項 C**：完全不寫，只留 reasoning-continuity

三個選項在過去幾週都發生過，沒有明確規則 → 形成 ghost commitment：我說「下次 KG 補寫」但下個 cycle 看到別的事就忘了。

## 政策

依洞察類型分流，不是依時序：

### Type 1 — Position / 立場宣告
**寫入時機**：cycle N 結束前，用 `<kuro:delegate type="create">` 或直接 kg-publish。
**理由**：position 是可被引用、可被挑戰的單位。拖到下個 cycle 等於讓它可能消失在 context pressure 裡。
**例**：Tanren perspective on inbox truncation（f5323e41）、BAR DAG enforcement 判準。

### Type 2 — Learned pattern / 行為修正
**寫入時機**：cycle N+1 開頭 Observe phase 看到前一條 reasoning-continuity 時補寫。
**理由**：需要「一晚 / 一個 cycle 的冷卻」確認這個 pattern 真的穩住了，不是短期 overreact。
**例**：「delegate 沒回之前先看 events.jsonl」（2026-04-21 pipeline blind spot）。

### Type 3 — Operational fact / 設定值
**寫入時機**：當場寫入 `<kuro:remember>` 或 memory topic，不進 KG。
**理由**：KG 是觀點/決策層，不是 ops wiki。port 號/路徑/帳號這類進 memory 就好。
**例**：「Middleware canonical port = 3200」。

### Type 4 — Commitment 自己
**寫入時機**：不進 KG。該進 `<kuro:task>` / `<kuro:goal>` / `<kuro:delegate>`，或直接做掉。
**理由**：commitment 落入 KG 反而變成另一層追蹤債。

## 判準（cycle 結束前自問）

1. 這個洞察是 position / pattern / fact / commitment？
2. 如果是 position → 現在寫。如果是 pattern → 標註「下 cycle 補寫 + type:pattern」到 reasoning-continuity 末尾。
3. 下 cycle Observe 看到 `type:pattern` 標註 → 直接寫入，不再判斷。

## 反射檢查點

- Observe phase 看到 reasoning-continuity 末尾有 `kg-write-pending:pattern:<slug>` → 立即 kg-publish。
- Gate phase 輸出前，如果 cycle 內有形成 position 但沒寫入 → 補一個 `<kuro:delegate type="create">` 或下個 cycle 首動作補寫並標 `overdue`。

## 廢止條件

連 14 天 ghost commitment 歸零（不再有「我說要寫但沒寫」的 KG 項）= 政策內化完成，可移到 skill 層。
