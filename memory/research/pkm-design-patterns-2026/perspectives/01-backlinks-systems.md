# Perspective: Backlink Systems

## 核心發現

### 雙向連結的技術實作

**Obsidian 實作模式**

- **儲存格式**：純文字 Markdown，使用 `[[note-name]]` wikilinks 語法
- **反向查找**：啟動時掃描所有檔案建立連結索引（in-memory graph）
- **區塊級連結**：支援 `[[Note#^block-id]]` 直接連結到段落
- **實作成本**：啟動時 O(n) 掃描，查詢時 O(1) lookup

**Logseq 的創新點**

- Block-based outliner，每個區塊都可獨立連結
- 儲存格式仍是 Markdown 檔案，但透過 block ID 實現細粒度連結
- 技術上最驚豔的是「以資料夾 Markdown 檔案模擬 Roam 的線上資料庫」
- 與 Roam 功能相同，但完全 file-based

**檔案系統實作工具**

1. **note-link-janitor** (Andy Matuschak)
   - 維護 backlinks 章節於檔案末尾
   - 使用 HTML comment 避免視覺污染
   - 格式：`[[like this]]`
   
2. **zettelcon**
   - CLI 工具，自動插入 backlinks 到 markdown 檔案
   - In-place 編輯，需備份原始檔案
   - 適合 Zettlr 等編輯器

3. **Dendron**
   - VS Code 擴充套件
   - 階層式命名：`recipes.vegetarian.md` 建立父子關係
   - Backlinks 透過 lookup 介面快速導航
   - 支援 schema（YAML）定義階層結構

## 反向查找問題的解法

| 方法 | 優點 | 缺點 | 適用場景 |
|------|------|------|----------|
| **啟動時索引** | 查詢極快 | 啟動慢（大 vault） | 中小型知識庫 (<1000 notes) |
| **檔案內嵌入** | 無依賴、可攜 | 維護成本、檔案變大 | 靜態知識庫 |
| **ripgrep 即時掃描** | 零索引、簡單 | 每次查詢掃描全部 | 小型或讀多寫少 |
| **SQLite FTS5** | 全文搜尋強、相關性排序 | 需維護資料庫 | 大型知識庫 (>10k notes) |

## Mini-Agent 的應用啟示

### 當前架構對應

Mini-agent 已經使用類似模式：

```typescript
// memory/topics/*.md — topic-based scoped memory
async readTopicMemory(topic: string): Promise<string>
```

但**缺少反向查找**：給定一個檔案，不知道哪些其他檔案引用它。

### 建議實作路徑

**Level 1: Passive Backlinks（檔案內嵌入）**

```bash
# 在 memory/topics/agent-architecture.md 末尾
---
## Backlinks
- [[SOUL.md]] — 引用此檔案在「競品研究」區塊
- [[proposals/2026-02-10-memory-lifecycle.md]] — 引用此檔案討論 memory 架構
```

- 優點：無需額外工具，Git-friendly
- 實作：`scripts/update-backlinks.sh` 定期執行（cron）
- 適合現有 file-based 架構

**Level 2: Active Index（啟動時建立）**

```typescript
// src/backlink-index.ts
class BacklinkIndex {
  private links: Map<string, Set<string>>; // target -> sources
  
  async scan(memoryDir: string): Promise<void> {
    // 掃描所有 .md 檔案，解析 [[...]] 和 markdown links
    // 建立反向索引
  }
  
  getBacklinks(file: string): string[] {
    return Array.from(this.links.get(file) ?? []);
  }
}
```

- 優點：查詢快、動態更新
- 成本：啟動時掃描 ~100-200ms（1000 檔案）
- 觸發時機：workspace change 時重建索引

**Level 3: 與 Perception 整合**

```xml
<workspace>
Current file: memory/proposals/2026-02-14-library-system.md
Backlinks (3):
  - memory/HEARTBEAT.md (line 42)
  - memory/topics/agent-architecture.md (section "Library Systems")
  - memory/daily/2026-02-14.md (3 mentions)
</workspace>
```

讓 Agent 意識到「這個提案在哪些地方被引用」，強化上下文理解。

## 資料格式建議

**Wikilinks vs Markdown Links**

| 格式 | 語法 | 優點 | 缺點 |
|------|------|------|------|
| Wikilinks | `[[file]]` | 簡潔、Obsidian/Logseq 支援 | 非標準 Markdown |
| Markdown | `[text](file.md)` | 標準、GitHub 支援 | 冗長、需要 display text |
| 混合 | `[[file\|text]]` | 兼顧可讀性 | Obsidian 獨有 |

**建議**：使用標準 Markdown links，保持 GitHub-friendly。但接受 wikilinks 作為輸入（agent 可以寫 wikilinks，工具轉換成標準格式）。

## 效能特性

**ripgrep vs SQLite FTS5 基準**

| 操作 | ripgrep | SQLite FTS5 | 備註 |
|------|---------|-------------|------|
| 搜尋 1000 檔案 | ~50-200ms | ~20-50ms | FTS5 快 2-4x |
| 索引建立 | 0ms | ~500ms | ripgrep 無索引 |
| 磁碟佔用 | 0 | +30% | FTS5 需要索引檔 |
| 相關性排序 | 無 | 有 | FTS5 支援 BM25 |

**Obsidian 實際效能**（根據論壇討論）

- 12,000 檔案 vault：啟動時間 ~5-10s（建立索引）
- 搜尋回應時間：~100-500ms
- 使用者抱怨點：「大 vault 搜尋慢」
- Dataview plugin 解法：專門索引，支援 SQL-like 查詢

**結論**：對於 mini-agent 的規模（<1000 notes），ripgrep 已足夠。超過 1000 notes 再考慮 SQLite FTS5。

## Sources

- [Obsidian Backlinks Documentation](https://help.obsidian.md/backlinks)
- [Logseq Bi-Directional Linking](https://medium.com/logseq-lady/bi-directional-linking-6ef8798ab7e7)
- [Andy Matuschak's note-link-janitor](https://github.com/andymatuschak/note-link-janitor)
- [zettelcon - Automatic markdown backlinks](https://github.com/whateverforever/zettelcon)
- [Dendron - Hierarchical Notes](https://wiki.dendron.so/)
- [Obsidian Search Performance Discussion](https://forum.obsidian.md/t/search-speed-improvement-ideas/1140)
- [SQLite FTS5 Full-Text Search](https://www.sqlite.org/fts5.html)
- [ripgrep Performance](https://github.com/BurntSushi/ripgrep)
