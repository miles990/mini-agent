# Knowledge Archival & Source Management — 2025-2026 研究報告

**研究問題**：AI agent 的知識/來源存檔系統的最新做法（2025-2026），特別關注符合 mini-agent 設計原則（File=Truth, No Database, 極簡）的方案。

**研究日期**：2026-02-14
**研究者**：Claude Code (Sonnet 4.5)

---

## Executive Summary

四個角度的研究發現，最有價值的洞見是：

1. **AI Agent 知識管理**：Letta/MemGPT 的 Context Repositories (2026-02) 驗證 file-based + git-versioned 記憶管理正確性。Personal agent 不需要 vector DB（AutoGPT 2023 年底已全部移除）。
2. **PKM 工具**：Obsidian/Logseq 的 backlink 機制核心價值在 **block-level referencing**（Logseq）和 **graph-based discovery**（Obsidian），可應用到 topic memory 交叉引用。
3. **Web Archiving**：SingleFile 2026 版本的關鍵改進 = proof of existence (SHA256→blockchain) + JS execution pre-processing。但 clean Markdown 轉換仍是更適合 agent 的格式。
4. **Citation 管理**：學術界已確認 **CSL YAML/JSON > BibTeX**（for Markdown workflows）。Better BibTeX 的穩定 citation key 機制值得借鏡。

**核心結論**：Library System 提案方向正確，但需整合三個業界最佳實踐：
- **Backlink**（Obsidian）→ `citedBy` 反向索引
- **YAML frontmatter**（Pandoc/CSL）→ structured metadata
- **Content-addressable storage**（Git）→ SHA256 hash 作為 truth anchor

---

## 角度一：AI Agent 知識管理

### 1. Letta (MemGPT) Context Repositories（最高價值）

**發現**（2026-02）：
- Letta Code 推出 Context Repositories = **programmatic context management + git-based versioning**
- MemGPT 的 archival memory 預設用 vector DB（Chroma/pgvector），但架構允許替換成 traditional databases
- Stateful agents 的核心 = **persistent memory that actually learns during deployment**

**對 mini-agent 的啟示**：
- ✅ **驗證 File=Truth 正確性**：Letta（$60M+ 融資）在 2026 年明確選擇 git-based versioning，證明 file-based 記憶管理在 agent 系統是可行的生產級方案
- ✅ **Programmatic context management**：不是把所有知識塞進 context，而是「程式化地決定載入什麼」— 跟 mini-agent 的 `buildContext()` keyword matching 同構
- ⚠️ **Personal vs Platform 分歧**：Letta 作為平台需要 performance（vector DB），mini-agent 作為 personal agent 可以保持簡單（grep + JSONL）

**是否適合整合**：
- **概念層面**：✅ Context Repositories 的 git versioning 概念完全符合，可作為 Library System 的理論支撐
- **技術層面**：❌ 不需要引入 vector DB，grep 在個人規模足夠（已在 agent-architecture.md 驗證）

### 2. AutoGPT 移除 Vector DB（歷史驗證）

**發現**（2023 年底）：
- AutoGPT 在 2023 年底移除**所有** vector DB 依賴（Pinecone, Milvus, Redis, Weaviate）
- 原因：個人 agent 的資料量不需要 vector search 的複雜度

**對 mini-agent 的啟示**：
- ✅ **No Embedding 原則被業界最大 open-source agent 驗證**
- ✅ Library System 保持 grep 搜尋是正確選擇

### 3. AutoGen / LangGraph（對比案例）

**發現**（2025）：
- LangGraph 和 LangChain 仍是最廣泛使用的 agentic AI frameworks
- AutoGen 快速成長，但都是 goal-driven 架構

**對 mini-agent 的啟示**：
- ⚠️ Goal-driven frameworks 的來源管理需求跟 perception-driven 不同
- mini-agent 的 Library System 是 **perception artifacts 的存檔**，不是 goal execution traces

---

## 角度二：Personal Knowledge Management (PKM)

### 1. Obsidian Backlink 機制（最高價值）

**發現**（2025）：
- **Backlink = bidirectional reference**：建立 `[[Link]]` 時，目標 note 自動顯示反向連結
- Graph View = 視覺化知識網路，促進 **non-linear thinking and discovery of hidden connections**
- Local-first + plain-text Markdown = 完全符合 File=Truth

**對 mini-agent 的啟示**：
- ✅ **`citedBy` 欄位 = Obsidian backlink 的實作**：Library System 提案的 `citedBy: string[]` 正是這個機制
- ✅ **可擴展方向**：未來可加 `/api/library/graph` endpoint，視覺化 topic memory ↔ library content 的引用網路
- ⚠️ **Block-level vs Document-level**：Logseq 的 block-level referencing 更細緻，但 mini-agent 的 topic entry 是 line-based，document-level backlink 剛好合適

**是否適合整合**：
- **當前**：✅ `citedBy` 欄位已在提案中，直接對應 Obsidian backlink 概念
- **未來**：✅ Knowledge graph API 可作為 Phase 3 改進

