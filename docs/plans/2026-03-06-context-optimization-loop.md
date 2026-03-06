# Self-Evolving Context Optimization Loop - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-evolving optimization loop that analyzes context usage per cycle, identifies bloat, and automatically adjusts loading strategies — making the agent's "brain" leaner over time with zero manual tuning.

**Architecture:** Two-layer optimization. Rule layer (every 50 cycles, zero LLM cost) handles MEMORY.md smart loading, trail deduplication, and citation-driven section demotion. Haiku layer (daily) handles topic memory pruning and MEMORY.md cold storage migration. All changes are fire-and-forget, non-blocking, and reversible.

**Tech Stack:** TypeScript strict mode, better-sqlite3 FTS5 (existing `src/search.ts`), Claude Haiku via CLI subprocess (existing pattern in `src/coach.ts`), JSONL state files (existing pattern in `src/feedback-loops.ts`)

**Key Design Decisions (converged with Kuro):**
- Precise loading > content compression ("the problem isn't too much content, it's too coarse loading")
- Pruning > summarizing (delete outdated facts, keep cross-domain insights)
- Rule layer changes directly; Haiku layer proposes changes for review
- 200-cycle demotion threshold (~3 days), with auto-promote on citation

**Existing Code Context:**
- `src/memory.ts` — `buildContext()` (L1499-2039), `tieredMemoryContent()` (L2336-2426), `readTrailSection()` (L2568-2623), `saveContextCheckpoint()` (L2046-2071)
- `src/search.ts` — FTS5 search with `searchMemoryFTS(query, limit)`, `parseMemoryMd()` already indexes MEMORY.md entries
- `src/feedback-loops.ts` — `trackPerceptionCitations()` (L176-238), existing citation tracking every 50 cycles
- State files pattern: `readState<T>()` / `writeState()` in feedback-loops.ts

---

## Task 1: MEMORY.md Smart Loading via FTS5 BM25

**What:** Replace always-load-full MEMORY.md with keyword-matched entry loading. `User Preferences` + `Important Decisions` stay always-load. `Learned Patterns` + `TODO` + `Operations` entries go through FTS5 BM25 filtering based on `contextHint`.

**Why:** MEMORY.md averages ~7711 chars with 0.46% citation rate. Smart loading should cut ~5000 chars/cycle.

**Files:**
- Modify: `src/memory.ts:2336-2426` (tieredMemoryContent)
- Modify: `src/memory.ts:2002-2005` (buildContext memory section)
- Modify: `src/search.ts` (add searchMemoryEntries helper)
- Test: `src/__tests__/memory-smart-loading.test.ts`

### Step 1: Write the failing test for searchMemoryEntries

```typescript
// src/__tests__/memory-smart-loading.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initSearchIndex, searchMemoryEntries, closeSearchIndex } from '../search.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('searchMemoryEntries', () => {
  const tmpDir = path.join(os.tmpdir(), `mem-test-${Date.now()}`);
  const dbPath = path.join(tmpDir, 'test.db');
  const memoryDir = path.join(tmpDir, 'memory');

  beforeAll(() => {
    fs.mkdirSync(memoryDir, { recursive: true });
    // Create a test MEMORY.md
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), `# Long-term Memory

## User Preferences
- [2026-02-05] User prefers TypeScript

## Learned Patterns
- [2026-02-09] CI/CD enabled since commit 2d46412. Self-hosted runner online.
- [2026-02-09] Do not make conclusions without verification. Use tools to verify.
- [2026-02-26] Abstraction must be thorough: after creating shared abstractions, grep all old hardcoded logic.
- [2026-02-26] Naming carries assumptions: when variable purpose generalizes, name must update.

## Important Decisions
- [2026-02-09] Three-party collaboration model: Alex + Claude Code + Kuro.

## TODO / Future Improvements
- [2026-03-01] Consider adding metrics dashboard for context optimization
`);
    initSearchIndex(dbPath);
  });

  afterAll(() => {
    closeSearchIndex();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns relevant entries matching query', () => {
    const results = searchMemoryEntries(memoryDir, 'CI/CD deploy runner', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('CI/CD');
  });

  it('returns empty for unrelated queries', () => {
    const results = searchMemoryEntries(memoryDir, 'quantum physics blockchain', 5);
    expect(results.length).toBe(0);
  });

  it('respects limit parameter', () => {
    const results = searchMemoryEntries(memoryDir, 'abstraction naming variable', 10);
    expect(results.length).toBeLessThanOrEqual(10);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/memory-smart-loading.test.ts`
Expected: FAIL — `searchMemoryEntries is not a function`

### Step 3: Implement searchMemoryEntries in search.ts

Add to `src/search.ts` after `searchMemoryFTS()` (after line 199):

```typescript
/**
 * Search MEMORY.md entries specifically, with auto-index on first call.
 * Used by buildContext() for smart MEMORY.md loading.
 */
export function searchMemoryEntries(
  memoryDir: string,
  query: string,
  limit = 10,
): Array<{ source: string; date: string; content: string }> {
  if (!db) return [];

  // Auto-index if empty
  if (!isIndexReady()) {
    indexMemoryFiles(memoryDir);
  }

  try {
    const sanitized = query.replace(/["""*{}()^~[\]]/g, '').trim();
    if (!sanitized) return [];

    const rows = db.prepare(`
      SELECT source, date, content, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
        AND source = 'MEMORY.md'
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit) as Array<{ source: string; date: string; content: string; rank: number }>;

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

