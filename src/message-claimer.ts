/**
 * MessageClaimer — Atomic in-memory message ownership tracking.
 *
 * Prevents duplicate processing of the same Chat Room message across
 * multiple lanes (LOOP + Foreground). All claim/check operations are
 * synchronous (Map operations), eliminating the async timing gaps
 * that plagued file-based marking (queueInboxMark).
 *
 * Usage:
 *   claim(roomMsgId, 'foreground') → true if claimed, false if already taken
 *   isClaimed(roomMsgId) → check without claiming
 *   release(roomMsgId) → free after processing completes
 */

interface ClaimEntry {
  lane: 'loop' | 'foreground';
  at: number;
}

const CLAIM_TTL_MS = 600_000; // 10 minutes — auto-expire stale claims (crash safety)

const inFlight = new Map<string, ClaimEntry>();

/**
 * Attempt to claim a message for a lane. Returns true if claimed, false if already taken.
 * Stale claims (>10 min) are auto-expired to handle crash/timeout scenarios.
 */
export function claimMessage(roomMsgId: string, lane: 'loop' | 'foreground'): boolean {
  if (!roomMsgId) return true; // No ID = no dedup possible, allow through
  const existing = inFlight.get(roomMsgId);
  if (existing && Date.now() - existing.at < CLAIM_TTL_MS) {
    return false; // Already claimed and not expired
  }
  inFlight.set(roomMsgId, { lane, at: Date.now() });
  return true;
}

/**
 * Check if a message is currently claimed by any lane.
 */
export function isMessageClaimed(roomMsgId: string): boolean {
  if (!roomMsgId) return false;
  const existing = inFlight.get(roomMsgId);
  if (!existing) return false;
  if (Date.now() - existing.at >= CLAIM_TTL_MS) {
    inFlight.delete(roomMsgId); // Auto-expire
    return false;
  }
  return true;
}

/**
 * Release a claimed message after processing completes.
 */
export function releaseMessage(roomMsgId: string): void {
  if (roomMsgId) inFlight.delete(roomMsgId);
}

/**
 * Get current in-flight count (for diagnostics).
 */
export function getInFlightCount(): number {
  return inFlight.size;
}
