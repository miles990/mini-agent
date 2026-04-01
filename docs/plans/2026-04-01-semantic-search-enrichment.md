# Semantic Search Enrichment (A + B + C) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 讓 mini-agent 的記憶搜尋從純關鍵字匹配進化到語義感知，不引入 embedding/vector DB。

**Architecture:** 三層增強疊加在現有 FTS5 之上：(A) 寫入時用 Haiku 生成同義詞/翻譯寫入 FTS5 enriched 欄位，(B) 查詢時用純程式碼雙語詞典擴展搜尋詞，(C) 週期性用 Haiku 生成 topic 摘要 + 跨 topic 關聯圖。三者獨立 fallback，任一層掛了不影響其他層。

**Tech Stack:** SQLite FTS5, sideQuery (Haiku), pure code synonym map, existing housekeeping cycle

**Key Files:**
- `src/search.ts` — FTS5 schema + enrichment + query expansion
- `src/memory.ts` — appendMemory/appendTopicMemory hook
- `src/dispatcher.ts` — fire-and-forget enrichment trigger
- `src/memory-summarizer.ts` — NEW: hierarchical summarization
- `src/cycle-tasks.ts` — hook summarization into housekeeping
- `tests/search.test.ts` — NEW: search enrichment tests

**Design Constraints:**
- File = Truth: 原始檔案不動，enrichment 只存 FTS5 index
- Fire-and-forget: enrichment 和 summarization 不阻塞寫入或 cycle
- No new dependencies: 用現有 sideQuery (Haiku) + pure code
- Graceful fallback: enrichment 失敗 → 退回純 keyword 搜尋

---

## Task 1: FTS5 Schema — 加入 enriched 欄位

**Files:**
- Modify: `src/search.ts:71-99` (initSearchIndex)
- Modify: `src/search.ts:609-630` (rebuildIndex)
- Test: `tests/search.test.ts` (NEW)

**Step 1: Write the failing test**

```typescript
// tests/search.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSearchIndex, closeSearchIndex, isIndexReady } from '../src/search.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('search enrichment', () => {
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
    dbPath = path.join(tmpDir, 'test-index.db');
  });

  afterEach(() => {
    closeSearchIndex();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create memory_fts with enriched column', () => {
    initSearchIndex(dbPath);
    const db = new Database(dbPath);
    const info = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
    const columns = info.map(r => r.name);
    expect(columns).toContain('enriched');
    db.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/search.test.ts`
Expected: FAIL — `enriched` column doesn't exist yet

**Step 3: Modify FTS5 schema in search.ts**

In `initSearchIndex()` (~line 81), change the CREATE TABLE:

```typescript
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    source,
    date,
    content,
    enriched,
    tokenize="unicode61"
  );
`);
```

In `rebuildIndex()` (~line 616), same change:

```typescript
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    source,
    date,
    content,
    enriched,
    tokenize="unicode61"
  );
`);
```

In `indexMemoryFiles()` (~line 250), update INSERT to include empty enriched:

```typescript
const insert = db.prepare('INSERT INTO memory_fts (source, date, content, enriched) VALUES (?, ?, ?, ?)');
// ...
insert.run(entry.source, entry.date, entry.content, '');
```

**Step 4: Handle schema migration**

Add to `initSearchIndex()` after CREATE TABLE, detect old schema and rebuild:

```typescript
// Schema migration: detect missing enriched column → rebuild
try {
  const cols = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some(c => c.name === 'enriched')) {
    db.exec('DROP TABLE IF EXISTS memory_fts');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source, date, content, enriched,
        tokenize="unicode61"
      );
    `);
    if (memoryDir) indexMemoryFiles(memoryDir);
  }
} catch { /* FTS5 PRAGMA may fail — ignore, CREATE IF NOT EXISTS handles it */ }
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/search.test.ts`
Expected: PASS

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat(search): add enriched column to FTS5 schema"
```

---

## Task 2: Write-time Enrichment Function

**Files:**
- Modify: `src/search.ts` — add `enrichMemoryEntry()` + `updateEnrichment()`
- Test: `tests/search.test.ts`

**Step 1: Write the failing test**

