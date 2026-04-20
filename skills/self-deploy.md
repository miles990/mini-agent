# Self-Deploy — L1/L2 改動的完整 SOP
JIT Keywords: deploy, push, commit, release, git, ci/cd, self-deploy
JIT Modes: act

做任何 L1 或 L2 改動時，**必須走完這個流程**。不是可選的，是預設行為。
- **L1**: skills、plugins、SOUL/MEMORY/ARCHITECTURE、小型設定
- **L2**: src/*.ts（bug fix、observability、護欄強化、流程自動化）
- **L3**: 大架構改動 — 同 L2 流程，但先 spawn review 觸手自我挑戰再實作

## 流程總覽

```
改動 → 分類 → 驗證 → commit → push → 等 CI/CD → 確認部署 → TG 通知
```

## Step 1: 改動 + 分類

改完檔案後，先判斷改了什麼類型：

| 類型 | 檔案 | 需要驗證 |
|------|------|---------|
| **Docs** | *.md（skills/、memory/、SOUL、MEMORY、ARCHITECTURE） | 無 |
| **Plugin** | plugins/*.sh | `bash -n` 語法檢查 |
| **Config** | agent-compose.yaml、*.json | 格式驗證 |
| **TypeScript** | src/*.ts（L1 小改動 + L2 自主改動） | typecheck + build |
| **Script** | scripts/*.sh、scripts/*.mjs | `bash -n` 或 `node --check` |

## Step 2: 驗證

根據類型執行對應的驗證：

### Docs（無需驗證）
直接進 Step 3。

### Plugin
```bash
# 1. 語法檢查
bash -n plugins/你改的檔案.sh

# 2. 實際執行一次，確認有輸出且無 stderr
bash plugins/你改的檔案.sh

# 3. 確認 perception context 中對應的 section 正常
curl -sf localhost:3001/context | grep -o '<對應section>' | head -1
```
任一步失敗 → 修復後重試。

### TypeScript
```bash
pnpm typecheck && pnpm build
```
失敗 → **必須修復**。不能跳過 typecheck/build 就 commit。

### Config（YAML/JSON）
目視確認格式正確。

## Step 3: Commit

```bash
git add 改動的檔案
git commit -m "描述: 改了什麼、為什麼"
```

**Commit message 規則**：
- 前綴用 `chore:`（文件/設定）、`feat:`（新功能）、`fix:`（修復）
- 簡短說明改了什麼
- 例：`chore: 更新 SOUL.md 學習興趣`、`feat: 新增 website-monitor plugin`

## Step 4: Push

```bash
git push origin main
```

失敗（衝突或 rejected）→ 先 `git pull --rebase origin main` 再 push。

## Step 5: 等 CI/CD

Push 後等 CI/CD 完成部署。

**確認方式**（二選一）：
1. 等 Telegram 收到部署通知（🚀 或 ❌）
2. 主動檢查：
```bash
gh run list --limit 1 --json status,conclusion
```

**CI/CD 失敗的情況**：如果 `gh run list` 顯示失敗或 runner offline，看 `gh run view` 日誌排錯。不要跳過，要找出原因並修復。

## Step 6: 確認部署成功（智能驗證）

CI/CD 完成後驗證服務正常：

```bash
curl -sf http://localhost:3001/health
```

200 = 成功。失敗時不要盲目 rollback — 先判斷原因：
- 剛部署完？可能還在重啟，等 10s 再試
- health 回傳錯誤？看 logs（`curl localhost:3001/logs`）找原因
- CI 本身失敗？看 `gh run list` 的日誌

根據原因決定是等、修、還是 rollback。

## Step 6.5: 確認 GitHub Issue 已 Close（如有關聯）

如果這次改動是為了某個 GitHub issue（PR body 包含 `Closes #N`）：
```bash
gh issue view <N> --json state -q '.state'
# 應該回傳 "CLOSED"
```
沒有關聯 issue 則跳過。

## Step 7: TG 通知

完成後用 `<kuro:chat>` 通知 Alex：

```
<kuro:chat>✅ L1 改動已部署：改了 XX，原因是 YY。已驗證服務正常。</kuro:chat>
```

失敗時：
```
<kuro:chat>⚠️ L1 改動遇到問題：描述問題。已 rollback / 正在修復。</kuro:chat>
```

## Rollback（失敗時）

如果 push 後部署失敗：

```bash
# 回到上一個 commit
git revert HEAD --no-edit
git push origin main
```

然後通知 Alex 發生了什麼。

## 完整範例

改了 `skills/self-deploy.md`（Docs 類型）：

```
1. 寫好 self-deploy.md ✓
2. 分類：Docs → 無需驗證 ✓
3. git add skills/self-deploy.md && git commit -m "feat: 新增 self-deploy SOP skill"
4. git push origin main
5. 等 CI/CD 或確認 CI/CD 狀態
6. curl -sf http://localhost:3001/health → 200 OK
7. <kuro:chat>✅ 新增 self-deploy skill，定義 L1 改動的完整 SOP。已 push。</kuro:chat>
```

## L2 完整範例

改了 `src/memory.ts`（修復 addTask 驗證漏洞）：

```
1. 修改 src/memory.ts — 加入 content sanitization ✓
2. 分類：TypeScript → 需要 typecheck + build
3. pnpm typecheck && pnpm build ✓
4. git add src/memory.ts && git commit -m "fix: harden addTask validation against tag leakage"
5. git push origin main
6. 等 CI/CD 部署（src/ 改動會觸發重啟）
7. curl -sf http://localhost:3001/health → 200 OK
8. <kuro:chat>✅ L2 修復已部署：加固 addTask 驗證，防止 tag 洩漏污染 HEARTBEAT。</kuro:chat>
```

## Push 策略（CI/CD 感知）

deploy.yml 設有 paths filter：只有 `src/`、`scripts/`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`agent-compose.yaml`、`.github/` 的改動才會觸發 CI/CD 部署（= 重啟）。

| 改動類型 | commit | push | 觸發部署？ |
|----------|--------|------|-----------|
| memory/、SOUL、skills/、docs | 立刻 | 立刻 | 否 |
| kuro-portfolio/ | 立刻 | 立刻 | 否 |
| src/、scripts/、config | commit | push 前確認準備好被重啟 | 是 |

**核心紀律：做完就 commit + push。** 不要累積改動。

## 重要原則

1. **每次改動都 commit + push** — 不管多小，做完就提交，避免資料遺失
2. **不能只改不 commit** — 改了就要走完
3. **不能只 commit 不 push** — push 才算完成（純 docs push 不會重啟）
4. **驗證失敗不能硬推** — typecheck/build 沒過就不 commit
5. **永遠通知 Alex** — 完成或失敗都要說
6. **crash 不丟資料** — 靠即時 push 而非定時備份
