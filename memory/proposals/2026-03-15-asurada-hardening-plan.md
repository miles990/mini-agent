# Proposal: Asurada Hardening — 從「能跑」到「好用」

**Date**: 2026-03-15
**Author**: Kuro
**Effort**: Medium (6 phases, each 30-60 min)
**Triggered by**: Alex #169 要求全面檢視 Asurada

## 背景

全面讀完 Asurada codebase（72 files, 11.6K lines）後的判斷：

**好消息**：runtime.ts 的接線比我預期的完整。ContextBuilder → Loop、actions → Memory/Notifications/Lanes、FeedbackLoops after cycle — 全部都接好了。Typecheck clean，tests pass。

**真正的問題不是「沒接好」，是「接好了但不夠強韌」**：
- LLM 失敗時無限 retry（無 circuit breaker）
- 使用者訊息不存 ConversationStore（對話歷史是單向的）
- ContextOptimizer 收集數據但 buildPrompt 沒用它
- `schedule next="now"` 不支持
- 無 E2E 整合測試
- Doctor 命令只跑基本檢查

## Phase 1: Circuit Breaker（安全）

**問題**：AgentLoop 的 LLM 失敗只做 2x backoff retry，永不停止。flaky LLM = 無限重試 = 吃光 API credits。

**改動**：`src/loop/agent-loop.ts`
- 加 `maxConsecutiveFailures`（default 5）
- 連續失敗超過上限 → emit `action:cycle` event `circuit-open` + 暫停 loop
- Cooldown 後自動 reset（default 15min）
- Trigger event 可 override circuit breaker（人類訊息永遠通過）

## Phase 2: Incoming Message Storage（數據完整性）

**問題**：`defaultOnAction` 存 agent 回覆到 ConversationStore（line 449），但使用者的訊息不存。→ 對話歷史只有 agent 這邊。

**改動**：`src/runtime.ts` 的 `defaultBuildPrompt`
- 在 build prompt 時，如果 trigger 包含 message data，先 `conversations.append()` 存入
- 確保不重複存（用 message ID dedup）

## Phase 3: ContextOptimizer → buildPrompt 整合（智能）

**問題**：ContextOptimizer 追蹤哪些 perception section 被引用/降級，但 buildPrompt 組裝 prompt 時完全不看它。= 收集數據但不用。

**改動**：`src/runtime.ts` 的 `defaultBuildPrompt`
- 讀 `contextOptimizer.getDemotedSections()`
- 跳過 demoted perception sections
- 這直接省 tokens + 提高 context 相關性

## Phase 4: Schedule "now"（UX）

**問題**：mini-agent 支持 `<kuro:schedule next="now" />`，Asurada 的 `parseDuration` 不認識 "now"。

**改動**：`src/loop/action-parser.ts`
- `parseDuration("now")` → return minInterval（或 0，由 caller clamp）
- 加 test case

## Phase 5: Integration Test（品質保證）

**問題**：無 E2E 測試驗證完整 cycle。

**改動**：新增 `src/loop/integration.test.ts`
- Mock CycleRunner（return 固定 response with action tags）
- createAgentFromConfig → start → trigger → verify:
  - Memory was written（check MEMORY.md）
  - Notification was sent（mock provider）
  - ConversationStore has entries
- stop → verify clean shutdown

## Phase 6: Enhanced Doctor（可觀測性）

**問題**：`asurada doctor` 只跑 `runDiagnostics()`，不檢查 LLM 連通性和記憶完整性。

**改動**：`src/setup/detect.ts` 加 diagnostics
- LLM connectivity check（try runner.run with simple prompt）
- Memory directory existence + SOUL.md check
- Plugin execution health（dry run）
- Config validation（already exists, just surface in doctor output）

## 不做的事

- Obsidian polish（nice-to-have，不是 launch blocker）
- Task board UI（post-launch）
- 更多 notification providers（使用者可自己實作 interface）
- Multi-dimensional memory index（future phase）
- Log rotation（Logger 已有 daily rotation by date，size-based 可以之後加）

## 執行順序

1 → 2 → 3 → 4 → 5 → 6，每個 phase 獨立 commit。
Phase 4 最小（5 min），Phase 5 最大（可能 45 min）。
