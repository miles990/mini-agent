/**
 * Dispatcher — Minimal Core Enhanced
 *
 * Triage incoming messages to the right lane:
 * - Haiku Lane: simple greetings, status queries → fast (~200ms)
 * - Claude Lane: complex tasks → full Claude CLI
 *
 * Requires ANTHROPIC_API_KEY for Haiku lane.
 * Without it, everything falls back to Claude lane.
 */

import { behaviorLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

type Lane = 'haiku' | 'claude';

interface TriageResult {
  lane: Lane;
  reason: string;
}

interface HaikuStats {
  active: number;
  total: number;
  errors: number;
}

// =============================================================================
// State
// =============================================================================

const MAX_HAIKU_CONCURRENT = 5;
let haikuActive = 0;
let haikuTotal = 0;
let haikuErrors = 0;

export function getHaikuStats(): HaikuStats {
  return { active: haikuActive, total: haikuTotal, errors: haikuErrors };
}

// =============================================================================
// Triage — Fast regex path
// =============================================================================

const SIMPLE_PATTERNS = [
  /^(hi|hey|hello|yo|嗨|哈囉|你好|早安|午安|晚安|安安)\s*[!！.。]?\s*$/i,
  /^(thanks|謝謝|感謝|ok|好的|了解|收到|good|nice)\s*[!！.。]?\s*$/i,
  /^(你好嗎|how are you|what's up|還好嗎|在嗎)\s*[?？]?\s*$/i,
  /^\/?(status|health|ping)\s*$/i,
];

const COMPLEX_SIGNALS = [
  /\b(寫|建立|修改|刪除|部署|安裝|create|build|deploy|fix|write|update|delete|refactor)\b/i,
  /\b(程式|code|script|file|api|server|database)\b/i,
  /```/,
  /\[TASK\]|\[REMEMBER\]|\[ACTION\]/,
];

export function triageMessage(message: string): TriageResult {
  const trimmed = message.trim();

  // No API key → always Claude
  if (!process.env.ANTHROPIC_API_KEY) {
    return { lane: 'claude', reason: 'no-api-key' };
  }

  // Very short messages: likely simple
  if (trimmed.length < 5) {
    return { lane: 'haiku', reason: 'very-short' };
  }

  // Regex fast path: known simple patterns
  for (const pat of SIMPLE_PATTERNS) {
    if (pat.test(trimmed)) {
      return { lane: 'haiku', reason: 'simple-pattern' };
    }
  }

  // Regex fast path: complex signals
  for (const pat of COMPLEX_SIGNALS) {
    if (pat.test(trimmed)) {
      return { lane: 'claude', reason: 'complex-signal' };
    }
  }

  // Messages over 200 chars → Claude
  if (trimmed.length > 200) {
    return { lane: 'claude', reason: 'long-message' };
  }

  // Default: short ambiguous messages → Haiku
  return { lane: 'haiku', reason: 'default-short' };
}

// =============================================================================
// Haiku API Call
// =============================================================================

export async function callHaiku(
  message: string,
  context: string,
  systemPrompt: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  if (haikuActive >= MAX_HAIKU_CONCURRENT) {
    throw new Error('Haiku lane at capacity');
  }

  haikuActive++;
  haikuTotal++;
  const start = Date.now();

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: `${systemPrompt}\n\n${context}`,
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(`Haiku API ${resp.status}: ${(errData?.error as Record<string, string>)?.message ?? resp.statusText}`);
    }

    const data = await resp.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join('');

    const duration = (Date.now() - start) / 1000;
    behaviorLog('haiku.call', `${duration.toFixed(1)}s | ${message.slice(0, 80)}`);
    return text;
  } catch (error) {
    haikuErrors++;
    throw error;
  } finally {
    haikuActive--;
  }
}
