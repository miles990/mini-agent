/**
 * Skill System v2 — On-Demand Loading with YAML Frontmatter
 *
 * Inspired by Claude Code's Skill system:
 * - Skills have YAML frontmatter (name, description, triggers, allowed-tools)
 * - On-demand loading: only load skills that match current context
 * - Scope-limited: skills declare which tools they can use
 * - Trigger-based: skills declare when they should activate
 *
 * Upgrade from v1 (perception.ts):
 * - v1: JIT Keywords/Modes inline metadata → load all, filter by mode
 * - v2: YAML frontmatter → index on startup, load on demand
 *
 * v1 still works — v2 wraps and extends it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import type { LoadedSkill } from './perception.js';

// =============================================================================
// Types
// =============================================================================

/** YAML frontmatter for skill files */
export interface SkillFrontmatter {
  name: string;
  description: string;
  /** When this skill should activate — pattern strings matched against context */
  triggers?: string[];
  /** Allowed tools (tool names from tool-registry) */
  allowedTools?: string[];
  /** Cycle modes this skill applies to */
  modes?: string[];
  /** Keywords for semantic matching */
  keywords?: string[];
  /** Token cost estimate */
  tokenCost?: number;
  /** Priority (lower = loaded first when multiple match) */
  priority?: number;
  /** Whether this skill is rigid (follow exactly) or flexible (adapt) */
  type?: 'rigid' | 'flexible';
  /** Maximum output cap in chars */
  outputCap?: number;
}

/** Indexed skill — frontmatter + path, content loaded on demand */
export interface SkillIndex {
  name: string;
  description: string;
  frontmatter: SkillFrontmatter;
  filePath: string;
  mtime: number;
  /** Estimated chars (from file size) */
  estimatedChars: number;
}

/** Fully loaded skill — index + content */
export interface SkillLoaded extends SkillIndex {
  content: string;
}

// =============================================================================
// Frontmatter Parser
// =============================================================================

/**
 * Parse YAML frontmatter from markdown content.
 * Format:
 * ```
 * ---
 * name: my-skill
 * description: Does things
 * triggers: [pattern1, pattern2]
 * ...
 * ---
 *
 * # Skill Content
 * ...
 * ```
 */
export function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; content: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!fmMatch) {
    // No frontmatter — fall back to v1 JIT metadata parsing
    return parseLegacyMetadata(raw);
  }

  const yamlBlock = fmMatch[1];
  const content = fmMatch[2].trim();

  // Simple YAML parser (no dependency needed for our subset)
  const frontmatter: SkillFrontmatter = {
    name: '',
    description: '',
  };

  for (const line of yamlBlock.split('\n')) {
    const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const trimmed = value.trim();

    switch (key) {
      case 'name':
        frontmatter.name = unquote(trimmed);
        break;
      case 'description':
        frontmatter.description = unquote(trimmed);
        break;
      case 'triggers':
        frontmatter.triggers = parseYamlArray(trimmed);
        break;
      case 'allowed-tools':
      case 'allowedTools':
        frontmatter.allowedTools = parseYamlArray(trimmed);
        break;
      case 'modes':
        frontmatter.modes = parseYamlArray(trimmed);
        break;
      case 'keywords':
        frontmatter.keywords = parseYamlArray(trimmed);
        break;
      case 'tokenCost':
      case 'token-cost':
        frontmatter.tokenCost = parseInt(trimmed, 10) || undefined;
        break;
      case 'priority':
        frontmatter.priority = parseInt(trimmed, 10) || undefined;
        break;
      case 'type':
        frontmatter.type = trimmed as 'rigid' | 'flexible';
        break;
      case 'outputCap':
      case 'output-cap':
        frontmatter.outputCap = parseInt(trimmed, 10) || undefined;
        break;
    }
  }

  return { frontmatter, content };
}

// =============================================================================
// Skill Index Manager
// =============================================================================

class SkillIndexManager {
  private index = new Map<string, SkillIndex>();
  private contentCache = new Map<string, { content: string; mtime: number }>();

  /** Scan directories and build index (fast — only reads frontmatter) */
  buildIndex(skillPaths: string[], cwd?: string): void {
    const resolvedPaths = resolveAllPaths(skillPaths, cwd);
    const newIndex = new Map<string, SkillIndex>();

    for (const filePath of resolvedPaths) {
      const entry = indexSingleSkill(filePath);
      if (entry) {
        newIndex.set(entry.name, entry);
      }
    }

    this.index = newIndex;
    slog('SKILL-V2', `Indexed ${this.index.size} skills`);
  }

