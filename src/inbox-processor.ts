/**
 * Inbox processing — mark pending messages as processed/addressed after each cycle.
 * Extracted from loop.ts for modularity.
 *
 * Covers:
 * - Claude Code inbox (simple pending → processed)
 * - Chat Room inbox (smart tracking: replied/addressed/unaddressed/expired)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ParsedTags } from './types.js';

// =============================================================================
// Paths
// =============================================================================

export const CLAUDE_CODE_INBOX_PATH = path.join(
  process.env.HOME ?? '/tmp',
  '.mini-agent',
  'claude-code-inbox.md',
);

export const CHAT_ROOM_INBOX_PATH = path.join(
  process.env.HOME ?? '/tmp',
  '.mini-agent',
  'chat-room-inbox.md',
);

// =============================================================================
// Claude Code Inbox — mark pending → processed after cycle
// =============================================================================

/**
 * Move all entries from ## Pending to ## Processed.
 * Trim processed to most recent 50 entries.
 * Fire-and-forget — errors silently ignored.
 */
export function markClaudeCodeInboxProcessed(): void {
  try {
    if (!fs.existsSync(CLAUDE_CODE_INBOX_PATH)) return;
    const content = fs.readFileSync(CLAUDE_CODE_INBOX_PATH, 'utf-8');

    const pendingMatch = content.match(/## Pending\n([\s\S]*?)(?=## Processed)/);
    if (!pendingMatch) return;

    const pendingLines = pendingMatch[1].split('\n').filter(l => l.startsWith('- ['));
    if (pendingLines.length === 0) return;

    // Mark each pending line as processed with timestamp
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const processedEntries = pendingLines.map(l => `${l} → processed ${now}`);

    // Extract existing processed entries
    const processedMatch = content.match(/## Processed\n([\s\S]*?)$/);
    const existingProcessed = processedMatch?.[1]
      ?.split('\n')
      .filter(l => l.startsWith('- ['))
      ?? [];

    // Combine and trim to 50
    const allProcessed = [...processedEntries, ...existingProcessed].slice(0, 50);

    const newContent = `## Pending\n\n## Processed\n${allProcessed.join('\n')}\n`;
    fs.writeFileSync(CLAUDE_CODE_INBOX_PATH, newContent, 'utf-8');
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Chat Room Inbox — smart processing with reply tracking
// =============================================================================

/** Read conversation JSONL and build reply tracking data.
 * Returns:
 * - replied: Set of message IDs that Kuro has replied to (replyTo values)
 * - msgLookup: Map of "sender\0textPrefix" → message ID (for entries without [msgId]) */
function getRoomReplyStatus(): { replied: Set<string>, msgLookup: Map<string, string> } {
  const replied = new Set<string>();
  const msgLookup = new Map<string, string>();
  try {
    // Load today's AND yesterday's conversation files — conversations often span midnight
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const dateStrs = [today.toISOString().slice(0, 10), yesterday.toISOString().slice(0, 10)];

    const allLines: string[] = [];
    for (const ds of dateStrs) {
      const jsonlPath = path.join(process.cwd(), 'memory', 'conversations', `${ds}.jsonl`);
      if (fs.existsSync(jsonlPath)) {
        allLines.push(...fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean));
      }
    }
    if (allLines.length === 0) return { replied, msgLookup };

    // Build short ID (NNN) → full ID map from ALL loaded messages
    const shortIdToFull = new Map<string, string>();
    for (const line of allLines) {
      try {
        const msg = JSON.parse(line);
        if (msg.id) {
          const shortMatch = (msg.id as string).match(/-(\d+)$/);
          if (shortMatch) shortIdToFull.set(shortMatch[1], msg.id);
        }
      } catch { /* skip */ }
    }

    // parentOf: msgId → replyTo msgId (for transitive parent-addressing)
    const parentOf = new Map<string, string>();
    for (const line of allLines) {
      try {
        const msg = JSON.parse(line);
        if (msg.from === 'kuro') {
          // Track explicit replyTo
          if (msg.replyTo) replied.add(msg.replyTo);
          // Also track message IDs mentioned in text (e.g. "看到了 #111" or "[2026-02-24-111]")
          if (msg.text) {
            const text = msg.text as string;
            // Full ID: 2026-02-24-NNN
            for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2}-\d+)\b/g)) replied.add(m[1]);
            // Short form: #N or #NNN — resolve to actual full ID from loaded messages
            for (const m of text.matchAll(/(?<![0-9-])#(\d{1,4})\b/g)) {
              const fullId = shortIdToFull.get(m[1]);
              if (fullId) replied.add(fullId);
            }
          }
        }
        // Track reply chain for all messages
        if (msg.id && msg.replyTo) parentOf.set(msg.id, msg.replyTo);
        // Build reverse lookup for non-kuro messages (sender + cleaned text prefix → id)
        if (msg.from && msg.from !== 'kuro' && msg.id && msg.text) {
          const cleanedText = (msg.text as string).replace(/@\w+\s*/g, '').trim();
          const key = `${msg.from}\0${cleanedText.slice(0, 30).toLowerCase()}`;
          msgLookup.set(key, msg.id);
        }
      } catch { /* skip malformed lines */ }
    }
    // Transitively mark parents as addressed:
    // If Kuro replied to B, and B is a reply to A, A is also addressed (same thread context).
    for (const id of [...replied]) {
      let parent = parentOf.get(id);
      while (parent && !replied.has(parent)) {
        replied.add(parent);
        parent = parentOf.get(parent);
      }
    }
  } catch { /* fire-and-forget */ }
  return { replied, msgLookup };
}

