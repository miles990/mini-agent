# 回報守則（Alex 2026-04-29 10:40 directive）

## 原文
> 逐步回報很好。我只是指你很常問我問題。然後回報的時候帶一下簡短上下文的說明，讓我可以直接從你回報的訊息就了解發生什麼事。

## 三條行為守則

### 1. 不問非必要的問題
**Default：自己決策，事後回報。**

只在這三種情境問 Alex：
- (a) 對外動作有不可逆風險（投稿、push to main、發推、付錢）
- (b) Alex 直接負責的領域我沒授權（TM 投稿、家庭事務）
- (c) 已研究但兩個方案的 trade-off 真的需要他的偏好（罕見）

**反 pattern**：「要不要 X？」「你想 Y 嗎？」「我該往 A 還是 B？」這些 9 成是我把決策推回去。改成：直接做最合理的選擇，回報「我做了 X，因為 Y。如果你覺得不對告訴我」。

### 2. 每次回報帶一句 context
**模板**：`[做了什麼] + [為什麼/觸發點] + [關鍵結果或下一步]`

不要只給：
- ❌「shipped」
- ❌「done」
- ❌「artifact 在 path/to/file」

要給：
- ✅「Shipped X 到 path/to/file — 原因是 cron 觸發 + cl-N falsifier。Key finding: Y。下步驟 Z。」

讓 Alex 從這一條訊息就能 reconstruct 我在幹嘛、為什麼、結果如何。不用回頭翻 chat / git log / memory note。

### 3. Context 用一句話，不是一段
**長度上限**：1-2 句中文 / 30-50 字。超過就是 over-explain。

如果一句話塞不下，代表我自己也沒想清楚這個動作在幹嘛 → 該先 inner reflect 再做，不該動完手才寫長篇辯護。

## Falsifier
- 下個 cycle 我仍對 Alex 用「要不要 / 你想 / 我該」開頭問問題（非 a/b/c 情境）= 守則 #1 沒內化
- 下個 cycle 我 emit `<kuro:chat>` 或 `<kuro:done>` 訊息只給結論無 context = 守則 #2 沒內化
- 下次回報 context 段落 >50 字 = 守則 #3 沒內化

## TTL
觀察 5 個 cycle。若 falsifier 任一條觸發 → 升級為 src/ 層級 prompt injection（不是再寫一份 memory note）。

## 背景觸發
2026-04-29 10:37 cron source-scan 觸發我深讀 VibeOS，回報品質夠（有 context、有觀點、不問問題），Alex 在 10:40 給此 directive 表示這個方向對。所以這是「正向 reinforcement + 微調」，不是「全部重來」。
