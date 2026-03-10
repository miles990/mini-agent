/**
 * Memory Index — Multi-dimensional memory indexing system
 *
 * Phase 1: Index skeleton (manifest + concepts)
 * Phase 2: Query integration (buildContext replacement)
 *
 * Proposal: memory/proposals/2026-03-10-multi-dimensional-memory-index.md
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { diagLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface MemoryIndexEntry {
  id: string;                    // hash(source + location)
  source: string;                // 來源檔案路徑 (topics/mushi.md, MEMORY.md, etc.)
  location: string;              // 精確位置 (entry index within file)
  summary: string;               // 一句話摘要 (~80 chars)
  concepts: string[];            // 概念標籤 ["mushi", "triage", "system-1"]
  created: string;               // ISO date (from entry [date] prefix)
  lastAccessed: string;          // 上次被載入 context 的時間
  accessCount: number;           // 累計載入次數
  sourceType: 'alex-conversation' | 'self-learning' | 'self-reasoning' | 'external';
}

interface ConceptIndex {
  [concept: string]: string[];   // concept → entry_id[]
}

interface IndexStats {
  entryCount: number;
  conceptCount: number;
  topicCount: number;
  lastRebuilt: string;
  lastUpdated: string;
}

// =============================================================================
// Constants
// =============================================================================

const INDEX_DIR = 'index';
const MANIFEST_FILE = 'manifest.json';
const CONCEPTS_FILE = 'concepts.json';
const STATS_FILE = 'stats.json';

// =============================================================================
// In-memory cache (invalidated on write)
// =============================================================================

let _manifestCache: MemoryIndexEntry[] | null = null;
let _conceptsCache: ConceptIndex | null = null;
let _manifestMtime = 0;

function invalidateCache(): void {
  _manifestCache = null;
  _conceptsCache = null;
  _manifestMtime = 0;
}

// =============================================================================
// Path helpers
// =============================================================================

function indexDir(memoryDir: string): string {
  return path.join(memoryDir, INDEX_DIR);
}

function manifestPath(memoryDir: string): string {
  return path.join(indexDir(memoryDir), MANIFEST_FILE);
}

function conceptsPath(memoryDir: string): string {
  return path.join(indexDir(memoryDir), CONCEPTS_FILE);
}

function statsPath(memoryDir: string): string {
  return path.join(indexDir(memoryDir), STATS_FILE);
}

function ensureIndexDir(memoryDir: string): void {
  const dir = indexDir(memoryDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// =============================================================================
// Entry ID generation
// =============================================================================

function entryId(source: string, location: string): string {
  return crypto.createHash('sha256').update(`${source}:${location}`).digest('hex').slice(0, 12);
}

// =============================================================================
// Entry parsing — extract bullet entries from topic/memory files
// =============================================================================

const DATE_PREFIX = /^- \[(\d{4}-\d{2}-\d{2})\]\s*/;
const ALEX_MARKERS = /Alex\s*(說|指示|授權|核准|提出|回饋|糾正|要求|原話|明確)/i;

/**
 * Parse bullet entries from a topic or memory file.
 * Format: `- [YYYY-MM-DD] content`
 */
function parseEntries(content: string, source: string, knownTopics: string[]): MemoryIndexEntry[] {
  const lines = content.split('\n');
  const entries: MemoryIndexEntry[] = [];
  const topicName = path.basename(source, '.md');
  let entryIndex = 0;

  for (const line of lines) {
    const match = line.match(DATE_PREFIX);
    if (!match) continue;

    const dateStr = match[1];
    const rawContent = line.slice(match[0].length);
    // Handle duplicate date prefixes like `[2026-02-27] [2026-02-27] content`
    const cleaned = rawContent.replace(DATE_PREFIX, '');
    const text = cleaned || rawContent;

    if (text.length < 10) continue; // skip trivially short entries

    const summary = text.length > 80 ? text.slice(0, 77) + '...' : text;

    // Extract concepts
    const concepts = extractConcepts(text, topicName, knownTopics);

    // Detect source type
    const sourceType = detectSourceType(text);

    const location = `entry-${entryIndex}`;
    entries.push({
      id: entryId(source, location),
      source,
      location,
      summary,
      concepts,
      created: dateStr,
      lastAccessed: '',
      accessCount: 0,
      sourceType,
    });
    entryIndex++;
  }

  return entries;
}

