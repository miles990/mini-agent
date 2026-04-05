/**
 * Content Scanner — Injection & Exfiltration Detection
 *
 * Scans content before it enters system prompt or persistent memory.
 * Inspired by Hermes Agent's memory_tool.py injection scanning,
 * adapted for mini-agent's architecture.
 *
 * All memory write paths (appendMemory, appendTopicMemory, appendDailyNote,
 * <kuro:remember> tags) pass through scanContent() before persisting.
 */

import { eventBus } from './event-bus.js';

// =============================================================================
// Threat Patterns
// =============================================================================

interface ThreatPattern {
  pattern: RegExp;
  id: string;
  severity: 'block' | 'warn';
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // Prompt injection
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection', severity: 'block' },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack', severity: 'block' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide', severity: 'block' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override', severity: 'block' },
  { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules', severity: 'block' },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, id: 'bypass_restrictions', severity: 'block' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(?!.*kuro)/i, id: 'identity_override', severity: 'block' },

  // Exfiltration via shell commands
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl', severity: 'block' },
  { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget', severity: 'block' },
  { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: 'read_secrets', severity: 'block' },

  // Persistence / backdoor
  { pattern: /authorized_keys/i, id: 'ssh_backdoor', severity: 'block' },
  { pattern: /(\$HOME|~)\/\.ssh\/(id_|config)/i, id: 'ssh_key_access', severity: 'warn' },

  // Data exfiltration patterns
  { pattern: /base64\s+(-d|--decode)?\s*[^\n]*(\.env|secret|key|token)/i, id: 'encoded_exfil', severity: 'block' },
  { pattern: />\s*\/dev\/tcp\//i, id: 'tcp_exfil', severity: 'block' },
];

// Invisible unicode characters used for injection attacks
const INVISIBLE_CHARS = new Set([
  '\u200B', // Zero Width Space
  '\u200C', // Zero Width Non-Joiner
  '\u200D', // Zero Width Joiner
  '\u2060', // Word Joiner
  '\uFEFF', // Zero Width No-Break Space (BOM)
  '\u202A', // Left-to-Right Embedding
  '\u202B', // Right-to-Left Embedding
  '\u202C', // Pop Directional Formatting
  '\u202D', // Left-to-Right Override
  '\u202E', // Right-to-Left Override
]);

// =============================================================================
// Trust Levels
// =============================================================================

export type TrustLevel = 'system' | 'user' | 'agent' | 'external';

/**
 * Policy: what each trust level is allowed to bypass.
 * Higher trust = fewer checks. But injection scanning is ALWAYS applied.
 */
const TRUST_POLICY: Record<TrustLevel, { skipWarnPatterns: boolean }> = {
  system: { skipWarnPatterns: true },
  user: { skipWarnPatterns: true },
  agent: { skipWarnPatterns: false },
  external: { skipWarnPatterns: false },
};

// =============================================================================
// Scanner
// =============================================================================

export interface ScanResult {
  blocked: boolean;
  reason?: string;
  patternId?: string;
  severity?: 'block' | 'warn';
}

/**
 * Scan content for injection/exfiltration threats.
 * Returns { blocked: false } if safe, { blocked: true, reason } if dangerous.
 *
 * @param content - Text to scan
 * @param trust - Trust level of the content source (default: 'agent')
 */
export function scanContent(content: string, trust: TrustLevel = 'agent'): ScanResult {
  const policy = TRUST_POLICY[trust];

  // 1. Invisible unicode check (always applied, all trust levels)
  for (const char of content) {
    if (INVISIBLE_CHARS.has(char)) {
      const result: ScanResult = {
        blocked: true,
        reason: `Content contains invisible unicode U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (possible injection)`,
        patternId: 'invisible_unicode',
        severity: 'block',
      };
      eventBus.emit('security:threat', { ...result, contentPreview: content.slice(0, 100), trust });
      return result;
    }
  }

  // 2. Threat pattern matching
  for (const { pattern, id, severity } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      if (severity === 'warn' && policy.skipWarnPatterns) {
        continue; // Trusted sources skip warn-level patterns
      }

      const result: ScanResult = {
        blocked: severity === 'block',
        reason: `Content matches threat pattern '${id}'. Memory entries are injected into the system prompt and must not contain injection or exfiltration payloads.`,
        patternId: id,
        severity,
      };

      eventBus.emit('security:threat', { ...result, contentPreview: content.slice(0, 100), trust });
      return result;
    }
  }

  return { blocked: false };
}

/**
 * Strip invisible unicode from content (for sanitization rather than blocking).
 * Use when you want to clean content rather than reject it.
 */
export function stripInvisibleChars(content: string): string {
  let result = '';
  for (const char of content) {
    if (!INVISIBLE_CHARS.has(char)) {
      result += char;
    }
  }
  return result;
}
