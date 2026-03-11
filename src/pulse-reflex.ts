/**
 * Pulse Reflex — Layer 2: 9B Signal Classification via oMLX
 *
 * Uses local 9B model (~800ms) to classify behavioral signals that
 * pure code heuristics can't catch:
 *   - action-as-avoidance (asked X, did Y)
 *   - metsuke patterns (learned anti-patterns from 1400+ cycles)
 *
 * Design: outputs structured signals, NOT advice. Signals are composable
 * and can be rotated by Layer 3's habituation resistance.
 *
 * Graceful degradation: if oMLX is offline, Layer 1 signals alone are sufficient.
 */

import type { PulseMetrics, PulseSignal } from './pulse.js';
import { slog } from './utils.js';

// =============================================================================
// Constants
// =============================================================================

const OMLX_BASE_URL = process.env.OMLX_BASE_URL ?? 'http://localhost:8000';
const OMLX_MODEL = process.env.OMLX_MODEL ?? 'Qwen3.5-9B-MLX-4bit';
const OMLX_API_KEY = process.env.OMLX_API_KEY ?? 'omlx-local';
const TIMEOUT_MS = 20000;

// =============================================================================
// 9B Classification
// =============================================================================

const REFLEX_SYSTEM = `You are a behavioral signal classifier for an AI agent. Given metrics and recent actions, output a JSON array of signals. Each signal has: type (string), severity (low/medium/high), positive (boolean), detail (string).

Signal types you can detect:
- "avoidance": agent was asked something specific but did an unrelated action instead
- "neglected": a stated priority has had zero action for >24h
- "drifting": recent actions don't match stated goals
- "progressing": agent is making real progress on stated goals
- "completed": a milestone was reached

Rules:
- Output ONLY valid JSON array. No markdown, no explanation.
- If nothing notable, output empty array: []
- Max 3 signals per call.
- Be concise in detail field (max 20 words).`;

interface OMLXResponse {
  choices?: Array<{ message?: { content: string } }>;
}

/**
 * Call oMLX for behavioral signal classification.
 * Returns additional signals to merge with Layer 1, or empty array if unavailable.
 */
export async function classifyWithReflex(
  metrics: PulseMetrics,
  action: string | null,
): Promise<PulseSignal[]> {
  // Build compact input for 9B
  const input = buildReflexInput(metrics, action);
  if (!input) return [];

  try {
    const response = await fetch(`${OMLX_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OMLX_API_KEY}`,
      },
      body: JSON.stringify({
        model: OMLX_MODEL,
        messages: [
          { role: 'system', content: REFLEX_SYSTEM },
          { role: 'user', content: input },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      slog('PULSE-REFLEX', `oMLX error: ${response.status}`);
      return [];
    }

    const data = await response.json() as OMLXResponse;
    const content = data.choices?.[0]?.message?.content ?? '';

    // Parse JSON response
    const signals = parseReflexResponse(content);
    if (signals.length > 0) {
      slog('PULSE-REFLEX', `${signals.length} signals from 9B`);
    }
    return signals;
  } catch (error) {
    // oMLX offline or timeout — graceful degradation
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('abort') && !msg.includes('timeout') && !msg.includes('ECONNREFUSED')) {
      slog('PULSE-REFLEX', `9B call failed: ${msg}`);
    }
    return [];
  }
}

// =============================================================================
// Helpers
// =============================================================================

function buildReflexInput(metrics: PulseMetrics, action: string | null): string | null {
  const parts: string[] = [];

  parts.push(`Metrics: learn_ratio=${(metrics.learnVsActionRatio * 100).toFixed(0)}%, output_rate=${(metrics.visibleOutputRate * 100).toFixed(0)}%, alignment=${(metrics.priorityAlignmentScore * 100).toFixed(0)}%`);

  if (metrics.goalIdleHours !== null) {
    parts.push(`Goal idle: ${Math.round(metrics.goalIdleHours)}h`);
  }

  if (metrics.velocityVector) {
    parts.push(`Velocity: ${metrics.velocityVector.goal} — ${metrics.velocityVector.trend} (${metrics.velocityVector.recent24h} vs ${metrics.velocityVector.prior24h})`);
  }

  if (action) {
    // Send first 300 chars of action for context
    parts.push(`Last action: ${action.slice(0, 300)}`);
  }

  return parts.join('\n');
}

function parseReflexResponse(content: string): PulseSignal[] {
  try {
    // Try to extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      type?: string;
      severity?: string;
      positive?: boolean;
      detail?: string;
    }>;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(s => s.type && typeof s.type === 'string')
      .slice(0, 3) // Cap at 3 signals
      .map(s => ({
        type: s.type!,
        severity: (['low', 'medium', 'high'].includes(s.severity ?? '') ? s.severity : 'medium') as 'low' | 'medium' | 'high',
        positive: !!s.positive,
        detail: String(s.detail ?? '').slice(0, 100),
      }));
  } catch {
    // JSON parse failure — ignore
    return [];
  }
}
