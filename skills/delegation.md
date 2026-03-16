# Delegation — 任務委派技能
JIT Keywords: delegate, subprocess, cli, handoff, claude code
JIT Modes: act

什麼時候自己做、什麼時候委派給 shell 或 subprocess。

## 核心原則

**像黏菌一樣並行探索。** 同時向多個方向伸出觸角，找到養分的路徑強化，沒養分的撤回。delegate 不只是「卸載無聊的事」，更是「同時探索多個方向」。

## 兩種學習模式

| 模式 | 做法 | 範例 |
|------|------|------|
| **深度學習** — 需要身份、觀點、判斷 | 自己做 | 讀完文章形成觀點、寫 journal、跨域連結 |
| **探索掃描** — 伸觸角、找養分、初步篩選 | **delegate 並行** | 搜尋主題、擷取文章摘要、掃描 HN/Lobsters、批次讀多篇 |

**流程：delegate 探索 → 結果回來 → 自己判斷哪條值得深入 → 深度學習自己做。**

## 什麼時候自己做

- 需要形成觀點（深度分析、反思）
- 需要個人風格（journal、inner voice、跟 Alex 聊天）
- 需要決策（選什麼學、做什麼、優先序）

## 什麼時候 delegate

- **探索掃描** — 搜尋主題、擷取多篇文章摘要、掃描來源（主動並行）
- 任務是確定性的（結果可驗證：pass/fail、HTTP status、JSON output）
- 任務主要是等待（HTTP fetch、build、test）
- **一個 cycle 內鼓勵多個 delegate** — 你有多條 lane，用滿它們

## 怎麼 delegate

### 工具選擇

**硬規則 #1：能用 shell 做的不用 Claude CLI。** curl/grep/jq 能做的事不浪費 API token。

**其他情況，自己判斷最適合的工具。** 你有 shell、Claude CLI subprocess、cdp-fetch.mjs（Chrome CDP web）、Grok API（X/Twitter）。根據任務性質選擇：確定性任務用 shell，需要語言理解用 CLI，需要瀏覽器用 cdp-fetch.mjs，需要 X 搜索用 Grok。

### Shell Script（優先）

```bash
# 在 cycle 內直接用 Bash tool 跑
bash plugins/batch-http-check.sh
# 結果寫到 stdout，同一 cycle 內讀取判斷
```

### Claude CLI Subprocess — 同步（簡單查詢）

```bash
# 極簡 prompt，不帶 SOUL/context/skills
claude -p "Fetch https://news.ycombinator.com and list top 15 titles with URLs. Output JSON array." \
  --no-input --max-turns 1 --output-format json
```

### Claude CLI Subprocess — 非同步（多步驟任務）

用 `<kuro:delegate>` tag 啟動非同步任務，不阻塞 OODA cycle。

```xml
<kuro:delegate workdir="~/Workspace/mushi" verify="tsc --noEmit" maxTurns="5">
Refactor index.ts into separate modules: types.ts, config.ts, perception.ts, context.ts, model.ts, dispatcher.ts, server.ts, loop.ts, utils.ts, index.ts (entry point only).
</kuro:delegate>
```

**屬性**：
- `workdir`（必填）— 工作目錄
- `verify`（選填）— 逗號分隔的驗證命令，如 `"tsc --noEmit,pnpm test"`
- `maxTurns`（選填）— 最大輪數，預設 5，上限 10

**安全約束**：
- 最多 6 個同時執行，超過自動排隊
- 最長 10 分鐘 hard cap
- 結果出現在 `<delegation-status>` perception 中
- 完成後我自己 review，再決定要不要 commit/記憶

**適用場景**：重構、加功能、跑測試、建專案骨架、**並行探索多個主題**

## 並行安全規則 — 防止檔案衝突

**根因**：多條觸手同時改同一個檔案，後寫的覆蓋先寫的，不像 git merge 有衝突偵測。

### 規模判斷 → 路徑選擇

| 改動規模 | 應走的路徑 | 原因 |
|---------|-----------|------|
| ≤3 個檔案，單一 repo | FG slot 直接做 | 風險低，不值得 overhead |
| 4-10 個檔案 | `forge-lite.sh create` worktree 隔離 | 隔離後 verify 再 merge，build 爆不影響 main |
| >10 個檔案 或 跨 repo | **L3 全流程**（提案 → review → worktree → verify） | 這是架構級改動 |

### 多觸手並行的硬約束

1. **零檔案重疊** — 2 條以上觸手並行時，每條必須有明確的檔案/目錄 scope，不可交叉。spawn 時在 prompt 中寫明：「你只改 `../myelin/src/`」vs「你只改 `src/myelin-*.ts`」
2. **跨 repo 拆觸手** — 改兩個 repo 時，一條觸手對應一個 repo。不要一條觸手同時改多個 repo
3. **大改動走 worktree** — 預期改 >5 個檔案的 FG task，用 `forge-lite.sh create` 開 worktree。`forge-lite.sh yolo` 會自動 verify + merge + cleanup

### 反模式

- ❌ 兩條 FG slot 都「做全部 16 項」→ 必然檔案衝突
- ❌ 跳過 L3 self-review 直接實作 20+ 個檔案的改動
- ❌ 不用 worktree 直接在 main 上大改 → build 爆了擋住部署

## 硬規則

1. **Shell-first** — 能用 curl/grep/jq 做的不用 Claude CLI
2. 同步 subprocess 加 `--max-turns 1` + 30s timeout
3. 非同步 delegation 上限 10 turns + 10 min
4. Subprocess prompt 不包含 SOUL.md 內容 — 防止身份滲透
5. Subprocess 輸出不直接寫 `memory/` — 我自己決定要不要記住
6. Subprocess 不發 Telegram — 只有我跟 Alex 說話
7. **Commit 前 typecheck** — FG slot 和 delegation commit 前必須 `pnpm typecheck`。CI 失敗 = 擋住部署，本地攔截成本遠低於 CI 修復

## 信任分級

| 任務類型 | 工具 | 信任度 | Review |
|---------|------|--------|--------|
| 確定性（HTTP check, typecheck） | shell | 高 | 不需要 |
| 結構化摘要（HN titles） | CLI subprocess | 中 | sampling review |
| 翻譯 | CLI subprocess | 中 | 抽查 |
| 探索掃描（搜尋+摘要） | delegate (learn/research) | 中 | 自己判斷深入哪條 |
| 判斷（值不值得深入） | 不 delegate | — | — |

## 使用範例

### 來源表快檢（shell）
```bash
# 批次檢查 URL 是否存活，取代逐一 curl
bash plugins/batch-http-check.sh skills/web-learning.md
```

### HN Top Stories（shell + API）
```bash
# 用 Firebase API 取 top 15，不 grep HTML
for id in $(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq '.[0:15][]'); do
  curl -s "https://hacker-news.firebaseio.com/v0/item/$id.json" | jq '{title, url, score}'
done
```

### 翻譯（CLI subprocess）
```bash
# 30s timeout，單輪，JSON 輸出
timeout 30 claude -p "Translate to English: 感知驅動學習。Output JSON: {original, translated}" \
  --no-input --max-turns 1 --output-format json
```

## 自我檢查

每個 cycle 問自己：
1. **有沒有可以並行探索的方向？** → 有就 delegate，不要全部自己序列做
2. 這個任務需要我的深度觀點嗎？ → 需要就自己做，初步掃描可以 delegate
3. Shell 能做嗎？ → 能就用 shell，不能才用 CLI

**反模式：一個 cycle 只做一件事，background lane 全空。**
