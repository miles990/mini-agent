# Knowledge Archival & Source Management 研究（2025-2026）

**研究日期**：2026-02-14  
**研究者**：Claude Code (Sonnet 4.5)  
**目的**：為 Library System 提案提供業界最佳實踐驗證

---

## 目錄結構

```
knowledge-archival-2026/
├── README.md                    # 本檔案（導覽）
├── synthesis.md                 # 綜合報告（最重要）
├── perspectives/                # 四個角度的詳細分析
│   ├── ai-agent-knowledge.md   # AI Agent 知識管理
│   ├── pkm-tools.md            # Personal Knowledge Management
│   ├── web-archiving.md        # Web Archiving 技術
│   └── citation-management.md  # Citation & Reference 管理
└── summaries/
    └── integration-checklist.yaml  # 結構化整合檢查清單
```

---

## 快速導覽

### 如果你只有 5 分鐘
閱讀 `synthesis.md` 的 **Executive Summary** 和 **整合建議** 部分。

### 如果你有 15 分鐘
1. 閱讀 `synthesis.md` 完整報告
2. 查看 `summaries/integration-checklist.yaml` 的 `phase_1_improvements`

### 如果你要深入了解某個角度
閱讀對應的 `perspectives/*.md` 檔案：
- **AI Agent 知識管理**：Letta, AutoGPT, LangGraph 的做法
- **PKM 工具**：Obsidian, Logseq 的 backlink 和 knowledge graph
- **Web Archiving**：SingleFile 2026, Monolith, ArchiveBox
- **Citation 管理**：CSL vs BibTeX, Zotero, Pandoc workflow

---

## 核心發現（TL;DR）

### 最高價值的三個洞見

1. **Letta Context Repositories (2026-02)**
   - Git-based versioning 驗證 file-based agent memory 可行性
   - Library System 不是「妥協方案」，是「生產級選擇」

2. **Obsidian Backlink 機制**
   - `citedBy` 欄位 = bidirectional reference 的實作
   - 不需要 graph database，JSONL + array 就能做到

3. **CSL > BibTeX（2025 共識）**
   - Markdown workflows 應用 CSL YAML/JSON，不是 BibTeX
   - Library System 只需調整 frontmatter 欄位名稱

### 三個整合建議（Phase 1）

1. **Content Hash**：在 catalog entry 加入 `contentHash: "sha256:..."` 欄位
2. **CSL-Compatible Metadata**：調整 YAML frontmatter（`fetchedAt` → `accessed`，新增 `author`, `date`, `type`）
3. **HTML → Markdown 轉換**：`archiveSource()` 整合簡易 regex-based 清理

### 五個不建議整合的方案

1. ❌ Vector DB（個人規模 grep 足夠）
2. ❌ Blockchain（Git commit SHA 已提供 immutability）
3. ❌ Graph DB（JSONL backlink 足夠）
4. ❌ Pandoc Rendering（agent 不需要格式化 bibliography）
5. ❌ Auto-generated Citation Keys（手動 slug 更簡單）

---

## 設計原則驗證

| 原則 | 驗證結果 | 來源 |
|------|---------|------|
| **File=Truth** | ✅ 驗證 | Letta git-based, Obsidian local-first |
| **No Database** | ✅ 驗證 | AutoGPT 移除 vector DB |
| **Minimalism** | ✅ 驗證 | 簡易 regex > Pandoc, 手動 slug > auto-gen |

所有研究角度都**強烈支援** Library System 提案的方向。

---

## 如何使用這份研究

### 給 Alex
- 閱讀 `synthesis.md` 了解業界最佳實踐
- 查看 `integration-checklist.yaml` 的 `phase_1_improvements`
- 決定是否核准 Library System 提案（含 Phase 1 改進）

### 給 Claude Code
- 參考 `perspectives/web-archiving.md` 實作 HTML → Markdown 轉換
- 參考 `perspectives/citation-management.md` 調整 YAML frontmatter
- 參考 `integration-checklist.yaml` 的實作細節

### 給 Kuro
- 了解 Library System 的理論基礎（不是憑空設計）
- 學習 Obsidian backlink, CSL metadata 等概念
- 未來可引用這份研究（`ref:knowledge-archival-2026`）

---

## 研究方法

1. **Web Search**：四個角度各一次搜尋（2025-2026 最新資訊）
2. **Cross-reference**：與 mini-agent 現有架構交叉驗證
3. **Trade-off Analysis**：分析每個方案的優缺點和適用性
4. **Integration Roadmap**：分 Phase 0/1/2/3 規劃整合優先級

---

## Sources（完整來源清單）

### AI Agent 知識管理
- [Letta](https://www.letta.com/)
- [Letta Docs - MemGPT](https://docs.letta.com/concepts/memgpt/)
- [Top AI Agent Frameworks 2025](https://www.codecademy.com/article/top-ai-agent-frameworks-in-2025)

### PKM 工具
- [Obsidian vs LogSeq](https://www.glukhov.org/post/2025/11/obsidian-vs-logseq-comparison/)
- [PKM Tools 2025](https://blog.obsibrain.com/other-articles/personal-knowledge-management-tools)
- [PKM Guide 2025](https://www.glukhov.org/post/2025/07/personal-knowledge-management/)

### Web Archiving
- [SingleFile GitHub](https://github.com/gildas-lormeau/SingleFile)
- [Monolith GitHub](https://github.com/Y2Z/monolith)
- [HTML to Single File Best Practices 2026](https://copyprogramming.com/howto/how-can-i-save-a-complete-html-file-as-single-file)
- [ArchiveBox](https://docs.archivebox.io/v0.6.0/README.html)

### Citation 管理
- [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/)
- [Markdown with BibTeX References](https://huckle.studio/Markdown-with-References/)
- [Markdown Citations Guide](https://blog.markdowntools.com/posts/markdown-citations-and-references-guide/)
- [Better BibTeX - Citation Keys](https://retorque.re/zotero-better-bibtex/citing/)
- [Pandoc Markdown/BibTeX](https://retorque.re/zotero-better-bibtex/exporting/pandoc/index.html)

---

## Meta

這份研究驗證了 Library System 提案的三個核心假設：
1. File-based 記憶管理在 agent 系統是可行的（Letta 2026 驗證）
2. Backlink 機制不需要 graph database（Obsidian 驗證）
3. Markdown + YAML frontmatter 是最適合 agent 的格式（CSL + Pandoc 驗證）

**結論**：Library System 提案方向完全正確，只需三個低成本改進（Phase 1）。
