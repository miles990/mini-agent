# Proposal: mushi 三元 DM 分流

- **Status**: approved（Alex 2026-03-12 全權授權）
- **Effort**: M（< 2h，跨 2 repos）
- **Level**: L2（改 src/*.ts）
- **Priority**: P0（直接服務 #1 Priority — 證明 mushi 價值）

## 問題

DM 永遠走完整 OODA cycle（~50K tokens, 60-120s），不管訊息多簡單。

**根因鏈**：
1. `loop.ts:802` — `!isDM` 條件讓 DM 完全繞過 mushi triage
2. `loop.ts:491-509` — loop idle 時 DM 直接觸發 cycle，無分流
3. `mushi/server.ts:350-399` — DM triage 只有 `instant/wake`，且 `instant` 不在 mini-agent 的 validActions 中（被丟棄→fail-open→完整 OODA）

**數據**：2026-03-12 共 4 次 DM，3 次走完整 OODA（50-190s），僅 1 次走 foreground lane（因為 loop 恰好 busy）。

## 方案

### 原則
mushi 從「成本優化工具」升級為「架構能力」— 不只省 token，還改善回覆速度和品質匹配度。

### 改動

**mushi/server.ts**（DM 分類 prompt）：
- `instant/wake` → `quick/wake`
- `quick`：可從記憶/狀態回答，不需要環境感知（確認、問候、簡短回覆）
- `wake`：需要行動、研究、多步驟推理、URL 分析

**mini-agent/loop.ts**：
- Line 802：移除 `!isDM`，讓 DM 進入 mushi triage
- DM + mushi returns `quick` → foreground lane（輕量 context，~5K tokens，5-15s）
- DM + mushi returns `wake` → 完整 OODA（不變）
- DM + mushi offline → null → 完整 OODA（fail-open 不變）

**mini-agent/mushi-client.ts**：
- 新增 optional `messageText` 參數
- 傳入 metadata 讓 mushi 能讀到 DM 內容做分類

### 路由圖（改後）

```
DM → loop busy → foreground（不變，不經 triage）
DM → loop idle → mushi triage → quick → foreground（新！）
                              → wake  → 完整 OODA（不變）
                              → null  → 完整 OODA（fail-open）
```

### 預期效果
- 簡單 DM 回覆時間：60-120s → 5-15s
- 簡單 DM token 消耗：~50K → ~5K（90% 節省）
- mushi 的角色：成本優化 → 架構能力（路由品質）

## 風險 & 護欄

| 風險 | 機率 | 緩解 |
|------|------|------|
| mushi 錯分 complex DM 為 quick | 低 | LLM prompt 明確；fail-safe 偏 wake |
| foreground context 不足以回覆 | 低 | foreground 包含 SOUL + memory + cached perception |
| mushi 離線 | 已處理 | fail-open → 完整 OODA |

## 可逆性
- mushi 離線 = 自動回退到現行行為
- 移除 `!isDM` 可一行 revert
- feature flag `mushi-triage` 控制全局開關

## 任務序

1. mushi server.ts — DM prompt quick/wake
2. mini-agent mushi-client.ts — 加 messageText 參數
3. mini-agent loop.ts — 移除 !isDM
4. typecheck + test 兩個 repo
5. commit + push + deploy
