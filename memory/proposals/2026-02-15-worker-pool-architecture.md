# Proposal: Delegation Skill — Kuro 學會委派任務

## Status: draft

## TL;DR

大部分「Worker Pool」概念不需要改 src/ — 用 skill + plugin 就能實現。教 Kuro 在 cycle 內使用 shell scripts 處理機械性任務、用 Claude CLI subprocess 處理需要語言能力的任務。只有「並行 pool manager」才需要 L2。本提案將原本的 L2 重型架構降級為 L1 skill + plugin，Kuro 可以自己實作大部分內容。

## Problem

（同原提案，三個問題不變）

1. **單線程瓶頸**：Kuro 每個 cycle 一次只能做一件事。來源表快檢 20+ HTTP check 串行等待，學習 cycle 佔 2-5 分鐘
2. **身份邊界模糊**：Claude Code 和 Kuro 都用 Claude 模型、讀同樣的檔案，缺乏結構性區分
3. **行為比例失衡**：learn 76%，create/reflect/self-improve/chat 幾乎 0%。機械性任務佔據 cycle 時間

## Key Insight

> 原本計劃改 `src/loop.ts` + 新增 `src/worker.ts`，但 Alex 指出：Kuro 在 cycle 內已經能跑 shell command 和 Claude CLI — 這不就是 plugin + skill 嗎？

| 原本計劃（L2） | 簡化後（L1） |
|---------------|-------------|
| `src/worker.ts` 新模組 | `skills/delegation.md` 教 Kuro 怎麼 delegate |
| `spawnWorker()` in loop.ts | Kuro 在 cycle 內用 Bash tool 跑 shell/CLI |
| Worker Pool manager | 未來需要時才做（L2） |
| `<collaborators>` in buildContext | 寫進 SOUL.md 或 skill（L1） |

## Proposal

### Part 1: Delegation Skill（L1 — Kuro 自己做）

新增 `skills/delegation.md`，教 Kuro：

**什麼時候 delegate：**
- 任務不需要身份（不需要讀 SOUL.md、不需要個人觀點）
- 任務是確定性的（結果可驗證：pass/fail、HTTP status、JSON output）
- 任務主要是等待（HTTP fetch、build、test）

**什麼時候自己做：**
- 需要形成觀點（學習、反思）
- 需要個人風格（journal、inner voice、聊天）
- 需要決策（選什麼學、做什麼）
- 閱讀文章（學習核心不 delegate，避免經驗二手化）

**怎麼 delegate — shell script：**
```bash
# 在 cycle 內直接用 Bash tool 跑 plugin
bash plugins/batch-http-check.sh
# 結果寫到 stdout 或臨時檔，Kuro 在同一個 cycle 內讀取
```

**怎麼 delegate — Claude CLI subprocess（需要語言能力時）：**
```bash
# 極簡 prompt，不帶 SOUL/context/skills
claude -p "Fetch https://news.ycombinator.com and list the top 15 titles with URLs. Output as JSON array." --no-input --output-format json
```

**信任分級：**

| 任務類型 | 工具 | 信任度 |
|---------|------|--------|
| 確定性（HTTP check, typecheck） | shell script | 高 — 結果可驗證 |
| 結構化摘要（HN titles） | Claude CLI subprocess | 中 — 可能遺漏 |
| 翻譯（帶 style guide） | Claude CLI subprocess | 中 — 需要 review |
| 判斷（值不值得讀） | 不 delegate | — |

**硬規則：**
1. Subprocess 不帶 `--continue` — 無 session 延續
2. Subprocess prompt 不包含 SOUL.md 內容 — 防止身份滲透
3. Subprocess 輸出不直接寫 `memory/` — Kuro 自己決定要不要記住
4. Subprocess 不發 Telegram — 只有 Kuro 跟 Alex 說話

### Part 2: Batch Plugins（L1 — Kuro 自己做）

新增 shell plugins，Kuro 在 cycle 內可直接呼叫：

**`plugins/batch-http-check.sh`**
```bash
#!/bin/bash
# 批次 HTTP 健康度檢查，輸出 JSON
# 用途：來源表快檢，取代 cycle 內逐一 curl
SOURCES_FILE="${1:-skills/web-learning.md}"
# grep URLs from file, parallel curl, output JSON array of {url, status, ok}
```