### 2. Logseq vs Obsidian（設計取捨）

**發現**（2025）：
- **Obsidian**：note-first, document-oriented, graph-based thinking
- **Logseq**：outline-first, block-level referencing, daily journaling

**對 mini-agent 的啟示**：
- mini-agent 的 topic memory = **line-based entries** = 介於 Obsidian (document) 和 Logseq (block) 之間
- Library System 的 content files = document-level，跟 Obsidian 對齊

### 3. File-Based PKM 的核心價值（驗證）

**發現**（2025）：
> "Local-first, plain-text options like Obsidian or Logseq are recommended for those who crave total ownership and infinite extensibility, valuing a system that adapts to them."

**對 mini-agent 的啟示**：
- ✅ **Transparency > Isolation 在 PKM 社群也是共識**
- ✅ 驗證 mini-agent 不走 Notion/Roam Research 的 cloud-based 路線是正確的

---

## 角度三：Web Archiving 技術

### 1. SingleFile 2026 版本改進（技術參考）

**發現**（2026）：
- **Proof of Existence**：SHA256 hash → blockchain，提供 tamper-evidence
- **JS Execution Pre-processing**：解決 JS-rendered 內容無法保存的問題
- **Integration**：Google Drive, GitHub, Amazon S3, WebDAV 自動備份
- **Mobile Support**：iOS Safari + Android Chrome 擴充功能

**對 mini-agent 的啟示**：
- ✅ **SHA256 hash 作為 truth anchor**：Library System 應在 catalog entry 加入 `contentHash: string` 欄位（SHA256），驗證原文未被竄改
- ✅ **JS-rendered 頁面處理**：mini-agent 已用 CDP (`cdp-fetch.mjs`)，天然支援 JS execution
- ❌ **Blockchain 整合**：對 personal agent 過度工程，但 Git commit SHA 本身就是 content-addressable storage

**是否適合整合**：
- **當前**：✅ 加入 `contentHash` 欄位到 catalog entry（低成本改進）
- **未來**：❌ Blockchain 不需要，Git history 已提供 immutability

### 2. HTML → Markdown 轉換（實務需求）

**發現**（2026）：
- SingleFile 預設輸出 = 單一 HTML 檔（base64 inline 所有資源）
- Clean Markdown 轉換 = 需要額外工具（Readability, Pandoc, Turndown）
- ArchiveBox 支援多格式輸出（HTML, WARC, PDF, Markdown）

**對 mini-agent 的啟示**：
- ⚠️ **CDP fetch 已輸出 text content**：`cdp-fetch.mjs` 的 `fetch` 命令回傳 cleaned text，但不是 Markdown
- ✅ **改進方向**：Library System 的 `archiveSource()` 應整合 HTML → Markdown 轉換
  - 選項 A：用 Readability algorithm（Mozilla 開源）
  - 選項 B：用 Pandoc（需外部依賴）
  - 選項 C：簡易 regex 清理（保持零依賴）

**是否適合整合**：
- **Phase 1**：✅ 先用簡易 regex 清理（零依賴，符合極簡原則）
- **Phase 2**：✅ 可選整合 Readability（如果品質不夠）

### 3. 格式選擇：MHTML vs Markdown vs WARC

**發現**（2026 Web Archiving 社群）：
- **MHTML**：完整保存，但二進位，Git 不友好
- **WARC**：標準存檔格式，但 agent 難直接讀取
- **Markdown**：人類可讀，Git 友好，適合 agent

**對 mini-agent 的啟示**：
- ✅ **Library System 選 Markdown 是正確的**
- Content files = Markdown + YAML frontmatter = 最佳 trade-off

---

## 角度四：Citation & Reference 管理

### 1. CSL (Citation Style Language) > BibTeX（關鍵發現）

**發現**（2025）：
> "If you are writing in markdown and using pandoc's default citation engine, you should use CSL YAML or CSL JSON, **not BibTeX**, since BibTeX will tend to produce inaccurate citations for non-book/journal citations."

**對 mini-agent 的啟示**：
- ✅ **Library System 應用 CSL-compatible metadata**，不是 BibTeX
- YAML frontmatter 格式應遵循 CSL 標準：
  ```yaml
  ---
  id: deobald-llm-problem
  title: The Problem with LLMs
  author: Steven Deobald
  url: https://deobald.ca/essays/...
  date: 2026-02-10
  type: article
  tags: [ai, ethics, buddhism]
  ---
  ```

**是否適合整合**：
- ✅ **當前提案已接近 CSL 格式**，只需微調欄位名稱（`fetchedAt` → `accessed`, 加入 `author`, `date`, `type`）

### 2. Better BibTeX 的 Citation Key 機制（技術借鏡）

**發現**（2025）：
- **Stable citation keys** = 人類可讀 + 無衝突（如 `deobald2026problem`）
- **Auto-generation from title** = 自動從 title 生成 kebab-case slug

