# Perspective: Notable Design Decisions

## Obsidian 的設計哲學

### "No Lock-in, Plain Markdown Files"

**核心承諾**

> "Your notes are stored in plain Markdown files on your local device. No proprietary format, no cloud dependency."

**技術決策**

- 資料儲存：純 Markdown + 本地檔案系統
- 索引：啟動時建立（in-memory）
- Plugins：擴充功能，非核心相依
- 同步：使用者自選（iCloud, Dropbox, Git, Obsidian Sync）

**影響**

- 使用者完全擁有資料
- 可隨時遷移到其他工具
- Git-friendly（版本控制、協作）
- 離線優先（無網路依賴）

**與 Mini-Agent 的對齊**

Mini-agent 同樣選擇：

- File = Truth（檔案是唯一真相來源）
- No Database（Markdown + JSONL）
- Git 可版控（audit trail）

### Obsidian 的效能取捨

根據社群討論：

- **啟動時間**：大 vault (>10k notes) 需 5-10s 建立索引
- **搜尋效能**：未索引的 vault 搜尋慢
- **解法**：Dataview plugin（專門索引 + 快取）

**啟示**：Pure file-based 有效能上限，但對個人使用（<1k notes）足夠。

## Andy Matuschak 的 Evergreen Notes

### 核心概念

**Evergreen notes 不是 "better note-taking"，而是 "better thinking"**

原則：

1. **Atomic** — 每個 note 一個概念
2. **Concept-oriented** — 按概念組織，非專案或書本
3. **Densely linked** — 跨書籍、跨領域連結
4. **Note titles as APIs** — 標題是介面，可組合

### 技術實作細節

**Note Titles 設計**

```markdown
# 不好的標題
- "Book notes: Thinking Fast and Slow"
- "Meeting 2026-02-14"

# Evergreen 標題
- "System 1 operates automatically and quickly"
- "Zettelkasten enables emergent insights"
```

標題本身就是完整陳述（proposition），非主題標籤。

**連結策略**

Matuschak 強調「創造自己的想法網路」：

- 不是收集別人的想法（bookmarks）
- 而是發展自己的思考（notes）
- 連結代表「這兩個想法如何相關」

**與 Zettelkasten 的差異**

| 面向 | Zettelkasten | Evergreen Notes |
|------|-------------|-----------------|
| ID 系統 | 時間戳 | 語意標題 |
| 組織方式 | 編號+連結 | 標題+連結 |
| 重點 | 積累 | 發展 |
| 目標 | 知識庫 | 思考工具 |

**Mini-Agent 應用**

當前 mini-agent 的 `memory/topics/*.md` 接近這個模式：

- 每個 topic 是一個概念領域
- 跨時間累積（append）
- 但缺少「連結」機制

**改進方向**

```markdown
# memory/topics/agent-architecture.md

## Core Insight
Perception-first architecture inverts the traditional goal-driven agent model.

## Related Concepts
- [[cognitive-science#enactive-cognition]] — environment shapes action
- [[design-philosophy#pattern-language]] — structure grows from forces
- See also: [[autogpt-critique]] for counter-example

## Evidence
- [2026-02-10] AutoGPT "有手沒有眼" — 證實此洞察
```

## Zettelkasten 的 ID 系統

### 時間戳 ID

**標準格式**：`YYYYMMDDHHMM`

```
202602141030.md  — 2026-02-14 10:30 建立的 note
```

**優勢**

- 絕對唯一（只要不在同一分鐘建立兩個）
- 時間順序自然排列
- 容易手動生成（看時鐘即可）
- 檔案系統友善

**連結語法**

```markdown
根據 §202602141030 的討論...

[§202602141030]: 202602141030.md
```

### 為何需要 UID？

從 Zettelkasten 論壇討論：

1. **檔名重構**：改標題不破壞連結
2. **引用穩定**：ID 不變，內容可以演化
3. **檔案系統相容**：避免特殊字元

