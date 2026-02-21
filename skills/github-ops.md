# GitHub Operations — Issue/PR 判斷指南

當 `<github-issues>` 或 `<github-prs>` 感知中出現需要處理的項目時，依照此指南行動。

## Issue Triage 決策表

看到 `Needs Triage` 的 issue 時：

| Effort | Type | 處理方式 |
|--------|------|---------|
| **S（< 30min）** | bug / docs / config | 自己做：建 branch → 修復 → 開 PR |
| **M（30min-2h）** | feature / refactor | 委派 Claude Code：建 handoff（active.md 一行） |
| **L（> 2h）** | architecture | 寫 proposal → 等 Alex 審核 |

Triage 後：
1. `gh issue edit <N> --add-assignee @me` 或標明委派對象
2. 加 label：`bug`、`enhancement`、`proposal` 等
3. 如果委派 Claude Code，在 handoff 寫清楚 issue number

## 開 Branch + PR 流程

```bash
# 1. 建 branch
git checkout -b fix/issue-<N>-簡短描述

# 2. 實作...

# 3. 開 PR（Closes 語法會自動 close issue）
gh pr create --title "fix: 描述" --body "Closes #<N>"

# 4. Push
git push -u origin fix/issue-<N>-簡短描述
```

## PR Review 準則

看到 `<github-prs>` 中需要 review 的 PR：

1. `gh pr diff <N>` — 看改動
2. 判斷：
   - 改動符合 proposal/issue 描述？
   - TypeScript strict mode 通過？
   - 有沒有安全問題（OWASP top 10）？
   - 符合 Meta-Constraints（C1-C4）？
3. 行動：
   - 通過：`gh pr review <N> --approve`
   - 需要修改：`gh pr review <N> --request-changes --body "原因"`

## Mixed Review 模型

| 誰寫 | 誰 Review |
|------|----------|
| Kuro（L1） | 不需要，走 self-deploy |
| Kuro（L2 src/） | Claude Code review |
| Claude Code | Kuro review（透過 `<github-prs>` 感知） |
| 外部 contributor | Kuro 先 triage |

## Auto-Merge 說明

`src/github.ts` 會自動 merge 滿足以下條件的 PR：
- `reviewDecision === 'APPROVED'`
- 所有 CI checks 通過

感知中標記為 `★ READY-TO-MERGE` 的 PR 會在下個 cycle 被自動 merge。
如果想阻止自動 merge，在 PR 上加 `hold` label。

## gh CLI 速查

```bash
gh issue list --state open                    # 列出 open issues
gh issue create --title "..." --body "..."    # 建 issue
gh issue edit <N> --add-label "bug"           # 加 label
gh issue close <N>                            # 關 issue

gh pr list --state open                       # 列出 open PRs
gh pr create --title "..." --body "..."       # 建 PR
gh pr diff <N>                                # 看 PR diff
gh pr review <N> --approve                    # approve PR
gh pr merge <N> --merge --delete-branch       # merge PR
gh pr checks <N>                              # 看 CI 狀態
```
