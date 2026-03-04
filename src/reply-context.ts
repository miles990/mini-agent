/**
 * Reply Context — 智能 Telegram 回覆脈絡管理
 *
 * 三層自適應邏輯：
 * 1. Acknowledgment 偵測 — 「好」「OK」「了解」等不需要回覆
 * 2. 脈絡覆蓋檢查 — 已回覆的主題，相關訊息不再重複回
 * 3. Content matching — 多條待回覆時，找最相關的作為 reply_to_message_id
 *
 * 保留回覆的判斷：
 * - 有問號 → 追問，需要回覆
 * - 有 URL → 新資訊，需要回覆
 * - 內容長度 > 閾值且有新關鍵詞 → 需要回覆
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
// Reply History — 記錄最近回覆的內容（in-memory ring buffer）
// =============================================================================

interface ReplyRecord {
  text: string;
  ts: number;
}

const replyHistory: ReplyRecord[] = [];
const HISTORY_TTL = 30 * 60 * 1000; // 30min
const MAX_HISTORY = 20;

/**
 * 記錄一次回覆的內容。每次 Kuro 發 telegram 回覆後呼叫。
 * 用於判斷後續訊息的脈絡是否已被覆蓋。
 */
export function recordReply(text: string): void {
  replyHistory.push({ text, ts: Date.now() });
  // Cleanup
  const cutoff = Date.now() - HISTORY_TTL;
  while (replyHistory.length > MAX_HISTORY || (replyHistory.length > 0 && replyHistory[0].ts < cutoff)) {
    replyHistory.shift();
  }
}

// =============================================================================
// Snapshot — 帶脈絡過濾的快照
// =============================================================================

/**
 * Snapshot pending telegram messages, filtering out:
 * - Pure acknowledgments (不需要回覆)
 * - Messages whose context is already covered by recent replies
 *
 * 保留：追問（有 ?）、新資訊（有 URL）、新主題
 */
export function snapshotTelegramMsgs(): TelegramMsgSnapshot[] {
  const pending = readPendingInbox();
  return pending
    .filter(i => i.source === 'telegram' && i.meta?.telegramMsgId)
    .filter(i => needsResponse(i.content))
    .map(i => ({
      msgId: Number(i.meta!.telegramMsgId),
      content: i.content,
    }));
}

// =============================================================================
// Needs Response — 判斷訊息是否需要回覆
// =============================================================================

const ACK_PATTERNS = /^(好[的啊吧]?|嗯+|ok[ay]*|sure|got\s*it|收到|了解|知道了|沒問題|明白|thanks?|thx|np|fine|alright|對|行|可以|讚|棒|不錯|看到了|noted)$/i;

function needsResponse(content: string): boolean {
  const trimmed = content.trim();

  // Questions — always need response
  if (/[?？]/.test(trimmed)) return true;

  // URLs — new information
  if (/https?:\/\//.test(trimmed)) return true;

  // Pure acknowledgment pattern
  if (ACK_PATTERNS.test(trimmed)) return false;

  // Very short messages without question/URL — likely acknowledgment
  if (trimmed.length <= 4) return false;

  // Check against recent reply history (context coverage)
  if (isContextCovered(trimmed)) return false;

  return true;
}

/**
 * 檢查訊息的脈絡是否已被最近的回覆覆蓋。
 * 從 Kuro 的回覆文字（較長、較豐富）中提取 tokens，
 * 看新訊息的 tokens 有多少已出現在回覆中。
 */
function isContextCovered(content: string): boolean {
  if (replyHistory.length === 0) return false;

  const cutoff = Date.now() - HISTORY_TTL;
  const recentReplies = replyHistory.filter(r => r.ts >= cutoff);
  if (recentReplies.length === 0) return false;

  // Join all recent replies as the "coverage pool"
  const coveragePool = recentReplies.map(r => r.text).join('\n').toLowerCase();
  const tokens = extractTokens(content.toLowerCase());
  if (tokens.length === 0) return false;

  let matches = 0;
  for (const token of tokens) {
    if (coveragePool.includes(token)) matches++;
  }

  // High coverage + message is short → context already addressed
  const score = matches / tokens.length;
  return score >= 0.5;
}

// =============================================================================
// Match — 從候選中找最相關的 reply target
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

  // Score each candidate by content relevance to the response
  let best = candidates[candidates.length - 1]; // default: latest
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
 * 提取候選訊息的 tokens，看多少比例出現在回覆文字中。
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