```typescript
it('should update enrichment for an indexed entry', () => {
  const memoryDir = path.join(tmpDir, 'memory');
  fs.mkdirSync(path.join(memoryDir, 'topics'), { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '## Learned Patterns\n- [2026-04-01] 部署失敗了\n');

  initSearchIndex(dbPath, memoryDir);

  // Import and call updateEnrichment
  const { updateEnrichment } = require('../src/search.js');
  updateEnrichment('MEMORY.md', '部署失敗了', 'deploy fail 上線 出錯 release error');

  // Search for enriched term should find it
  const { searchMemoryFTS } = require('../src/search.js');
  const results = searchMemoryFTS('deploy');
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].content).toContain('部署失敗了');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/search.test.ts`
Expected: FAIL — `updateEnrichment` not exported

**Step 3: Implement updateEnrichment in search.ts**

```typescript
/**
 * 更新指定記憶條目的 enriched 欄位（同義詞、翻譯、標籤）
 * Fire-and-forget — 失敗不影響搜尋功能
 */
export function updateEnrichment(source: string, contentSnippet: string, enriched: string): boolean {
  if (!db || !enriched.trim()) return false;
  try {
    // Match by source + content prefix (content may be truncated in index)
    const prefix = contentSnippet.slice(0, 100);
    const stmt = db.prepare(`
      UPDATE memory_fts SET enriched = ?
      WHERE source = ? AND content LIKE ? || '%'
    `);
    // FTS5 doesn't support UPDATE directly — need DELETE + INSERT
    // Find matching row first
    const row = db.prepare(`
      SELECT rowid, source, date, content FROM memory_fts
      WHERE source = ? AND content LIKE ? || '%'
      LIMIT 1
    `).get(source, prefix) as { rowid: number; source: string; date: string; content: string } | undefined;

    if (!row) return false;

    db.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(row.rowid);
    db.prepare('INSERT INTO memory_fts (source, date, content, enriched) VALUES (?, ?, ?, ?)')
      .run(row.source, row.date, row.content, enriched);
    return true;
  } catch {
    return false;
  }
}
```

**Step 4: Implement enrichMemoryEntry (Haiku sideQuery)**

```typescript
/**
 * 用 Haiku 為記憶條目生成語義豐富化標籤
 * Returns: 同義詞、翻譯、相關概念（空格分隔）
 * Fire-and-forget safe — returns empty string on failure
 */
export async function enrichMemoryEntry(content: string): Promise<string> {
  if (content.length < 10) return '';

  try {
    const { sideQuery } = await import('./side-query.js');
    const prompt = `Given this memory entry, generate search-friendly synonyms, translations (Chinese↔English), and related terms. Return ONLY a single line of space-separated terms, no explanations.

Entry: "${content.slice(0, 300)}"

Example input: "部署失敗了"
Example output: deploy fail failure 上線 出錯 錯誤 release error 發布 deployment`;

    const result = await sideQuery(prompt, {
      model: 'claude-haiku-4-5-20251001',
      timeout: 10_000,
      maxTokens: 128,
    });

    return result?.trim() ?? '';
  } catch {
    return '';
  }
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/search.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat(search): add write-time enrichment with Haiku synonyms"
```

---

## Task 3: Wire Enrichment into Memory Write Path

**Files:**
- Modify: `src/dispatcher.ts:659-666` — add enrichment after appendMemory/appendTopicMemory

**Step 1: Read current dispatcher code around line 659**

The `<kuro:remember>` processing block currently:
1. Dedup check
2. `appendTopicMemory()` or `appendMemory()`
3. `addIndexEntry()` (fire-and-forget)
4. Classify + log

**Step 2: Add enrichment after the memory write**

After `addIndexEntry` (~line 666), add:

```typescript
// Semantic enrichment — generate synonyms/translations for FTS5 (fire-and-forget)
import { enrichMemoryEntry, updateEnrichment } from './search.js';

// ... inside the for loop, after addIndexEntry:
enrichMemoryEntry(rem.content).then(enriched => {
  if (enriched) {
    const source = rem.topic ? `${rem.topic}.md` : 'MEMORY.md';
    updateEnrichment(source, rem.content, enriched);
  }
}).catch(() => {}); // fire-and-forget
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Run existing dispatcher tests**

Run: `pnpm vitest run tests/dispatcher.test.ts`
Expected: PASS (enrichment is fire-and-forget, won't break existing tests)

**Step 5: Commit**

```bash
git add src/dispatcher.ts
git commit -m "feat(search): wire enrichment into memory write path"
```

---

## Task 4: Query-time Expansion — 雙語詞典

**Files:**
- Modify: `src/search.ts` — add `expandQuery()`, modify `searchMemoryFTS()` and `searchMemoryEntries()`
- Test: `tests/search.test.ts`

**Step 1: Write the failing test**

```typescript
it('should expand query with bilingual synonyms', () => {
  const { expandQuery } = require('../src/search.js');
  const expanded = expandQuery('部署');
  expect(expanded).toContain('deploy');

  const expanded2 = expandQuery('deploy');
  expect(expanded2).toContain('部署');
});

