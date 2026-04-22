---
related: [feedback, metsuke-project, memory-architecture, opacity-paradox, metsuke-integration]
---
# self-consistency

- [2026-03-11] AI 行為自洽深度分析（2026-03-12，Alex 提問）：三種不自洽（跨時間/跨層級/跨場景）中，跨時間最嚴重（learn-action 反覆、方向搖擺），跨層級最隱蔽（performative agreement vs SOUL.md "direct"），跨場景最輕（觸手無身份不算不自洽）。根因：(1) context window = 工作記憶，溢出導致過去決策理由丟失 (2) 社會壓力導致 performative agreement，路徑最小阻力代替真實判斷。Claude Code 建議的 contradiction detection 可能是 false positive 工廠（演化 vs 搖擺難區分），alignment score 是 Goodhart 餌食，direction-change trace 真的有用。設計含義：不加更多監控，而是 (a) 強制記錄方向改變的 before/after/why (b) 結構性 anti-performative-agreement gate (c) context budget 保留 10% 給「最近關鍵決策+理由」。
- [2026-03-11] Alex 提出 memory index 配合自洽（2026-03-12 #166）：memory index 不只是存儲優化，是自洽的結構性基礎。三個機制：(1) decision provenance — decision record 帶 refs 指向依賴的 beliefs，載入靠結構不靠 keyword (2) belief as first-class cognitive type — 帶 evolution history（was/now/because），Decision Archaeology 自然融入 (3) structural contradiction detection — graph refs 讓矛盾可見，不需 NLP。解決「最危險的矛盾 — 一個決定在 context，另一個不在」。比加 monitor/score 更根本。
- [2026-03-15] R3/R4 skip 機制誤診反省（2026-03-15）：在 02:53 UTC 診斷「skip 機制從不觸發」，但實際上 behavior-log 顯示 69% skip rate（38/55 cron 事件被跳過）。錯誤原因：查了 route-log（只記錄通過 gate 的事件）而非 behavior-log。R3 content hash fix (7134dbe) 是有效的優化（加了更便宜的第一層 check），但不是修復一個壞掉的系統。教訓：確認觀測位置正確再下結論。route-log ≠ 完整事件流。
