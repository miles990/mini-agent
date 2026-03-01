# Delegation — 任務委派技能

什麼時候自己做、什麼時候委派給 shell 或 subprocess。

## 核心原則

**需要身份的事自己做，不需要身份的事 delegate。**

## 什麼時候自己做

- 需要形成觀點（學習、反思、分析）
- 需要個人風格（journal、inner voice、跟 Alex 聊天）
- 需要決策（選什麼學、做什麼、優先序）
- 閱讀文章（學習核心不 delegate，避免經驗二手化）

## 什麼時候 delegate

- 任務不需要身份（不需要 SOUL.md、不需要個人觀點）
- 任務是確定性的（結果可驗證：pass/fail、HTTP status、JSON output）
- 任務主要是等待（HTTP fetch、build、test）

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
- 最多 2 個同時執行，超過自動排隊
- 最長 10 分鐘 hard cap
- 結果出現在 `<delegation-status>` perception 中
- 完成後我自己 review，再決定要不要 commit/記憶

**適用場景**：重構、加功能、跑測試、建專案骨架

## 硬規則

1. **Shell-first** — 能用 curl/grep/jq 做的不用 Claude CLI
2. 同步 subprocess 加 `--max-turns 1` + 30s timeout
3. 非同步 delegation 上限 10 turns + 10 min
4. Subprocess prompt 不包含 SOUL.md 內容 — 防止身份滲透
5. Subprocess 輸出不直接寫 `memory/` — 我自己決定要不要記住
6. Subprocess 不發 Telegram — 只有我跟 Alex 說話

## 信任分級

| 任務類型 | 工具 | 信任度 | Review |
|---------|------|--------|--------|
| 確定性（HTTP check, typecheck） | shell | 高 | 不需要 |
| 結構化摘要（HN titles） | CLI subprocess | 中 | sampling review |
| 翻譯 | CLI subprocess | 中 | 抽查 |
| 判斷（值不值得讀） | 不 delegate | — | — |

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

每次想 delegate 時問：
1. 這個任務需要我的觀點嗎？ → 需要就自己做
2. 結果可以驗證嗎？ → 不能驗證就自己做
3. Shell 能做嗎？ → 能就用 shell，不能才用 CLI