### Step 4: Run test to verify it passes

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/memory-smart-loading.test.ts`
Expected: PASS

### Step 5: Modify tieredMemoryContent to support smart loading

Replace `tieredMemoryContent()` in `src/memory.ts:2336-2426` to accept an optional `contextHint` parameter and use FTS5 for non-critical sections:

```typescript
private tieredMemoryContent(raw: string, contextHint?: string): string {
  if (!raw) return raw;

  const now = Date.now();
  const THREE_DAYS = 3 * 86_400_000;
  const MEMORY_BUDGET = 6000;

  // Sections always loaded in full (small, critical, exempt from budget)
  const alwaysFullSections = ['User Preferences', 'Important Facts', 'Important Decisions'];
  // Sections eligible for FTS5 smart loading
  const smartLoadSections = ['Learned Patterns', 'TODO', 'Operations', 'Future Improvements'];

  const lines = raw.split('\n');
  const result: string[] = [];
  let currentSection = '';
  let isAlwaysFullSection = false;
  let isSmartLoadSection = false;
  let budgetChars = 0;
  let budgetExceeded = false;
  let olderCount = 0;
  let skippedBySmartLoad = 0;

  // If contextHint available and FTS5 ready, get relevant entry contents
  let relevantEntryContents: Set<string> | null = null;
  if (contextHint) {
    try {
      const { searchMemoryEntries } = require('./search.js');
      const entries = searchMemoryEntries(
        path.join(this.memoryDir),
        contextHint,
        15,
      ) as Array<{ content: string }>;
      if (entries.length > 0) {
        relevantEntryContents = new Set(entries.map(e => e.content.slice(0, 80)));
      }
    } catch { /* FTS5 not available, fall through to age-based */ }
  }

  for (const line of lines) {
    // Section headers
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      if (olderCount > 0 || skippedBySmartLoad > 0) {
        const total = olderCount + skippedBySmartLoad;
        result.push(`(${total} more entries available via search)`);
        olderCount = 0;
        skippedBySmartLoad = 0;
      }
      currentSection = sectionMatch[1];
      isAlwaysFullSection = alwaysFullSections.some(s => currentSection.includes(s));
      isSmartLoadSection = smartLoadSections.some(s => currentSection.includes(s));
      budgetExceeded = false;
      result.push(line);
      continue;
    }

    // Sub-section headers always kept
    if (line.startsWith('### ')) {
      result.push(line);
      continue;
    }

    // Always-full sections: keep everything
    if (isAlwaysFullSection) {
      result.push(line);
      continue;
    }

    // Budget exceeded: count remaining
    if (budgetExceeded) {
      if (line.match(/^- \[/)) olderCount++;
      else if (line.trim()) result.push(line);
      continue;
    }

    // Dated entries
    const dateMatch = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]/);
    if (dateMatch) {
      const age = now - new Date(dateMatch[1]).getTime();

      // Smart load: if FTS5 results available, only include matching entries
      if (isSmartLoadSection && relevantEntryContents) {
        const entryText = line.replace(/^- \[\d{4}-\d{2}-\d{2}\] /, '').slice(0, 80);
        const isRelevant = relevantEntryContents.has(entryText) || age <= THREE_DAYS;
        if (!isRelevant) {
          skippedBySmartLoad++;
          continue;
        }
      }

      // Age-based tiering (fallback when no FTS5)
      let entry: string;
      if (age <= THREE_DAYS) {
        entry = line;
      } else if (age <= 7 * 86_400_000) {
        entry = line.length > 120 ? line.slice(0, 120) + '...' : line;
      } else if (!relevantEntryContents) {
        // Only age-filter if not using smart load
        olderCount++;
        continue;
      } else {
        entry = line; // FTS5 matched, keep regardless of age
      }

      // Budget check
      if (budgetChars + entry.length > MEMORY_BUDGET) {
        budgetExceeded = true;
        olderCount++;
        continue;
      }

      result.push(entry);
      budgetChars += entry.length;
      continue;
    }

    // Undated entries: always keep
    result.push(line);
  }

  if (olderCount > 0 || skippedBySmartLoad > 0) {
    const total = olderCount + skippedBySmartLoad;
    result.push(`(${total} more entries available via search)`);
  }

  return result.join('\n');
}
```

### Step 6: Update buildContext to pass contextHint to tieredMemoryContent

In `src/memory.ts:2003`, change:

```typescript
// Before:
const tieredMem = this.tieredMemoryContent(memory);

// After:
const tieredMem = this.tieredMemoryContent(memory, contextHint);
```

### Step 7: Run typecheck and full tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run src/__tests__/memory-smart-loading.test.ts`
Expected: PASS

### Step 8: Commit

```bash
git add src/search.ts src/memory.ts src/__tests__/memory-smart-loading.test.ts
git commit -m "feat: smart MEMORY.md loading via FTS5 BM25

Phase 1.1 of context optimization loop. Non-critical MEMORY.md sections
(Learned Patterns, TODO, Operations) now use FTS5 keyword matching instead
of always-loading. User Preferences + Important Decisions exempt.
Estimated savings: ~5000 chars/cycle."
```

---

## Task 2: Trail Deduplication

**What:** Deduplicate repeated trail entries. When the same trigger+result pattern appears >3 times in the 2h window, merge into a single line with count.

**Why:** Trail section can have repetitive entries (e.g., same heartbeat trigger cycling), wasting ~1000-2000 chars.

**Files:**
- Modify: `src/memory.ts:2568-2623` (readTrailSection)
- Test: `src/__tests__/trail-dedup.test.ts`

### Step 1: Write the failing test

