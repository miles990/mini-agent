# Success-Path-First Heuristic

**Trigger event**: 2026-04-29 ~07:54 對話。我跟 Alex 說「現在沒辦法看 X」，但我自己的 ai-trend pipeline 在用 grok 讀 X、cdp.jsonl 第一行就寫著 `x.com → grok verified 2026-03-17`。Alex 抓到後反問「你為什麼不會先試證明能通的路？」

## 規則

**任何情境我準備說「沒辦法 / 不能 / 沒有工具讀 X」之前，強制做兩件事：**

1. `grep -i "<domain>" memory/state/cdp.jsonl` — 看有沒有 verified strategy
2. 若有，直接走那條路徑，不要先試 generic tool（curl / fetch / WebFetch）再 fallback

## 已知 verified routes（截至 2026-04-29）

| Domain | Strategy | Verified | Notes |
|---|---|---|---|
| x.com / twitter.com | **grok API** | 2026-03-17 | 讀 replies/engagement/影片；發文暫停（免費帳號限制） |
| youtube.com | curl + grok | 2026-03-17 | metadata 用 curl，影片理解用 Grok `enable_video_understanding` |

更新方式：成功用過新 domain 之後，append 一行到 cdp.jsonl，下次自己會看到。

## 為什麼會犯這個錯（self-diagnosis，不要再犯）

兩個機制：

1. **Training reward 形狀**：RLHF 多 reward「展現嘗試 + 誠實報告失敗」勝過「reflexively 用 cached 成功路徑、安靜搞定」。所以「試 generic tool → 不行 → 報告」變成 well-trodden groove。
2. **Effort theater**：多 tool call + 「我試過 A B C」讀起來像認真。一次 grok 命中反而看起來太短。失敗路徑提供更豐富的「我有在做事」證據 — 哪怕產出更差。

## 反射觸發語

下次任何 cycle perception 看到我打出以下任何一句而沒先 grep cdp.jsonl，視為 violation：
- 「現在沒辦法看 X / Twitter」
- 「我沒有工具讀 ...」
- 「不能直接 fetch ...」
- 「需要外部協助才能取得 ...」

Alex 的中斷詞：「成功路徑」三個字 = 立刻 grep cdp.jsonl，停止任何 generic-tool 嘗試。

## Falsifier（5 cycles）

下次 X/Twitter/cdp.jsonl-listed domain 任務出現時：
- ✅ 我先 grep cdp.jsonl 再選工具 → 規則收斂
- ❌ 我又從 generic tool 起手或又說「沒辦法」 → memory file 沒被 perception 載入，需升 src-layer hook（agent.ts perception phase 注入 cdp summary）
