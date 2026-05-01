/**
 * Idea Capture — Stage 1 of the Intake Pipeline.
 *
 * Source-end emit: each input channel calls addIdea() at the point of creation.
 * Content hash dedup prevents the same idea from entering twice.
 */

import { createHash } from 'node:crypto';
import { appendMemoryIndexEntry, queryMemoryIndexSync, type CreateMemoryIndexEntryInput } from './memory-index.js';
import { logMechanism } from './mechanism-log.js';
import { qualifyIdea, type QualifyResult } from './idea-qualify.js';

// =============================================================================
// Types
// =============================================================================

export interface IdeaEmitContract {
  raw_text: string;
  source: string;            // format: "channel:actor" e.g. "room:alex", "discovery:hn-cron"
  content_hash?: string;     // auto-computed if omitted
  context_snippet?: string;  // optional surrounding context (max 200 chars)
}

export interface CaptureResult {
  captured: boolean;
  idea_id?: string;
  reason: 'created' | 'duplicate' | 'empty';
  qualify?: QualifyResult;
}

// =============================================================================
// Core
// =============================================================================

export function computeContentHash(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export async function addIdea(
  memoryDir: string,
  input: IdeaEmitContract,
): Promise<CaptureResult> {
  const rawText = input.raw_text.trim();
  if (!rawText || rawText.length < 3) {
    return { captured: false, reason: 'empty' };
  }

  const contentHash = input.content_hash ?? computeContentHash(rawText);

  // Dedup: check for existing idea with same content_hash
  const existing = queryMemoryIndexSync(memoryDir, { type: ['idea'] });
  const duplicate = existing.find(e => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    return payload.content_hash === contentHash && e.status !== 'stale';
  });

  if (duplicate) {
    logMechanism(memoryDir, {
      mechanism: 'idea-intake',
      action: 'dedup-blocked',
      reason: `duplicate content_hash ${contentHash} → existing ${duplicate.id.slice(0, 12)}`,
      data: { content_hash: contentHash, existing_id: duplicate.id },
    });
    return { captured: false, reason: 'duplicate' };
  }

  // Check for stale re-entry (Akari Option B: attach stale_reason)
  const staleMatch = existing.find(e => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    return payload.content_hash === contentHash && e.status === 'stale';
  });
  const stalePayload = staleMatch
    ? (staleMatch.payload as Record<string, unknown>) ?? {}
    : null;
  const staleReason = stalePayload
    ? (stalePayload.stale_reason as string) ?? 'no action taken'
    : undefined;
  const prevQualifyScore = stalePayload
    ? (stalePayload.qualify_score as number) ?? 0
    : undefined;

  // Create idea entry
  const entry: CreateMemoryIndexEntryInput = {
    type: 'idea',
    status: 'pending',
    source: input.source,
    summary: rawText.slice(0, 200),
    payload: {
      raw_text: rawText,
      content_hash: contentHash,
      source: input.source,
      context_snippet: input.context_snippet?.slice(0, 200),
      emitted_at: new Date().toISOString(),
      ...(staleReason ? { prev_stale_reason: staleReason } : {}),
      ...(prevQualifyScore !== undefined ? { prev_qualify_score: prevQualifyScore } : {}),
    },
  };

  const created = await appendMemoryIndexEntry(memoryDir, entry);

  // Immediately qualify (Stage 2)
  const qualifyResult = qualifyIdea(memoryDir, created);

  logMechanism(memoryDir, {
    mechanism: 'idea-intake',
    action: 'captured',
    reason: `${input.source} → ${qualifyResult.decision} (score=${qualifyResult.score.toFixed(2)})`,
    data: {
      idea_id: created.id,
      content_hash: contentHash,
      source: input.source,
      qualify_score: qualifyResult.score,
      qualify_decision: qualifyResult.decision,
      qualify_signals: qualifyResult.signals,
      raw_text_preview: rawText.slice(0, 100),
    },
  });

  return {
    captured: true,
    idea_id: created.id,
    reason: 'created',
    qualify: qualifyResult,
  };
}
