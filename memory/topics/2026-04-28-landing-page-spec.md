# AI Trend Landing Page — Apply-Ready Spec

**Cycle 27 / 2026-04-28 14:09 / serves AI Trend 90 分 P0 #1**

Builds on: `2026-04-28-landing-page-data-inventory.md` (cycle 25), clustering verify (cycle 26).
Status: **apply-ready** — Alex 直接照貼，無 src/ 自 apply（malware-guard active）。

## Goal

Single page (`kuro-portfolio/ai-trend/landing.html`) — 打開就看到 4 區塊，覆蓋 Alex 04-27 反饋：

1. **今日 top topics**（5 源整合）
2. **趨勢走勢圖**（7-day topic-count trend lines）
3. **跨源共振**（topic × source matrix，filter sources≥2）
4. **時間篩選器**（dropdown: 今天 / 7 天 / 30 天 / 自訂）

GitHub 第六源 + graph 重疊 + swimlane 空格 = 另案，不在本 spec scope。

## Architecture

```
scripts/build-landing.mjs      ← new, runs after sync-views.mjs in cron
  → kuro-portfolio/ai-trend/data/landing-1d.json
  → kuro-portfolio/ai-trend/data/landing-7d.json
  → kuro-portfolio/ai-trend/data/landing-30d.json
  → kuro-portfolio/ai-trend/data/landing-custom-meta.json (date list for picker)

kuro-portfolio/ai-trend/landing.html  ← new, static, fetches data/landing-{period}.json
```

`build-landing.mjs` 共用 `hn-ai-trend-graph.mjs` 的 `TOPICS` + `tagPost()` — **不要 import**（避免 circular），複製常數區（已是 zero-dep regex，~15 行）以保 build script 獨立。

## Data Pipeline

### Input

```
memory/state/hn-ai-trend/2026-04-*.json
memory/state/reddit-trend/2026-04-*.json
memory/state/x-trend/2026-04-*.json
memory/state/arxiv-trend/2026-04-*.json
memory/state/latent-space-trend/2026-04-*.json
```

每檔 `{ run_at, count, posts: [{ id, title, url, points?, comments?, ... }] }`。

### Per-period aggregate（1d / 7d / 30d）

```js
// 對每個 period (1, 7, 30 天)：
// 1. 載入指定日期視窗內所有源檔
// 2. dedup by post.id（cross-day 同 id 取 max points）
// 3. 對每 post 跑 tagPost() → primary topic + tags[]

const aggregate = {
  meta: {
    period_days: 7,
    end_date: '2026-04-28',
    start_date: '2026-04-22',
    sources_active: ['hn_ai','reddit','x','arxiv','latent'],
    total_posts: 142,
    generated_at: '2026-04-28T06:09:00Z',
  },

  // 區塊 1: 今日 top topics
  // For period=1d: 直接列 top N by heat
  // For period=7d/30d: top N by post count per topic
  top_topics: [
    {
      topic: 'agent',
      color: '#9ab8ff',
      post_count: 23,
      sources: ['hn_ai','reddit','x'],
      sample_titles: [   // top 3 representative posts
        { title: '...', url: '...', source: 'hn_ai', points: 412 },
        ...
      ],
    },
    ...
  ],

  // 區塊 2: 趨勢走勢圖
  // X 軸 = date (period 內每天)，Y 軸 = post count per topic per day
  // dedup: 一個 post 只計入 first-seen date（避免連續多天出現灌水）
  trend_lines: [
    {
      topic: 'agent',
      color: '#9ab8ff',
      points: [
        { date: '2026-04-22', count: 5 },
        { date: '2026-04-23', count: 7 },
        ...
        { date: '2026-04-28', count: 12 },
      ],
      delta_vs_prev_period: '+45%',  // today vs avg(period_days-1)
    },
    ...
  ],

  // 區塊 3: 跨源共振
  // 一個 topic 在 ≥2 源出現 → 收進來
  cross_source: [
    {
      topic: 'agent',
      sources: ['hn_ai','reddit','x'],
      source_count: 3,
      post_count: 23,
      sample_titles: [...],  // 1 per source (cross-pollination evidence)
    },
    ...
  ],
};
```