```typescript
// src/__tests__/trail-dedup.test.ts
import { describe, it, expect } from 'vitest';

// We'll test the dedup logic as a pure function
import { deduplicateTrailEntries } from '../memory.js';

describe('deduplicateTrailEntries', () => {
  it('merges entries with same agent+type+decision pattern appearing >3 times', () => {
    const entries = [
      { ts: '2026-03-06T10:00:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:05:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:10:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:15:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:20:00Z', agent: 'kuro', type: 'focus', decision: 'act', topics: ['learning'], detail: 'Started research on topic X' },
    ];

    const result = deduplicateTrailEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].count).toBe(4);
    expect(result[0].detail).toContain('No action needed');
    expect(result[1].count).toBeUndefined();
  });

  it('does not merge entries appearing <=3 times', () => {
    const entries = [
      { ts: '2026-03-06T10:00:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:05:00Z', agent: 'kuro', type: 'triage', decision: 'skip', topics: ['workspace'], detail: 'No action needed' },
      { ts: '2026-03-06T10:10:00Z', agent: 'kuro', type: 'focus', decision: 'act', topics: ['code'], detail: 'Writing feature' },
    ];

    const result = deduplicateTrailEntries(entries);
    expect(result).toHaveLength(3);
  });

  it('preserves unique entries in order', () => {
    const entries = [
      { ts: '2026-03-06T10:00:00Z', agent: 'kuro', type: 'scout', topics: ['music'], detail: 'Found new artist' },
      { ts: '2026-03-06T10:05:00Z', agent: 'kuro', type: 'focus', topics: ['code'], detail: 'Implementing feature' },
    ];

    const result = deduplicateTrailEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].detail).toContain('Found new artist');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/trail-dedup.test.ts`
Expected: FAIL — `deduplicateTrailEntries is not exported`

### Step 3: Implement deduplicateTrailEntries

Add to `src/memory.ts` before `readTrailSection()` (before line 2568):

```typescript
interface TrailEntry {
  ts: string;
  agent: string;
  type: string;
  decision?: string;
  topics: string[];
  detail: string;
  count?: number;
}

/** Deduplicate trail entries: merge same pattern >3 times into single entry with count */
export function deduplicateTrailEntries(entries: TrailEntry[]): TrailEntry[] {
  if (entries.length <= 3) return entries;

  // Group by pattern key: agent + type + decision
  const groups = new Map<string, TrailEntry[]>();
  const order: string[] = []; // track first-seen order

  for (const e of entries) {
    const key = `${e.agent}|${e.type}|${e.decision ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  const result: TrailEntry[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length > 3) {
      // Merge: use latest timestamp, combine topics, keep first detail
      const latest = group[group.length - 1];
      const allTopics = [...new Set(group.flatMap(e => e.topics))];
      result.push({
        ...latest,
        topics: allTopics,
        detail: group[0].detail,
        count: group.length,
      });
    } else {
      result.push(...group);
    }
  }

  return result;
}
```

### Step 4: Update readTrailSection to use dedup

In `readTrailSection()` at `src/memory.ts:2598`, change the formatting to use dedup:

```typescript
// Before:
const formatted = entries.slice(-20).map(e => {
  ...
}).join('\n');

// After:
const deduped = deduplicateTrailEntries(entries);
const formatted = deduped.slice(-20).map(e => {
  const time = e.ts.split('T')[1]?.split('.')[0]?.slice(0, 5) ?? '';
  const icon = e.type === 'scout' ? '?' : e.type === 'focus' ? '' : e.type === 'triage' ? '' : '';
  const decision = e.decision ? `[${e.decision}]` : '';
  const topics = e.topics.join(',');
  const countSuffix = e.count ? ` (x${e.count})` : '';
  return `${time} ${icon} ${e.agent} ${decision} ${topics}: ${e.detail.slice(0, 80)}${countSuffix}`;
}).join('\n');
```

Also update the topic frequency counting to use `deduped` source entries (not the deduplicated ones — use original `entries` for accurate topic counting).

### Step 5: Run tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run src/__tests__/trail-dedup.test.ts`
Expected: PASS

### Step 6: Commit

```bash
git add src/memory.ts src/__tests__/trail-dedup.test.ts
git commit -m "feat: trail deduplication for context optimization

Phase 1.2: same trigger+result pattern >3 times in trail merges into
single entry with count suffix. Estimated savings: ~1000-2000 chars/cycle."
```

---

## Task 3: Citation-Driven Auto-Demotion

**What:** Extend `trackPerceptionCitations()` to also track section load/citation for always-load sections. After 200 consecutive cycles with zero citations, demote an always-load section to conditional-load. Auto-promote back when cited.

**Why:** Some sections were manually demoted (capabilities, coach, commitments) based on one-time analysis. This automates the process with a safety net.

**Files:**
- Modify: `src/feedback-loops.ts:176-238` (trackPerceptionCitations)
- Create: `src/context-optimizer.ts` (new module for optimization logic)
- Modify: `src/memory.ts:1630-1640` (buildContext reads demotion state)
- Test: `src/__tests__/context-optimizer.test.ts`

### Step 1: Write the failing test