  /** Get skill index entries matching context */
  match(context: SkillMatchContext): SkillIndex[] {
    const matches: Array<SkillIndex & { score: number }> = [];

    for (const skill of this.index.values()) {
      const score = computeMatchScore(skill, context);
      if (score > 0) {
        matches.push({ ...skill, score });
      }
    }

    // Sort by score (desc) then priority (asc)
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.frontmatter.priority ?? 50) - (b.frontmatter.priority ?? 50);
    });

    return matches;
  }

  /** Load a skill's content (on demand, cached) */
  loadContent(name: string): SkillLoaded | null {
    const entry = this.index.get(name);
    if (!entry) return null;

    // Check cache
    const cached = this.contentCache.get(name);
    if (cached && cached.mtime === entry.mtime) {
      return { ...entry, content: cached.content };
    }

    // Read file
    try {
      const raw = fs.readFileSync(entry.filePath, 'utf-8');
      const { content } = parseFrontmatter(raw);

      // Apply output cap
      const cap = entry.frontmatter.outputCap ?? 8000;
      const capped = content.length > cap
        ? content.slice(0, cap) + '\n[... skill truncated]'
        : content;

      this.contentCache.set(name, { content: capped, mtime: entry.mtime });
      return { ...entry, content: capped };
    } catch {
      return null;
    }
  }

  /** Load multiple skills for context injection */
  loadMatched(context: SkillMatchContext, opts?: { maxSkills?: number; maxChars?: number }): SkillLoaded[] {
    const maxSkills = opts?.maxSkills ?? 5;
    const maxChars = opts?.maxChars ?? 20000;

    const matched = this.match(context).slice(0, maxSkills);
    const loaded: SkillLoaded[] = [];
    let totalChars = 0;

    for (const entry of matched) {
      const skill = this.loadContent(entry.name);
      if (!skill) continue;

      if (totalChars + skill.content.length > maxChars) {
        // Budget exhausted
        break;
      }

      loaded.push(skill);
      totalChars += skill.content.length;
    }

    return loaded;
  }

  /** Hot-reload: check for changes and re-index if needed */
  refreshIndex(skillPaths: string[], cwd?: string): boolean {
    const resolvedPaths = resolveAllPaths(skillPaths, cwd);
    let changed = false;

    for (const filePath of resolvedPaths) {
      try {
        const stat = fs.statSync(filePath);
        const name = path.basename(filePath, path.extname(filePath));
        const existing = this.index.get(name);

        if (!existing || existing.mtime !== stat.mtimeMs) {
          const entry = indexSingleSkill(filePath);
          if (entry) {
            this.index.set(entry.name, entry);
            this.contentCache.delete(entry.name); // Invalidate cache
            changed = true;
          }
        }
      } catch {
        // File might have been deleted
      }
    }

    // Check for removed files
    for (const [name, entry] of this.index) {
      if (!fs.existsSync(entry.filePath)) {
        this.index.delete(name);
        this.contentCache.delete(name);
        changed = true;
      }
    }

    return changed;
  }

  /** Get all indexed skill names */
  listNames(): string[] {
    return [...this.index.keys()];
  }

  /** Get a specific skill index */
  getIndex(name: string): SkillIndex | undefined {
    return this.index.get(name);
  }

  /** Bridge: convert v2 loaded skills to v1 format for backward compat */
  toV1Format(loaded: SkillLoaded[]): LoadedSkill[] {
    return loaded.map(s => ({
      name: s.name,
      content: s.content,
      keywords: s.frontmatter.keywords ?? [],
      modes: s.frontmatter.modes ?? [],
      filePath: s.filePath,
      mtime: s.mtime,
    }));
  }

  get size(): number {
    return this.index.size;
  }
}

// Singleton
export const skillIndex = new SkillIndexManager();

// =============================================================================
// Matching
// =============================================================================

export interface SkillMatchContext {
  /** Current cycle mode */
  mode?: string;
  /** Current task/trigger keywords */
  keywords?: string[];
  /** Explicit skill name request */
  skillName?: string;
  /** Active tool names */
  activeTools?: string[];
  /** Current perception data summary */
  perceptionSummary?: string;
}

