/**
 * Reply Context — 智能 Telegram 回覆目標解析
 *
 * 從多條 pending 訊息中，根據回覆內容的脈絡關係，
 * 自適應地選擇最相關的訊息作為 reply_to_message_id。
 *
 * 策略：
 * - 0 條 pending → fallback getLastAlexMessageId()
 * - 1 條 → 直接用它
 * - N 條 → content matching 找最相關的（CJK bigram + English word + number overlap）
 */

import { readPendingInbox } from './inbox.js';
import { getLastAlexMessageId } from './telegram.js';

// =============================================================================
// Types
// =============================================================================

export interface TelegramMsgSnapshot {
  msgId: number;
  content: string;
}

// =============================================================================
// Snapshot
// =============================================================================

/**
 * Snapshot pending telegram messages at cycle/foreground entry.
 * Captures immutable state before async operations can change inbox.
 */
export function snapshotTelegramMsgs(): TelegramMsgSnapshot[] {
  const pending = readPendingInbox();
  return pending
    .filter(i => i.source === 'telegram' && i.meta?.telegramMsgId)
    .map(i => ({
      msgId: Number(i.meta!.telegramMsgId),
      content: i.content,
    }));
}

// =============================================================================
// Match
// =============================================================================

/**
 * 從 snapshot 中解析最佳 reply target。
 *
 * @param responseText Kuro 的回覆內容
 * @param candidates cycle 開始時的 snapshot
 * @returns telegram message_id 或 null
 */
export function matchReplyTarget(
  responseText: string,
  candidates: TelegramMsgSnapshot[],
): number | null {
  if (candidates.length === 0) return getLastAlexMessageId();
  if (candidates.length === 1) return candidates[0].msgId;

  // Score each candidate by content relevance
  let best = candidates[candidates.length - 1]; // default: latest (most likely trigger)
  let bestScore = -1;

  for (const c of candidates) {
    const score = computeRelevance(responseText, c.content);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best.msgId;
}

// =============================================================================
// Content Relevance Scoring
// =============================================================================

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'shall',
  'and', 'but', 'or', 'not', 'no', 'yes',
  'this', 'that', 'these', 'those', 'it', 'its',
  'for', 'from', 'with', 'about', 'into', 'through',
  'of', 'in', 'on', 'at', 'to', 'by', 'as',
  // 中文常用虛詞
  '的', '了', '是', '在', '有', '和', '就', '不', '都',
  '一', '我', '他', '她', '你', '也', '很', '到', '要',
  '會', '這', '那', '沒', '嗎', '吧', '呢', '啊',
]);

/**
 * 計算回覆文字與候選訊息的相關度分數（0-1）。
 * 混合 English word + CJK bigram + number matching。
 */
function computeRelevance(response: string, candidateContent: string): number {
  const responseLower = response.toLowerCase();
  const tokens = extractTokens(candidateContent.toLowerCase());
  if (tokens.length === 0) return 0;

  let matches = 0;
  for (const token of tokens) {
    if (responseLower.includes(token)) matches++;
  }

  return matches / tokens.length;
}

/**
 * 從文字中提取有意義的 tokens。
 * - English: 3+ char words (excluding stop words)
 * - CJK: character bigrams (no tokenizer needed)
 * - Numbers: 2+ digits (versions, dates, IDs)
 */
function extractTokens(text: string): string[] {
  const tokens: string[] = [];

  // English words
  const words = text.match(/[a-z]{3,}/g) || [];
  for (const w of words) {
    if (!STOP_WORDS.has(w)) tokens.push(w);
  }

  // CJK bigrams
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || [];
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk[i] + cjk[i + 1]);
  }

  // Numbers
  const nums = text.match(/\d{2,}/g) || [];
  tokens.push(...nums);

  return [...new Set(tokens)];
}
