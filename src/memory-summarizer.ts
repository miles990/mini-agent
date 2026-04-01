/**
 * Memory Summarizer — Hierarchical Topic Summarization
 *
 * The "C" layer of A+B+C enrichment: compressed topic overviews + cross-topic
 * relationship discovery. Runs as part of housekeeping cycles.
 *
 * - buildTopicManifest: pure file scan, no LLM
 * - summarizeTopic: Haiku-powered 2-3 sentence summary
 * - generateCrossTopicMap: Haiku-powered relationship discovery
 * - runSummarizationCycle: main entry point, fire-and-forget safe
 */

import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { diagLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface TopicManifestEntry {
  topic: string;
  entryCount: number;
  preview: string;
  lastDate: string;
  charCount: number;
}

// =============================================================================
// Constants
// =============================================================================

const SUMMARIES_DIR = '.summaries';
const SUMMARY_STALE_DAYS = 7;
const MAX_TOPICS_PER_CYCLE = 3;
const MIN_ENTRIES_FOR_SUMMARY = 5;
const MIN_CHARS_FOR_SUMMARY = 100;
const CROSS_TOPIC_MAX_PAIRS = 10;
const CROSS_TOPIC_TIMEOUT = 20_000;
const SUMMARY_TIMEOUT = 15_000;
const HAIKU_TAIL_CHARS = 3000;
const MIN_ACTIVE_ENTRIES = 3;
const ACTIVE_DAYS = 30;

// =============================================================================
// buildTopicManifest — Pure file scan
// =============================================================================

/**
 * Scan memory/topics/*.md and return a manifest of all topics.
 * Sorted by lastDate descending (most recent first).
 * Pure file reading — no LLM calls.
 */
export function buildTopicManifest(memoryDir: string): TopicManifestEntry[] {
  const topicsDir = path.join(memoryDir, 'topics');
  if (!existsSync(topicsDir)) return [];

  const files = readdirSync(topicsDir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('.'),
  );

  const entries: TopicManifestEntry[] = [];

  for (const file of files) {
    const filePath = path.join(topicsDir, file);
    try {
      const fileStat = statSync(filePath);
      if (!fileStat.isFile()) continue;

      const content = readFileSync(filePath, 'utf-8');
      const topic = file.replace(/\.md$/, '');

      // Strip YAML frontmatter
      const body = stripFrontmatter(content);

      // Extract entries (bullet points)
      const bulletEntries = extractEntries(body);
      const entryCount = bulletEntries.length;

      // Extract dates from entries
      const dates = extractDates(body);
      const lastDate = dates.length > 0
        ? dates.sort().reverse()[0]
        : fileStat.mtime.toISOString().slice(0, 10);

      // Preview: last 2 entries, max 200 chars
      const preview = buildPreview(bulletEntries);

      entries.push({
        topic,
        entryCount,
        preview,
        lastDate,
        charCount: content.length,
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by lastDate descending
  entries.sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return entries;
}

// =============================================================================
// summarizeTopic — Haiku-powered summary
// =============================================================================

/**
 * Generate a 2-3 sentence summary for a topic file using Haiku.
 * Returns null on failure or if content is too short.
 */
export async function summarizeTopic(
  memoryDir: string,
  topic: string,
): Promise<string | null> {
  const filePath = path.join(memoryDir, 'topics', `${topic}.md`);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  if (content.length < MIN_CHARS_FOR_SUMMARY) return null;

  // Take last N chars to focus on recent content
  const tail = content.slice(-HAIKU_TAIL_CHARS);

  const prompt = `Summarize this topic file in 2-3 sentences. Focus on the key themes and most important insights. Be concise and specific.

Topic: ${topic}

Content:
${tail}

Reply with ONLY the 2-3 sentence summary, nothing else.`;

  try {
    const { sideQuery } = await import('./side-query.js');
    const result = await sideQuery(prompt, { timeout: SUMMARY_TIMEOUT });
    return result;
  } catch (err) {
    diagLog('memory-summarizer.summarizeTopic', err, { topic });
    return null;
  }
}

// =============================================================================
// generateCrossTopicMap — Relationship discovery
// =============================================================================

/**
 * Identify relationships between active topics using Haiku.
 * Active = >= 3 entries AND updated in last 30 days.
 * Returns relationship pairs or null on failure.
 */
export async function generateCrossTopicMap(
  memoryDir: string,
): Promise<string | null> {
  const manifest = buildTopicManifest(memoryDir);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVE_DAYS);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const activeTopics = manifest.filter(
    (t) => t.entryCount >= MIN_ACTIVE_ENTRIES && t.lastDate >= cutoffStr,
  );

  if (activeTopics.length < 2) return null;

  const topicList = activeTopics
    .map((t) => `- ${t.topic} (${t.entryCount} entries): ${t.preview}`)
    .join('\n');

  const prompt = `Given these active knowledge topics, identify meaningful relationships between them. Focus on conceptual connections, shared themes, or complementary perspectives.

Topics:
${topicList}

Output ONLY relationship pairs in this exact format (max ${CROSS_TOPIC_MAX_PAIRS} pairs):
topic-a ↔ topic-b: brief description of relationship

No other text.`;

  try {
    const { sideQuery } = await import('./side-query.js');
    const result = await sideQuery(prompt, {
      timeout: CROSS_TOPIC_TIMEOUT,
      maxTokens: 512,
    });
    return result;
  } catch (err) {
    diagLog('memory-summarizer.generateCrossTopicMap', err);
    return null;
  }
}

// =============================================================================
// runSummarizationCycle — Main entry point
// =============================================================================

/**
 * Run one summarization cycle. Fire-and-forget safe.
 *
 * - Only summarizes topics with > 5 entries, not summarized in 7 days
 * - Max 3 topics per cycle
 * - Updates cross-topic map if > 7 days old
 * - Writes to memory/topics/.summaries/
 */
export async function runSummarizationCycle(memoryDir: string): Promise<void> {
  try {
    const topicsDir = path.join(memoryDir, 'topics');
    const summariesDir = path.join(topicsDir, SUMMARIES_DIR);

    // Ensure .summaries/ dir exists
    if (!existsSync(summariesDir)) {
      await mkdir(summariesDir, { recursive: true });
    }

    const manifest = buildTopicManifest(memoryDir);
    let summarized = 0;

    for (const entry of manifest) {
      if (summarized >= MAX_TOPICS_PER_CYCLE) break;
      if (entry.entryCount <= MIN_ENTRIES_FOR_SUMMARY) continue;

      // Check if summary is stale
      const summaryPath = path.join(summariesDir, `${entry.topic}.md`);
      if (existsSync(summaryPath)) {
        try {
          const summaryStatResult = await stat(summaryPath);
          const ageMs = Date.now() - summaryStatResult.mtimeMs;
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays < SUMMARY_STALE_DAYS) continue;
        } catch {
          // If stat fails, re-summarize
        }
      }

      const summary = await summarizeTopic(memoryDir, entry.topic);
      if (summary) {
        const header = `<!-- Auto-generated summary — ${new Date().toISOString().slice(0, 10)} -->\n`;
        await writeFile(summaryPath, `${header}# ${entry.topic}\n\n${summary}\n`, 'utf-8');
        summarized++;

        eventBus.emit('log:info', {
          tag: 'memory-summarizer',
          msg: `summarized topic=${entry.topic} entries=${entry.entryCount}`,
        });
      }
    }

    // Update cross-topic map if stale
    const crossTopicPath = path.join(summariesDir, '_cross-topic-map.md');
    let shouldUpdateMap = true;
    if (existsSync(crossTopicPath)) {
      try {
        const mapStatResult = await stat(crossTopicPath);
        const ageMs = Date.now() - mapStatResult.mtimeMs;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays < SUMMARY_STALE_DAYS) shouldUpdateMap = false;
      } catch {
        // If stat fails, regenerate
      }
    }

    if (shouldUpdateMap) {
      const crossMap = await generateCrossTopicMap(memoryDir);
      if (crossMap) {
        const header = `<!-- Auto-generated cross-topic map — ${new Date().toISOString().slice(0, 10)} -->\n`;
        await writeFile(crossTopicPath, `${header}# Cross-Topic Relationships\n\n${crossMap}\n`, 'utf-8');

        eventBus.emit('log:info', {
          tag: 'memory-summarizer',
          msg: 'updated cross-topic map',
        });
      }
    }

    if (summarized > 0) {
      eventBus.emit('log:info', {
        tag: 'memory-summarizer',
        msg: `cycle complete: summarized=${summarized}`,
      });
    }
  } catch (err) {
    diagLog('memory-summarizer.runSummarizationCycle', err);
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Strip YAML frontmatter (---...---) from content */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 3).trimStart();
}

/** Extract bullet entries from topic body */
function extractEntries(body: string): string[] {
  const lines = body.split('\n');
  const entries: string[] = [];
  let currentEntry = '';

  for (const line of lines) {
    if (line.match(/^- /)) {
      if (currentEntry) entries.push(currentEntry.trim());
      currentEntry = line;
    } else if (currentEntry && line.match(/^\s+/) && line.trim()) {
      // Continuation of current entry (indented)
      currentEntry += ' ' + line.trim();
    } else if (currentEntry && line.trim() === '') {
      // Blank line after entry
      entries.push(currentEntry.trim());
      currentEntry = '';
    }
  }
  if (currentEntry) entries.push(currentEntry.trim());

  return entries;
}

/** Extract YYYY-MM-DD dates from content */
function extractDates(body: string): string[] {
  const datePattern = /\[(\d{4}-\d{2}-\d{2})\]/g;
  const dates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = datePattern.exec(body)) !== null) {
    dates.push(match[1]);
  }
  return dates;
}

/** Build preview from last 2 entries, max 200 chars */
function buildPreview(entries: string[]): string {
  if (entries.length === 0) return '';

  const last2 = entries.slice(-2);
  const combined = last2.join(' | ');

  if (combined.length <= 200) return combined;
  return combined.slice(0, 197) + '...';
}
