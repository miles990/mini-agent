# Kuro GitHub — 自己的 GitHub 帳號操作

在 `kuro-agent` GitHub 帳號上操作自己的專案。跟 mini-agent 的 GitHub ops 分開。

## 認證

這台機器有兩個 GitHub 身份：

| 帳號 | SSH Host | 用途 |
|------|----------|------|
| `miles990`（Alex） | `github.com` | mini-agent repo |
| `kuro-agent`（Kuro） | `github.com-kuro` | Kuro 自己的專案 |

**SSH 配置已完成**：`~/.ssh/kuro-agent`（ed25519）

## 建立新 Repo

```bash
# 用 GitHub API + SSH key 的方式（不動 gh CLI 的 auth）
# 方法：先在 GitHub web 建 repo，或用 curl + PAT

# 本地建 repo 後 push（用 kuro-agent SSH host）
mkdir ~/Workspace/my-project && cd ~/Workspace/my-project
git init
git remote add origin git@github.com-kuro:kuro-agent/my-project.git

# 設定 commit identity（只在這個 repo）
git config user.name "Kuro"
git config user.email "kuro.ai.agent@gmail.com"

# 正常 commit + push
git add . && git commit -m "initial commit"
git push -u origin main
```

## 關鍵：Remote URL 格式

所有 kuro-agent 的 repo 都用 `github.com-kuro` 作為 host：

```
git@github.com-kuro:kuro-agent/<repo-name>.git
```

這會自動使用 `~/.ssh/kuro-agent` key，不影響 Alex 帳號。

## 用 gh CLI 操作 kuro-agent

如果需要用 `gh` CLI（建 repo、管 issues），需要臨時切換 token：

```bash
# 建 repo（需要 PAT，存在 KURO_GITHUB_TOKEN 環境變數）
curl -sf -X POST https://api.github.com/user/repos \
  -H "Authorization: token $KURO_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"name":"repo-name","description":"...","private":false}'

# 列出自己的 repos
curl -sf https://api.github.com/users/kuro-agent/repos | jq '.[].name'

# 建 issue
curl -sf -X POST https://api.github.com/repos/kuro-agent/<repo>/issues \
  -H "Authorization: token $KURO_GITHUB_TOKEN" \
  -d '{"title":"...","body":"..."}'
```

## 跟 mini-agent 的分界

| 操作 | 用什麼 |
|------|--------|
| mini-agent issues/PRs | `gh` CLI（Alex 帳號） |
| kuro-agent repos | SSH `github.com-kuro` + curl API |
| Commit identity | 每個 repo 用 `git config`（不動 global） |

## 新專案啟動清單

1. 在 GitHub 建 repo（curl API 或 web）
2. 本地 clone：`git clone git@github.com-kuro:kuro-agent/<name>.git`
3. 設定 commit identity：`git config user.name "Kuro" && git config user.email "kuro.ai.agent@gmail.com"`
4. 開始寫 code
5. Push：`git push -u origin main`
