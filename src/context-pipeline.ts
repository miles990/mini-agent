/**
 * Context Pipeline — Model-Aware Context Processing
 *
 * Three-layer pipeline that adapts context for different model tiers:
 * - L0 Denoise: Remove empty sections, collapse duplicates, handle degraded (both tiers)
 * - L1 Pre-digest: Summarize verbose sections for small models (aggressive), light for large
 * - Budget enforcement: Truncate lowest-priority sections to fit context budget
 *
 * Design: small models (4B) get clean, pre-digested context with simplified prompts.
 * Large models (Opus) get denoised context with full detail preserved.
 */

import type { Provider } from './types.js';

// =============================================================================
// Types
// =============================================================================

export type ModelTier = 'small' | 'large';

export interface ModelTierConfig {
  contextBudget: number;
  maxTags: number;
  promptStyle: 'micro' | 'full';
  predigestLevel: 'aggressive' | 'light';
}

// =============================================================================
// Tier Detection
// =============================================================================

/** Known small model patterns (case-insensitive substring match) */
const SMALL_MODEL_PATTERNS = [
  '1b', '1.5b', '2b', '3b', '4b', '7b', '8b',
  'qwen3.5-4b', 'qwen2.5-3b', 'qwen2.5-1.5b',
  'phi-3-mini', 'phi-4-mini',
  'gemma-2b', 'gemma-3-4b',
  'llama-3.2-3b', 'llama-3.2-1b',
  'smollm',
];

/**
 * Detect model tier from provider and model name.
 * - 'claude' and 'codex' providers → always 'large'
 * - 'local' provider → check model name against known small patterns
 */
export function detectModelTier(provider: Provider, modelName?: string): ModelTier {
  // Claude API and Codex are always large
  if (provider === 'claude' || provider === 'codex') return 'large';

  // Local provider: check model name
  if (provider === 'local' && modelName) {
    const lower = modelName.toLowerCase();
    for (const pattern of SMALL_MODEL_PATTERNS) {
      if (lower.includes(pattern)) return 'small';
    }
  }

  // Default: large (safe fallback — don't lose context unnecessarily)
  return 'large';
}

// =============================================================================
// Tier Config
// =============================================================================

const TIER_CONFIGS: Record<ModelTier, ModelTierConfig> = {
  small: {
    contextBudget: 6_000,   // ~6K chars — 4B models struggle above this
    maxTags: 3,             // reply, action, remember only
    promptStyle: 'micro',
    predigestLevel: 'aggressive',
  },
  large: {
    contextBudget: 50_000,  // ~50K chars — Opus handles fine
    maxTags: 20,            // all tags
    promptStyle: 'full',
    predigestLevel: 'light',
  },
};

export function getModelTierConfig(tier: ModelTier): ModelTierConfig {
  return TIER_CONFIGS[tier];
}

// =============================================================================
// L0: Denoise (both tiers)
// =============================================================================

/**
 * Remove empty XML sections: `<tag>\s*</tag>` → removed
 */
function removeEmptySections(text: string): string {
  // Match XML sections with only whitespace content
  return text.replace(/<(\w[\w-]*)>\s*<\/\1>/g, '');
}

/**
 * Collapse 3+ consecutive identical lines into `[repeated x N]`
 */
function collapseRepeatedLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let prevLine = '';
  let repeatCount = 0;

  for (const line of lines) {
    if (line === prevLine && line.trim() !== '') {
      repeatCount++;
    } else {
      if (repeatCount >= 2) {
        // We already pushed the first occurrence; replace it with collapsed version
        result.push(`[repeated x ${repeatCount + 1}]`);
      } else if (repeatCount === 1) {
        // Only 2 consecutive — keep both (push the second)
        result.push(prevLine);
      }
      result.push(line);
      repeatCount = 0;
    }
    prevLine = line;
  }

  // Handle trailing repeats
  if (repeatCount >= 2) {
    result.push(`[repeated x ${repeatCount + 1}]`);
  } else if (repeatCount === 1) {
    result.push(prevLine);
  }

  return result.join('\n');
}

/**
 * Handle degraded/timeout sections: keep the section tag but replace content
 * with a brief note. Matches sections that contain [degraded] or [timeout] markers.
 */
function handleDegradedSections(text: string): string {
  // Match sections containing [degraded] or [timeout]
  return text.replace(
    /<(\w[\w-]*)>([\s\S]*?\[(?:degraded|timeout)\][\s\S]*?)<\/\1>/g,
    (_match, tag: string) => `<${tag}>(degraded)</${tag}>`,
  );
}

/**
 * L0 Denoise: apply all denoising steps
 */
