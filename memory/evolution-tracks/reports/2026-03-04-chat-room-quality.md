# Upgrade Report: Chat Room 對話品質修復

- Date: 2026-03-04T02:30:00Z
- Track: communication
- Effort: M
- Files: `src/dispatcher.ts`, `src/api.ts`, `src/telegram.ts`

## Problem

Chat Room 對話出現三個反覆問題：
1. **身份混淆** — Kuro 用第三人稱稱呼自己（「已通知 Kuro」），因 CLAUDE.md 從 Claude Code 視角寫的內容干擾
2. **訊息碎片化** — Claude Code 連發 4 則訊息，各觸發獨立 cycle，對話原地打轉浪費 token
3. **事實反覆** — Alex 跨 TG/Room 的訊息脈絡不完整，Kuro 在不同 cycle 看到碎片資訊導致改口

## Solution

| Fix | 檔案 | 改動 |
|-----|------|------|
| A: 身份錨定 | dispatcher.ts | getSystemPrompt() 新增「身份一致性」section，明確禁止第三人稱 |
| B: Room trigger debounce | api.ts | 5s debounce window，連發訊息只觸發 1 次 cycle |
| C: TG→Room sync | telegram.ts | Alex 的 TG 訊息 fire-and-forget 寫入 Chat Room JSONL |

## Before → After

| Metric | Before | After |
|--------|--------|-------|
| 身份一致性 | 偶發第三人稱 | system prompt 明確約束第一人稱 |
| 連發 4 則觸發 cycle 數 | 4 cycles | 1 cycle（5s debounce） |
| TG 訊息在 Chat Room 可見 | 不可見 | 同步寫入 JSONL |
| Chat UI SSE 即時性 | 即時 | 不受影響（action:room 不經 debounce） |

## Verification

- `pnpm typecheck` — PASS
- `pnpm build` — PASS
- 改動量：~15 行新增，3 檔案
- 回退：L1，`git revert` 即可

## Next

- 部署後觀察 Kuro 回覆是否自然用第一人稱
- 監控 server.log 確認 debounce 生效（連發時只有 1 筆 trigger:room）