**反例**：使用標題當檔名

```
System 1 operates automatically and quickly.md
```

問題：

- 標題改了，所有引用失效
- 空格、標點符號在某些檔案系統有問題
- 檔名太長

### Mini-Agent 當前模式

Mini-agent 使用：

```
proposals/2026-02-14-library-system.md  — 日期+描述
topics/agent-architecture.md            — 語意名稱
daily/2026-02-14.md                     — 純日期
```

**混合策略**

- proposals/handoffs：用日期前綴（類似 Zettelkasten）
- topics：用語意名稱（類似 Evergreen Notes）
- daily：純時間組織

**權衡**：語意名稱人類友善，但重構困難。日期前綴穩定，但不可讀。

**建議**：維持現狀，因為 proposals 已經穩定（completed 後不改），topics 改名頻率低。

## Dendron 的階層式筆記

### Dot Notation

```
recipes.vegetarian.md         — recipes > vegetarian
recipes.vegetarian.pasta.md   — recipes > vegetarian > pasta
```

**優勢**

- 階層關係一目了然
- 檔案系統扁平化（全在一個資料夾）
- 自動完成（lookup）支援

**Schema 定義**

```yaml
# schemas/recipes.schema.yml
schemas:
  - id: recipes
    children:
      - vegetarian
      - meat
      - dessert
```

Dendron 用 schema 強制階層結構。

**Mini-Agent 應用情境**

可考慮用於 proposals：

```
proposals/perception.mobile.sensor.md
proposals/perception.mobile.vision.md
proposals/perception.audio.stt.md
```

但目前的平面命名已足夠清楚。

## 通用設計模式總結

### Pattern 1: 分離索引與內容

| 工具 | 索引 | 內容 |
|------|------|------|
| Obsidian | In-memory graph | Markdown files |
| ArchiveBox | SQLite | HTML/WARC files |
| Dendron | Index cache | Markdown files |

**優勢**：索引可重建，內容不可變。

### Pattern 2: 漸進式複雜度

**Jamie Rubin 法則**：從簡單開始，自然成長

- 階段 1：單一資料夾 + 扁平檔案
- 階段 2：引入 tags（<10 個核心 tags）
- 階段 3：建立 MOC（Map of Content）索引頁
- 階段 4：考慮階層結構或 backlinks

**Anti-pattern**：一開始就建立複雜分類系統。

### Pattern 3: 內容優先，結構次要

Matuschak 的洞察：

> "不要花時間組織，花時間思考和連結。"

**實踐**

- 寫 note 時不要先想「這放哪個資料夾」
- 先寫內容，連結自然浮現
- 定期重構（整理 backlinks、合併相似 notes）

**Mini-Agent 對應**

當前 `[REMEMBER #topic]` 機制已經體現這個模式：

- Agent 寫內容時標註 topic
- 系統自動路由到對應檔案
- 無需預先規劃資料夾結構

### Pattern 4: 人類可讀 > 機器最佳化

**Obsidian vs Roam**

- Obsidian：Markdown（人類可讀）
- Roam：JSON（機器最佳化）

**結果**：Obsidian 社群更大，因為使用者信任資料格式。

**Mini-Agent 的選擇**

全部使用人類可讀格式：

- Memory：Markdown
- Logs：JSONL（line-delimited, 可用 `jq`）
- Config：YAML

## Sources

- [Obsidian Design Philosophy](https://help.obsidian.md/)
- [Andy Matuschak - Evergreen Notes](https://notes.andymatuschak.org/Evergreen_notes)
- [Zettelkasten UID Discussion](https://forum.zettelkasten.de/discussion/613/zettel-id-and-general-unique-identifiers)
- [Dendron Hierarchical Notes](https://wiki.dendron.so/)
- [Maggie Appleton - Growing the Evergreens](https://maggieappleton.com/evergreens)
