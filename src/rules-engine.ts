/**
 * Rules Engine — Path-Based Contextual Rules
 *
 * Inspired by Claude Code's rules/ directory:
 * - Markdown files with YAML frontmatter specifying `paths` glob pattern
 * - Rules auto-loaded when working with matching files
 * - Injected into agent context as behavioral constraints
 *
 * Example rule file (rules/code-quality.md):
 * ```
 * ---
 * paths: src/**\/*.{ts,tsx}
 * priority: 10
 * ---
 * # Code Quality Standards
 * - Keep functions small and focused
 * - Handle errors explicitly
 * ```
 *
 * Key difference from CC: Our rules also match on event types
 * and perception data, not just file paths. An autonomous agent
 * needs rules that apply to behavioral patterns, not just code editing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export interface RuleFrontmatter {
  /** Glob patterns for file path matching */
  paths?: string[];
  /** Event types this rule applies to */
  events?: string[];
  /** Keywords that trigger this rule (matched against context) */
  triggers?: string[];
  /** Priority (lower = higher priority, loaded first) */
  priority?: number;
  /** Whether this rule is mandatory or advisory */
  severity?: 'mandatory' | 'advisory';
  /** Enabled flag */
  enabled?: boolean;
}

export interface Rule {
  name: string;
  frontmatter: RuleFrontmatter;
  content: string;
  filePath: string;
  mtime: number;
}

export interface RuleMatch {
  rule: Rule;
  matchType: 'path' | 'event' | 'trigger' | 'always';
  matchDetail: string;
}

// =============================================================================
// Rules Manager
// =============================================================================

class RulesEngine {
  private rules: Rule[] = [];
  private lastScanMs = 0;
  private rulesDirs: string[] = [];

  /** Scan directories for rule files */
  loadRules(dirs: string[]): void {
    this.rulesDirs = dirs;
    this.rules = [];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(dir, f));

      for (const filePath of files) {
        const rule = parseRuleFile(filePath);
        if (rule && rule.frontmatter.enabled !== false) {
          this.rules.push(rule);
        }
      }
    }

    // Sort by priority
    this.rules.sort((a, b) => (a.frontmatter.priority ?? 50) - (b.frontmatter.priority ?? 50));
    this.lastScanMs = Date.now();

    if (this.rules.length > 0) {
      slog('RULES', `Loaded ${this.rules.length} rules from ${dirs.length} directories`);
    }
  }

  /** Match rules against context */
  match(context: RuleMatchContext): RuleMatch[] {
    const matches: RuleMatch[] = [];

    for (const rule of this.rules) {
      const fm = rule.frontmatter;

      // Path matching
      if (fm.paths?.length && context.filePaths?.length) {
        for (const pattern of fm.paths) {
          for (const filePath of context.filePaths) {
            if (matchGlob(pattern, filePath)) {
              matches.push({ rule, matchType: 'path', matchDetail: `${pattern} ← ${filePath}` });
              break;
            }
          }
        }
      }

      // Event matching
      if (fm.events?.length && context.eventType) {
        if (fm.events.includes(context.eventType)) {
          matches.push({ rule, matchType: 'event', matchDetail: context.eventType });
        }
      }

      // Trigger keyword matching
      if (fm.triggers?.length && context.keywords?.length) {
        for (const trigger of fm.triggers) {
          if (context.keywords.some(k => k.toLowerCase().includes(trigger.toLowerCase()))) {
            matches.push({ rule, matchType: 'trigger', matchDetail: trigger });
            break;
          }
        }
      }

      // Always-on rules (no paths, no events, no triggers = always active)
      if (!fm.paths?.length && !fm.events?.length && !fm.triggers?.length) {
        matches.push({ rule, matchType: 'always', matchDetail: 'global rule' });
      }
    }

    // Deduplicate (same rule might match multiple ways)
    const seen = new Set<string>();
    return matches.filter(m => {
      if (seen.has(m.rule.name)) return false;
      seen.add(m.rule.name);
      return true;
    });
  }

  /** Format matched rules for context injection */
  formatForContext(matches: RuleMatch[]): string {
    if (matches.length === 0) return '';

    const sections = matches.map(m => {
      const severity = m.rule.frontmatter.severity === 'mandatory' ? ' [MANDATORY]' : '';
      return `### ${m.rule.name}${severity}\n${m.rule.content}`;
    });

    return `<rules>\n${sections.join('\n\n---\n\n')}\n</rules>`;
  }

  /** Hot-reload: check for changes */
  refresh(): boolean {
    if (Date.now() - this.lastScanMs < 30_000) return false; // Max once per 30s

    let changed = false;
    for (const rule of this.rules) {
      try {
        const stat = fs.statSync(rule.filePath);
        if (stat.mtimeMs !== rule.mtime) {
          changed = true;
          break;
        }
      } catch {
        changed = true; // File deleted
        break;
      }
    }

    if (changed) {
      this.loadRules(this.rulesDirs);
    }
    return changed;
  }

  /** Get all rules */
  getAll(): Rule[] {
    return [...this.rules];
  }

  get size(): number {
    return this.rules.length;
  }
}