function l0Denoise(text: string): string {
  let result = text;
  result = removeEmptySections(result);
  result = collapseRepeatedLines(result);
  result = handleDegradedSections(result);
  // Clean up excessive blank lines (3+ → 2)
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

// =============================================================================
// L1: Pre-digest (tier-dependent)
// =============================================================================

/** Section priority for budget enforcement (higher number = higher priority = cut last) */
const SECTION_PRIORITY: Record<string, number> = {
  'task-queue': 90,
  'inbox': 85,
  'chat-room-inbox': 85,
  'soul': 80,
  'heartbeat': 75,
  'chat-room-recent': 70,
  'next': 65,
  'topics': 60,
  // Everything else (perceptions) gets default priority 30
};

/** Sections that should never be pre-digested (identity/core) */
const PRESERVED_SECTIONS = new Set([
  'soul', 'heartbeat', 'inbox', 'chat-room-inbox', 'task-queue', 'memory-index',
]);

/**
 * Extract all XML sections from context text.
 * Returns array of { tag, content, start, end } sorted by position.
 */
interface ContextSection {
  tag: string;
  content: string;
  fullMatch: string;
  start: number;
  end: number;
}

function extractSections(text: string): ContextSection[] {
  const sections: ContextSection[] = [];
  const regex = /<(\w[\w-]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    sections.push({
      tag: match[1],
      content: match[2],
      fullMatch: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return sections;
}

/**
 * Summarize inbox section for small models.
 * Input: raw inbox content. Output: summary like "3 pending (1 Alex, 2 system)"
 */
function summarizeInbox(content: string): string {
  const lines = content.split('\n').filter(l => l.trim().startsWith('- ['));
  if (lines.length === 0) return 'No pending messages.';

  const bySender: Record<string, number> = {};
  for (const line of lines) {
    const senderMatch = line.match(/\((\w[\w-]*)\)/);
    const sender = senderMatch?.[1] ?? 'unknown';
    bySender[sender] = (bySender[sender] ?? 0) + 1;
  }

  const parts = Object.entries(bySender).map(([s, n]) => `${n} ${s}`);
  return `${lines.length} pending (${parts.join(', ')})`;
}

/**
 * Summarize chat room section for small models.
 * Keep only last 3 messages, add count.
 */
function summarizeChatRoom(content: string): string {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '';

  const total = lines.length;
  const kept = lines.slice(-3);
  const header = total > 3 ? `[${total} messages, showing last 3]\n` : '';
  return header + kept.join('\n');
}

/**
 * L1 Pre-digest: process sections based on tier
 */
function l1Predigest(text: string, level: 'aggressive' | 'light'): string {
  if (level === 'light') return text; // Large models get no content changes

  // Aggressive: summarize verbose sections for small models
  const sections = extractSections(text);
  let result = text;

  // Process in reverse order to maintain correct offsets
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];

    if (sec.tag === 'inbox' || sec.tag === 'chat-room-inbox') {
      const summary = summarizeInbox(sec.content);
      result = result.slice(0, sec.start) + `<${sec.tag}>${summary}</${sec.tag}>` + result.slice(sec.end);
    } else if (sec.tag === 'chat-room-recent') {
      const summary = summarizeChatRoom(sec.content);
      result = result.slice(0, sec.start) + `<${sec.tag}>${summary}</${sec.tag}>` + result.slice(sec.end);
    } else if (!PRESERVED_SECTIONS.has(sec.tag) && sec.content.length > 200) {
      // Truncate other perception sections to first 200 chars
      const truncated = sec.content.slice(0, 200) + '...';
      result = result.slice(0, sec.start) + `<${sec.tag}>${truncated}</${sec.tag}>` + result.slice(sec.end);
    }
  }

  return result;
}

// =============================================================================
// Budget Enforcement
// =============================================================================

/**
 * Enforce context budget by removing lowest-priority sections.
 * Priority order (high→low): task-queue > inbox > soul > heartbeat > chat-room > next > topics > rest
 */
function enforceBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;

  const sections = extractSections(text);
  if (sections.length === 0) {
    // No XML sections — just truncate
    return text.slice(0, budget);
  }

  // Sort sections by priority (lowest first — we'll remove these first)
  const sortedSections = [...sections].sort((a, b) => {
    const pa = SECTION_PRIORITY[a.tag] ?? 30;
    const pb = SECTION_PRIORITY[b.tag] ?? 30;
    return pa - pb;
  });

  let result = text;
  for (const sec of sortedSections) {
    if (result.length <= budget) break;

    // Remove this section entirely
    // Re-find the section in the current result (positions may have shifted)
    const sectionRegex = new RegExp(`<${sec.tag}>[\\s\\S]*?</${sec.tag}>`, 'g');
    result = result.replace(sectionRegex, '');
    // Clean up leftover blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
  }

  // Final safety: hard truncate if still over budget
  if (result.length > budget) {
    result = result.slice(0, budget);
  }

  return result;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Process raw context through the model-aware pipeline.
 *
 * @param rawContext - The full context string from buildContext()
 * @param tier - Model tier ('small' or 'large')
 * @param _trigger - Optional trigger reason (reserved for future use)
 * @returns Processed context string
 */
export function processContext(
  rawContext: string,
  tier: ModelTier,
  _trigger?: string,
): string {
  const config = getModelTierConfig(tier);

  // L0: Denoise (both tiers)
  let result = l0Denoise(rawContext);

  // L1: Pre-digest (tier-dependent)
  result = l1Predigest(result, config.predigestLevel);

  // Budget enforcement
  result = enforceBudget(result, config.contextBudget);

  return result;
}