### Build script skeleton (`build-landing.mjs`)

```js
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STATE_DIR = 'memory/state';
const OUT_DIR   = 'kuro-portfolio/ai-trend/data';

// Copy from hn-ai-trend-graph.mjs (zero-dep regex, ~15 lines)
const TOPICS = [/* same as graph.mjs:40-50 */];
const DEFAULT_TOPIC = { name: 'other', color: '#666666' };
function tagPost(post) { /* same as graph.mjs:53-64 */ }

// Source registry — same as graph.mjs:21-34 SOURCES (5 active)
const SOURCES = [
  { key: 'hn_ai',   dir: 'hn-ai-trend' },
  { key: 'reddit',  dir: 'reddit-trend' },
  { key: 'x',       dir: 'x-trend' },
  { key: 'arxiv',   dir: 'arxiv-trend' },
  { key: 'latent',  dir: 'latent-space-trend' },
];

async function loadPeriod(days) {
  const today = new Date().toISOString().slice(0,10);
  const cutoff = new Date(Date.now() - days*86400e3).toISOString().slice(0,10);

  const allPosts = [];
  for (const src of SOURCES) {
    const dir = join(STATE_DIR, src.dir);
    let files; try { files = await readdir(dir); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (!m || m[1] < cutoff || m[1] > today) continue;
      const date = m[1];
      const raw = JSON.parse(await readFile(join(dir, f), 'utf8'));
      for (const p of (raw.posts || [])) {
        const t = tagPost(p);
        allPosts.push({
          id: p.id, date, source: src.key,
          title: p.title, url: p.url,
          points: p.points ?? 0, comments: p.comments ?? 0,
          tags: t.tags, primary: t.primary, color: t.color,
        });
      }
    }
  }

  // Dedup by id, keep first-seen date (for trend line) + max points (for top)
  const byId = new Map();
  for (const p of allPosts) {
    const prev = byId.get(p.id);
    if (!prev) { byId.set(p.id, { ...p, first_seen: p.date }); continue; }
    if (p.date < prev.first_seen) prev.first_seen = p.date;
    if (p.points > prev.points)   prev.points = p.points;
  }
  return [...byId.values()];
}

function buildTopTopics(posts) { /* group by primary, sort by count desc, top 9 */ }
function buildTrendLines(posts, days) { /* per topic per first_seen day, count posts */ }
function buildCrossSource(posts) { /* per topic, collect sources set, filter >=2 */ }

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const days of [1, 7, 30]) {
    const posts = await loadPeriod(days);
    const out = {
      meta: { period_days: days, /* ... */ },
      top_topics: buildTopTopics(posts),
      trend_lines: buildTrendLines(posts, days),
      cross_source: buildCrossSource(posts),
    };
    await writeFile(join(OUT_DIR, `landing-${days}d.json`), JSON.stringify(out, null, 2));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
```

## HTML / UI Spec (`landing.html`)

Self-contained single-file pattern (same as graph.html / swimlane.html)：inline CSS + D3 v7 (CDN) + vanilla JS。

### Layout

