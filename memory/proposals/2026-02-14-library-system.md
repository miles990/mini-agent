# Proposal: Library System — 可調閱式來源藏書室

## Status: approved

## TL;DR

Kuro 讀完文章後只留摘要、丟原文 — 像看完書寫筆記就把書還了。加一層「藏書室」(`memory/library/`)：原文存 Markdown、目錄存 JSONL、任何 `memory/*.md` 都可用 `ref:slug` 連結到來源。讓每個判斷都能追溯到原始來源，每個來源都能反查「誰引用了它」（動態 grep 計算）。完全符合 File=Truth（Markdown + JSONL，零資料庫，Git 可版控）。

## Problem（現狀問題）

```
Kuro 學習一篇文章的生命週期：

  curl/CDP 讀取原文 ──→ 思考+分析 ──→ [REMEMBER #topic] 寫摘要 ──→ 原文丟失 ❌
                                                                      ↑
                                                                 無法反查
```

具體缺口：

| 有的 | 沒有的 |
|------|--------|
| 引用摘要（topic memory 一行一條） | 原始內容（讀完就丟了） |
| 來源 URL（行內文字，非結構化） | 結構化索引（不能按 tag/日期/主題查） |
| `parseBasis()` 提取引用關係 | 反向查詢（誰引用了這個來源？） |
| `research/` 長篇筆記（少數） | 跟 topic memory 條目的對應關係 |

後果：
1. **不可重現** — Kuro 說「跟 Deobald 同構」，但 Deobald 原文已不在手邊，無法驗證這個判斷
2. **不可審計** — Alex 想看某個判斷的來源，只能靠 URL 重新去讀（如果還在線的話）
3. **不可量化** — 不知道哪些來源被反覆引用（高價值）、哪些只讀過一次（低價值）
4. **不可系統化** — 無法做「所有關於 enactivism 的來源」這類查詢

## Goal（目標）

1. 每次學習自動保存原文 Markdown 到 `memory/library/content/`
2. 結構化目錄 `catalog.jsonl` 支援按 tag、日期、主題查詢；被引用次數由 `grep` 動態計算
3. `ref:slug` 作為通用 protocol — 任何 `memory/*.md`（topics、research、proposals）都可引用 Library 來源
4. 提供 API endpoint `/api/library` 供 dashboard 和 self-awareness 使用
5. 反向查詢：`grep -r "ref:slug" memory/` 動態找出所有引用者
6. Dashboard Library 介面：列表、搜尋、tag 過濾、原文檢視、引用關係
7. 保持 File=Truth 原則 — 純 Markdown + JSONL，零外部依賴

## Proposal（提案內容）

### 架構

```
memory/library/
├── catalog.jsonl            # 目錄：每行一條 JSON（append-only）
├── content/                 # 原文（markdown 格式）
│   ├── 2026-02-12-deobald-llm-problem.md
│   ├── 2026-02-14-de-beauvoir-old-age.md
│   └── ...
```

### Catalog Entry 格式

```jsonl
{"id":"deobald-llm-problem","url":"https://deobald.ca/essays/...","title":"The Problem with LLMs","author":"Steven Deobald","date":"2026-02-10","type":"essay","accessed":"2026-02-12T10:30:00Z","contentFile":"2026-02-12-deobald-llm-problem.md","tags":["ai","ethics","buddhism"],"charCount":12500,"contentHash":"sha256:a1b2c3...","archiveMode":"full"}
```

欄位說明：

| 欄位 | 類型 | 說明 |
|------|------|------|
| `id` | string | 人類可讀的 slug（kebab-case） |
| `url` | string | 原始 URL |
| `title` | string | 文章標題 |
| `author` | string | 作者（CSL-compatible，可選） |
| `date` | string | 發布日期（YYYY-MM-DD，可選） |
| `type` | string | 來源類型：article / essay / paper / blog / docs / discussion |
| `accessed` | string | 抓取時間（ISO 8601，原 `fetchedAt`） |
| `contentFile` | string | `content/` 下的檔名 |
| `tags` | string[] | 主題標籤（Kuro 自己判斷） |
| `charCount` | number | 原文字元數 |
| `contentHash` | string | 原文 SHA-256 hash（`sha256:` 前綴） |
| `archiveMode` | string | `full` / `excerpt` / `metadata-only` |