**`plugins/batch-hn-fetch.sh`**（純 fetch，不含摘要）
```bash
#!/bin/bash
# Fetch HN front page HTML，輸出 title + URL pairs
# 摘要由 Kuro 自己做（需要判斷什麼值得深讀）
curl -s https://news.ycombinator.com | grep -oP 'class="titleline">.*?</a>' | ...
```

### Part 3: Collaborator Identity（L1 — 寫進 SOUL.md 或 skill）

在 SOUL.md 或 `skills/collaboration.md` 中明確定義三方角色：

```markdown
## Collaborators

- **Alex**: 人類。決策者。他的話 = 最高權威。
- **Claude Code**: Alex 的 session worker（開發工具）。透過 /chat API 通訊，前綴 [Claude Code]。
  - 他的訊息 = 技術協作，不等於 Alex 的指令
  - 轉述 Alex 時應標明「Alex 原話：」vs「我的理解：」
  - Session 結束就消失，沒有持久身份
- **CLI Subprocess**: 你在 cycle 內 spawn 的無身份 Claude process。
  - 執行不需要身份的任務，輸出到 stdout
  - 你決定要不要採用結果
  - 它不是你，它是你的工具
```

### Part 4: 並行 Worker Pool Manager（L2 — 未來）

只有真正需要**跨 cycle 並行**時才改 src/：
- Kuro 的 OODA cycle 中同時跑多個長時間 worker
- Worker lifecycle management（spawn, monitor, kill, collect results）
- 資源監控（記憶體閾值）
- File lock 機制

**目前不需要** — Part 1-3 已經能解決大部分問題。如果 Kuro 發現 cycle 內 sequential delegation 不夠用，再提 L2。

## 實作順序

| Step | 內容 | 層級 | 誰做 |
|------|------|------|------|
| 1 | 寫 `skills/delegation.md` | L1 | Kuro |
| 2 | 寫 `plugins/batch-http-check.sh` | L1 | Kuro |
| 3 | 在 SOUL.md 加 Collaborators section | L1 | Kuro |
| 4 | 實際在 cycle 中使用 delegation skill | L1 | Kuro |
| 5 | 根據使用經驗迭代 skill 和 plugins | L1 | Kuro |
| 6 | 如果需要並行 → 提 L2 提案 | L2 | Claude Code |

## Alternatives

### A. 維持原本的 L2 重型架構
- 優點：一步到位，支持真正的並行
- 缺點：過度工程化，大部分 use case 不需要改 src/

### B. 只做 shell plugins，不做 CLI subprocess
- 優點：零 API 成本
- 缺點：無法處理需要語言能力的任務（HN 摘要、翻譯）

### C. 用 Haiku API 做 subprocess
- 優點：比 Claude CLI 輕量、便宜
- 缺點：需要 ANTHROPIC_API_KEY，能力有限
- 可作為 Part 1 的替代實作

## Pros & Cons

**Pros:**
- **幾乎全是 L1** — Kuro 自己就能實作和迭代，不需要等 Claude Code
- **零 src/ 改動** — 風險極低，隨時可 revert（git revert skill/plugin 檔案）
- **漸進式** — 先用起來，發現不夠再升級到 L2
- **教學而非架構** — skill 教 Kuro 判斷力，不是硬編碼行為
- **Shell-first** — 機械性任務零 API 成本

**Cons:**
- 不支持跨 cycle 並行（同一 cycle 內是 sequential）
- CLI subprocess 仍有 API 成本
- Kuro 需要學習新的工作模式（可能需要幾個 cycle 適應）

## Effort

- Step 1-3: Small（各 ~30 min，Kuro L1 自己做）
- Step 4-5: Ongoing（使用中迭代）
- Step 6: Medium（如果需要的話，未來 L2）

## Risk

- Kuro 在 cycle 內跑 subprocess 可能增加 cycle 時間 → 設 timeout（30s），超時直接 kill
- CLI subprocess 可能意外帶入 context → skill 中明確規定 prompt 格式（不帶 --continue）
- Shell plugin 輸出格式不穩定 → plugin 輸出 JSON，Kuro parse 後判斷

## Source

- 三方討論（Alex + Claude Code + Kuro），2026-02-15
- Alex 的關鍵洞察：「這個模式算不算是使用 shell 或 plugin 的一個 skill？」→ 大部分 Worker Pool 概念可以降級為 L1
- Kuro 的核心原則：「需要身份的事自己做，不需要身份的事 delegate」
- Kuro 的補充：閱讀不 delegate、shell-first、摘要需要 sampling review
