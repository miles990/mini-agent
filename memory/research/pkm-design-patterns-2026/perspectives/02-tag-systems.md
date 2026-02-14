# Perspective: Tag Systems & Organization

## PARA vs Tags vs Folders

### Tiago Forte 的 PARA 方法

**核心概念**

- **P**rojects — 有明確終點的任務
- **A**reas — 持續關注的責任領域
- **R**esources — 未來可能有用的主題
- **A**rchive — 已完成或不活躍的項目

**關鍵洞察：按行動組織 > 按主題組織**

Forte 的核心主張：

> "Tag by actionability, not by topic. Contexts are finite, topics are infinite."

不是「這是關於什麼？」而是「這對哪個專案有用？」

**PARA 與 Tags 的關係**

- Forte 早期批評 tags「太耗費精力、價值不高」
- 但在 Building a Second Brain 祕密章節中，提出 tags 作為 PARA 的補充層
- Tags 用於標記「行動上下文」，非主題分類

### 階層式 Tags vs 扁平 Tags

**Obsidian 階層式 Tags 實作**

```markdown
#animals/domestic-animals/dogs
#location/home/office
#location/home/kitchen
```

- 語法：`/` 分隔符建立階層
- 重命名父標籤，子標籤自動跟隨
- Tag pane 顯示樹狀結構
- 適合需要細緻分類的場景

**扁平 Tags 優勢**

- 簡單、彈性高
- 無需預先規劃階層結構
- 組合多個 tags 實現多維度分類
- 適合探索式知識管理

### 實作細節

**檔案系統中的 Tag 儲存**

Obsidian/Logseq 的 tags：

```markdown
---
tags: [ai, agents, perception]
---

# 標題

內文中的 #inline-tag 也會被識別
```

- **Frontmatter YAML**：結構化、機器可讀
- **Inline tags**：書寫時自然、上下文相關
- 兩者都會被索引

**Tag 索引建立**

```typescript
// 啟動時掃描
const tagIndex = new Map<string, Set<string>>(); // tag -> files

for (const file of markdownFiles) {
  const frontmatter = parseFrontmatter(file);
  const inlineTags = extractInlineTags(file);
  const allTags = [...frontmatter.tags, ...inlineTags];
  
  for (const tag of allTags) {
    if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
    tagIndex.get(tag)!.add(file);
  }
}
```

## Mini-Agent 應用啟示

### 當前狀態

Mini-agent 已有類似概念：

```
memory/
  topics/          — 類似 PARA 的 "Areas"
  proposals/       — 類似 PARA 的 "Projects"
  daily/           — 時間軸組織
  HEARTBEAT.md     — Active tasks（PARA 的 Projects）
```

但**缺少明確的 tag system**。

### 建議實作

**Level 1: Frontmatter Tags**

```markdown
---
tags: [perception, mobile, sensor]
status: active
effort: medium
---

# Proposal: Mobile Perception
```

- 簡單、標準、Git-friendly
- 透過 grep 即可搜尋：`grep -r "tags:.*perception" memory/`

**Level 2: Tag-based Context Loading**

```typescript
// buildContext() 改良
async buildContext(options?: {
  tags?: string[];  // 只載入有這些 tags 的檔案
  mode?: 'full' | 'focused' | 'minimal';
}): Promise<string>
```

例如 agent 在處理 mobile perception 問題時：

```typescript
const context = await buildContext({
  tags: ['perception', 'mobile'],
  mode: 'focused'
});
```

只載入相關的 proposals 和 topics。

**Level 3: Action-Based Tags**

Forte 的核心洞察應用到 agent：

```markdown
# 不要這樣（topic-based）
tags: [typescript, api, backend]

# 應該這樣（action-based）
tags: [need-review, deploy-ready, needs-test]
stage: implementation
priority: P1
```

Tags 標記「這份筆記需要什麼行動」，而非「這是關於什麼」。

### 與 PARA 結合

```
memory/
  projects/        — PARA: Projects（有期限、可完成）
    2026-mobile-perception/
    2026-reactive-architecture/
  
  areas/           — PARA: Areas（持續關注）
    perception/
    learning/
    development/
  
  resources/       — PARA: Resources（參考資料）
    research/
    patterns/
  
  archive/         — PARA: Archive
    completed/
    deprecated/
```

但這需要重構現有 memory/ 結構 — 建議作為 L2 proposal。

## 業界實踐模式

### Obsidian 社群最佳實踐

根據論壇討論和文章，使用者常見模式：

1. **MOC (Map of Content)** — 索引頁取代資料夾
2. **Datalinks** — YAML frontmatter + 查詢
3. **Tag hierarchies** — 大型 vault 才需要
4. **Minimal tags** — 多數人用 <10 個核心 tags

### Jamie Todd Rubin 的 Tag 實踐

> "Tags in theory vs tags in practice — never the twain shall meet"

他的結論：

- 計畫中的 tag 系統總是太複雜
- 實際使用的 tags 遠少於預期
- **建議**：從 3-5 個核心 tags 開始，自然成長

### Tag Wrangler Plugin

Obsidian 的 tag 管理工具：

- 批次重命名 tags
- 合併相似 tags
- 顯示 tag 使用統計
- **啟示**：tags 需要持續整理，會隨時間演化

## 效能考量

**Tags vs Full-Text Search**

| 操作 | Tags | Full-text |
|------|------|-----------|
| 精確查詢 | 快（O(1) lookup） | 慢（掃描全部） |
| 模糊查詢 | 無法 | 可以 |
| 維護成本 | 需手動標記 | 自動 |
| 語意準確度 | 高（人工） | 低（關鍵字） |

**結論**：Tags 和 full-text search 互補，不是替代關係。

## Sources

- [Tiago Forte - PARA Method](https://fortelabs.com/blog/para/)
- [Tiago Forte - Complete Guide to Tagging for PKM](https://fortelabs.com/blog/a-complete-guide-to-tagging-for-personal-knowledge-management/)
- [Obsidian Tags Documentation](https://help.obsidian.md/tags)
- [Obsidian Hierarchical Tags](https://forum.obsidian.md/t/hierarchical-tag-organization-in-obsidian/87553)
- [Tag Wrangler Plugin](https://github.com/pjeby/tag-wrangler)
- [Jamie Todd Rubin - Tags in Theory and Practice](https://jamierubin.net/2022/03/08/practically-paperless-with-obsidian-episode-21-tags-in-theory-and-tags-in-practice-and-never-the-twain-shall-meet/)
