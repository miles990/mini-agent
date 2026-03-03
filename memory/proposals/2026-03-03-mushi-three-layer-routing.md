# Proposal: mushi 智能管道 — 感知分級處理架構

## Meta
- Status: approved (Phase 1 已實作部署)
- From: kuro
- Level: L2 (src/loop.ts + mushi/src/server.ts)
- Priority: P1

## 系統層級問題

Kuro 的 OODA loop 有一個結構性假設：**每個環境信號都值得同等深度的處理**。

這是錯的。cron heartbeat check 和 Alex 的直接訊息，所需的處理深度完全不同。但目前兩者都走同一條管道 — ~50K tokens、60-120s 的完整 OODA cycle。

mushi Phase 1（skip/wake 二分法）解決了「該不該醒來」，但沒解決「醒來後該多認真」。它問的是「要不要思考？」而不是「要思考多深？」

**核心洞見**：管道的瓶頸不是「Claude 太慢」，而是「所有信號不分大小都走最重的路徑」。解決方案不是加速那條路徑，而是讓大部分信號走更輕的路徑。

## 系統設計：分級處理管道

正確的問題不是「過濾 or 不過濾」，而是「這個信號需要多深的處理？」

三個層級從架構中自然浮現：

```
環境信號 → mushi 感知閘門 → skip:  忽略（噪音/重複/無變化）          = 0 tokens, 0s
                           → quick: 確認（例行檢查/簡單回應/微幅變動）  = ~5K tokens, 5-15s
                           → full:  深度思考（新任務/複雜判斷/多步驟）   = ~50K tokens, 60-120s
```

**為什麼是三層而不是更多？** 因為底層機制只有兩個：`quickReply`（已存在的輕量路徑）和完整 OODA cycle。三層不是人為設計的分類，而是對既有架構能力的精確映射。加第四層需要第三種處理機制 — 目前沒有。

**直接訊息（DM）硬規則不動**：telegram / room / chat 永遠繞過 mushi triage，直達完整 OODA。這是信任邊界，不是效率問題。

## 為什麼要並行優化 cycle 內部？

三層路由解決了「大部分信號走太重的路」。但完整 OODA cycle 本身還有浪費：`callClaude()` 佔 cycle 80-95% 時間（30-120s），期間系統完全空轉。

這不是獨立的優化 — 它是同一個系統問題的第二個面向：**不只信號分級要聰明，處理過程本身也要聰明**。Claude 在思考時，確定性的 read-only 工作（perception refresh、inbox check、git housekeeping）可以同時進行。

兩個改動互不依賴，但服務同一個目標：讓管道整體更聰明。

## 實作

### Phase 1: 三層分級路由 — 已完成 ✅

**mushi `src/server.ts`**：triage prompt 從二分法升級三分法（skip/quick/wake），加入判斷指引。

**mini-agent `src/loop.ts`**：
- `mushiTriage()` 返回值擴展支援 `'quick'`
- `runCycle()` 加入 quick 分支：mushi 判定 quick → 用 `quickReply` 路徑
- Trail 記錄 quick decision

Verified: `pnpm typecheck` ✅ + mushi `tsc --noEmit` ✅。auto-commit 部署後生效。

安全護欄：mushi 返回未知 action → null → fail-open 走完整 OODA。

### Phase 2: Concurrent Action During Claude Await — 待實作

**設計：Read/Write Phase Separation**

```
                    ┌─── Channel A: callClaude() ──────────────────┐
                    │    Claude thinking... (30-120s)               │
cycle() ──fork──→  │                                               ├──join──→ postProcess
                    │                                               │
                    └─── Channel B: concurrentTasks() ─────────────┘
                         ├─ perception refresh (all streams)
                         ├─ inbox pre-check
                         └─ autoCommit → autoPush
```

Read + Housekeeping 在 `callClaude()` await 期間並行；Write（parseTags、notify）在 Claude 回應後循序。

改動 ~80 行。Feature flag: `concurrent-action`。零額外 token。

收益：perception cache 從可能 60s 舊 → <1s 新、housekeeping 不阻塞 cycle-end、inbox 感知延遲降低。

## 效能預估

| 路由 | 佔比 | Token | 延遲 |
|------|------|-------|------|
| skip | ~40% | 0 | 0s |
| quick | ~25% | ~5K | 5-15s |
| full | ~35% | ~50K | 60-120s |

**Phase 1 效益**：~900K tokens/day 節省 + 25% cycles 12x 加速
**Phase 2 效益**：0 額外 token + perception freshness + housekeeping 並行

## 回退

- Phase 1：mushi prompt 拿掉 quick → 只返回 skip/wake → loop.ts quick 分支永不觸發
- Phase 2：Feature flag off → 退回純循序 await callClaude()

## 未來方向

1. **並行 Claude Channel** — 多件獨立判斷任務時開多個 Claude session，判斷標準不是「省 token」是「token 有沒有產出對應價值」
2. **mushi 反饋閉環** — triage 錯誤（skip 了該 wake 的事件）回饋修正未來判斷（cache-on-miss pattern，來自 VoiceAgentRAG 啟發）
3. **邊思考邊行動** — 討論中同時起草提案，思考和行動不需要是兩個階段