```typescript
// src/__tests__/context-optimizer.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ContextOptimizer, type SectionDemotionState } from '../context-optimizer.js';

describe('ContextOptimizer', () => {
  let optimizer: ContextOptimizer;

  beforeEach(() => {
    optimizer = new ContextOptimizer();
  });

  describe('section demotion', () => {
    it('does not demote a section before 200 zero-citation cycles', () => {
      // Simulate 199 cycles with no citations for "achievements"
      for (let i = 0; i < 199; i++) {
        optimizer.recordCycle({ citedSections: ['soul', 'workspace'] });
      }
      expect(optimizer.isDemoted('achievements')).toBe(false);
    });

    it('demotes a section after 200 consecutive zero-citation cycles', () => {
      for (let i = 0; i < 200; i++) {
        optimizer.recordCycle({ citedSections: ['soul', 'workspace'] });
      }
      expect(optimizer.isDemoted('achievements')).toBe(true);
    });

    it('resets counter when section is cited', () => {
      for (let i = 0; i < 150; i++) {
        optimizer.recordCycle({ citedSections: ['soul'] });
      }
      // Now cite achievements — counter resets
      optimizer.recordCycle({ citedSections: ['soul', 'achievements'] });
      for (let i = 0; i < 100; i++) {
        optimizer.recordCycle({ citedSections: ['soul'] });
      }
      expect(optimizer.isDemoted('achievements')).toBe(false);
    });

    it('auto-promotes a demoted section when cited', () => {
      // First demote it
      for (let i = 0; i < 200; i++) {
        optimizer.recordCycle({ citedSections: ['soul'] });
      }
      expect(optimizer.isDemoted('achievements')).toBe(true);

      // Now cite it — should auto-promote with observation period
      optimizer.recordCycle({ citedSections: ['achievements'] });
      expect(optimizer.isDemoted('achievements')).toBe(false);
      expect(optimizer.isInObservation('achievements')).toBe(true);
    });

    it('permanently demotes after observation period expires with no citations', () => {
      // Demote
      for (let i = 0; i < 200; i++) {
        optimizer.recordCycle({ citedSections: [] });
      }
      // Cite to promote
      optimizer.recordCycle({ citedSections: ['achievements'] });
      // 50 cycles observation with no citation
      for (let i = 0; i < 50; i++) {
        optimizer.recordCycle({ citedSections: [] });
      }
      expect(optimizer.isDemoted('achievements')).toBe(true);
      expect(optimizer.isInObservation('achievements')).toBe(false);
    });

    it('never demotes protected sections', () => {
      for (let i = 0; i < 500; i++) {
        optimizer.recordCycle({ citedSections: [] });
      }
      // Core sections should never be demoted
      expect(optimizer.isDemoted('environment')).toBe(false);
      expect(optimizer.isDemoted('soul')).toBe(false);
      expect(optimizer.isDemoted('inbox')).toBe(false);
      expect(optimizer.isDemoted('workspace')).toBe(false);
    });
  });

  describe('getLoadableKeywords', () => {
    it('returns keywords for demoted sections', () => {
      // Demote achievements
      for (let i = 0; i < 200; i++) {
        optimizer.recordCycle({ citedSections: [] });
      }
      const kw = optimizer.getLoadableKeywords('achievements');
      expect(kw).toBeDefined();
      expect(kw!.length).toBeGreaterThan(0);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/context-optimizer.test.ts`
Expected: FAIL — `Cannot find module '../context-optimizer.js'`

### Step 3: Implement ContextOptimizer

Create `src/context-optimizer.ts`:

```typescript
/**
 * Context Optimizer - Citation-driven auto-demotion/promotion of context sections
 *
 * Tracks which sections are cited per cycle. After 200 consecutive cycles with
 * zero citations, a section is demoted to conditional-load (keyword-triggered).
 * If a demoted section is cited, it's promoted back with a 50-cycle observation.
 */

import { readState, writeState } from './feedback-loops.js';

export interface SectionDemotionState {
  /** Per-section consecutive zero-citation count */
  zeroCounts: Record<string, number>;
  /** Demoted sections with their keyword triggers */
  demoted: Record<string, { demotedAt: string; keywords: string[] }>;
  /** Sections in observation period (promoted back, watching) */
  observation: Record<string, { promotedAt: string; remainingCycles: number }>;
  /** Total cycles tracked */
  totalCycles: number;
}

const STATE_FILE = 'context-optimizer.json';
const DEMOTION_THRESHOLD = 200;
const OBSERVATION_CYCLES = 50;

/** Sections that must never be demoted */
const PROTECTED_SECTIONS = new Set([
  'environment', 'soul', 'inbox', 'workspace', 'telegram',
  'memory', 'heartbeat', 'recent_conversations', 'next',
  'priority-focus', 'self', 'chat-room-recent',
]);

/** Default keywords for conditional loading when demoted */
const SECTION_KEYWORDS: Record<string, string[]> = {
  temporal: ['time', 'schedule', 'when', 'date', 'calendar'],
  capabilities: ['capability', 'tool', 'plugin', 'skill', 'mcp', 'provider', 'model'],
  process: ['process', 'memory', 'cpu', 'pid', 'debug', 'slow', 'performance', 'kill'],
  system: ['system', 'disk', 'cpu', 'resource', 'space', 'full'],
  logs: ['error', 'log', 'fail', 'bug', 'debug', 'crash'],
  network: ['port', 'network', 'service', 'connect', 'http', 'api', 'url'],
  config: ['config', 'setting', 'compose', 'cron', 'loop', 'skill'],
  activity: ['activity', 'behavior', 'action', 'recent'],
  trail: ['trail', 'decision', 'triage', 'scout'],
  achievements: ['achievement', 'milestone', 'ship', 'momentum'],
  coach: ['coach', 'habit', 'behavior', 'pattern', 'streak', 'action ratio'],
  commitments: ['commitment', 'promise', 'overdue', 'committed', 'pledge'],
  'background-completed': ['background', 'delegation', 'delegate', 'completed'],
  'recent-activity': ['activity', 'journal', 'recent'],
  threads: ['thread', 'thinking'],
  'working-memory': ['inner', 'working', 'scratch'],
  'inner-voice': ['impulse', 'voice', 'creative'],
  'conversation-threads': ['conversation', 'thread', 'pending', 'question'],
  'stale-tasks': ['stale', 'task', 'overdue'],
  'structural-health': ['structural', 'health', 'warning'],
  'decision-quality-warning': ['quality', 'decision', 'warning'],
};

export class ContextOptimizer {
  private state: SectionDemotionState;

  constructor(initialState?: SectionDemotionState) {
    this.state = initialState ?? readState<SectionDemotionState>(STATE_FILE, {
      zeroCounts: {},
      demoted: {},
      observation: {},
      totalCycles: 0,
    });
  }

  /** Record one cycle's citation data */
  recordCycle(data: { citedSections: string[] }): void {
    const cited = new Set(data.citedSections);
    this.state.totalCycles++;

    // All trackable sections (from SECTION_KEYWORDS)
    const trackable = Object.keys(SECTION_KEYWORDS);

    for (const section of trackable) {
      if (PROTECTED_SECTIONS.has(section)) continue;

      if (cited.has(section)) {
        // Section was cited — reset zero count
        this.state.zeroCounts[section] = 0;

        // If demoted, auto-promote with observation
        if (this.state.demoted[section]) {
          delete this.state.demoted[section];
          this.state.observation[section] = {
            promotedAt: new Date().toISOString(),
            remainingCycles: OBSERVATION_CYCLES,
          };
        }

        // If in observation, refresh (citation during observation = healthy)
        if (this.state.observation[section]) {
          this.state.observation[section].remainingCycles = OBSERVATION_CYCLES;
        }
      } else {
        // Not cited — increment zero count
        this.state.zeroCounts[section] = (this.state.zeroCounts[section] ?? 0) + 1;

        // Check demotion threshold
        if (this.state.zeroCounts[section] >= DEMOTION_THRESHOLD && !this.state.demoted[section]) {
          this.state.demoted[section] = {
            demotedAt: new Date().toISOString(),
            keywords: SECTION_KEYWORDS[section] ?? [],
          };
          delete this.state.observation[section];
        }

        // Tick observation period
        if (this.state.observation[section]) {
          this.state.observation[section].remainingCycles--;
          if (this.state.observation[section].remainingCycles <= 0) {
            // Observation expired with no citation — permanent demotion
            delete this.state.observation[section];
            this.state.demoted[section] = {
              demotedAt: new Date().toISOString(),
              keywords: SECTION_KEYWORDS[section] ?? [],
            };
          }
        }
      }
    }
  }

  /** Check if a section is currently demoted */
  isDemoted(section: string): boolean {
    if (PROTECTED_SECTIONS.has(section)) return false;
    return !!this.state.demoted[section];
  }

  /** Check if a section is in observation period */
  isInObservation(section: string): boolean {
    return !!this.state.observation[section];
  }

  /** Get conditional-load keywords for a demoted section */
  getLoadableKeywords(section: string): string[] | undefined {
    return this.state.demoted[section]?.keywords ?? SECTION_KEYWORDS[section];
  }

  /** Get all demoted section names */
  getDemotedSections(): string[] {
    return Object.keys(this.state.demoted);
  }

  /** Persist state */
  save(): void {
    writeState(STATE_FILE, this.state);
  }

  /** Get state for inspection */
  getState(): SectionDemotionState {
    return this.state;
  }
}

// Singleton
let optimizer: ContextOptimizer | null = null;

export function getContextOptimizer(): ContextOptimizer {
  if (!optimizer) {
    optimizer = new ContextOptimizer();
  }
  return optimizer;
}
```

