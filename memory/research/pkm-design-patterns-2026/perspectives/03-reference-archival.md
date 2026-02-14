# Perspective: Reference Management & Web Archival

## Citation Management for Markdown

### BibTeX Integration

**工作流程**

```markdown
---
bibliography: references.bib
---

# Research Note

According to Smith [@smith2020], agent architectures...
```

配合 Pandoc 轉換：

```bash
pandoc note.md --filter pandoc-citeproc -o note.pdf
```

**BibTeX 檔案格式**

```bibtex
@article{smith2020,
  title = {Agent Memory Systems},
  author = {Smith, John},
  journal = {AI Research},
  year = {2020}
}
```

### Zotero + Markdown 整合

**Better BibTeX for Zotero**

- 自動生成 citation keys
- 即時同步到 `.bib` 檔案
- 支援 Obsidian/Logseq 整合

**工作流程**

1. Zotero 儲存文獻
2. Better BibTeX 產生 citation key（如 `smith2020agent`）
3. Markdown 中引用：`[@smith2020agent]`
4. Pandoc 編譯時自動插入完整引用

**優勢**

- 學術寫作標準
- 跨平台相容（LaTeX, Word, Markdown）
- 大型文獻庫管理（>1000 筆）

### 輕量級替代方案

**簡單 Markdown 腳註**

```markdown
根據研究[^1]，agent 架構...

[^1]: Smith, J. (2020). Agent Memory Systems. AI Research.
```

- 無需外部工具
- GitHub/GitLab 原生支援
- 適合小型知識庫

**DEVONthink "See Also" 模式**

DEVONthink 的 AI 功能：

- 分析文件內容（非標籤）
- 自動建議相關文件
- 使用相似度演算法（非向量搜尋）

**技術實作**（推測）

```typescript
// TF-IDF 或簡單的詞頻比對
function findRelated(doc: Document, corpus: Document[]): Document[] {
  const docTerms = extractTerms(doc);
  return corpus
    .map(candidate => ({
      doc: candidate,
      score: cosineSimilarity(docTerms, extractTerms(candidate))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(r => r.doc);
}
```

**Mini-Agent 應用**

類似功能可整合到 perception：

```xml
<workspace>
Current file: memory/proposals/2026-02-14-library-system.md
Related documents (by content similarity):
  - memory/proposals/2026-02-12-token-optimization.md (score: 0.85)
  - memory/topics/agent-architecture.md (score: 0.72)
  - memory/research/autogpt-babyagi-2026/synthesis.md (score: 0.68)
</workspace>
```

無需 embedding，用 TF-IDF 或更簡單的關鍵字重疊即可。

## Web Archival Patterns

### WARC Format (Internet Archive)

**格式特性**

- ISO 標準（ISO 28500）
- 可串接多個資源到單一檔案
- 包含 request/response headers、metadata
- Wayback Machine 使用此格式

**結構**

```
WARC/1.0
WARC-Type: response
WARC-Target-URI: https://example.com/article
Content-Type: text/html

<html>...</html>
```

**優勢**

- 完整保存 HTTP 層資訊
- 可重播（replay）完整瀏覽體驗
- 標準化、長期保存

**劣勢**

- 格式複雜，需專門工具讀取
- 檔案巨大（包含所有資源）
- 不適合人類直接閱讀

### SingleFile — 單一 HTML 保存

**技術實作**

- Browser extension（Chrome/Firefox）
- 將完整網頁（HTML + CSS + JS + 圖片）內嵌到單一 HTML
- 圖片轉 base64 data URI
- CSS/JS inline 到 `<style>` 和 `<script>`

**特性**

- 自給自足（self-contained）
- 可離線瀏覽
- 雙擊即可開啟（無需特殊工具）

**檔案大小**

- 普通文章：100-500KB
- 圖片多的頁面：5-20MB
- 包含影片：可達 100MB+

**自動化整合**

```bash
# CLI 模式
single-file https://example.com/article --output article.html

# 自動存檔（browser extension）
# 每個載入的頁面自動存到 Google Drive / Dropbox
```

**Mini-Agent 應用**

可整合到 web-learning 流程：

```bash
# plugins/web-archive.sh
if [ -n "$URL" ]; then
  single-file "$URL" --output memory/archive/$(date +%s).html
fi
```

### ArchiveBox — Self-hosted 網頁封存

**架構**