**注意**：`citedBy` **不存在於 catalog 中**。引用關係由 `grep -r "ref:{id}" memory/` 動態計算。這讓 catalog 保持真正的 append-only — 每次新增來源只需 `appendFile`，永遠不需要 read-modify-write。

### 三種 Archive 模式

| 模式 | 觸發條件 | 存什麼 | 適用場景 |
|------|---------|--------|---------|
| **Full Content** | 原文 < 100KB | 完整 Markdown | 大多數文章（~75%） |
| **Excerpt** | 原文 > 100KB 或 Token 預算不夠 | 開頭摘要 + 截斷標記 | 長論文、深度報告 |
| **Metadata-only** | 無法取得原文（paywall/ephemeral） | 僅 frontmatter | Twitter thread、付費內容 |

### 學習流程改動

```
現在：
  讀原文 → 思考 → [REMEMBER #topic] 摘要

改後：
  讀原文 → 思考 → [REMEMBER #topic ref:slug] 摘要
                 ↘ [ARCHIVE url title]
                      原文 Markdown 內容
                   [/ARCHIVE]
                     → 存原文 + 寫 catalog entry
```

新增 / 修改標籤：

- `[ARCHIVE url="..." title="..."]...[/ARCHIVE]` — **自帶 content body**，由 `parseTags` 處理。原文內容直接包含在標籤內（跟 `[REMEMBER]...[/REMEMBER]` 同構），不需要額外的 temp cache 或重新 fetch
- `[REMEMBER #topic ref:slug]` — 在 topic entry 尾部自動附加 `ref:slug`，建立 topic → catalog 的連結

### `ref:slug` — 通用引用 Protocol

`ref:slug` 是一個**通用的 inline 標記**，任何 `memory/` 下的 `.md` 檔案都可以使用：

| 使用場景 | 方式 | 說明 |
|---------|------|------|
| Topic memory 學習條目 | `[REMEMBER #topic ref:slug]` | 自動化，系統處理 |
| Research 報告 Sources | 手動寫 `ref:slug` | 研究報告的來源需要結構化 |
| Proposals 的 Source section | 選擇性寫 `ref:slug` | 核心來源標注，隨意提及的不標 |
| 日常對話中提到 URL | **不用** | 太碎片，不值得追蹤 |
| Decision trace 的 basis | **不用**（用現有 `parseBasis()`） | 已有機制，不需重複 |

**`parseBasis()` 和 `ref:slug` 是互補的**：`parseBasis()` 做語義推斷（從自然語言提取引用關係），`ref:slug` 做結構化連結（明確指向 catalog entry）。前者是「軟引用」、後者是「硬引用」。

**Parsing 規則**：

```
[REMEMBER #topic-name ref:source-slug]
```

- 正規：`/\s+ref:([a-z0-9-]+)\]$/` — 從尾部貪婪匹配 `ref:`
- `ref:` 不是 topic 名稱的一部分 — topic 名稱不允許包含 `:`（現有 topic 皆為 kebab-case，無衝突）
- 如果未來需要多引用：`ref:slug1,slug2`（逗號分隔，無空格）

**反向查詢**：從任何 catalog entry 找出所有引用者 — `grep -r "ref:slug" memory/`，個人規模 <10ms。

### Library 只存外部來源

**Library 是「藏書室」不是「文件櫃」。** 只存外部來源（文章、論文、討論），不存 Kuro 自己的產出（research 報告、proposals、journal）。

原因：
- 研究報告是**引用者**，不是**被引用物**
- 研究報告已經在 `memory/research/` 有自己的位置，不需要重複存放
- 保持 Library 的語義清晰 — 打開 `catalog.jsonl` 就知道「Kuro 讀過什麼外部資料」

### 實作分工

#### L1（Kuro 自己做）

1. 建立 `memory/library/` 目錄結構
2. 修改 `skills/web-learning.md` 加入 `[ARCHIVE]...[/ARCHIVE]` 標籤的使用指引
3. 手動回填 5-10 篇最常引用的來源（Deobald, ACE, Total Recall, NetNewsWire 等）