// Singleton
export const rulesEngine = new RulesEngine();

// =============================================================================
// Context Interface
// =============================================================================

export interface RuleMatchContext {
  /** File paths being worked on */
  filePaths?: string[];
  /** Current event type */
  eventType?: string;
  /** Keywords from current context */
  keywords?: string[];
}

// =============================================================================
// Parsing
// =============================================================================

function parseRuleFile(filePath: string): Rule | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath, path.extname(filePath));

    // Parse frontmatter
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!fmMatch) {
      // No frontmatter — treat as always-on rule
      return {
        name,
        frontmatter: {},
        content: raw.trim(),
        filePath,
        mtime: stat.mtimeMs,
      };
    }

    const yamlBlock = fmMatch[1];
    const content = fmMatch[2].trim();
    const frontmatter: RuleFrontmatter = {};

    for (const line of yamlBlock.split('\n')) {
      const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
      if (!match) continue;

      const [, key, value] = match;
      const trimmed = value.trim();

      switch (key) {
        case 'paths':
          frontmatter.paths = parseArray(trimmed);
          break;
        case 'events':
          frontmatter.events = parseArray(trimmed);
          break;
        case 'triggers':
          frontmatter.triggers = parseArray(trimmed);
          break;
        case 'priority':
          frontmatter.priority = parseInt(trimmed, 10) || undefined;
          break;
        case 'severity':
          frontmatter.severity = trimmed as 'mandatory' | 'advisory';
          break;
        case 'enabled':
          frontmatter.enabled = trimmed !== 'false';
          break;
      }
    }

    return { name, frontmatter, content, filePath, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Simple glob pattern matching (supports *, **, ?) */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Convert glob to regex
  let regex = pattern
    .replace(/\./g, '\\.')                    // Escape dots
    .replace(/\*\*/g, '{{GLOBSTAR}}')          // Temp placeholder
    .replace(/\*/g, '[^/]*')                    // Single star
    .replace(/\?/g, '[^/]')                     // Question mark
    .replace(/{{GLOBSTAR}}/g, '.*')             // Double star
    .replace(/\{([^}]+)\}/g, (_, opts) => {     // Brace expansion
      return `(${opts.split(',').map((o: string) => o.trim()).join('|')})`;
    });

  try {
    return new RegExp(`^${regex}$`).test(normalizedPath) ||
           new RegExp(`(^|/)${regex}$`).test(normalizedPath);
  } catch {
    return false;
  }
}

function parseArray(value: string): string[] {
  const bracketMatch = value.match(/^\[(.*)\]$/);
  if (bracketMatch) {
    return bracketMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return [value.replace(/^["']|["']$/g, '')];
}

/**
 * Default rules directories.
 * Searches in order:
 * 1. Project-local: ./rules/
 * 2. Instance-level: ~/.mini-agent/instances/{id}/rules/
 * 3. Global: ~/.mini-agent/rules/
 */
export function getDefaultRulesDirs(workdir?: string): string[] {
  const dirs: string[] = [];

  // Project-local
  const localRules = path.join(workdir ?? process.cwd(), 'rules');
  if (fs.existsSync(localRules)) dirs.push(localRules);

  // Instance-level
  try {
    const instanceRules = path.join(getInstanceDir(getCurrentInstanceId()), 'rules');
    if (fs.existsSync(instanceRules)) dirs.push(instanceRules);
  } catch {
    // Instance not initialized yet
  }

  // Global
  const home = process.env.HOME ?? '/tmp';
  const globalRules = path.join(home, '.mini-agent', 'rules');
  if (fs.existsSync(globalRules)) dirs.push(globalRules);

  return dirs;
}