/**
 * Extract concepts from entry text.
 * Simple approach: topic name + cross-references to other known topics.
 */
function extractConcepts(text: string, topicName: string, knownTopics: string[]): string[] {
  const concepts = new Set<string>();

  // Always include the topic name
  concepts.add(topicName);

  // Check for cross-references to other topics
  const lowerText = text.toLowerCase();
  for (const topic of knownTopics) {
    if (topic === topicName) continue;
    // Match topic name or its hyphenated-to-space variant
    const spacedTopic = topic.replace(/-/g, ' ');
    if (lowerText.includes(topic) || lowerText.includes(spacedTopic)) {
      concepts.add(topic);
    }
  }

  // Extract notable terms (specific high-value patterns)
  const termPatterns = [
    /\bmushi\b/i, /\btriage\b/i, /\bsystem[- ]1\b/i, /\bsystem[- ]2\b/i,
    /\bHC1\b/, /\bHaiku\b/i, /\bOulipo\b/i, /\bSDF\b/,
    /\bperception\b/i, /\bdelegation\b/i, /\bforge\b/i,
    /\btoken\b/i, /\bcontext\b/i, /\bDev\.to\b/i,
    /\bAlex\b/, /\bClaude\b/i, /\bFTS5\b/i,
    /\bwabi[- ]sabi\b/i, /\bumwelt\b/i, /\bconstraint\b/i,
    /\bgallery\b/i, /\bjournal\b/i, /\btsubuyaki\b/i,
  ];

  for (const pattern of termPatterns) {
    if (pattern.test(text)) {
      const matched = text.match(pattern);
      if (matched) {
        concepts.add(matched[0].toLowerCase().replace(/[- ]/g, '-'));
      }
    }
  }

  return [...concepts];
}

/**
 * Detect source type from entry text.
 */
function detectSourceType(text: string): MemoryIndexEntry['sourceType'] {
  if (ALEX_MARKERS.test(text)) return 'alex-conversation';
  if (/\bhttps?:\/\/\S+/.test(text)) return 'external';
  if (/自己|自主|我的判斷|推論|推理/.test(text)) return 'self-reasoning';
  return 'self-learning';
}

// =============================================================================
// Manifest I/O
// =============================================================================

async function readManifest(memoryDir: string): Promise<MemoryIndexEntry[]> {
  const mp = manifestPath(memoryDir);
  try {
    const stat = await fs.stat(mp);
    if (_manifestCache && stat.mtimeMs === _manifestMtime) {
      return _manifestCache;
    }
    const raw = await fs.readFile(mp, 'utf-8');
    _manifestCache = JSON.parse(raw) as MemoryIndexEntry[];
    _manifestMtime = stat.mtimeMs;
    return _manifestCache;
  } catch {
    return [];
  }
}

async function writeManifest(memoryDir: string, entries: MemoryIndexEntry[]): Promise<void> {
  ensureIndexDir(memoryDir);
  await fs.writeFile(manifestPath(memoryDir), JSON.stringify(entries, null, 2), 'utf-8');
  invalidateCache();
}

async function readConcepts(memoryDir: string): Promise<ConceptIndex> {
  if (_conceptsCache) return _conceptsCache;
  try {
    const raw = await fs.readFile(conceptsPath(memoryDir), 'utf-8');
    _conceptsCache = JSON.parse(raw) as ConceptIndex;
    return _conceptsCache;
  } catch {
    return {};
  }
}

async function writeConcepts(memoryDir: string, concepts: ConceptIndex): Promise<void> {
  ensureIndexDir(memoryDir);
  await fs.writeFile(conceptsPath(memoryDir), JSON.stringify(concepts, null, 2), 'utf-8');
  _conceptsCache = concepts;
}