/** Check if Kuro replied to a message in the room, by ID or content lookup. */
function isRepliedInRoom(
  msgId: string | undefined, sender: string, text: string,
  replied: Set<string>, msgLookup: Map<string, string>,
): boolean {
  // Direct ID match
  if (msgId && replied.has(msgId)) return true;
  // Transitive: if this message is a reply (↩parent) and Kuro replied to the parent
  const replyToHint = text.match(/↩(\d{4}-\d{2}-\d{2}-\d+)/);
  if (replyToHint && replied.has(replyToHint[1])) return true;
  // Fallback: look up message ID by sender + text prefix (for old entries without [msgId])
  // Strip leading ↩ replyTo hint and @mentions for matching
  const cleanText = text.replace(/^↩\S+\s*/, '').replace(/@\w+\s*/g, '').trim();
  const lookupKey = `${sender}\0${cleanText.slice(0, 30).toLowerCase()}`;
  const resolvedId = msgLookup.get(lookupKey);
  if (resolvedId && replied.has(resolvedId)) return true;
  return false;
}

/** Extract key terms from a message for address matching */
function extractKeyTerms(text: string): string[] {
  // Remove @mentions and common noise
  const cleaned = text
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_[\](){}<>:;,.!?/\\|"'~+-]/g, ' ')
    .toLowerCase();
  const stopWords = new Set(['的', '了', '是', '在', '有', '和', '也', '不', '都', '就', '被',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'on', 'and', 'or',
    'it', 'this', 'that', 'with', 'as', 'at', 'by', 'from', 'i', 'you', 'he', 'she', 'we', 'they']);
  return cleaned.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
}

/** Check if Kuro's response addressed a particular inbox message.
 * Stricter matching: check <kuro:chat> content (not full response), require multiple keyword hits.
 * Previous version was too lenient — any single keyword in the full OODA output would match. */
function isMessageAddressed(
  sender: string, messageText: string,
  response: string, chatTags: Array<{ text: string; reply: boolean }>, action: string | null,
  msgId?: string,
): boolean {
  const senderLower = sender.toLowerCase();
  const terms = extractKeyTerms(messageText);
  const meaningfulTerms = terms.filter(t => t.length > 3); // skip short/common words

  // 0. Message ID reference — batch replies like "統一回覆 #155/#196/#199" or "2026-03-09-155"
  if (msgId) {
    const searchable = response + ' ' + (action ?? '');
    // Match short form #NNN (last segment of YYYY-MM-DD-NNN)
    const shortId = msgId.split('-').pop();
    if (shortId && searchable.includes(`#${shortId}`)) return true;
    // Match full form YYYY-MM-DD-NNN
    if (searchable.includes(msgId)) return true;
  }

  // 1. Has <kuro:chat> tags → check CHAT content specifically (not full response)
  if (chatTags.length > 0) {
    const chatContent = chatTags.map(t => t.text).join(' ').toLowerCase();
    // Explicit sender mention in CHAT
    if (chatContent.includes(senderLower)) return true;
    // At least 2 meaningful keywords in CHAT content
    const chatMatches = meaningfulTerms.filter(t => chatContent.includes(t));
    if (chatMatches.length >= 2) return true;
  }

  // 2. Action explicitly mentions sender + at least 2 meaningful keywords
  if (action) {
    const actionLower = action.toLowerCase();
    if (actionLower.includes(senderLower)) {
      const actionMatches = meaningfulTerms.filter(t => actionLower.includes(t));
      if (actionMatches.length >= 2) return true;
    }
  }

  // 3. Very short message (≤2 words after removing @mention) + any <kuro:chat> → addressed
  const strippedWords = messageText.replace(/@\w+/g, '').trim().split(/\s+/).filter(Boolean);
  if (strippedWords.length <= 2 && chatTags.length > 0) return true;

  return false;
}

/** Truncate message to ≤60 chars summary */
function summarizeMessage(text: string): string {
  if (text.length <= 60) return text;
  return text.slice(0, 57) + '...';
}

