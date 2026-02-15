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

### 工具選擇（Shell-first）

**硬規則 #1：能用 shell 做的不用 Claude CLI。** curl/grep/jq 能做的事不浪費 API token。

| 任務 | 工具 | 範例 |
|------|------|------|
| HTTP 健康度檢查 | shell | `curl -sf URL -o /dev/null -w '%{http_code}'` |
| JSON 解析 | shell | `jq '.field'` |
| 檔案計數/搜尋 | shell | `grep -c pattern file` |
| HN top stories | shell | HN Firebase API + jq |
| 結構化摘要 | Claude CLI | `claude -p "..." --no-input --max-turns 1` |
| 翻譯（帶 style guide） | Claude CLI | `claude -p "..." --no-input --max-turns 1` |

### Shell Script（優先）

```bash
# 在 cycle 內直接用 Bash tool 跑
bash plugins/batch-http-check.sh
# 結果寫到 stdout，同一 cycle 內讀取判斷
```

### Claude CLI Subprocess（需要語言能力時）

```bash
# 極簡 prompt，不帶 SOUL/context/skills
claude -p "Fetch https://news.ycombinator.com and list top 15 titles with URLs. Output JSON array." \
  --no-input --max-turns 1 --output-format json
```

## 硬規則

1. **Shell-first** — 能用 curl/grep/jq 做的不用 Claude CLI
2. Subprocess 不帶 `--continue` — 無 session 延續
3. Subprocess 加 `--max-turns 1` — 防止自己跑多輪失控
4. Subprocess prompt 不包含 SOUL.md 內容 — 防止身份滲透
5. Subprocess 輸出不直接寫 `memory/` — 我自己決定要不要記住
6. Subprocess 不發 Telegram — 只有我跟 Alex 說話
7. Subprocess 最長 30s — 超時 kill，不等待

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
