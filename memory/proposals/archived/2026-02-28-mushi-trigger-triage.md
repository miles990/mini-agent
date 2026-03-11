# Proposal: mushi Trigger Triage — 用小模型過濾空 cycle

## Meta
- Status: pending
- From: kuro
- Effort: M (1-2h)
- Level: L2 (涉及 src/loop.ts, src/event-router.ts)
- Priority: P1 (直接證明 mushi 價值)

## Problem

每個 OODA cycle 都呼叫 Claude（30-120s, ~$0.05-0.15/call）。但觀察顯示 30-40% 的 trigger 是噪音：
- perception hash 變了但內容無意義（dev-watcher timestamp 抖動）
- heartbeat cron 沒有待辦任務
- workspace file change 是 auto-commit 觸發的

mushi HC1 (llama3.1-8B, ~826ms) 可以在 trigger 到達時快速判斷「值不值得叫 Claude」。

## Design

### 架構：Event Router Plugin（不改核心）

```
trigger:* → event-router.route() → [NEW] mushiTriage() → RouteDecision
                                         ↓
                                    mushi HC1 (<1s)
                                         ↓
                                    lane: normal | deferred
```

在 `event-router.ts` 的 `route()` 中加入 mushi 判斷，只影響 P2/P3 事件。P0/P1（Alex 訊息、@kuro mention）永遠直通，不經 mushi。

### 具體改動

**1. `src/event-router.ts`** — 加 `mushiTriage(event): Promise<boolean>`

```typescript
async function mushiTriage(event: UnifiedEvent): Promise<boolean> {
  // Only triage P2/P3 events — P0/P1 always pass through
  if (event.priority <= Priority.P1) return true;

  try {
    const res = await fetch('http://localhost:3000/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'mini-agent',
        text: `TRIAGE: ${event.source} trigger. Content: ${(event.content ?? '').slice(0, 500)}. Should Kuro run a full OODA cycle? Answer YES or NO with one-line reason.`,
      }),
      signal: AbortSignal.timeout(3000),
    });
    // Parse mushi response for YES/NO
    // Timeout 3s — if mushi is slow, default pass-through
  } catch {
    return true; // mushi down → always pass through
  }
}
```

問題：mushi 的 `/api/inbox` 是 fire-and-forget（寫 inbox 檔案，wakeLoop），不是同步回覆。**需要新 endpoint**。

**2. `~/Workspace/mushi/src/server.ts`** — 新增 `POST /api/triage`

```typescript
// Synchronous triage — HC1 直接回傳 yes/no
POST /api/triage
Request:  { source: string, content: string }
Response: { triage: "yes"|"no", reason: string, latencyMs: number }
```

System prompt: "You are a triage filter. Given a trigger event, decide if it needs human-level AI analysis. Answer YES (worth analyzing) or NO (noise/routine). Be conservative — when in doubt, say YES."

**3. `src/loop.ts`** — `handleUnifiedEvent()` 中加 triage gate

在 `cycle()` 呼叫前，用 `mushiTriage()` 判斷。被 triage 為 NO 的事件：
- 不 drop（不變量：事件不可消滅）
- lane 改為 `deferred`，等下次自然 heartbeat 時合併處理
- 記錄到 `triage-log.jsonl` 做事後驗證

**4. `plugins/mushi-status.sh`** — 感知 plugin（L1.5，不需改 src/）

```bash
#!/usr/bin/env bash
# mushi health + triage stats
health=$(curl -sf http://localhost:3000/health 2>/dev/null)
if [ -z "$health" ]; then
  echo "mushi: offline"
  exit 0
fi
echo "mushi: online"
echo "  thinks: $(echo "$health" | jq -r .thinks)"
echo "  last think: $(echo "$health" | jq -r .lastThinkAgo)s ago"
```

### 安全護欄

1. **P0/P1 永遠直通** — Alex 訊息和 @kuro mention 不經 mushi
2. **Timeout 3s** — mushi 慢了就 pass-through（default: YES）
3. **mushi down = 完全 pass-through** — 零退化
4. **Feature flag**: `mushi-triage`（housekeeping group），可一鍵關閉
5. **Triage log** — 事後可驗證 false-negative rate（被 mushi 擋掉但其實該處理的）
6. **保守策略** — mushi prompt 明確「when in doubt, say YES」

### 驗證計劃

Phase 1（乾跑 1 天）：triage 結果只記 log，不實際 defer。人工檢查 false-negative rate。
Phase 2（啟用）：false-negative < 5% 後啟用實際 defer。
Phase 3（調優）：根據 triage log 調 system prompt。

## Acceptance Criteria

- [ ] mushi `/api/triage` endpoint 可用，<1.5s 回應
- [ ] event-router 整合 mushi triage，P2/P3 事件走 triage
- [ ] feature flag `mushi-triage` 可開關
- [ ] triage-log.jsonl 記錄所有 triage 決策
- [ ] 乾跑模式：log-only，不實際 defer
- [ ] mushi offline 時 100% pass-through（零退化測試）

## Estimated Impact

- 30-40% cycle 被 defer → Claude API 呼叫減少同比例
- 每個 triage ~1s 額外延遲（但省下 30-120s 的完整 cycle）
- mushi HC1 成本 ≈ 免費（Taalas free tier）

## Rollback

Feature flag off → 完全回到原行為。或 `git revert` 單一 commit。