- Django Web UI + REST API
- SQLite 元資料 + 檔案系統內容
- 支援多種封存方式（WARC, SingleFile, screenshot, PDF）

**儲存結構**

```
data/
  index.sqlite3       — 元資料資料庫
  archive/
    1234567890/       — timestamp-based folders
      index.html
      screenshot.png
      article.pdf
      warc/
```

**特性**

- S3/B2/NFS 遠端儲存支援
- 排程自動抓取
- 全文搜尋（FTS5）
- Chrome headless 整合

**效能**

- 1000 篇文章：~1-50GB（視 MEDIA_MAX_SIZE）
- 搜尋：~100-500ms（有索引）

**Mini-Agent 應用情境**

對於 agent 而言，ArchiveBox 太重了（需要 Django + Docker）。

**更輕量的替代方案**

```
memory/archive/
  index.jsonl        — 元資料（URL, title, saved_at, path）
  content/
    YYYY-MM-DD/
      {hash}.html    — SingleFile 輸出
      {hash}.md      — Markdown 轉換（用於搜尋）
```

搭配 ripgrep 搜尋 `.md` 檔案，無需資料庫。

### Wallabag — Read-it-later Service

**架構**

- Symfony (PHP) web app
- 內容萃取：Graby + php-readability + ftr-site-config
- 儲存：資料庫 + 檔案系統
- RSS feeds、標註、匯出

**內容萃取流程**

```
URL → HTTP fetch → HTML parsing → Readability extraction → Markdown conversion
```

**特性**

- 去除廣告、彈窗
- 純文字閱讀模式
- 標註（highlighting + notes）
- Pocket/Instapaper 匯入

**Mini-Agent 啟示**

Wallabag 的核心是**內容萃取**，而非完整封存。

對 agent 而言，重點是「可搜尋的知識」，非「像素級重現」。

**建議流程**

```
URL → curl/CDP fetch → Readability.js → Markdown → memory/archive/{topic}/{title}.md
```

- 使用 Mozilla's Readability.js（零依賴）
- 輸出 Markdown（Git-friendly, 可搜尋）
- 保留 metadata（URL, saved_at, tags）

## 與 Mini-Agent 整合建議

### Level 1: Simple Archive

```markdown
---
url: https://example.com/article
archived_at: 2026-02-14T10:30:00Z
tags: [ai, agents]
---

# Article Title

(Markdown content extracted by Readability.js)

## Sources
Original: https://example.com/article
```

儲存位置：`memory/archive/YYYY-MM-DD/{slug}.md`

### Level 2: Topic-based Archive

```
memory/topics/
  agent-architecture/
    notes.md         — 手寫筆記
    sources/         — 封存的參考資料
      autogpt-analysis.md
      babyagi-critique.md
```

### Level 3: Backlink Integration

```markdown
# memory/topics/agent-architecture/notes.md

根據 [[sources/autogpt-analysis|AutoGPT 分析]]，memory 架構...
```

Backlinks 自動追蹤「哪些筆記引用了這個來源」。

## 效能與儲存權衡

| 方法 | 儲存大小 | 搜尋速度 | 保真度 | 實作複雜度 |
|------|---------|---------|--------|-----------|
| **WARC** | 大（完整） | 慢（需解析） | 100% | 高 |
| **SingleFile** | 中（內嵌） | 慢（HTML） | 95% | 中 |
| **Markdown** | 小（純文字） | 快（ripgrep） | 70% | 低 |
| **ArchiveBox** | 大（多格式） | 快（索引） | 100% | 高 |

**建議**：對 agent 知識管理而言，**Markdown 轉換優先**。需要完整保存時才用 SingleFile。

## Sources

- [Academic Markdown with BibTeX](https://medium.com/@chriskrycho/academic-markdown-and-citations-fe562ff443df)
- [Zotero Better BibTeX](https://retorque.re/zotero-better-bibtex/)
- [DEVONthink See Also Feature](https://www.devontechnologies.com/blog/20260210-graph-view-devonthink)
- [WARC Format Specification](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/)
- [Internet Archive WARC Introduction](https://archive.org/details/introduction-to-the-warc_202111)
- [SingleFile Browser Extension](https://github.com/gildas-lormeau/SingleFile)
- [ArchiveBox Documentation](https://github.com/ArchiveBox/ArchiveBox)
- [Wallabag Architecture](https://github.com/wallabag/wallabag)