function computeMatchScore(skill: SkillIndex, context: SkillMatchContext): number {
  let score = 0;
  const fm = skill.frontmatter;

  // Explicit name match — always include
  if (context.skillName && skill.name === context.skillName) return 100;

  // Mode match
  if (context.mode && fm.modes?.length) {
    if (fm.modes.includes(context.mode)) score += 30;
    else return 0; // Mode mismatch = exclude
  }

  // Keyword overlap
  if (context.keywords?.length && fm.keywords?.length) {
    const overlap = context.keywords.filter(k =>
      fm.keywords!.some(fk => fk.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(fk.toLowerCase()))
    );
    score += overlap.length * 10;
  }

  // Trigger pattern match
  if (fm.triggers?.length && context.perceptionSummary) {
    for (const trigger of fm.triggers) {
      try {
        if (new RegExp(trigger, 'i').test(context.perceptionSummary)) {
          score += 20;
          break;
        }
      } catch {
        if (context.perceptionSummary.toLowerCase().includes(trigger.toLowerCase())) {
          score += 20;
          break;
        }
      }
    }
  }

  // If no mode filter and no keywords matched, give base score
  // so skills without metadata still get included when nothing else matches
  if (score === 0 && !fm.modes?.length && !fm.keywords?.length) {
    score = 1;
  }

  return score;
}

// =============================================================================
// Helpers
// =============================================================================

function indexSingleSkill(filePath: string): SkillIndex | null {
  try {
    const stat = fs.statSync(filePath);
    // Read only first 1KB for frontmatter (fast indexing)
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);

    const header = buf.toString('utf-8', 0, bytesRead);
    const { frontmatter } = parseFrontmatter(header);

    // Use filename as fallback name
    if (!frontmatter.name) {
      frontmatter.name = path.basename(filePath, path.extname(filePath));
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description || `Skill: ${frontmatter.name}`,
      frontmatter,
      filePath,
      mtime: stat.mtimeMs,
      estimatedChars: stat.size,
    };
  } catch {
    return null;
  }
}

function resolveAllPaths(paths: string[], cwd?: string): string[] {
  const result: string[] = [];
  const base = cwd ?? process.cwd();

  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(base, p);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(abs)
          .filter(f => f.endsWith('.md'))
          .map(f => path.join(abs, f));
        result.push(...files);
      } else {
        result.push(abs);
      }
    } catch {
      // Skip
    }
  }

  return [...new Set(result)];
}

function parseYamlArray(value: string): string[] {
  // [a, b, c] format
  const bracketMatch = value.match(/^\[(.*)\]$/);
  if (bracketMatch) {
    return bracketMatch[1].split(',').map(s => unquote(s.trim())).filter(Boolean);
  }
  // Single value
  return [unquote(value)];
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse v1 JIT metadata from skill content (backward compat)
 */
function parseLegacyMetadata(raw: string): { frontmatter: SkillFrontmatter; content: string } {
  const lines = raw.split('\n');
  const keywords: string[] = [];
  const modes: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const kwMatch = line.match(/^JIT Keywords:\s*(.+)$/i);
    const modeMatch = line.match(/^JIT Modes:\s*(.+)$/i);

    if (kwMatch) {
      keywords.push(...kwMatch[1].split(',').map(k => k.trim().toLowerCase()).filter(Boolean));
    } else if (modeMatch) {
      modes.push(...modeMatch[1].split(',').map(m => m.trim().toLowerCase()).filter(Boolean));
    } else {
      contentLines.push(line);
    }
  }

  return {
    frontmatter: {
      name: '',
      description: '',
      keywords: keywords.length > 0 ? keywords : undefined,
      modes: modes.length > 0 ? modes : undefined,
    },
    content: contentLines.join('\n').trim(),
  };
}

/**
 * Format loaded skills for prompt injection.
 * More compact than v1 — includes skill metadata for model reference.
 */
export function formatSkillsForPrompt(skills: SkillLoaded[]): string {
  if (skills.length === 0) return '';

  const sections = skills.map(s => {
    const header = `### ${s.name}${s.frontmatter.type ? ` [${s.frontmatter.type}]` : ''}`;
    const desc = s.frontmatter.description ? `_${s.frontmatter.description}_\n` : '';
    return `${header}\n${desc}\n${s.content}`;
  });

  return `\n## Active Skills\n\n${sections.join('\n\n---\n\n')}\n`;
}