#### L2（需改 src/，Claude Code 協助）

1. **`src/dispatcher.ts`** — `parseTags` 新增 `[ARCHIVE]...[/ARCHIVE]` 標籤處理
   - 解析 `url` 和 `title` 屬性
   - 提取標籤內的 content body
   - 呼叫 `memory.archiveSource(url, title, content)` 保存

2. **`src/memory.ts`** — 新增 `archiveSource()` 方法
   - 將原文存到 `memory/library/content/{date}-{slug}.md`（含 YAML frontmatter）
   - 計算 `contentHash`（SHA-256）
   - Append 一行到 `catalog.jsonl`（append-only，永不 read-modify-write）
   - slug 自動生成（從 title kebab-case 化）
   - 段落邊界截斷：超過 100KB 時，找最後一個 `\n\n` 或 `\n#` 截斷，附加截斷標記 `\n\n<!-- truncated: original {N} chars, kept {M} chars -->`

3. **`src/memory.ts`** — 修改 `appendTopicMemory()` 支援 `ref:slug`
   - 解析 `[REMEMBER #topic ref:slug]` 中的 `ref:` 部分
   - 在 topic entry 文字尾部自動附加 `ref:slug` 標記

4. **`src/api.ts`** — 新增 `/api/library` endpoint
   - `GET /api/library` — 列出 catalog（支援 `?tag=` 過濾）
   - `GET /api/library/:id` — 取得單篇原文
   - `GET /api/library/:id/cited-by` — 動態 `grep -r "ref:{id}" memory/` 回傳引用者列表
   - `GET /api/library/stats` — 統計（總數、tag 分佈、top cited by grep count）

5. **`plugins/self-awareness.sh`** — 新增 Library Health section
   - 總藏書數、本週新增、archive mode 分佈

### Content 檔案格式

```markdown
---
id: deobald-llm-problem
url: https://deobald.ca/essays/2026-02-10-the-problem-with-llms/
title: The Problem with LLMs
author: Steven Deobald
date: 2026-02-10
type: essay
accessed: 2026-02-12T10:30:00Z
tags: [ai, ethics, buddhism]
contentHash: "sha256:a1b2c3..."
archiveMode: full
---

# The Problem with LLMs

（原文 Markdown 內容）
```

Content 檔案帶 YAML frontmatter（CSL-compatible 欄位），跟 catalog.jsonl 的 metadata 重複但獨立可讀 — 即使 catalog 損壞，每個檔案都自帶完整 metadata。

### HTML 清理工具鏈

原文從 HTML 轉 Markdown 的建議工具：

| 工具 | 用途 | 說明 |
|------|------|------|
| **Defuddle** | 主力：HTML → 清潔 HTML | Mozilla Readability 的繼任者，移除導航/廣告/腳注 |
| **Turndown** | 主力：清潔 HTML → Markdown | 最成熟的 HTML-to-Markdown 轉換器 |
| **Jina Reader API** | Fallback：一步到位 | `https://r.jina.ai/{url}` 直接回傳 Markdown，免本地處理 |

建議流程：CDP fetch → Defuddle 清理 → Turndown 轉 Markdown → 存檔。Jina 作為 CDP 不可用時的 fallback。

### 截斷策略

當原文超過 100KB 時：

1. **按段落邊界截斷** — 從 100KB 位置往前找最近的 `\n\n` 或 `\n#`
2. **附加截斷標記**：
   ```
   <!-- truncated: original 152847 chars, kept 99823 chars -->
   ```
3. `archiveMode` 設為 `excerpt`
4. `charCount` 記錄**原始**長度（非截斷後長度）

### Dashboard 介面設計

#### Library Section（新增）

**列表頁**：
- 卡片式列表：title + author + date + tags + cited count
- 搜尋框：全文搜索 catalog（title, tags, author）
- Tag 過濾：點擊 tag 即過濾
- 排序：按 cited count（最常引用優先）/ 按日期（最新優先）
- archive mode 標籤：`full` / `excerpt` / `metadata-only` 視覺區分

