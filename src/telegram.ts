/**
 * TelegramPoller — Minimal version for experiment/minimal-core
 *
 * Simplified to ~250-300 lines, keeping only core functionality:
 * - Long-poll lifecycle (start/stop)
 * - Send text messages (Markdown with plain text fallback)
 * - Process incoming messages via callback
 * - Offset persistence
 * - Basic message parsing
 */

import fs from 'node:fs';
import path from 'node:path';
import { behaviorLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { first_name: string; username?: string };
    chat: { id: number };
    date: number;
    text?: string;
    caption?: string;
    forward_from?: { first_name: string };
    forward_from_chat?: { title: string };
    reply_to_message?: { from?: { first_name: string }; text?: string };
    quote?: { text: string };
  };
}

interface SendResult {
  ok: boolean;
  error?: string;
  status?: number;
}

type NotificationTier = 'signal' | 'summary' | 'heartbeat';

// =============================================================================
// TelegramPoller
// =============================================================================

export class TelegramPoller {
  private token: string;
  private chatId: string;
  private running = false;
  private offset = 0;
  private retryDelay = 5000;
  private readonly maxRetryDelay = 60000;
  private readonly pollTimeout = 30;
  private memoryDir: string;
  private offsetFile: string;
  private abortController: AbortController | null = null;
  private onMessage: (text: string) => Promise<string>;

  constructor(
    token: string,
    chatId: string,
    memoryDir: string,
    onMessage: (text: string) => Promise<string>,
  ) {
    this.token = token;
    this.chatId = chatId;
    this.memoryDir = memoryDir;
    this.offsetFile = path.join(memoryDir, '.telegram-offset');
    this.onMessage = onMessage;
    this.loadOffset();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.retryDelay = 5000;
    console.log(`[TELEGRAM] Poller started (chatId: ${this.chatId})`);
    this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[TELEGRAM] Poller stopped');
  }

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  async sendMessage(text: string, parseMode: 'Markdown' | '' = 'Markdown'): Promise<SendResult> {
    try {
      if (!text || !text.trim()) {
        return { ok: false, error: 'empty message', status: 0 };
      }

      // Truncate if too long
      const MAX_LEN = 4000;
      let finalText = text;
      if (text.length > MAX_LEN) {
        finalText = text.slice(0, MAX_LEN - 3) + '...';
        console.log(`[TELEGRAM] Truncated message from ${text.length} to ${finalText.length} chars`);
      }

      const body: Record<string, string | boolean> = {
        chat_id: this.chatId,
        text: finalText,
        disable_web_page_preview: true,
      };
      if (parseMode) body.parse_mode = parseMode;

      console.log(`[TG-OUT] sendMessage [${finalText.length}ch]: ${finalText.slice(0, 80).replace(/\n/g, '\\n')}`);

      const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({})) as Record<string, unknown>;
        const desc = (errData?.description as string) ?? resp.statusText;

        // Markdown failed → retry as plain text
        if (parseMode === 'Markdown') {
          console.log(`[TELEGRAM] Markdown failed (${resp.status}): ${desc}, retrying plain`);
          return this.sendMessage(finalText, '');
        }

        console.log(`[TELEGRAM] sendMessage failed (${resp.status}): ${desc}`);
        return { ok: false, error: desc, status: resp.status };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[TELEGRAM] sendMessage error: ${msg}`);
      return { ok: false, error: msg, status: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Poll Loop
  // ---------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();

        if (updates.length > 0) {
          this.retryDelay = 5000;
          for (const update of updates) {
            await this.handleUpdate(update);
            this.offset = update.update_id + 1;
            this.saveOffset();
          }
        }
      } catch (err) {
        if (!this.running) break;

        console.log(`[TELEGRAM] Poll error: ${err instanceof Error ? err.message : err}`);
        await this.sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
        continue;
      }
    }
  }

  async getUpdates(): Promise<TelegramUpdate[]> {
    this.abortController = new AbortController();

    const resp = await fetch(
      `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=${this.pollTimeout}&allowed_updates=["message"]`,
      { signal: this.abortController.signal },
    );

    if (!resp.ok) {
      throw new Error(`getUpdates failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) {
      throw new Error('getUpdates returned ok=false');
    }

    return data.result;
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;

    // Security: only accept messages from configured chat
    if (String(msg.chat.id) !== this.chatId) {
      console.log(`[TELEGRAM] Ignored message from unauthorized chat: ${msg.chat.id}`);
      return;
    }

    const parsed = this.parseMessage(msg);
    if (!parsed) return;

    console.log(`[TELEGRAM] ← ${parsed.sender}: ${parsed.text.slice(0, 100)}${parsed.text.length > 100 ? '...' : ''}`);
    behaviorLog('telegram.message', `from:${parsed.sender} | ${parsed.text.slice(0, 100)}`);

