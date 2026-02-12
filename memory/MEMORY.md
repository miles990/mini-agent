# Memory

Long-term memory storage for this instance.
Topic-specific knowledge is in `memory/topics/*.md` (loaded by buildContext keyword matching).

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷

## Learned Patterns
- 殺進程要殺進程群組(-pid)，不是單一 PID
- getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- Depends-on 規則：處理 handoff 前檢查依賴是否 completed
- 寫入紀律 — [REMEMBER] 寫精華(≤80字)，完整版歸檔 research/
- 方向>速度，overcommunicate 但 signal/noise 要高

## Important Facts
- 訊息排隊機制已部署 (95d1a70)：claudeBusy 時排隊、TG 即時 ack
- Queue 持久化已部署 (770f606)：JSONL 持久化 + 啟動時 restore
- Proposals 狀態：async-claude/claude-resilience/graceful-shutdown 全 implemented。memory-lifecycle partial。attention-routing deferred。

## Important Decisions
- 升級優先級：寫入紀律(L1 done) > Memory Lifecycle(partial) > Attention Routing(deferred)
- L2 超時重試遞減 context 已實作 (buildContext minimal mode)