it('should find entries via expanded query terms', () => {
  const memoryDir = path.join(tmpDir, 'memory');
  fs.mkdirSync(path.join(memoryDir, 'topics'), { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'),
    '## Learned Patterns\n- [2026-04-01] CI/CD 部署流程已完成設定\n');

  initSearchIndex(dbPath, memoryDir);

  const { searchMemoryFTS } = require('../src/search.js');
  // Search with English term should find Chinese content (via expansion)
  const results = searchMemoryFTS('deployment');
  expect(results.length).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/search.test.ts`
Expected: FAIL

**Step 3: Implement bilingual synonym map**

```typescript
/**
 * 雙語同義詞典 — 純程式碼，零延遲
 * 雙向映射：任何一個詞都能找到同組的其他詞
 */
const SYNONYM_GROUPS: string[][] = [
  ['部署', 'deploy', 'deployment', '上線', 'release', '發布'],
  ['失敗', 'fail', 'failure', 'error', '錯誤', '出錯'],
  ['記憶', 'memory', 'remember', '記住', '記錄'],
  ['搜尋', 'search', 'find', '查詢', 'query', '檢索'],
  ['學習', 'learn', 'learning', '研究', 'study'],
  ['任務', 'task', 'job', '工作', '待辦'],
  ['測試', 'test', 'testing', '驗證', 'verify'],
  ['修復', 'fix', 'bug', '修正', 'repair', 'patch'],
  ['效能', 'performance', '速度', 'speed', 'latency', '延遲'],
  ['設定', 'config', 'configuration', 'setting', '配置'],
  ['建立', 'create', 'build', '建構', '製作'],
  ['刪除', 'delete', 'remove', '移除', '清除'],
  ['更新', 'update', 'upgrade', '升級', '改版'],
  ['安全', 'security', 'safe', '防護'],
  ['通知', 'notify', 'notification', 'alert', '告警'],
  ['排程', 'schedule', 'cron', '定時'],
  ['感知', 'perception', 'sense', 'detect', '偵測'],
  ['架構', 'architecture', 'structure', '結構'],
  ['重構', 'refactor', 'refactoring', '整理'],
  ['文件', 'document', 'doc', '文檔', '說明'],
];

// Build reverse lookup: word → all synonyms
const _synonymLookup = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const lower = group.map(w => w.toLowerCase());
  for (const word of lower) {
    if (!_synonymLookup.has(word)) _synonymLookup.set(word, new Set());
    for (const syn of lower) {
      if (syn !== word) _synonymLookup.get(word)!.add(syn);
    }
  }
}

/**
 * 擴展查詢詞 — 加入雙語同義詞
 * Pure code, 零延遲, 零 LLM 成本
 */
export function expandQuery(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const expanded = new Set(words);

  for (const word of words) {
    const synonyms = _synonymLookup.get(word);
    if (synonyms) {
      for (const syn of synonyms) expanded.add(syn);
    }
    // Also check Chinese characters individually (unicode61 tokenizer splits them)
    for (const char of word) {
      const charSyns = _synonymLookup.get(char);
      if (charSyns) {
        for (const syn of charSyns) expanded.add(syn);
      }
    }
  }

  return [...expanded];
}
```

**Step 4: Modify searchMemoryFTS to use expansion**

In `searchMemoryFTS()` (~line 488):

```typescript
export function searchMemoryFTS(query: string, limit = 5): MemoryEntry[] {
  if (!db) return [];

  try {
    const sanitized = sanitizeFTS5Query(query);
    if (!sanitized) return [];

    // Query expansion: add bilingual synonyms
    const expanded = expandQuery(sanitized);
    const ftsQuery = expanded.join(' OR ');

    const rows = db.prepare(`
      SELECT source, date, content, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{ source: string; date: string; content: string; rank: number }>;

    return rows.map(row => ({
      source: row.source,
      date: row.date,
      content: row.content,
    }));
  } catch {
    return [];
  }
}
```

Same change in `searchMemoryEntries()` (~line 533): replace `words.join(' OR ')` with `expandQuery(sanitized).join(' OR ')`.

**Step 5: Run tests**

Run: `pnpm vitest run tests/search.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat(search): add query-time bilingual synonym expansion"
```

---

## Task 5: Hierarchical Topic Summarization

**Files:**
- Create: `src/memory-summarizer.ts` (NEW)
- Test: `tests/memory-summarizer.test.ts` (NEW)

**Step 1: Write the failing test**

```typescript
// tests/memory-summarizer.test.ts
import { describe, it, expect } from 'vitest';
import { buildTopicManifest } from '../src/memory-summarizer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('memory-summarizer', () => {
  it('should build topic manifest from topic files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summarizer-test-'));
    const topicsDir = path.join(tmpDir, 'topics');
    fs.mkdirSync(topicsDir, { recursive: true });

    fs.writeFileSync(path.join(topicsDir, 'deploy.md'),
      '# deploy\n\n- [2026-03-01] CI/CD 設定完成\n- [2026-03-15] 自動部署流程上線\n- [2026-04-01] 加入 health check\n');
    fs.writeFileSync(path.join(topicsDir, 'testing.md'),
      '# testing\n\n- [2026-03-10] 單元測試框架選定 vitest\n');

    const manifest = buildTopicManifest(tmpDir);
    expect(manifest.length).toBe(2);
    expect(manifest[0].topic).toBeDefined();
    expect(manifest[0].entryCount).toBeGreaterThan(0);
    expect(manifest[0].preview).toBeTruthy();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/memory-summarizer.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement memory-summarizer.ts**

```typescript
/**
 * Memory Summarizer — Hierarchical topic summarization
 *
 * Layer 0: 原始記憶條目（現有 topics/*.md）
 * Layer 1: 每個 topic 的摘要（.summaries/{topic}.md）
 * Layer 2: 跨 topic 關聯圖（.summaries/_cross-topic-map.md）
 *
 * 設計原則：
 * - Fire-and-forget: 不阻塞任何 cycle
 * - Haiku sideQuery: 便宜 + 可靠
 * - File = Truth: 摘要是衍生品，原始檔案不動
 * - 自帶遺忘: 摘要自然壓縮掉過時資訊
 */

import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { diagLog } from './utils.js';

export interface TopicManifestEntry {
  topic: string;
  entryCount: number;
  preview: string;       // first 2 entries
  lastDate: string;      // most recent entry date
  charCount: number;
}

/**
 * 掃描所有 topic 檔案，建構 manifest（不需要 LLM）
 */
export function buildTopicManifest(memoryDir: string): TopicManifestEntry[] {
  const topicsDir = path.join(memoryDir, 'topics');
  if (!fs.existsSync(topicsDir)) return [];

  const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md'));
  const manifest: TopicManifestEntry[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(topicsDir, file), 'utf-8');
      const entries = content.split('\n').filter(l => l.startsWith('- ['));
      const dates = entries.map(l => l.match(/\[(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? '').filter(Boolean);

      manifest.push({
        topic: file.replace(/\.md$/, ''),
        entryCount: entries.length,
        preview: entries.slice(-2).join('\n').slice(0, 200),
        lastDate: dates[dates.length - 1] ?? '',
        charCount: content.length,
      });
    } catch { /* skip unreadable */ }
  }

  return manifest.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/**
 * 用 Haiku 生成單個 topic 的摘要
 */
export async function summarizeTopic(
  memoryDir: string,
  topic: string,
): Promise<string | null> {
  const topicPath = path.join(memoryDir, 'topics', `${topic}.md`);
  if (!fs.existsSync(topicPath)) return null;

  try {
    const content = fs.readFileSync(topicPath, 'utf-8');
    if (content.length < 100) return null; // too short to summarize

    const { sideQuery } = await import('./side-query.js');
    const prompt = `Summarize this topic memory file in 2-3 sentences. Focus on: key themes, important decisions, and current status. Write in the same language as the content.

Topic: ${topic}
Content (last 3000 chars):
${content.slice(-3000)}

Return ONLY the summary, no headers or labels.`;

    return await sideQuery(prompt, {
      model: 'claude-haiku-4-5-20251001',
      timeout: 15_000,
      maxTokens: 256,
    });
  } catch (error) {
    diagLog('summarizeTopic', error, { topic });
    return null;
  }
}

/**
 * 生成跨 topic 關聯圖
 */
export async function generateCrossTopicMap(
  memoryDir: string,
): Promise<string | null> {
  const manifest = buildTopicManifest(memoryDir);
  if (manifest.length < 3) return null;

  // Only include active topics (updated in last 30 days, >3 entries)
  const active = manifest.filter(t =>
    t.entryCount >= 3 &&
    t.lastDate >= new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  );
  if (active.length < 3) return null;

  try {
    const { sideQuery } = await import('./side-query.js');
    const topicList = active
      .map(t => `- ${t.topic} (${t.entryCount} entries, last: ${t.lastDate}): ${t.preview.slice(0, 100)}`)
      .join('\n');

    const prompt = `Given these topic-memory files, identify which topics are related and how. Output a concise relationship map.

Topics:
${topicList}

Format each relationship as: "topic-a ↔ topic-b: one-line description of relationship"
Only list clearly related pairs. Max 10 pairs. No explanations.`;

    return await sideQuery(prompt, {
      model: 'claude-haiku-4-5-20251001',
      timeout: 20_000,
      maxTokens: 512,
    });
  } catch (error) {
    diagLog('generateCrossTopicMap', error);
    return null;
  }
}

/**
 * 執行完整的摘要更新週期
 * 適合從 housekeeping cycle 呼叫（fire-and-forget）
 */
export async function runSummarizationCycle(memoryDir: string): Promise<void> {
  const summariesDir = path.join(memoryDir, 'topics', '.summaries');
  if (!fs.existsSync(summariesDir)) {
    fs.mkdirSync(summariesDir, { recursive: true });
  }

  const manifest = buildTopicManifest(memoryDir);

  // Only summarize topics with >5 entries that haven't been summarized recently
  let summarized = 0;
  const MAX_PER_CYCLE = 3; // Limit Haiku calls per cycle

  for (const entry of manifest) {
    if (summarized >= MAX_PER_CYCLE) break;
    if (entry.entryCount < 5) continue;

    const summaryPath = path.join(summariesDir, `${entry.topic}.md`);

    // Skip if summary exists and is <7 days old
    try {
      const stat = fs.statSync(summaryPath);
      if (Date.now() - stat.mtimeMs < 7 * 86400000) continue;
    } catch { /* no existing summary — proceed */ }

    const summary = await summarizeTopic(memoryDir, entry.topic);
    if (summary) {
      const header = `<!-- auto-generated: ${new Date().toISOString().split('T')[0]} | entries: ${entry.entryCount} -->\n`;
      fs.writeFileSync(summaryPath, header + summary + '\n');
      summarized++;
      eventBus.emit('log:info', {
        tag: 'summarizer',
        msg: `Summarized ${entry.topic} (${entry.entryCount} entries → ${summary.length} chars)`,
      });
    }
  }

  // Update cross-topic map (max once per week)
  const mapPath = path.join(summariesDir, '_cross-topic-map.md');
  let shouldUpdateMap = true;
  try {
    const stat = fs.statSync(mapPath);
    if (Date.now() - stat.mtimeMs < 7 * 86400000) shouldUpdateMap = false;
  } catch { /* no existing map */ }

  if (shouldUpdateMap) {
    const map = await generateCrossTopicMap(memoryDir);
    if (map) {
      const header = `<!-- auto-generated: ${new Date().toISOString().split('T')[0]} -->\n# Cross-Topic Relationships\n\n`;
      fs.writeFileSync(mapPath, header + map + '\n');
      eventBus.emit('log:info', { tag: 'summarizer', msg: 'Updated cross-topic map' });
    }
  }
}
```

**Step 4: Run test**

Run: `pnpm vitest run tests/memory-summarizer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory-summarizer.ts tests/memory-summarizer.test.ts
git commit -m "feat(search): add hierarchical topic summarization"
```

---

## Task 6: Wire Summarization into Housekeeping

**Files:**
- Modify: `src/cycle-tasks.ts` — add summarization to housekeeping cycle

**Step 1: Find the housekeeping hook point**

In `cycle-tasks.ts`, look for the housekeeping section (where `cleanStaleTasks`, `autoCommitMemoryFiles` etc. are called).

**Step 2: Add summarization call**

```typescript
import { runSummarizationCycle } from './memory-summarizer.js';

// Inside housekeeping block, after existing fire-and-forget tasks:
// Topic summarization — update summaries for large topics (fire-and-forget)
runSummarizationCycle(memoryDir).catch(() => {});
```

**Important:** Only run in housekeeping cycles (not every cycle). Check the existing gating logic — likely `if (isHousekeeping)` or similar.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cycle-tasks.ts
git commit -m "feat(search): wire summarization into housekeeping cycle"
```

---

## Task 7: Use Summaries in Search

**Files:**
- Modify: `src/search.ts` — index summaries in FTS5
- Modify: `src/memory.ts` — use summaries in buildContext for topic discovery

**Step 1: Index summaries during indexMemoryFiles**

In `indexMemoryFiles()`, after parsing topics, also parse `.summaries/`:

```typescript
// Parse topic summaries (Layer 1 — condensed, high-signal)
const summariesDir = path.join(topicsDir, '.summaries');
if (fs.existsSync(summariesDir)) {
  const summaryFiles = fs.readdirSync(summariesDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  for (const file of summaryFiles) {
    try {
      const content = fs.readFileSync(path.join(summariesDir, file), 'utf-8')
        .replace(/^<!--.*-->\n/gm, '').trim();
      if (content.length > 10) {
        const topic = file.replace(/\.md$/, '');
        allEntries.push({
          source: `summary:${topic}`,
          date: new Date().toISOString().split('T')[0],
          content,
        });
      }
    } catch { /* skip */ }
  }
}
```

**Step 2: Use cross-topic map in semanticRankTopics**

In `semanticRankTopics()` (~memory.ts:602), append cross-topic map to the prompt if available:

```typescript
// Load cross-topic map for relationship hints
let crossTopicHint = '';
try {
  const mapPath = path.join(topicsDir, '.summaries', '_cross-topic-map.md');
  crossTopicHint = fs.readFileSync(mapPath, 'utf-8').replace(/^<!--.*-->\n/gm, '').trim();
} catch { /* no map available */ }

const prompt = `...existing prompt...
${crossTopicHint ? `\nKnown topic relationships:\n${crossTopicHint}` : ''}`;
```

**Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm vitest run tests/search.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/search.ts src/memory.ts
git commit -m "feat(search): index summaries and use cross-topic map in ranking"
```

---

## Task 8: End-to-End Verification

**Step 1: Rebuild index with enrichment**

```bash
# In mini-agent CLI or via API
curl -sf localhost:3001/api/search/rebuild
# Or: pnpm build && node -e "require('./dist/search.js').rebuildIndex('/path/to/memory')"
```

**Step 2: Verify query expansion works**

```bash
# Search for English term, expect Chinese results
curl -sf 'localhost:3001/api/search?q=deployment' | jq '.results[:3]'
```

**Step 3: Verify enrichment pipeline**

```bash
# Write a test memory, wait for enrichment, then search
curl -X POST localhost:3001/api/room -d '{"from":"alex","text":"@kuro remember: GraphQL migration 完成"}'
# Wait ~20s for enrichment
curl -sf 'localhost:3001/api/search?q=API+遷移' | jq '.results[:3]'
```

**Step 4: Verify summarization**

```bash
ls memory/topics/.summaries/
cat memory/topics/.summaries/_cross-topic-map.md
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(search): semantic search enrichment A+B+C complete"
```

---

## Rollback Plan

每個改動都可獨立回退：

| 組件 | 回退方式 |
|------|---------|
| A: enriched column | `rebuildIndex()` 重建（enriched 欄位為空，搜尋退回純 keyword） |
| B: query expansion | 刪除 `expandQuery()` + `SYNONYM_GROUPS`，搜尋退回原邏輯 |
| C: summarization | 刪除 `memory/topics/.summaries/` + `memory-summarizer.ts`，零影響 |
| 全部 | `git revert` 所有 commits，FTS5 schema 自動 migrate 回舊版 |