### Step 4: Run test

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run src/__tests__/context-optimizer.test.ts`
Expected: PASS

### Step 5: Integrate into feedback-loops.ts

In `src/feedback-loops.ts`, at the end of `trackPerceptionCitations()` (after line 237), add:

```typescript
// Feed citation data to context optimizer
try {
  const { getContextOptimizer } = await import('./context-optimizer.js');
  const citedSections: string[] = [];
  for (const m of action.matchAll(/<(\w[\w-]+)>/g)) {
    const name = m[1];
    if (!['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol'].includes(name)) {
      citedSections.push(name);
    }
  }
  const opt = getContextOptimizer();
  opt.recordCycle({ citedSections });
  opt.save();
} catch { /* ignore */ }
```

### Step 6: Integrate into buildContext

In `src/memory.ts:buildContext()`, after the `isRelevant` function (line 1634), add optimizer-aware check:

```typescript
// Load demotion state from context optimizer
let demotedSections: Set<string> = new Set();
try {
  const { getContextOptimizer } = await import('./context-optimizer.js');
  const opt = getContextOptimizer();
  demotedSections = new Set(opt.getDemotedSections());
} catch { /* ignore */ }

// Enhanced relevance check: includes auto-demoted sections
const shouldLoad = (section: string, keywords: string[]) => {
  if (demotedSections.has(section)) {
    // Demoted: only load if keyword match
    return keywords.some(k => contextHint.includes(k));
  }
  return isRelevant(keywords);
};
```

Then replace `isRelevant(...)` calls for sections that should be optimizer-aware (activity, trail, achievements, etc.) with `shouldLoad(sectionName, keywords)`.

### Step 7: Run full tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 8: Commit

```bash
git add src/context-optimizer.ts src/feedback-loops.ts src/memory.ts src/__tests__/context-optimizer.test.ts
git commit -m "feat: citation-driven auto-demotion for context sections

Phase 1.3: tracks per-section citations. 200 consecutive zero-citation
cycles demotes to conditional-load. Auto-promotes back on citation with
50-cycle observation. Protected sections (soul, inbox, etc) exempt."
```

---

## Task 4: Haiku Daily Pruning (Topic Memory)

**What:** Daily scheduled job that uses Claude Haiku to analyze topic memory files and propose deletions of outdated/duplicate entries. Proposals saved as markdown diff for Kuro to review.

**Why:** Topic files accumulate stale entries over time. Haiku can identify outdated facts cheaply ($0.001-0.01/run).

**Files:**
- Create: `src/context-pruner.ts` (Haiku pruning logic)
- Modify: `src/loop.ts` (add daily trigger)
- Test: `src/__tests__/context-pruner.test.ts`

### Step 1: Write the failing test

```typescript
// src/__tests__/context-pruner.test.ts
import { describe, it, expect } from 'vitest';
import { generatePruningPrompt, parsePruningProposal } from '../context-pruner.js';