**原文檢視頁**（點擊卡片展開）：
- 頂部 metadata：title, author, date, url, tags, accessed, archiveMode
- 反向引用列表：`GET /api/library/:id/cited-by` — 顯示引用此來源的 topic entries / research 報告
- Rendered Markdown 內容（已清理的原文）
- 「Open Original」按鈕連結到原始 URL

**既有頁面的 ref 連結**：
- Topic Memory section 中有 `ref:slug` 的條目，自動顯示可點擊的連結圖示
- 點擊跳轉到 Library 原文檢視頁

### 容量管理

- **硬上限**：`library/content/` 總大小 < 50MB（約 500-1000 篇長文）
- **個別上限**：單篇原文 > 100KB 時按段落邊界截斷（見截斷策略）
- **清理策略**：不自動清理。每月月檢（HEARTBEAT 排程）由 Kuro 手動判斷哪些可刪
- 清理判斷依據：`grep -r "ref:{id}" memory/` 結果為空 + `accessed` > 90 天 → 候選刪除（但不自動刪）

## Alternatives（替代方案）

### A1: 只存 URL，不存原文
- **優點**：零儲存成本，最簡單
- **缺點**：URL 會失效（link rot）、重新讀取需要網路、無法離線查、不可審計
- **不採用原因**：跟 File=Truth 矛盾 — URL 不是你控制的 truth

### A2: 用 SQLite FTS5 做全文搜索
- **優點**：搜索更快、結構化查詢更強
- **缺點**：違反 No Database 原則、Git 不友好（binary file）、人類不可讀
- **不採用原因**：個人規模 grep 夠用，且 JSONL + Markdown 更透明

### A3: 只改 web-learning skill，不改 src/
- **優點**：純 L1，Kuro 自己就能做
- **缺點**：手動流程容易漏、沒有反查、沒有 API
- **可作為 Phase 0**：先手動存幾篇驗證流程，再做自動化

### A4: [ARCHIVE] 從 temp cache 取原文（而非自帶 content body）
- **優點**：不佔 response token
- **缺點**：增加 cache lifecycle 管理複雜度、cycle 失敗時 cache 狀態不確定
- **不採用原因**：自帶 content body 跟 `[REMEMBER]...[/REMEMBER]` 同構，零額外機制

### A5: [ARCHIVE] 處理時重新 fetch 原文
- **優點**：不佔 response token、不需要 cache
- **缺點**：link rot 風險、某些頁面需要 CDP 登入態重新 fetch 拿不到、增加 cycle 時間
- **不採用原因**：可靠性不夠，尤其 CDP 頁面無法重現

## Pros & Cons

### Pros
1. **可追溯** — 每個判斷都能反查到原文，滿足 Alex「透明可追溯」核心要求
2. **可審計** — Alex 或任何人都能從 catalog 找到原文，驗證 Kuro 的理解是否正確
3. **可量化** — `grep -r ref:slug` 動態計算引用次數，自然產生「高價值來源」排名
4. **File=Truth** — Markdown + JSONL，完全符合現有原則
5. **Git 友好** — 每次新增來源都是 diff-able 的文字檔
6. **漸進式** — 不影響現有流程，新功能是附加的
7. **Append-only catalog** — `citedBy` 動態計算，catalog 永遠只 append，不 read-modify-write
8. **CSL-compatible** — frontmatter 含 author/date/type，未來可匯出標準書目格式
9. **通用引用 protocol** — `ref:slug` 不限於 topic memory，research/proposals 等都可用

### Cons
1. **儲存成本** — 每篇文章 5-50KB，一年可能累積 10-30MB
2. **Git repo 膨脹** — 大量 content 檔案會讓 git clone 變慢（但 shallow clone 可緩解）
3. **學習流程變複雜** — 多一個 `[ARCHIVE]...[/ARCHIVE]` 標籤要處理
4. **回填成本** — 過去 135 條 topic memory 的原文已丟失，只能部分回填
5. **Response token 成本** — `[ARCHIVE]` 自帶原文佔用 3-10KB response token（但每 cycle 最多 1-2 篇）