/**
 * Smart inbox processing: track addressed vs unaddressed messages.
 * - Addressed pending → Processed (→ replied / → addressed)
 * - Unaddressed pending → Unaddressed (summary only)
 * - Previously unaddressed + now addressed → Processed
 * - Previously unaddressed + 24h old → Processed (→ expired)
 * Trim processed to most recent 50 entries.
 * Fire-and-forget — errors silently ignored.
 */
export function markChatRoomInboxProcessed(response: string, tags: ParsedTags, action: string | null): void {
  try {
    if (!fs.existsSync(CHAT_ROOM_INBOX_PATH)) return;
    const content = fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8');

    const now = new Date();
    const nowStr = now.toISOString().slice(0, 16).replace('T', ' ');

    // Read Kuro's room replies from conversation JSONL
    const { replied, msgLookup } = getRoomReplyStatus();

    // Parse three sections
    const pendingMatch = content.match(/## Pending\n([\s\S]*?)(?=## (?:Unaddressed|Processed))/);
    const unaddressedMatch = content.match(/## Unaddressed\n([\s\S]*?)(?=## Processed)/);
    const processedMatch = content.match(/## Processed\n([\s\S]*?)$/);

    const pendingLines = pendingMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];
    const unaddressedLines = unaddressedMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];
    const existingProcessed = processedMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];

    if (pendingLines.length === 0 && unaddressedLines.length === 0) return;

    const newUnaddressed: string[] = [];
    const newProcessed: string[] = [];

    // Process pending messages
    for (const line of pendingLines) {
      // Parse: - [YYYY-MM-DD HH:MM] (sender) [msgId] text  OR  - [YYYY-MM-DD HH:MM] (sender) text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (?:\[(\d{4}-\d{2}-\d{2}-\d+)\] )?(.+)$/);
      if (!match) {
        // Unparseable → move to processed as-is
        newProcessed.push(`${line} → processed ${nowStr}`);
        continue;
      }

      const [, ts, sender, msgId, text] = match;

      // Check 1: Kuro replied to this message in the room (via replyTo in JSONL)
      const repliedInRoom = isRepliedInRoom(msgId, sender, text, replied, msgLookup);
      // Check 2: Text-based matching (CHAT tags, ACTION keywords, msgId references)
      const addressed = repliedInRoom || isMessageAddressed(sender, text, response, tags.chats, action, msgId);

      if (addressed) {
        const suffix = repliedInRoom ? 'replied' : (tags.chats.length > 0 ? 'replied' : 'addressed');
        newProcessed.push(`${line} → ${suffix} ${nowStr}`);
      } else {
        // Move to unaddressed with summary + unaddressed timestamp
        const summary = summarizeMessage(text);
        const idPart = msgId ? `[${msgId}] ` : '';
        newUnaddressed.push(`- [${ts}|u:${nowStr}] (${sender}) ${idPart}${summary}`);
      }
    }

    // Process existing unaddressed messages
    for (const line of unaddressedLines) {
      // Parse: - [ts|u:ts] (sender) [msgId] text  OR  - [ts|u:ts] (sender) text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\|u:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (?:\[(\d{4}-\d{2}-\d{2}-\d+)\] )?(.+)$/);
      if (!match) {
        // Unparseable → expire
        newProcessed.push(`${line} → expired ${nowStr}`);
        continue;
      }

      const [, originalTs, _uTs, sender, msgId, text] = match;

      // Check 1: Kuro replied to this message in the room
      const repliedInRoom = isRepliedInRoom(msgId, sender, text, replied, msgLookup);
      // Check 2: Text-based matching + msgId references
      if (repliedInRoom || isMessageAddressed(sender, text, response, tags.chats, action, msgId)) {
        const suffix = repliedInRoom ? 'replied' : (tags.chats.length > 0 ? 'replied' : 'addressed');
        newProcessed.push(`- [${originalTs}] (${sender}) ${text} → ${suffix} ${nowStr}`);
        continue;
      }

      // Check 24h expiry from original timestamp
      const originalDate = new Date(originalTs.replace(' ', 'T') + ':00');
      const ageMs = now.getTime() - originalDate.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        newProcessed.push(`- [${originalTs}] (${sender}) ${text} → expired ${nowStr}`);
        continue;
      }

      // Keep as unaddressed
      newUnaddressed.push(line);
    }

    const allProcessed = [...newProcessed, ...existingProcessed].slice(0, 50);

    const newContent = [
      '## Pending',
      '',
      '## Unaddressed',
      ...newUnaddressed,
      '',
      '## Processed',
      ...allProcessed,
      '',
    ].join('\n');
    fs.writeFileSync(CHAT_ROOM_INBOX_PATH, newContent, 'utf-8');
  } catch { /* fire-and-forget */ }
}