describe('context-pruner', () => {
  describe('generatePruningPrompt', () => {
    it('generates a prompt with topic content and instructions', () => {
      const prompt = generatePruningPrompt('music', `# Music
- [2026-01-15] Discovered Nujabes - jazz hop pioneer
- [2026-01-15] Discovered Nujabes - jazz hip-hop pioneer (duplicate)
- [2025-12-01] BPM of test.mp3 is 120
- [2026-02-20] Cross-domain: music structure maps to code architecture`);

      expect(prompt).toContain('music');
      expect(prompt).toContain('DELETE');
      expect(prompt).toContain('KEEP');
    });
  });

  describe('parsePruningProposal', () => {
    it('parses DELETE and KEEP lines from Haiku response', () => {
      const response = `Analysis of topic "music":

DELETE: - [2026-01-15] Discovered Nujabes - jazz hip-hop pioneer (duplicate)
REASON: Duplicate of previous entry

DELETE: - [2025-12-01] BPM of test.mp3 is 120
REASON: Ephemeral fact, not reusable knowledge

KEEP: - [2026-01-15] Discovered Nujabes - jazz hop pioneer
KEEP: - [2026-02-20] Cross-domain: music structure maps to code architecture`;

      const result = parsePruningProposal(response);
      expect(result.deletions).toHaveLength(2);
      expect(result.keeps).toHaveLength(2);
      expect(result.deletions[0].line).toContain('duplicate');
      expect(result.deletions[0].reason).toContain('Duplicate');
    });

    it('returns empty result for unparseable response', () => {
      const result = parsePruningProposal('I cannot analyze this.');
      expect(result.deletions).toHaveLength(0);
      expect(result.keeps).toHaveLength(0);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/context-pruner.test.ts`
Expected: FAIL — `Cannot find module '../context-pruner.js'`

### Step 3: Implement context-pruner.ts

```typescript
/**
 * Context Pruner - Haiku-driven topic memory pruning
 *
 * Daily job: reads topic files, sends to Haiku for analysis,
 * saves pruning proposals as markdown diff for Kuro review.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { readState, writeState } from './feedback-loops.js';

interface PrunerState {
  lastRun: string;
  lastTopic: string;
  proposalsPending: number;
}

interface PruningProposal {
  deletions: Array<{ line: string; reason: string }>;
  keeps: Array<{ line: string }>;
}

const STATE_FILE = 'context-pruner.json';
const PROPOSALS_DIR = 'pruning-proposals';

export function generatePruningPrompt(topicName: string, content: string): string {
  return `You are analyzing a topic memory file for an AI agent. Your job is to identify entries that should be DELETED because they are:
1. Duplicates (same information stated differently)
2. Outdated facts (superseded by newer entries)
3. Ephemeral data (specific values/metrics that aren't reusable knowledge)

KEEP entries that are:
- Cross-domain insights (connections between different fields)
- Opinions and perspectives (subjective judgments)
- Reusable patterns (applicable to future decisions)
- Unique knowledge not duplicated elsewhere

For each entry, respond with either:
DELETE: [the full entry line]
REASON: [why it should be deleted]

or:
KEEP: [the full entry line]

Topic: "${topicName}"
Content:
${content}`;
}

export function parsePruningProposal(response: string): PruningProposal {
  const deletions: Array<{ line: string; reason: string }> = [];
  const keeps: Array<{ line: string }> = [];

  const lines = response.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('DELETE:')) {
      const entryLine = line.replace(/^DELETE:\s*/, '').trim();
      // Look for REASON on next line
      const nextLine = lines[i + 1]?.trim() ?? '';
      const reason = nextLine.startsWith('REASON:')
        ? nextLine.replace(/^REASON:\s*/, '').trim()
        : 'No reason given';
      if (entryLine) {
        deletions.push({ line: entryLine, reason });
      }
    } else if (line.startsWith('KEEP:')) {
      const entryLine = line.replace(/^KEEP:\s*/, '').trim();
      if (entryLine) {
        keeps.push({ line: entryLine });
      }
    }
  }

  return { deletions, keeps };
}

/**
 * Run Haiku pruning on a single topic file.
 * Returns proposal or null if no deletions suggested.
 */
export async function pruneTopicFile(
  topicPath: string,
  topicName: string,
): Promise<PruningProposal | null> {
  const content = fs.readFileSync(topicPath, 'utf-8');

  // Skip small files (not worth pruning)
  if (content.length < 500) return null;

  const prompt = generatePruningPrompt(topicName, content);

  try {
    const result = execFileSync('claude', ['-p', '--model', 'claude-haiku-4-5-20251001'], {
      input: prompt,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    const proposal = parsePruningProposal(result);
    if (proposal.deletions.length === 0) return null;

    return proposal;
  } catch (error) {
    slog('PRUNER', `Haiku call failed for ${topicName}: ${error}`);
    return null;
  }
}

/**
 * Save a pruning proposal as markdown diff for review.
 */
export function savePruningProposal(
  memoryDir: string,
  topicName: string,
  proposal: PruningProposal,
): string {
  const dir = path.join(memoryDir, PROPOSALS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-prune-${topicName}.md`;
  const filepath = path.join(dir, filename);

  const lines = [
    `# Pruning Proposal: ${topicName}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Proposed Deletions',
    '',
    ...proposal.deletions.map(d =>
      `- \`${d.line.slice(0, 100)}\`\n  Reason: ${d.reason}`
    ),
    '',
    '## Entries to Keep',
    '',
    ...proposal.keeps.map(k => `- ${k.line.slice(0, 100)}`),
    '',
    '---',
    'To apply: Kuro reviews and uses `<kuro:action>` to delete approved lines.',
  ];

  fs.writeFileSync(filepath, lines.join('\n'));
  return filepath;
}

/**
 * Daily pruning job: process one topic file per run (round-robin).
 * Called from loop.ts on daily schedule.
 */
export async function runDailyPruning(memoryDir: string): Promise<void> {
  const state = readState<PrunerState>(STATE_FILE, {
    lastRun: '',
    lastTopic: '',
    proposalsPending: 0,
  });

  // Check if already ran today
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastRun === today) return;

  // List topic files
  const topicsDir = path.join(memoryDir, 'topics');
  if (!fs.existsSync(topicsDir)) return;

  const topics = fs.readdirSync(topicsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  if (topics.length === 0) return;

  // Round-robin: pick next topic after lastTopic
  const lastIdx = topics.indexOf(state.lastTopic);
  const nextIdx = (lastIdx + 1) % topics.length;
  const topicName = topics[nextIdx];
  const topicPath = path.join(topicsDir, `${topicName}.md`);

  slog('PRUNER', `Analyzing topic: ${topicName}`);

  const proposal = await pruneTopicFile(topicPath, topicName);

  if (proposal) {
    const filepath = savePruningProposal(memoryDir, topicName, proposal);
    state.proposalsPending++;
    slog('PRUNER', `Proposal saved: ${filepath} (${proposal.deletions.length} deletions)`);
  } else {
    slog('PRUNER', `No pruning needed for ${topicName}`);
  }

  state.lastRun = today;
  state.lastTopic = topicName;
  writeState(STATE_FILE, state);
}
```

### Step 4: Run test

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run src/__tests__/context-pruner.test.ts`
Expected: PASS

### Step 5: Integrate into loop.ts

Find the feedback loops call in `loop.ts` (where `runFeedbackLoops()` is called after each cycle). Add daily pruning trigger:

```typescript
// After runFeedbackLoops() call, add:
// Daily pruning (fire-and-forget)
import { runDailyPruning } from './context-pruner.js';
runDailyPruning(this.memory.memoryDir).catch(() => {});
```

### Step 6: Run full tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 7: Commit

```bash
git add src/context-pruner.ts src/loop.ts src/__tests__/context-pruner.test.ts
git commit -m "feat: Haiku-driven daily topic pruning

Phase 2.1: daily job sends one topic file to Haiku for analysis.
Proposals saved as markdown diff in memory/pruning-proposals/ for
Kuro review. Round-robin across topics, fire-and-forget."
```

---

## Task 5: MEMORY.md Cold Storage Migration

**What:** Entries in MEMORY.md that haven't been cited in 30+ days are automatically moved to `memory/cold-storage.md`. The `(N more entries available via search)` hint already exists — cold entries remain searchable via FTS5.

**Why:** MEMORY.md accumulates entries that were useful once but are no longer actively relevant.

**Files:**
- Modify: `src/context-optimizer.ts` (add cold migration logic)
- Modify: `src/memory.ts` (integrate migration trigger)
- Test: `src/__tests__/cold-storage.test.ts`

### Step 1: Write the failing test

```typescript
// src/__tests__/cold-storage.test.ts
import { describe, it, expect } from 'vitest';
import { identifyColdEntries, migrateToColdStorage } from '../context-optimizer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('cold storage migration', () => {
  const tmpDir = path.join(os.tmpdir(), `cold-test-${Date.now()}`);

  it('identifies entries older than 30 days not in alwaysFull sections', () => {
    const today = new Date();
    const old = new Date(today.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(today.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);

    const content = `# Long-term Memory

## User Preferences
- [${old}] User prefers TypeScript

## Learned Patterns
- [${old}] Old pattern that is outdated
- [${recent}] Recent pattern still useful

## Important Decisions
- [${old}] Important decision (should stay)`;

    const cold = identifyColdEntries(content, 30);
    expect(cold).toHaveLength(1);
    expect(cold[0]).toContain('Old pattern');
  });

  it('migrates cold entries to cold-storage.md and removes from source', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const today = new Date();
    const old = new Date(today.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(today.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);

    const memoryPath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memoryPath, `# Long-term Memory

## Learned Patterns
- [${old}] Old fact to migrate
- [${recent}] Recent fact to keep

## TODO / Future Improvements
- [${old}] Old todo item
`);

    const result = migrateToColdStorage(tmpDir, 30);
    expect(result.migrated).toBe(2);

    // Check MEMORY.md no longer has old entries
    const updated = fs.readFileSync(memoryPath, 'utf-8');
    expect(updated).not.toContain('Old fact to migrate');
    expect(updated).toContain('Recent fact to keep');

    // Check cold-storage.md has them
    const coldPath = path.join(tmpDir, 'cold-storage.md');
    expect(fs.existsSync(coldPath)).toBe(true);
    const cold = fs.readFileSync(coldPath, 'utf-8');
    expect(cold).toContain('Old fact to migrate');
    expect(cold).toContain('Old todo item');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/mini-agent && npx vitest run src/__tests__/cold-storage.test.ts`
Expected: FAIL — functions not exported

### Step 3: Implement cold storage functions

Add to `src/context-optimizer.ts`:

```typescript
/**
 * Identify MEMORY.md entries older than threshold in non-protected sections.
 */
export function identifyColdEntries(content: string, maxAgeDays: number): string[] {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const protectedSections = ['User Preferences', 'Important Facts', 'Important Decisions'];

  const lines = content.split('\n');
  const cold: string[] = [];
  let inProtected = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      inProtected = protectedSections.some(s => sectionMatch[1].includes(s));
      continue;
    }
    if (inProtected) continue;

    const dateMatch = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]/);
    if (dateMatch) {
      const entryDate = new Date(dateMatch[1]).getTime();
      if (entryDate < cutoff) {
        cold.push(line);
      }
    }
  }

  return cold;
}

/**
 * Move cold entries from MEMORY.md to cold-storage.md.
 * Returns count of migrated entries.
 */
export function migrateToColdStorage(
  memoryDir: string,
  maxAgeDays = 30,
): { migrated: number } {
  const memoryPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) return { migrated: 0 };

  const content = fs.readFileSync(memoryPath, 'utf-8');
  const coldEntries = identifyColdEntries(content, maxAgeDays);

  if (coldEntries.length === 0) return { migrated: 0 };

  // Remove cold entries from MEMORY.md
  const coldSet = new Set(coldEntries);
  const updatedLines = content.split('\n').filter(line => !coldSet.has(line));
  fs.writeFileSync(memoryPath, updatedLines.join('\n'));

  // Append to cold-storage.md
  const coldPath = path.join(memoryDir, 'cold-storage.md');
  const date = new Date().toISOString().slice(0, 10);
  const header = fs.existsSync(coldPath) ? '' : '# Cold Storage\n\nEntries migrated from MEMORY.md (still searchable via FTS5).\n\n';
  const section = `\n## Migrated ${date}\n${coldEntries.join('\n')}\n`;
  fs.appendFileSync(coldPath, header + section);

  return { migrated: coldEntries.length };
}
```

(Note: add `import fs from 'node:fs';` and `import path from 'node:path';` to context-optimizer.ts imports)

### Step 4: Run test

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run src/__tests__/cold-storage.test.ts`
Expected: PASS

### Step 5: Add weekly migration trigger

In `src/context-pruner.ts`, at the end of `runDailyPruning()`:

```typescript
// Weekly cold storage migration (every Sunday)
if (new Date().getDay() === 0) {
  try {
    const { migrateToColdStorage } = await import('./context-optimizer.js');
    const result = migrateToColdStorage(memoryDir, 30);
    if (result.migrated > 0) {
      slog('PRUNER', `Cold storage: migrated ${result.migrated} entries`);
    }
  } catch { /* ignore */ }
}
```

### Step 6: Ensure cold-storage.md is indexed by FTS5

In `src/search.ts:indexMemoryFiles()`, add after the MEMORY.md parsing (after line 155):

```typescript
// Parse cold-storage.md (migrated entries should remain searchable)
const coldStorage = path.join(memoryDir, 'cold-storage.md');
if (fs.existsSync(coldStorage)) {
  allEntries.push(...parseMemoryMd(coldStorage));
}
```

### Step 7: Run full tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 8: Commit

```bash
git add src/context-optimizer.ts src/context-pruner.ts src/search.ts src/__tests__/cold-storage.test.ts
git commit -m "feat: MEMORY.md cold storage migration

Phase 2.2: entries >30 days old in non-protected sections auto-migrate
to cold-storage.md weekly. Cold entries remain FTS5-searchable.
Reversible: entries can be manually moved back."
```

---

## Task 6: Context Telemetry Dashboard Section

**What:** Add a `<context-health>` section to buildContext (conditional, keyword: 'context', 'optimize') that shows current optimization state: demoted sections, cold entries count, trail dedup stats, MEMORY.md smart-load hit rate.

**Why:** Kuro needs visibility into how the optimization loop is performing to make informed decisions.

**Files:**
- Modify: `src/context-optimizer.ts` (add formatHealthSection)
- Modify: `src/memory.ts` (add conditional section to buildContext)
- Test: `src/__tests__/context-optimizer.test.ts` (extend)

### Step 1: Add formatHealthSection to context-optimizer.ts

```typescript
/** Format context health for injection into buildContext */
export function formatContextHealth(): string | null {
  try {
    const opt = getContextOptimizer();
    const state = opt.getState();

    const demoted = opt.getDemotedSections();
    const observing = Object.entries(state.observation)
      .map(([name, obs]) => `${name}(${obs.remainingCycles} cycles left)`);

    const lines = [
      `Cycles tracked: ${state.totalCycles}`,
      `Demoted sections: ${demoted.length > 0 ? demoted.join(', ') : 'none'}`,
      `In observation: ${observing.length > 0 ? observing.join(', ') : 'none'}`,
    ];

    return lines.join('\n');
  } catch {
    return null;
  }
}
```

### Step 2: Add conditional section in buildContext

In `src/memory.ts`, add after the `config` conditional section (after line 1672):

```typescript
// Context health — when asking about context optimization
if (shouldLoad('context-health', ['context', 'optimize', 'budget', 'demotion', 'pruning'])) {
  try {
    const { formatContextHealth } = await import('./context-optimizer.js');
    const healthCtx = formatContextHealth();
    if (healthCtx) sections.push(`<context-health>\n${healthCtx}\n</context-health>`);
  } catch { /* ignore */ }
}
```

### Step 3: Run tests

Run: `cd /Users/user/Workspace/mini-agent && npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 4: Commit

```bash
git add src/context-optimizer.ts src/memory.ts
git commit -m "feat: context health telemetry section

Adds <context-health> section (conditional: context/optimize keywords)
showing demotion state, observation periods, and cycle count."
```

---

## Summary

| Task | Phase | Est. Savings | Complexity |
|------|-------|-------------|------------|
| 1. MEMORY.md Smart Loading | 1.1 | ~5000 chars/cycle | Medium |
| 2. Trail Deduplication | 1.2 | ~1000-2000 chars/cycle | Low |
| 3. Citation-Driven Auto-Demotion | 1.3 | Variable | Medium |
| 4. Haiku Daily Pruning | 2.1 | Gradual reduction | Medium |
| 5. Cold Storage Migration | 2.2 | ~2000 chars after 30d | Low |
| 6. Context Health Telemetry | Meta | Visibility | Low |

**Total estimated savings:** ~6000-8000 chars/cycle immediately (Phase 1), with gradual compounding from Phase 2.

**Reversibility:**
- Task 1-3: Feature flag or git revert
- Task 4: Proposals need Kuro review (safe by design)
- Task 5: Manual move back from cold-storage.md
- Task 6: Conditional section, zero cost when not loaded

**Dependencies:** Tasks 1-3 are independent. Task 5 depends on Task 3 (optimizer module). Task 6 depends on Task 3. Task 4 is independent.

**Recommended execution order:** 1 → 2 → 3 → 5 → 6 → 4 (Haiku integration last, needs most testing)