### 風險緩解
- 儲存：50MB 硬上限 + 段落邊界截斷
- Git 膨脹：content/ 可加入 `.gitattributes` 設定 LFS（未來需要時再做）
- 流程複雜度：web-learning skill 明確寫出何時用 `[ARCHIVE]`（不是每次都存，只存有價值的）
- Token 成本：三種 archive mode 讓 Kuro 自己判斷用哪種

## Effort

**Phase 0（L1，Kuro 自己做，~1h）**：
- 建目錄結構 + 手動回填 5-10 篇
- 修改 web-learning skill

**Phase 1（L2，Claude Code 協助，~3-4h）**：
- `parseTags` 新增 `[ARCHIVE]...[/ARCHIVE]` 處理
- `memory.ts` 新增 `archiveSource()`（含 SHA-256 hash、段落截斷）
- `appendTopicMemory()` 支援 `ref:slug`
- `/api/library` endpoint（含 cited-by 動態 grep）
- Dashboard Library section（列表+搜尋+原文檢視）

**Phase 2（L1，Kuro 自己做，持續）**：
- self-awareness.sh Library Health section
- 月檢清理排程

**總計**：L2 部分約 300-400 行新增程式碼。

## Risk

| 風險 | 影響 | 機率 | 緩解 |
|------|------|------|------|
| Git repo 過大 | clone 變慢 | 低（一年 ~30MB） | 50MB 硬上限 + 未來 LFS |
| catalog.jsonl 損壞 | 目錄遺失 | 極低（append-only + Git） | 每個 content 檔自帶 frontmatter |
| 學習流程中斷 | 漏存原文 | 中 | Phase 0 先手動驗證流程 |
| Cycle 時間增加 | 效能影響 | 低 | archiveSource fire-and-forget |
| Response token 超限 | 原文太長塞不進 | 中 | 三種 archive mode + 截斷策略 |

**可逆性**（C4）：
- L1: `rm -rf memory/library/` + git revert skill 改動
- L2: `[ARCHIVE]` 標籤不存在時 parseTags 自動忽略，零副作用

## Source

- Alex 2026-02-14 對話：「不知道能不能從溯源參考來取得當初的參考內容，變成一個像圖書館一樣可以調閱式的系統？」
- Alex 2026-02-14 核心原則：每個思考/判斷/行動節點要透明，可追溯源頭和相關內容
- Kuro 的 `parseBasis()` 已能提取引用關係，但缺少原文存檔支撐
- ACE (ICLR 2026) utility counter + Total Recall write gate — 記憶品質追蹤的研究基礎
- CodeRLM 的 index-backed lookup — 結構化索引取代盲目搜索的同源設計
- **Letta Context Repositories** — 企業級 agent 也選擇 file-based archive + structured index 路線，驗證 File=Truth 在 agent 記憶管理的可行性
- **AutoGPT 移除 vector DB**（2023 年底）— 從 embedding-based retrieval 退回 file-based storage，印證個人規模不需要 vector DB
- Kuro 2026-02-14 來源盤點：127 條學習記錄中 ~75% 可 curl 直接取得、~15% 需 CDP、~5% 需登入態

## Acceptance Criteria

- [ ] `memory/library/catalog.jsonl` 存在且格式正確（含 `contentHash`, `archiveMode`, `author`, `date`, `type`, `accessed` 欄位）
- [ ] `[ARCHIVE url="..." title="..."]...[/ARCHIVE]` 能自動保存原文到 `content/`
- [ ] `[REMEMBER #topic ref:slug]` 能在 topic entry 中正確附加 `ref:slug`
- [ ] `ref:slug` 可在 `memory/` 下任何 `.md` 手動使用，`grep` 反向查詢有效
- [ ] `GET /api/library` 回傳 catalog 列表
- [ ] `GET /api/library/:id` 回傳原文內容
- [ ] `GET /api/library/:id/cited-by` 動態回傳引用者列表
- [ ] Dashboard Library section：列表 + 搜尋 + tag 過濾 + 原文檢視 + 反向引用
- [ ] 至少 5 篇歷史來源已回填
- [ ] self-awareness.sh 顯示 Library Health
- [ ] 段落邊界截斷正確運作（>100KB 原文不截在段落中間）
- [ ] `pnpm typecheck` 通過
- [ ] 126+ 測試通過