async function writeStats(memoryDir: string, entries: MemoryIndexEntry[], concepts: ConceptIndex): Promise<void> {
  const topicSet = new Set(entries.map(e => path.basename(e.source, '.md')));
  const stats: IndexStats = {
    entryCount: entries.length,
    conceptCount: Object.keys(concepts).length,
    topicCount: topicSet.size,
    lastRebuilt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  await fs.writeFile(statsPath(memoryDir), JSON.stringify(stats, null, 2), 'utf-8');
}

// =============================================================================
// Build concepts inverted index from manifest
// =============================================================================

function buildConceptIndex(entries: MemoryIndexEntry[]): ConceptIndex {
  const index: ConceptIndex = {};
  for (const entry of entries) {
    for (const concept of entry.concepts) {
      if (!index[concept]) index[concept] = [];
      index[concept].push(entry.id);
    }
  }
  return index;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build the full memory index by scanning topics/*.md and MEMORY.md.
 * This is the cold-start / rebuild function.
 */
export async function buildMemoryIndex(memoryDir: string): Promise<{ entries: number; concepts: number }> {
  const topicsDir = path.join(memoryDir, 'topics');
  const knownTopics: string[] = [];

  // Collect known topic names
  try {
    const files = await fs.readdir(topicsDir);
    for (const f of files) {
      if (f.endsWith('.md')) knownTopics.push(f.replace(/\.md$/, ''));
    }
  } catch { /* no topics dir */ }

  const allEntries: MemoryIndexEntry[] = [];

  // Parse topic files
  for (const topic of knownTopics) {
    try {
      const filePath = path.join(topicsDir, `${topic}.md`);
      const content = await fs.readFile(filePath, 'utf-8');
      const entries = parseEntries(content, `topics/${topic}.md`, knownTopics);
      allEntries.push(...entries);
    } catch {
      diagLog('memory-index.buildIndex', new Error(`Failed to parse topic: ${topic}`));
    }
  }

  // Parse MEMORY.md (Learned Patterns section)
  try {
    const memoryPath = path.join(memoryDir, 'MEMORY.md');
    const content = await fs.readFile(memoryPath, 'utf-8');
    const entries = parseEntries(content, 'MEMORY.md', knownTopics);
    allEntries.push(...entries);
  } catch { /* no MEMORY.md */ }

  // Build inverted index
  const concepts = buildConceptIndex(allEntries);

  // Write files
  await writeManifest(memoryDir, allEntries);
  await writeConcepts(memoryDir, concepts);
  await writeStats(memoryDir, allEntries, concepts);

  return { entries: allEntries.length, concepts: Object.keys(concepts).length };
}

/**
 * Add a single entry to the index (incremental update on REMEMBER).
 */
export async function addIndexEntry(
  memoryDir: string,
  content: string,
  topic?: string,
  sourceType?: MemoryIndexEntry['sourceType'],
): Promise<void> {
  const topicsDir = path.join(memoryDir, 'topics');
  let knownTopics: string[] = [];
  try {
    const files = await fs.readdir(topicsDir);
    knownTopics = files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  } catch { /* no topics dir */ }

  const source = topic ? `topics/${topic}.md` : 'MEMORY.md';
  const topicName = topic ?? 'memory';
  const concepts = extractConcepts(content, topicName, knownTopics);
  const summary = content.length > 80 ? content.slice(0, 77) + '...' : content;
  const dateStr = new Date().toISOString().split('T')[0];

  // Read existing manifest
  const manifest = await readManifest(memoryDir);
  const location = `entry-${manifest.filter(e => e.source === source).length}`;

  const entry: MemoryIndexEntry = {
    id: entryId(source, location),
    source,
    location,
    summary,
    concepts,
    created: dateStr,
    lastAccessed: '',
    accessCount: 0,
    sourceType: sourceType ?? detectSourceType(content),
  };

  manifest.push(entry);

  // Update concepts index
  const conceptIndex = await readConcepts(memoryDir);
  for (const concept of concepts) {
    if (!conceptIndex[concept]) conceptIndex[concept] = [];
    conceptIndex[concept].push(entry.id);
  }

  await writeManifest(memoryDir, manifest);
  await writeConcepts(memoryDir, conceptIndex);
}

/**
 * Query the index for entries matching a text query.
 * Returns entry IDs sorted by relevance (concept overlap count).
 */
export async function queryIndex(
  memoryDir: string,
  query: string,
  limit = 20,
): Promise<MemoryIndexEntry[]> {
  const manifest = await readManifest(memoryDir);
  if (manifest.length === 0) return [];

  const concepts = await readConcepts(memoryDir);
  const lowerQuery = query.toLowerCase();

  // Find matching concepts
  const matchedConcepts = new Set<string>();
  for (const concept of Object.keys(concepts)) {
    const spacedConcept = concept.replace(/-/g, ' ');
    if (lowerQuery.includes(concept) || lowerQuery.includes(spacedConcept)) {
      matchedConcepts.add(concept);
    }
  }

  if (matchedConcepts.size === 0) return [];

  // Score entries by concept overlap
  const scored = new Map<string, number>();
  for (const concept of matchedConcepts) {
    for (const id of concepts[concept] ?? []) {
      scored.set(id, (scored.get(id) ?? 0) + 1);
    }
  }

  // Lookup entries and sort by score
  const idMap = new Map(manifest.map(e => [e.id, e]));
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => idMap.get(id))
    .filter((e): e is MemoryIndexEntry => e !== undefined);
}

/**
 * Get relevant topic names for a query using the concept index.
 * Returns topic names sorted by relevance (number of matching entries).
 */
export async function getRelevantTopics(
  memoryDir: string,
  query: string,
): Promise<Array<{ topic: string; matchCount: number }>> {
  const entries = await queryIndex(memoryDir, query, 100);

  // Count entries per topic
  const topicCounts = new Map<string, number>();
  for (const entry of entries) {
    const topic = path.basename(entry.source, '.md');
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  return [...topicCounts.entries()]
    .map(([topic, matchCount]) => ({ topic, matchCount }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

/**
 * Generate a compact manifest summary for context injection.
 * Format: overview of knowledge domains + entry counts.
 */
export async function getManifestContext(memoryDir: string, budget = 2000): Promise<string> {
  const manifest = await readManifest(memoryDir);
  if (manifest.length === 0) return '';

  // Group entries by source topic
  const topicGroups = new Map<string, { count: number; latest: string; concepts: Set<string> }>();
  for (const entry of manifest) {
    const topic = path.basename(entry.source, '.md');
    const group = topicGroups.get(topic) ?? { count: 0, latest: '', concepts: new Set() };
    group.count++;
    if (entry.created > group.latest) group.latest = entry.created;
    for (const c of entry.concepts) {
      if (c !== topic) group.concepts.add(c); // exclude self-reference
    }
    topicGroups.set(topic, group);
  }

  // Sort by entry count descending
  const sorted = [...topicGroups.entries()].sort((a, b) => b[1].count - a[1].count);

  const lines: string[] = [];
  lines.push(`${manifest.length} entries across ${topicGroups.size} topics`);
  let charsUsed = lines[0].length;

  for (const [topic, data] of sorted) {
    const topConcepts = [...data.concepts].slice(0, 5).join(', ');
    const line = `- ${topic}(${data.count}) ${data.latest}${topConcepts ? ' — ' + topConcepts : ''}`;
    if (charsUsed + line.length + 1 > budget) {
      lines.push(`... and ${sorted.length - lines.length + 1} more topics`);
      break;
    }
    lines.push(line);
    charsUsed += line.length + 1;
  }

  return lines.join('\n');
}

/**
 * Mark entries as accessed (updates lastAccessed + accessCount).
 * Fire-and-forget, non-blocking.
 */
export async function markAccessed(memoryDir: string, entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const manifest = await readManifest(memoryDir);
  const now = new Date().toISOString();
  const idSet = new Set(entryIds);
  let changed = false;

  for (const entry of manifest) {
    if (idSet.has(entry.id)) {
      entry.lastAccessed = now;
      entry.accessCount++;
      changed = true;
    }
  }

  if (changed) {
    await writeManifest(memoryDir, manifest);
  }
}

/**
 * Check if index exists and is non-empty.
 */
export function isIndexBuilt(memoryDir: string): boolean {
  return existsSync(manifestPath(memoryDir));
}

/**
 * Get index stats.
 */
export async function getIndexStats(memoryDir: string): Promise<IndexStats | null> {
  try {
    const raw = await fs.readFile(statsPath(memoryDir), 'utf-8');
    return JSON.parse(raw) as IndexStats;
  } catch {
    return null;
  }
}