```
┌─────────────────────────────────────────────────┐
│ AI Trend — 一眼看懂 [filter: 今天▼]            │  ← header + period dropdown
├─────────────────────────────────────────────────┤
│ 今日 top topics                                 │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  ← 9 topic chips, size = post_count
│ │agent │ │model │ │ infra│ │ eval │ │ ...  │  │     color = TOPICS.color
│ │  23  │ │  18  │ │  12  │ │  9   │ │  ... │  │     click → expand sample_titles
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │
├─────────────────────────────────────────────────┤
│ 趨勢走勢圖 (7 days)                            │
│         ┌──────────────────────────┐            │  ← D3 line chart
│   count │       /\          /      │            │     X = date, Y = post count
│         │   ___/  \________/       │            │     一線 = 一 topic (legend = TOPICS)
│         │  /                       │            │
│         └──────────────────────────┘            │
│           4/22  4/23  ...  4/28                 │
├─────────────────────────────────────────────────┤
│ 跨源共振 (topic 在 ≥2 源出現)                  │
│ topic    │ HN │ Reddit │ X │ arxiv │ latent     │  ← matrix
│ agent    │ ●  │   ●    │ ● │       │            │     ● = topic 在該源有 post
│ model    │ ●  │   ●    │   │   ●   │     ●      │
│ ...                                              │
├─────────────────────────────────────────────────┤
│ generated 2026-04-28 06:09 · 142 posts · 5 srcs │  ← footer
└─────────────────────────────────────────────────┘
```

### Behavior

- 時間篩選器（dropdown）：`今天` / `7 天` / `30 天` / `自訂`
  - 前三個：fetch `data/landing-{1,7,30}d.json`，全頁 re-render
  - 自訂：v1 標 "TODO"（留鉤子，不阻 ship）
- Topic chip click → 展開該 topic 的 `sample_titles`（top 3 posts），再次 click 收合
- Trend line legend click → toggle 該線顯示
- Cross-source matrix cell hover → tooltip 顯示「該 topic 在該源的 post 數」

### Mobile

`@media (max-width: 720px)` — chips 改 2 欄、trend chart 高度減半、matrix 改 vertical scroll。

### i18n

跟 graph.html 同模式：`data-i18n="..."` + `lang` toggle（zh/en）。

## Cron Wire-up

```cron
# crontab -e
30 1 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/hn-ai-trend.mjs ...
35 1 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/reddit-ai-trend.mjs ...
... (其他 source fetchers)
50 1 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/hn-ai-trend-sync-views.mjs
55 1 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/build-landing.mjs   # ← new
```

## Acceptance

- [ ] `build-landing.mjs` 跑完不報錯，產出 3 個 `landing-{1,7,30}d.json`，schema 符合上述
- [ ] `landing.html` 4 區塊全現，period dropdown 切換正常
- [ ] mobile (375px) 不破版
- [ ] cron 04-29 02:00 自動跑完，landing 顯示 04-29 資料

## Falsifier (3 cycle TTL)

1. Alex 看了 spec 說「不是我要的 landing」→ 我 misread Alex P0 文字，需 re-read
2. spec 假設 arxiv/latent-space 也有 `points` → 程式碼用 `?? 0` 已防，但 trend line 對這兩源等於只有 0 分權重，可能讓 model topic 跨源計分時 arxiv 分量偏低（acceptable for v1，標 known limitation）
3. dedup 用 `first_seen` 記入 trend → 同 post 同日重複出現只算 1 票 ✅；但跨日連續上榜的 hot post 只在 first day 有 +1，其後 0 → 趨勢線會把「持續火」的 topic 顯示成「曇花一現」。**接受 v1**：trend = 「新話題湧現密度」而非「總熱度」，與 Alex 「哪些話題在升溫」對齊（升溫 = 新 post 出現速率）。

## Out of scope（下個 cycle）

- GitHub 第六源 fetcher（Alex P0 #2）
- graph.html 節點重疊修復（D3 force layout 調 charge/collision）
- swimlane 空格修復（cycle 24 Alex 反饋）
- 自訂日期 picker 實作

## Apply checklist for Alex

1. `touch mini-agent/scripts/build-landing.mjs` → paste skeleton + 補三個 helper（`buildTopTopics`/`buildTrendLines`/`buildCrossSource`）
2. `touch mini-agent/kuro-portfolio/ai-trend/landing.html` → 寫 4 區塊（D3 line + chip grid + matrix table）
3. `mkdir -p mini-agent/kuro-portfolio/ai-trend/data`
4. `cd mini-agent && node scripts/build-landing.mjs` → smoke test，看 3 個 json 是否產出
5. Open `landing.html` in browser，4 區塊都有資料 → 加 cron entry