    try {
      // Call the callback to get response
      const response = await this.onMessage(parsed.text);

      // Send response
      if (response && response.trim()) {
        const result = await this.sendMessage(response);
        if (result.ok) {
          console.log(`[TELEGRAM] → ${response.slice(0, 100)}${response.length > 100 ? '...' : ''}`);
        } else {
          console.log(`[TELEGRAM] Failed to send response: ${result.error}`);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[TELEGRAM] Process error: ${errMsg}`);
      // Send error notification to user
      await this.sendMessage(`⚠️ Error processing your message: ${errMsg}`, '');
    }
  }

  // ---------------------------------------------------------------------------
  // Parse Message
  // ---------------------------------------------------------------------------

  private parseMessage(msg: TelegramUpdate['message']): { sender: string; text: string } | null {
    if (!msg) return null;

    const sender = msg.from?.first_name ?? msg.from?.username ?? 'Unknown';

    let messageText = '';
    if (msg.text) messageText = msg.text;
    if (msg.caption) messageText = msg.caption;

    // Forward info
    let forwardPrefix = '';
    if (msg.forward_from) {
      forwardPrefix = `[Forwarded from ${msg.forward_from.first_name}] `;
    } else if (msg.forward_from_chat) {
      forwardPrefix = `[Forwarded from ${msg.forward_from_chat.title}] `;
    }

    // Reply context
    let replyContext = '';
    if (msg.reply_to_message) {
      const reply = msg.reply_to_message;
      const replySender = reply.from?.first_name ?? 'Unknown';
      const quoteText = msg.quote?.text ?? reply.text ?? '[media]';
      replyContext = `[Replying to ${replySender}: "${quoteText.slice(0, 200)}"] `;
    }

    const fullText = `${replyContext}${forwardPrefix}${messageText}`.trim();

    if (!fullText) {
      console.log(`[TELEGRAM] Empty message from ${sender}, skipping`);
      return null;
    }

    return { sender, text: fullText };
  }

  // ---------------------------------------------------------------------------
  // Offset Persistence
  // ---------------------------------------------------------------------------

  private loadOffset(): void {
    try {
      if (fs.existsSync(this.offsetFile)) {
        const data = fs.readFileSync(this.offsetFile, 'utf-8').trim();
        const parsed = parseInt(data, 10);
        if (!isNaN(parsed)) this.offset = parsed;
      }
    } catch {
      // Start from 0
    }
  }

  private saveOffset(): void {
    try {
      fs.writeFileSync(this.offsetFile, String(this.offset), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton
// =============================================================================

let pollerInstance: TelegramPoller | null = null;

export function getTelegramPoller(): TelegramPoller | null {
  return pollerInstance;
}

export function createTelegramPoller(
  memoryDir: string,
  onMessage: (text: string) => Promise<string>,
): TelegramPoller | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[TELEGRAM] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, poller disabled');
    return null;
  }

  pollerInstance = new TelegramPoller(token, chatId, memoryDir, onMessage);
  return pollerInstance;
}

// =============================================================================
// Notification Helpers
// =============================================================================

let notifSent = 0;
let notifFailed = 0;

export function getNotificationStats(): { sent: number; failed: number } {
  return { sent: notifSent, failed: notifFailed };
}

/**
 * Reliable Telegram notification with retry
 */
export async function notifyTelegram(message: string): Promise<boolean> {
  const poller = pollerInstance;
  if (!poller || !message.trim()) return false;

  const result = await poller.sendMessage(message);
  if (result.ok) {
    notifSent++;
    return true;
  }

  // Retry once as plain text
  await new Promise(r => setTimeout(r, 1000));
  const retry = await poller.sendMessage(message, '');
  if (retry.ok) {
    notifSent++;
    return true;
  }

  console.log(`[TELEGRAM] Notification failed: ${retry.error}`);
  notifFailed++;
  return false;
}

// =============================================================================
// Summary Buffer
// =============================================================================

const summaryBuffer: string[] = [];

/**
 * Flush summary buffer into a digest message. Returns null if empty.
 */
export function flushSummary(): string | null {
  if (summaryBuffer.length === 0) return null;
  const digest = `📋 最近動態（${summaryBuffer.length} 項）：\n\n${summaryBuffer.join('\n')}`;
  summaryBuffer.length = 0;
  return digest;
}

/**
 * Tiered notification
 */
export async function notify(message: string, tier: NotificationTier): Promise<boolean> {
  switch (tier) {
    case 'signal':
      return notifyTelegram(message);
    case 'summary': {
      const time = new Date().toLocaleTimeString('en', { hour12: false });
      summaryBuffer.push(`${time} ${message}`);
      behaviorLog('notify.summary', message.slice(0, 100));
      return true;
    }
    case 'heartbeat':
      behaviorLog('notify.heartbeat', message.slice(0, 100));
      return true;
  }
}
