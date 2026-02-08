/**
 * TelegramPoller — 接收 Telegram 訊息的長輪詢系統
 *
 * 使用 Telegram Bot API getUpdates 長輪詢，零新依賴（Node 內建 fetch）
 *
 * 智能回覆策略：
 * - 收到訊息後不立即回覆，等待 3 秒看有沒有後續訊息
 * - 多條訊息累積後一次處理、一次回覆（像人類對話一樣自然）
 * - 訊息同時寫入 inbox → OODA 循環透過 perception 可見
 */

import fs from 'node:fs';
import path from 'node:path';
import { processMessage } from './agent.js';
import { slog } from './api.js';

// =============================================================================
// Types
// =============================================================================

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  caption?: string;
  forward_from?: TelegramUser;
  forward_from_chat?: { id: number; title: string };
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** Parsed message ready for buffering */
interface ParsedMessage {
  sender: string;
  timestamp: string;
  text: string;
  attachments: string[];
}

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
  private inboxFile: string;
  private abortController: AbortController | null = null;

  // Smart batching: accumulate messages, flush after quiet period
  private messageBuffer: ParsedMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchWaitMs = 3000; // Wait 3s for more messages before processing
  private processing = false; // Lock to prevent concurrent processMessage calls

  constructor(token: string, chatId: string, memoryDir: string) {
    this.token = token;
    this.chatId = chatId;
    this.memoryDir = memoryDir;
    this.offsetFile = path.join(memoryDir, '.telegram-offset');
    this.inboxFile = path.join(memoryDir, '.telegram-inbox.md');
    this.loadOffset();
    this.ensureInboxFile();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.retryDelay = 5000;
    slog('TELEGRAM', `Poller started (chatId: ${this.chatId})`);
    this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    slog('TELEGRAM', 'Poller stopped');
  }

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  private async setReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${this.token}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: 'emoji', emoji }],
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
        slog('TELEGRAM', `Reaction failed (${resp.status}): ${data?.description ?? resp.statusText}`);
      } else {
        slog('TELEGRAM', `${emoji} msg#${messageId}`);
      }
    } catch (err) {
      slog('TELEGRAM', `Reaction error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Send message (public — also used by loop.ts)
  // ---------------------------------------------------------------------------

  async sendMessage(text: string, parseMode: 'Markdown' | 'HTML' | '' = 'Markdown'): Promise<boolean> {
    try {
      const body: Record<string, string> = {
        chat_id: this.chatId,
        text,
      };
      if (parseMode) body.parse_mode = parseMode;

      const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        if (parseMode === 'Markdown') {
          return this.sendMessage(text, '');
        }
        slog('TELEGRAM', `sendMessage failed: ${resp.status} ${resp.statusText}`);
        return false;
      }
      return true;
    } catch (err) {
      slog('TELEGRAM', `sendMessage error: ${err instanceof Error ? err.message : err}`);
      return false;
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

        slog('TELEGRAM', `Poll error: ${err instanceof Error ? err.message : err}`);
        await this.sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
        continue;
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
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
  // Message Handling — Smart Batching
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;

    // Security: only accept messages from configured chat
    if (String(msg.chat.id) !== this.chatId) {
      slog('TELEGRAM', `Ignored message from unauthorized chat: ${msg.chat.id}`);
      return;
    }

    // React with 👀 to acknowledge we've seen the message
    await this.setReaction(String(msg.chat.id), msg.message_id, '👀');

    const parsed = await this.parseMessage(msg);
    if (!parsed) return;

    slog('TELEGRAM', `← ${parsed.sender}: ${parsed.text.slice(0, 100)}${parsed.text.length > 100 ? '...' : ''}`);

    // Write to inbox immediately
    this.writeInbox(parsed.timestamp, parsed.sender, parsed.text, 'pending');

    // Add to buffer and schedule flush
    this.messageBuffer.push(parsed);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    // Reset timer — wait for more messages
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => this.flushBuffer(), this.batchWaitMs);
  }

  private async flushBuffer(): Promise<void> {
    this.flushTimer = null;
    if (this.messageBuffer.length === 0) return;

    // Prevent concurrent processing
    if (this.processing) {
      // Re-schedule: there are messages waiting but we're busy
      this.scheduleFlush();
      return;
    }

    this.processing = true;
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    try {
      // Combine messages into one prompt
      let combined: string;
      if (messages.length === 1) {
        combined = messages[0].text;
      } else {
        // Multiple messages → combine with context
        combined = messages.map(m => m.text).join('\n\n');
        slog('TELEGRAM', `Batched ${messages.length} messages`);
      }

      const response = await processMessage(combined);
      const replyText = response.content;

      await this.sendLongMessage(replyText);
      slog('TELEGRAM', `→ ${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}`);

      // Mark all as processed
      for (const m of messages) {
        this.markInboxProcessed(m.timestamp, m.sender);
      }
    } catch (err) {
      slog('TELEGRAM', `Process error: ${err instanceof Error ? err.message : err}`);
      await this.sendMessage('抱歉，處理訊息時發生錯誤。');
    } finally {
      this.processing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Parse Telegram Message → ParsedMessage
  // ---------------------------------------------------------------------------

  private async parseMessage(msg: TelegramMessage): Promise<ParsedMessage | null> {
    const sender = msg.from?.first_name ?? msg.from?.username ?? 'Unknown';
    const timestamp = new Date(msg.date * 1000).toISOString();

    let messageText = '';
    const attachments: string[] = [];

    if (msg.text) messageText = msg.text;
    if (msg.caption) messageText = msg.caption;

    // Extract URLs
    const urls = this.extractUrls(msg);
    if (urls.length > 0) {
      messageText += '\n\nURLs:\n' + urls.map(u => `- ${u}`).join('\n');
    }

    // Photo
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      const filePath = await this.downloadFile(largest.file_id, `photo_${msg.message_id}.jpg`);
      if (filePath) attachments.push(`[Photo: ${filePath}]`);
    }

    // Document
    if (msg.document) {
      const fileName = msg.document.file_name ?? `doc_${msg.message_id}`;
      const filePath = await this.downloadFile(msg.document.file_id, fileName);
      if (filePath) attachments.push(`[File: ${filePath}]`);
    }

    // Voice
    if (msg.voice) {
      const filePath = await this.downloadFile(msg.voice.file_id, `voice_${msg.message_id}.ogg`);
      if (filePath) attachments.push(`[Voice: ${filePath}]`);
    }

    // Forward info
    let forwardPrefix = '';
    if (msg.forward_from) {
      forwardPrefix = `[Forwarded from ${msg.forward_from.first_name}] `;
    } else if (msg.forward_from_chat) {
      forwardPrefix = `[Forwarded from ${msg.forward_from_chat.title}] `;
    }

    const fullText = [forwardPrefix, messageText, ...attachments].filter(Boolean).join('\n').trim();

    if (!fullText) {
      slog('TELEGRAM', `Empty message from ${sender}, skipping`);
      return null;
    }

    return { sender, timestamp, text: fullText, attachments };
  }

  private extractUrls(msg: TelegramMessage): string[] {
    const urls: string[] = [];
    if (!msg.entities || !msg.text) return urls;

    for (const entity of msg.entities) {
      if (entity.type === 'url') {
        urls.push(msg.text.substring(entity.offset, entity.offset + entity.length));
      } else if (entity.type === 'text_link' && entity.url) {
        urls.push(entity.url);
      }
    }
    return urls;
  }

  // ---------------------------------------------------------------------------
  // File Download
  // ---------------------------------------------------------------------------

  private async downloadFile(fileId: string, fileName: string): Promise<string | null> {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`);
      if (!resp.ok) return null;

      const data = await resp.json() as { ok: boolean; result: TelegramFile };
      if (!data.ok || !data.result.file_path) return null;

      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${data.result.file_path}`;
      const fileResp = await fetch(fileUrl);
      if (!fileResp.ok) return null;

      const mediaDir = path.join(this.memoryDir, 'media');
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const savePath = path.join(mediaDir, fileName);
      const buffer = Buffer.from(await fileResp.arrayBuffer());
      fs.writeFileSync(savePath, buffer);

      return `media/${fileName}`;
    } catch (err) {
      slog('TELEGRAM', `Download failed for ${fileName}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Inbox File (File=Truth)
  // ---------------------------------------------------------------------------

  private ensureInboxFile(): void {
    if (!fs.existsSync(this.inboxFile)) {
      fs.writeFileSync(this.inboxFile, '## Pending\n\n## Processed\n', 'utf-8');
    }
  }

  private writeInbox(timestamp: string, sender: string, message: string, _status: 'pending' | 'processed'): void {
    try {
      const content = fs.readFileSync(this.inboxFile, 'utf-8');
      const oneLiner = message.replace(/\n/g, ' ').slice(0, 200);
      const entry = `- [${timestamp}] ${sender}: ${oneLiner}`;
      const updated = content.replace('## Pending\n', `## Pending\n${entry}\n`);
      fs.writeFileSync(this.inboxFile, updated, 'utf-8');
    } catch {
      // Non-critical
    }
  }

  private markInboxProcessed(timestamp: string, sender: string): void {
    try {
      const content = fs.readFileSync(this.inboxFile, 'utf-8');
      const tsPrefix = `- [${timestamp}] ${sender}:`;

      const lines = content.split('\n');
      const pendingIdx = lines.findIndex(l => l === '## Pending');
      const processedIdx = lines.findIndex(l => l === '## Processed');
      if (pendingIdx === -1 || processedIdx === -1) return;

      let entryLine = '';
      const newLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (i > pendingIdx && i < processedIdx && lines[i].startsWith(tsPrefix)) {
          entryLine = lines[i] + ' → replied';
          continue;
        }
        newLines.push(lines[i]);
      }

      if (entryLine) {
        const newProcessedIdx = newLines.findIndex(l => l === '## Processed');
        if (newProcessedIdx !== -1) {
          newLines.splice(newProcessedIdx + 1, 0, entryLine);
        }
      }

      fs.writeFileSync(this.inboxFile, newLines.join('\n'), 'utf-8');
      this.trimInbox();
    } catch {
      // Non-critical
    }
  }

  private trimInbox(): void {
    try {
      const content = fs.readFileSync(this.inboxFile, 'utf-8');
      const marker = '## Processed\n';
      const processedIdx = content.indexOf(marker);
      if (processedIdx === -1) return;

      const beforeProcessed = content.substring(0, processedIdx + marker.length);
      const processedLines = content.substring(processedIdx + marker.length)
        .split('\n')
        .filter(l => l.startsWith('- ['));

      if (processedLines.length > 50) {
        const trimmed = processedLines.slice(0, 50);
        fs.writeFileSync(this.inboxFile, beforeProcessed + trimmed.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // Non-critical
    }
  }

  // ---------------------------------------------------------------------------
  // Send long message (split at 4096 char Telegram limit)
  // ---------------------------------------------------------------------------

  private async sendLongMessage(text: string): Promise<void> {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      await this.sendMessage(text);
      return;
    }

    const chunks: string[] = [];
    let current = '';

    for (const para of text.split('\n\n')) {
      if ((current + '\n\n' + para).length > MAX_LEN) {
        if (current) chunks.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    for (const chunk of chunks) {
      await this.sendMessage(chunk);
    }
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

export function createTelegramPoller(memoryDir: string): TelegramPoller | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    slog('TELEGRAM', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, poller disabled');
    return null;
  }

  pollerInstance = new TelegramPoller(token, chatId, memoryDir);
  return pollerInstance;
}
