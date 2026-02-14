# Personal Knowledge Management 工具（2025）

## 研究範圍
Obsidian, Logseq, Notion, Roam Research 的 backlink 和 knowledge graph 機制。

---

## 發現一：Obsidian Backlink 機制（最高價值）

**來源**：[Obsidian vs LogSeq](https://www.glukhov.org/post/2025/11/obsidian-vs-logseq-comparison/), [PKM Tools 2025](https://blog.obsibrain.com/other-articles/personal-knowledge-management-tools)

**核心機制**：
- **Backlink = bidirectional reference**：建立 `[[Link]]` 時，目標 note 自動顯示反向連結
- **Graph View**：視覺化知識網路，促進 non-linear thinking
- **Discovery of hidden connections**：透過 graph traversal 發現意想不到的關聯

**技術細節**：
> "Every time you create a link, Obsidian creates a backlink — a reference in the original note that shows all other notes linking to it, which promotes non-linear thinking and discovery of hidden connections."

**Obsidian 的三個核心優勢**（2025）：
1. **Local-first + plain-text Markdown** = 完全符合 File=Truth
2. **Graph-based thinking** with interactive graph view
3. **Plugin ecosystem**（1000+ plugins）

**對 mini-agent 的啟示**：

### ✅ Library System 的 `citedBy` = Obsidian backlink
- 提案中的 catalog entry 格式：
  ```jsonl
  {"id":"deobald-llm-problem", ..., "citedBy":["agent-architecture","design-philosophy"]}
  ```
- **這正是 Obsidian backlink 的實作**！

### ✅ 可擴展方向：Knowledge Graph API
- Obsidian 的 Graph View = 視覺化 note ↔ note 的連結
- mini-agent 可實作 `/api/library/graph` = 視覺化 topic ↔ content 的引用網路
- 前端視覺化（可選，不強制）

### ⚠️ Document-level vs Block-level
- Obsidian = **document-level backlink**（整篇 note 的連結）
- Logseq = **block-level backlink**（段落級的連結）
- mini-agent topic memory = **line-based entries** = document-level 剛好合適

**是否適合整合到 Library System**：
- **當前**：✅ `citedBy` 欄位已在提案中，直接對應 Obsidian backlink
- **Phase 2**：✅ Knowledge graph API 可作為未來改進
- **Graph View UI**：❌ 不需要（personal agent 不是 GUI 工具）

---

## 發現二：Logseq 的 Block-level Referencing（設計取捨）

**來源**：[Obsidian vs LogSeq](https://www.glukhov.org/post/2025/11/obsidian-vs-logseq-comparison/)

**核心差異**：
- **Logseq**：outline-first, **block-level referencing**, daily journaling
- **Obsidian**：note-first, document-oriented, graph-based thinking

**Block-level referencing 的優勢**：
> "Logseq's block-level referencing offers more granular connections, while Obsidian's approach is cleaner for document-oriented workflows."

**對 mini-agent 的啟示**：

### ⚠️ mini-agent 不需要 block-level backlink
- Topic memory 的結構 = **一行一條 entry**（line-based）
- Library content = **整篇文章**（document-based）
- **Line ↔ Document 的對應關係**剛好是 document-level backlink

### ✅ Daily journaling 模式已在 mini-agent
- Logseq 的核心用法 = daily notes + block references
- mini-agent 的 `daily/*.md` = 類似結構
- 差異：mini-agent 用 keyword matching 載入 topics，不需要手動 reference

**是否適合整合到 Library System**：
- ❌ Block-level backlink 對 mini-agent 過度複雜
- ✅ Document-level backlink（Obsidian 模式）剛好合適

---

## 發現三：File-Based PKM 的核心價值（驗證）

**來源**：[PKM 2025](https://www.glukhov.org/post/2025/07/personal-knowledge-management/)

**業界共識**（2025）：
> "Local-first, plain-text options like Obsidian or Logseq are recommended for those who crave **total ownership and infinite extensibility**, valuing a system that adapts to them."

**Obsidian vs Cloud PKM 的選擇**：
- **Obsidian/Logseq**：local vault, Markdown files, total ownership
- **Notion/Roam Research**：cloud-based, proprietary format, vendor lock-in

**對 mini-agent 的啟示**：

### ✅ Transparency > Isolation 在 PKM 社群也是共識
- **Total ownership** = 你控制所有資料（不是平台控制）
- **Infinite extensibility** = 可以用任何工具讀寫（因為是 plain text）
- mini-agent 的 File=Truth 原則 = PKM 社群的最佳實踐

### ✅ 驗證 mini-agent 不走 cloud-based 路線
- Notion AI, Roam Research = 把知識鎖在平台上
- mini-agent Library System = 所有原文存在本地 Git repo
- **未來不需要擔心「平台倒閉」或「API 改變」**

**是否適合整合到 Library System**：
- ✅ 完全驗證當前方向正確（Markdown + local storage）

---

## 發現四：PKM 的 Graph Visualization（參考案例）

**來源**：[Visualize PKM Knowledge Graphs](https://infranodus.com/use-case/visualize-knowledge-graphs-pkm)

**現有工具的做法**：
- **InfraNodus**：可視覺化 Obsidian/Roam/Logseq 的 knowledge graph
- **Graph analysis**：找出 highly connected nodes（hub concepts）
- **Gap detection**：找出缺少連結的區域（knowledge gaps）

**對 mini-agent 的啟示**：

### ✅ 知識圖譜的價值在「發現意外連結」
- 不是「我知道 A 和 B 有關，所以連結它們」
- 而是「我不知道 A 和 B 有關，圖譜讓我發現」

### ⚠️ 但 personal agent 的圖譜需求不同於人類 PKM
- **人類**：需要視覺化（用眼睛看 graph）
- **Agent**：可以直接查詢（用 API 讀 `citedBy`）
- mini-agent 可能**不需要 graph UI**，但需要 **graph query API**

**是否適合整合到 Library System**：
- **Phase 1**：❌ 不需要 visualization
- **Phase 2**：✅ Graph query API（`/api/library/related/:id`）= 找出跟某 source 有共同 topic 的其他 sources
- **Phase 3**：❌ Graph UI（除非 Alex 明確需要）

---

## 發現五：Backlink 的實作細節（技術參考）

**來源**：[PKM Knowledge Graphs Discussion](https://forum.obsidian.md/t/personal-knowledge-graphs/69264)

**Obsidian backlink 的兩種模式**：
1. **Linked mentions**：顯式的 `[[Link]]`
2. **Unlinked mentions**：出現相同關鍵字但未建立連結

**對 mini-agent 的啟示**：

### ✅ Library System 只需要 linked mentions
- `[REMEMBER #topic ref:slug]` = 顯式建立連結
- 自動偵測 unlinked mentions（關鍵字匹配）= 已在 `buildContext()` keyword matching 實作

### ✅ Backlink 的更新時機
- Obsidian：寫入時立即更新 backlink index（in-memory）
- mini-agent：寫入時更新 `citedBy` in catalog.jsonl（append-only）

**是否適合整合到 Library System**：
- ✅ 當前提案已包含（`appendTopicMemory()` 同步更新 `citedBy`）

---

## 總結：三個可整合設計

| PKM 概念 | mini-agent 對應 | 整合建議 |
|----------|----------------|---------|
| **Backlink** | `citedBy: string[]` | ✅ 已在提案，直接實作 |
| **Graph View** | `/api/library/graph` | ✅ Phase 2，API only（無 UI） |
| **Local-first** | `memory/library/*.md` | ✅ 已在提案，完全符合 |
| **Block-level ref** | — | ❌ 不需要，document-level 足夠 |
| **Daily journaling** | `daily/*.md` | ✅ 已存在，無需改動 |

**最高價值洞見**：
- Obsidian backlink = **最簡單有效的知識網路機制**
- Library System 的 `citedBy` 欄位 = 這個機制的直接實作
- 不需要複雜的 graph database，**JSONL + array 就能做到**
