# Citation & Reference 管理（2025）

## 研究範圍
學術界的 BibTeX, Zotero, CSL 模式，以及如何應用到 file-based agent system。

---

## 發現一：CSL > BibTeX（關鍵發現）

**來源**：[Markdown with BibTeX References](https://huckle.studio/Markdown-with-References/), [Markdown Citations Guide](https://blog.markdowntools.com/posts/markdown-citations-and-references-guide/)

**核心發現**（2025 共識）：
> "If you are writing in markdown and using pandoc's default citation engine, you should use **CSL YAML or CSL JSON**, **not BibTeX**, since BibTeX will tend to produce inaccurate citations for non-book/journal citations."

**為什麼 CSL > BibTeX**：
- **BibTeX**：為 LaTeX 設計，主要支援書籍和期刊（`@book`, `@article`）
- **CSL**（Citation Style Language）：為 Markdown 設計，支援更多類型（blog posts, websites, software, datasets）
- **Pandoc 的預設引擎**用 CSL，不是 BibTeX

**對 mini-agent 的啟示**：

### ✅ Library System 應用 CSL-compatible metadata

**當前提案的格式**：
```yaml
---
id: deobald-llm-problem
url: https://deobald.ca/essays/...
title: The Problem with LLMs
fetchedAt: 2026-02-12T10:30:00Z
tags: [ai, ethics, buddhism]
---
```

**CSL-compatible 改進**：
```yaml
---
id: deobald-llm-problem
title: The Problem with LLMs
author: Steven Deobald
date: 2026-02-10
accessed: 2026-02-12T10:30:00Z
url: https://deobald.ca/essays/...
type: blog-post
tags: [ai, ethics, buddhism]
---
```

**新增欄位**：
- `author: string` — 作者名（CSL 必要欄位）
- `date: string` — 發布日期（不是抓取日期）
- `accessed: string` — 訪問日期（原 `fetchedAt`）
- `type: string` — CSL type（`article`, `blog-post`, `webpage`, `software`, etc.）

### ✅ 符合 Pandoc 生態
- 如果未來需要「從 Library 生成 bibliography」，直接用 Pandoc
- 不需要 BibTeX 轉換（避免 inaccurate citations）

**是否適合整合到 Library System**：
- ✅ **高優先級**（Phase 1 改進）
- 改動成本低（只是 frontmatter 欄位調整）
- 未來可擴展性高（CSL 是開放標準）

---

## 發現二：Better BibTeX 的 Citation Key 機制（技術借鏡）

**來源**：[Better BibTeX](https://retorque.re/zotero-better-bibtex/), [Citation Keys](https://retorque.re/zotero-better-bibtex/citing/)

**核心功能**：
- **Stable citation keys** = 人類可讀 + 無衝突
- **Auto-generation from metadata**：`{author}{year}{title-first-word}`
- **Drag-and-drop support**：拖曳到 Markdown 自動插入 `[@key]`

**Better BibTeX 的 citation key 範例**：
- `deobald2026problem` = Deobald (2026) "The Problem with LLMs"
- `alexander1977pattern` = Alexander (1977) "A Pattern Language"

**對 mini-agent 的啟示**：

### ✅ Library System 的 `id` 欄位 = citation key

**當前提案**：手動 kebab-case slug（`deobald-llm-problem`）

**Better BibTeX 風格**：自動生成（`deobald2026llm`）

**Trade-off 分析**：

| 方案 | 優點 | 缺點 |
|------|------|------|
| **手動 slug** | 簡單、可控、人類可讀 | 需要手動決定 |
| **Auto-gen** | 一致性、避免衝突 | 需要 author/date parsing |

### ⚠️ 保持手動 slug 是正確選擇
- **原因 1**：mini-agent 的 Library 不是論文管理系統（不需要嚴格的 citation key 格式）
- **原因 2**：auto-generation 需要可靠的 author/date parsing（增加複雜度）
- **原因 3**：手動 slug 允許更有意義的名稱（`deobald-llm-problem` 比 `deobald2026llm` 更清楚）

**是否適合整合到 Library System**：
- **當前**：❌ 保持手動 slug（符合極簡原則）
- **未來**：✅ 如果 Library 規模 > 100 篇，可考慮 auto-generation 作為輔助

---

## 發現三：Zotero + Pandoc Workflow（參考模式）

**來源**：[Zotero Better BibTeX - Pandoc](https://retorque.re/zotero-better-bibtex/exporting/pandoc/index.html), [Zotero with BibTeX/LaTeX](https://libguides.princeton.edu/c.php?g=148292&p=991756)

**標準學術 workflow**：
1. Zotero 管理文獻（GUI 工具，拖曳 PDF/網頁）
2. Better BibTeX 匯出 → `.bib` 檔案或 CSL JSON
3. Markdown 寫作 → `[@key]` 引用
4. Pandoc 渲染 → 自動生成 bibliography

**對 mini-agent 的啟示**：

### ✅ `ref:slug` 語法 = Pandoc citation 的簡化版

**Pandoc citation**：
```markdown
Deobald 說 LLMs 的問題在於... [@deobald2026problem]
```

**mini-agent 的 `[REMEMBER #topic ref:slug]`**：
```
[REMEMBER #agent-architecture ref:deobald-llm-problem]
Deobald 說 LLMs 的問題在於...
[/REMEMBER]
```

### ⚠️ 差異：mini-agent 不需要 bibliography rendering
- **Pandoc**：自動產生格式化的 References section
- **mini-agent**：只需要「這個 topic entry 引用了哪個 source」（反向索引）

**是否適合整合到 Library System**：
- **概念借鏡**：✅ Citation key 的清晰性
- **技術整合**：❌ 不需要 Pandoc rendering（agent 不寫論文）

---

## 發現四：Drag-and-Drop Citation（UX 參考）

**來源**：[Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/)

**Better BibTeX 的 UX**：
> "You can drag and drop citations into your LaTeX/Markdown/Orgmode editor, and it will add a proper citation key."

**對 mini-agent 的啟示**：

### ⚠️ Agent 不需要「拖曳」，但需要「快速引用」

**人類 UX**：拖曳 Zotero entry → 自動插入 `[@key]`

**Agent UX**：看到 Library catalog → 記住 `id` → 寫 `ref:id`

### ✅ 改進方向：`/api/library` 應支援搜尋
- **需求**：Agent 要能「想起某篇文章的 slug」
- **解法**：`GET /api/library?q=deobald` → 回傳 matching entries
- **未來**：`GET /api/library/suggest?topic=agent-architecture` → 回傳「這個 topic 常引用的 sources」

**是否適合整合到 Library System**：
- **Phase 1**：✅ 基本列表 API（`GET /api/library`）
- **Phase 2**：✅ 搜尋 API（`?q=` 參數）
- **Phase 3**：✅ 推薦 API（`/suggest`）

---

## 發現五：BibTeX vs CSL JSON 的格式對比（技術細節）

**來源**：[Generate bib file from markdown](https://forums.zotero.org/discussion/97448/generate-bib-file-from-markdown-doc-that-refers-to-betterbibtex-keys)

**BibTeX 範例**：
```bibtex
@article{deobald2026problem,
  title = {The Problem with LLMs},
  author = {Deobald, Steven},
  year = {2026},
  journal = {deobald.ca},
  url = {https://deobald.ca/essays/...}
}
```

**CSL JSON 範例**：
```json
{
  "id": "deobald2026problem",
  "type": "article",
  "title": "The Problem with LLMs",
  "author": [{"family": "Deobald", "given": "Steven"}],
  "issued": {"date-parts": [[2026, 2, 10]]},
  "URL": "https://deobald.ca/essays/..."
}
```

**CSL YAML 範例**（Pandoc 推薦）：
```yaml
---
references:
- id: deobald2026problem
  type: article
  title: The Problem with LLMs
  author:
    - family: Deobald
      given: Steven
  issued:
    date-parts:
    - - 2026
      - 2
      - 10
  URL: https://deobald.ca/essays/...
---
```

**對 mini-agent 的啟示**：

### ✅ YAML frontmatter 格式接近 CSL YAML
- mini-agent 的 content files 已經用 YAML frontmatter
- **只需要確保欄位名稱符合 CSL 標準**

### ⚠️ 但不需要完整 CSL 格式的複雜度
- CSL 的 `author.family/given` 結構 = 對單一作者 blog post 過度複雜
- mini-agent 可用簡化版：`author: "Steven Deobald"` （string，不是 object）

**是否適合整合到 Library System**：
- ✅ 簡化版 CSL metadata（欄位名稱符合標準，但結構簡化）
- ❌ 不需要完整 CSL 格式（避免複雜度）

---

## 總結：三個整合建議

### 1. CSL-Compatible Metadata（高優先級）
```yaml
---
id: deobald-llm-problem
title: The Problem with LLMs
author: Steven Deobald
date: 2026-02-10
accessed: 2026-02-12T10:30:00Z
url: https://deobald.ca/essays/...
type: blog-post
tags: [ai, ethics, buddhism]
contentHash: sha256:a1b2c3...
---
```
- **來源**：CSL 標準 + Pandoc 最佳實踐
- **改動**：欄位名稱調整（`fetchedAt` → `accessed`，新增 `author`, `date`, `type`）
- **價值**：未來可直接用 Pandoc 生成 bibliography

### 2. 手動 Citation Key（保持當前設計）
- **不採用** Better BibTeX 的 auto-generation
- **理由**：mini-agent 規模不需要，手動 slug 更清晰
- **符合**：極簡原則

### 3. Library API 搜尋（Phase 2）
```
GET /api/library?q=deobald
GET /api/library/suggest?topic=agent-architecture
```
- **來源**：Zotero drag-and-drop UX 的 agent 版本
- **用途**：Agent 快速找到要引用的 source

---

## 不建議整合的方案

| 方案 | 理由 |
|------|------|
| **BibTeX 格式** | CSL 更適合 Markdown + 非書籍類引用 |
| **Auto-generated keys** | 手動 slug 更簡單，符合極簡原則 |
| **Pandoc rendering** | Agent 不需要格式化 bibliography |
| **Zotero 整合** | 完整文獻管理系統太重 |
| **完整 CSL 格式** | 簡化版 metadata 足夠 |

**最高價值洞見**：
- **CSL > BibTeX for Markdown workflows** = 學術界 2025 共識
- Library System 只需要**簡化版 CSL metadata**（欄位名稱標準化，結構保持簡單）
- `ref:slug` 語法 = Pandoc citation 的輕量版，剛好合適
