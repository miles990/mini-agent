# Web Archiving 技術（2025-2026）

## 研究範圍
Archive.org, SingleFile, Monolith, Readability 等工具的做法，特別關注 HTML → Markdown 轉換和離線存檔格式。

---

## 發現一：SingleFile 2026 版本改進（最高技術價值）

**來源**：[SingleFile GitHub](https://github.com/gildas-lormeau/SingleFile), [2026 Best Practices](https://copyprogramming.com/howto/how-can-i-save-a-complete-html-file-as-single-file)

**核心功能**（2026）：
- **單一 HTML 檔案** = 所有資源（CSS, JS, images）base64 inline
- 支援 Chrome, Firefox, Edge, Safari
- 保存「當前狀態」而非「初始 HTML」

**2026 年關鍵新功能**：

### 1. Proof of Existence（SHA256 → Blockchain）
> "A notable 2026 addition is the 'proof of existence' feature that cryptographically links saved page SHA256 hashes to blockchain records, providing tamper-evidence for legal or archival applications."

**對 mini-agent 的啟示**：
- ✅ **SHA256 hash 作為 truth anchor**
- Library System 應在 catalog entry 加入 `contentHash` 欄位：
  ```jsonl
  {"id":"...", "contentHash":"sha256:abc123...", ...}
  ```
- 用途：
  1. 驗證原文未被竄改
  2. Deduplication（同一篇文章不同 URL）
  3. 可選未來擴展：Git commit 時 verify hash

**Blockchain 是否需要**：
- ❌ 對 personal agent 過度工程
- ✅ 但 **Git commit SHA 本身就是 content-addressable storage**（同樣效果，零成本）

### 2. JS Execution Pre-processing
> "2026 versions of SingleFile now include improved JavaScript execution pre-processing, allowing pages with interactive elements to be saved in their current state rather than just the initial HTML, addressing a major limitation where JavaScript-rendered content would not be captured."

**對 mini-agent 的啟示**：
- ✅ **mini-agent 已有 CDP (`cdp-fetch.mjs`)**，天然支援 JS execution
- CDP fetch = 等待頁面完全載入後才抓取內容 = 同樣效果
- **不需要額外工具**，當前架構已解決這個問題

### 3. Cloud Integration
> "Direct integration with Google Drive, GitHub, Amazon S3, and WebDAV servers (available in 2026 versions) enables automatic backup and centralized storage."

**對 mini-agent 的啟示**：
- ❌ 不需要 cloud integration（本地優先）
- ✅ 但 **Git push = 天然的 GitHub 備份**（已存在）

### 4. Mobile Support
> "Mobile browser extensions for both iOS Safari and Android Chrome now support single-file saving with touch-optimized interfaces."

**對 mini-agent 的啟示**：
- ⚠️ 當前 mini-agent mobile perception 是 sensor-based（GPS, accelerometer）
- ✅ 未來 Phase 2（Vision）可考慮整合 mobile web archiving

**是否適合整合到 Library System**：
- **Content Hash**：✅ 高優先級（Phase 1 新增 `contentHash` 欄位）
- **JS Execution**：✅ 已解決（CDP）
- **Blockchain**：❌ 不需要
- **Cloud Integration**：❌ 不需要（Git 已足夠）

---

## 發現二：HTML → Markdown 轉換（實務挑戰）

**來源**：[SingleFile Discussion](https://talk.macpowerusers.com/t/future-proof-your-webpage-archives-in-a-unique-html-file-with-singlefile/22745), [ArchiveBox](https://docs.archivebox.io/v0.6.0/README.html)

**格式選擇的 trade-off**：

| 格式 | 優點 | 缺點 |
|------|------|------|
| **SingleFile HTML** | 完整保存（包括樣式、圖片） | 二進位 base64，Git 不友好 |
| **Plain HTML** | 原始結構 | 需要清理，agent 難讀 |
| **Markdown** | 人類可讀，Git 友好 | 損失部分格式 |
| **WARC** | 標準存檔格式 | agent 難直接讀取 |

**業界工具**：
> "For a simpler, leaner solution that archives page text in markdown and provides note-taking abilities, check out Archivy or 22120. Additionally, tools like ArchiveBox support integration with various conversion tools for markdown output."

**對 mini-agent 的啟示**：

### ✅ Markdown 是最適合 agent 的格式
- **人類可讀** = Alex 可以直接打開驗證
- **Git 友好** = 每次更新是 text diff，不是 binary blob
- **Agent 易處理** = 不需要 HTML parser

### ⚠️ 當前 CDP fetch 輸出不是 Markdown
- `cdp-fetch.mjs` 的 `fetch` 命令 = 回傳 cleaned text
- **不是 Markdown**，只是純文字（無標題、連結等結構）

### ✅ HTML → Markdown 轉換工具
1. **Readability**（Mozilla 開源）：提取主要內容 + 清理廣告
2. **Pandoc**：完整 HTML → Markdown 轉換（需外部依賴）
3. **Turndown**（JavaScript）：輕量級轉換（可整合）
4. **Regex-based**：簡易清理（零依賴）

**是否適合整合到 Library System**：
- **Phase 1**：✅ 簡易 regex 清理（零依賴，符合極簡原則）
  - 基本標題：`<h1>` → `# `
  - 基本連結：`<a href="...">text</a>` → `[text](...)`
  - 移除 script/style tags
- **Phase 2**：✅ 可選整合 Turndown（如果品質不夠）
- **不考慮**：❌ Pandoc（外部依賴太重）

---

## 發現三：Monolith CLI Tool（極簡替代方案）

**來源**：[Monolith GitHub](https://github.com/Y2Z/monolith), [HN Discussion](https://news.ycombinator.com/item?id=39810378)

**核心功能**：
> "Monolith is a CLI tool to save a web page as a single HTML file."

**優勢**：
- Rust 寫的，單一二進位檔，零依賴
- 比 SingleFile 更適合 CLI 整合

**對 mini-agent 的啟示**：

### ⚠️ 但輸出仍是 HTML，不是 Markdown
- Monolith 解決的問題 = 打包成單一檔案
- **不解決** HTML → Markdown 轉換

### ✅ 如果未來需要「完整保存」功能
- Monolith 可作為 fallback（當 Markdown 轉換失敗時）
- 但當前 Library System 的目標是「可讀內容」，不是「完整複製」

**是否適合整合到 Library System**：
- ❌ 當前不需要（CDP + Markdown 轉換已足夠）
- ⚠️ 可作為 Phase 3 備案（如果需要 full fidelity archive）

---

## 發現四：ArchiveBox 的多格式支援（參考架構）

**來源**：[ArchiveBox GitHub](https://github.com/ArchiveBox/ArchiveBox), [Awesome Web Archiving](https://github.com/iipc/awesome-web-archiving)

**ArchiveBox 的設計**：
- 支援多種輸入（URLs, browser history, bookmarks, Pocket, Pinboard）
- 支援多種輸出（HTML, JS, PDFs, media, **Markdown**）
- Self-hosted, open source

**對 mini-agent 的啟示**：

### ✅ 多格式輸出的價值
- ArchiveBox 不強迫單一格式，而是**同時保存多種格式**
- Library System 可考慮：
  - Primary：Markdown（agent 易讀）
  - Fallback：原始 HTML（完整性）
  - Optional：PDF（視覺保真）

### ⚠️ 但 ArchiveBox 是獨立系統，不是 library
- 太重（完整 web archiving solution）
- mini-agent 只需要「學習來源的存檔」，不需要「全網站備份」

**是否適合整合到 Library System**：
- **概念借鏡**：✅ 多格式存檔的思路（primary + fallback）
- **技術整合**：❌ 不需要引入整個 ArchiveBox

---

## 總結：三個技術建議

### 1. Content Hash（高優先級）
```jsonl
{"id":"deobald-llm-problem", "contentHash":"sha256:a1b2c3...", ...}
```
- **來源**：SingleFile 2026 proof of existence
- **實作**：Node.js `crypto` module（零依賴）
- **用途**：驗證、deduplication、Git integrity

### 2. HTML → Markdown 轉換（Phase 1）
```typescript
// src/memory.ts - archiveSource()
function htmlToMarkdown(html: string): string {
  // 簡易 regex-based 轉換
  let md = html;
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // ... 更多規則
  return md.trim();
}
```
- **來源**：Web archiving best practices
- **實作**：零依賴（符合極簡原則）
- **升級路徑**：如果品質不夠，Phase 2 整合 Turndown

### 3. 格式選擇：Markdown > HTML
- **Primary format**：Markdown with YAML frontmatter
- **Fallback**：不需要（如果 Markdown 轉換失敗，記錄 error 但仍存 text）
- **不考慮**：MHTML, WARC（agent 難讀取）

---

## 不建議整合的方案

| 方案 | 理由 |
|------|------|
| **Blockchain proof** | Git commit SHA 已提供 immutability |
| **Cloud integration** | Git push 已足夠，不需要 S3/Drive |
| **Complete page archive** | Library 目標是「可讀內容」，不是「pixel-perfect 複製」 |
| **ArchiveBox** | 完整 web archiving 系統太重 |
| **Pandoc** | 外部依賴，regex-based 轉換足夠 |

**最高價值洞見**：
- SingleFile 2026 的 **SHA256 content hash** = truth anchor 的最佳實踐
- HTML → Markdown 轉換 = **可以用簡單 regex 實現**，不需要複雜工具
- CDP + Markdown = mini-agent 已有的能力，只差最後一哩路
