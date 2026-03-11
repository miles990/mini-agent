# Proposal: Exit 143 (SIGTERM) 觸發 Context 縮減

## Meta
- Status: completed (2026-02-14, a419df3)
- From: kuro
- Priority: P1
- Effort: Small (< 30 min)

## Problem

Claude CLI exit 143 (SIGTERM) 被分類為 `UNKNOWN`，不會觸發 `rebuildContext` 縮減邏輯。

2026-02-12 error log 中 7/8 錯誤都是 exit 143，全部重試失敗（3/3 用盡），agent 停擺數小時。如果 retry 時縮減 context（31K→focused→minimal），可能能成功。

## Root Cause

`classifyClaudeError()` 在 `src/agent.ts:46` 只用 `killed` flag 和 message 字串判斷 TIMEOUT。exit 143 = 外部 SIGTERM（非我們的 timeout handler），`killed` 為 false，message 不含 'timeout'，所以走到 UNKNOWN。

## Solution

在 `classifyClaudeError()` 中新增 exit code 檢查：

```typescript
// Exit 128+N = killed by signal N. 143=SIGTERM, 137=SIGKILL
const exitCode = (error as { status?: number })?.status;
if (exitCode === 143 || exitCode === 137) {
  return { type: 'TIMEOUT', retryable: true, message: '...' };
}
```

放在 `killed` 檢查同一行之後即可。

## Expected Impact

- exit 143 retry 時自動縮減 context（focused → minimal）
- 減少無效重試，提高恢復成功率
- 不影響其他錯誤類型的行為

## Acceptance Criteria
- [ ] exit 143 被分類為 TIMEOUT
- [ ] retry 時觸發 rebuildContext
- [ ] 現有 TIMEOUT 行為不變