**對 mini-agent 的啟示**：
- ✅ **Library System 的 `id` 欄位 = citation key**
- 當前提案：`id` 是手動 kebab-case slug（如 `deobald-llm-problem`）
- 改進方向：自動生成 = `{author-lastname}{year}{first-keyword}`（如 `deobald2026llm`）

**是否適合整合**：
- ⚠️ **手動 slug 更簡單**，auto-generation 需要 author/date parsing（增加複雜度）
- ✅ 保持當前提案的手動 slug，符合極簡原則

### 3. Zotero + Pandoc Workflow（參考模式）

**發現**（2025）：
- Workflow：Zotero 管理文獻 → Better BibTeX 匯出 → Pandoc 引用
- 支援 drag-and-drop citation keys 到 Markdown
- `[@deobald2026]` → 自動轉換成格式化引用

**對 mini-agent 的啟示**：
- ✅ **`ref:slug` 語法 = Pandoc citation 的簡化版**
- mini-agent 不需要完整 bibliography rendering，但可借鏡 citation key 的清晰性

---

## 整合建議

基於四個角度的研究，Library System 提案的改進方向：

### Phase 0（當前提案已包含）
- ✅ `catalog.jsonl` + `content/*.md` 結構
- ✅ `citedBy` 反向索引（Obsidian backlink 概念）
- ✅ YAML frontmatter（CSL-compatible metadata）

### Phase 1（新增建議）
1. **Content Hash**（SingleFile 啟發）
   ```jsonl
   {"id":"...", "contentHash":"sha256:abc123...", ...}
   ```
   - 用途：驗證原文未被竄改，支援 deduplication

2. **CSL-Compatible Metadata**（Citation 管理最佳實踐）
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

3. **HTML → Markdown 轉換**（Web Archiving 技術）
   - `archiveSource()` 整合簡易 HTML 清理
   - 保持零外部依賴（regex-based）

### Phase 2（未來擴展）
1. **Knowledge Graph API**（Obsidian Graph View）
   - `GET /api/library/graph` → 回傳 topic ↔ content 的引用網路
   - 前端視覺化（可選）

2. **Deduplication**（基於 contentHash）
   - 同一篇文章不同 URL → 自動 merge catalog entries

3. **Cross-Reference Discovery**（Letta Context Repositories）
   - 自動發現「被多個 topic 引用的高價值來源」

---

## 不建議整合的方案

| 方案 | 理由 |
|------|------|
| **Vector DB**（MemGPT） | 個人規模 grep 足夠，AutoGPT 已驗證 |
| **Blockchain**（SingleFile 2026） | Git commit SHA 已提供 immutability |
| **Neo4j / Graph DB**（Graphiti） | 違反 No Database，JSONL backlink 足夠 |
| **Pandoc Citation Rendering** | Agent 不需要格式化 bibliography |
| **Auto-generated Citation Keys** | 手動 slug 更簡單，符合極簡原則 |

---

## 結論

四個角度的研究結果高度一致：

1. **File-based 記憶管理**在 agent 系統是**生產級可行**方案（Letta 2026 驗證）
2. **Backlink 機制**是知識網路的核心（Obsidian/Logseq 共識）
3. **Markdown + YAML frontmatter**是最適合 agent 的存檔格式（Web Archiving + Citation 管理交集）
4. **Content hash**是 truth anchor 的最佳實踐（SingleFile 2026 + Git）

**Library System 提案方向完全正確**，只需三個低成本改進：
- 加入 `contentHash` 欄位
- 調整 YAML frontmatter 為 CSL-compatible
- 整合簡易 HTML → Markdown 轉換

所有改進都符合 **File=Truth, No Database, 極簡** 原則。

---

## Sources

- [Letta](https://www.letta.com/)
- [Letta Docs - MemGPT](https://docs.letta.com/concepts/memgpt/)
- [Top AI Agent Frameworks in 2025 | Codecademy](https://www.codecademy.com/article/top-ai-agent-frameworks-in-2025)
- [Obsidian vs LogSeq Comparison](https://www.glukhov.org/post/2025/11/obsidian-vs-logseq-comparison/)
- [12 Best Personal Knowledge Management Tools for 2025](https://blog.obsibrain.com/other-articles/personal-knowledge-management-tools)
- [Personal Knowledge Management (PKM)](https://www.glukhov.org/post/2025/07/personal-knowledge-management/)
- [SingleFile GitHub](https://github.com/gildas-lormeau/SingleFile)
- [Monolith GitHub](https://github.com/Y2Z/monolith)
- [How to Save a Complete HTML File as a Single File: 2026 Best Practices](https://copyprogramming.com/howto/how-can-i-save-a-complete-html-file-as-single-file)
- [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/)
- [Markdown Citations and References Guide](https://blog.markdowntools.com/posts/markdown-citations-and-references-guide/)
- [Markdown with BibTeX References Using Zotero](https://huckle.studio/Markdown-with-References/)
- [Zotero Better BibTeX - Citation Keys](https://retorque.re/zotero-better-bibtex/citing/)
