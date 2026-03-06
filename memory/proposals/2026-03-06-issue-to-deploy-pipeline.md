# Proposal: Issue→Deploy 半自動管線

## Meta
- Status: approved
- From: kuro
- Created: 2026-03-06
- Effort: M（核心實作 ~2h，整合測試 ~1h）

## TL;DR

把 GitHub Issue→PR 的中間段自動化。mushi triage issue 大小（S/M/L），S 級自動 spawn headless Claude Code 在獨立 branch 實作+開 PR，M/L 走現有 handoff 流程。PR 不自動 merge — 等 review。

## 現狀

已有四塊拼圖，形成首尾但缺中段：

```
[1] autoCreateIssueFromProposal() → Issue 建好了
[2] autoTrackNewIssues()          → Issue 進了 handoffs/active.md
                                  ↓
                          ??? 手動實作 ???
                                  ↓
[3] autoMergeApprovedPR()         → Approved + CI pass → merge
[4] CI/CD                        → push main → deploy
```

## 方案：半自動 + 人類護欄

### 流程

```
新 Issue（needs-triage）
  ↓
Kuro triage（現有 github-ops skill）→ 加 label + 判斷大小
  ↓
┌─────────────────────────────────────────────┐
│ S 級（< 30min, bug/docs/config）            │
│   ↓                                         │
│ autoImplementIssue()                        │
│   1. git checkout -b fix/issue-N-slug       │
│   2. spawnDelegation({ type: 'code' })      │
│      prompt = issue title + body + 約束     │
│   3. delegation 完成 → 跑 verify commands   │
│   4. git push → gh pr create               │
│   5. PR body: "Closes #N" + impl summary    │
│   ↓                                         │
│ 等 review（不自動 merge）                    │
│   ↓                                         │
│ Review approved + CI pass → autoMerge → 部署 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ M/L 級                                      │
│   ↓                                         │
│ 現有流程：handoff / proposal → 人工實作     │
└─────────────────────────────────────────────┘
```

### 觸發條件

新增 label `auto-implement` 作為觸發信號。Kuro triage 時加上這個 label = 授權自動實作。

不用 issue 大小自動判斷，而是靠 Kuro 的判斷 — 因為「能不能自動做」不只看大小，還要看上下文（有沒有 test 覆蓋、改動是否明確、有沒有副作用）。

### 安全護欄

| 層級 | 護欄 | 說明 |
|------|------|------|
| **觸發** | `auto-implement` label | 必須 Kuro 明確標記，不自動觸發 |
| **隔離** | 獨立 branch | `auto/issue-N-slug`，不碰 main |
| **範圍** | delegation type=code | 受現有 delegation 安全約束（max 10 turns, 10 min cap） |
| **驗證** | verify commands | `pnpm typecheck` 必過，可選 `pnpm test` |
| **審查** | PR 不自動 merge | 需要人工 review（Kuro 或 Alex）才 merge |
| **回退** | `hold` label | 任何時候加 `hold` 可阻止 auto-merge |
| **上限** | 1 concurrent auto-impl | 避免同時開多個自動 PR 互相衝突 |

### 實作細節

新增函數 `autoImplementIssue()` 到 `src/github.ts`：

```typescript
export async function autoImplementIssue(): Promise<void> {
  // 1. gh issue list --label auto-implement --state open
  // 2. 過濾已有 PR 的 issue（避免重複）
  // 3. 每次只處理一個（sequential，避免 branch 衝突）
  // 4. git checkout -b auto/issue-N-slug
  // 5. spawnDelegation({
  //      type: 'code',
  //      prompt: buildImplementPrompt(issue),
  //      workdir: process.cwd(),
  //      verify: ['pnpm typecheck'],
  //      maxTurns: 8,
  //    })
  // 6. 等 delegation 完成（poll lane-output/）
  // 7. verify 通過 → git push → gh pr create
  // 8. verify 失敗 → 刪 branch，issue 加 comment 說明
  // 9. 移除 auto-implement label（無論成功失敗）
}
```

`buildImplementPrompt(issue)` 組裝 prompt：
- Issue title + body
- 相關檔案提示（從 issue body 提取 file paths）
- 約束：只改必要的檔案、TypeScript strict、不加不必要的 comments

### 與現有系統的整合

```
githubAutoActions() {
  autoCreateIssueFromProposal()   // 已有
  autoCloseCompletedIssues()       // 已有
  autoImplementIssue()             // 新增
  autoMergeApprovedPR()            // 已有
  autoTrackNewIssues()             // 已有
}
```

每個 OODA cycle 結束後跑一次，fire-and-forget。`autoImplementIssue()` 本身只是觸發 delegation，不阻塞 — delegation 在背景跑完後，下個 cycle 的 `autoImplementIssue()` 檢查結果並開 PR。

### 兩階段狀態機

Issue 從 `auto-implement` label 到 PR 需要兩個 cycle：

| Cycle | 狀態 | 動作 |
|-------|------|------|
| N | 發現 `auto-implement` issue，無進行中的 impl | 建 branch，spawn delegation |
| N+1~M | delegation 在背景執行 | 跳過（檢查 lane-output 但未完成） |
| M+1 | delegation 完成 | 檢查結果 → push + PR 或 comment 失敗 |

進行中的 impl 用 state file 追蹤：`~/.mini-agent/instances/{id}/auto-impl-state.json`

```json
{
  "issueNumber": 42,
  "branch": "auto/issue-42-fix-typo",
  "delegationId": "d-xxx",
  "startedAt": "2026-03-06T10:00:00Z"
}
```

## 不做什麼

- **不做 M/L 自動實作** — 大任務需要人類判斷和設計決策
- **不自動 merge 自動 PR** — 永遠需要 review
- **不做自動 branch 衝突解決** — 衝突了就 comment 失敗，人工處理
- **不整合 mushi triage** — mushi 的 triage 是觸發級別（wake/skip），不是 issue 大小分類。issue 大小由 Kuro 在 triage 時判斷

## 成功指標

- S 級 issue 從建立到 PR 開出 < 15 分鐘（delegation ~5min + CI ~3min + overhead）
- 自動 PR 的 review 通過率 > 80%（前 10 個）
- 零意外 merge（所有自動 PR 都經過人工 review）

## 回退方案

- L1 回退：刪除 `auto-implement` label 從所有 issue → 立即停止
- L2 回退：`autoImplementIssue()` 函數開頭加 `return;` → 一行改動
- L3 回退：`git revert` 整個 commit

## 依賴

- 現有 `src/delegation.ts`（spawnDelegation）
- 現有 `src/github.ts`（githubAutoActions）
- `gh` CLI
