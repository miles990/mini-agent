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
import { getLogger } from './logging.js';
import { diagLog } from './utils.js';

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
  reply_to_message?: TelegramMessage;
  quote?: { text: string };
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

/** sendMessage 結果 — 攜帶失敗原因 */
interface SendResult {
  ok: boolean;
  /** Telegram API error description（失敗時） */
  error?: string;
  /** HTTP status code（失敗時） */
  status?: number;
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

  async sendMessage(text: string, parseMode: 'Markdown' | 'HTML' | '' = 'Markdown'): Promise<SendResult> {
    try {
      if (!text || !text.trim()) {
        return { ok: false, error: 'empty message', status: 0 };
      }

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
        const errData = await resp.json().catch(() => ({})) as Record<string, unknown>;
        const desc = (errData?.description as string) ?? resp.statusText;

        // Markdown 失敗 → 降級為純文字重試
        if (parseMode === 'Markdown') {
          slog('TELEGRAM', `Markdown failed (${resp.status}): ${desc}, retrying plain`);
          return this.sendMessage(text, '');
        }

        // 訊息太長 → 分段送出
        if (resp.status === 400 && text.length > 4000) {
          slog('TELEGRAM', `Too long (${text.length} chars), splitting`);
          return this.sendLongMessageFallback(text);
        }

        slog('TELEGRAM', `sendMessage failed (${resp.status}): ${desc} [${text.length} chars]`);
        return { ok: false, error: desc, status: resp.status };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      slog('TELEGRAM', `sendMessage error: ${msg}`);
      return { ok: false, error: msg, status: 0 };
    }
  }

  /** Emergency fallback: hard-split by char limit */
  private async sendLongMessageFallback(text: string): Promise<SendResult> {
    const MAX = 4000;
    let lastError: SendResult = { ok: true };
    for (let i = 0; i < text.length; i += MAX) {
      const chunk = text.slice(i, i + MAX);
      const result = await this.sendMessage(chunk, '');
      if (!result.ok) lastError = result;
    }
    return lastError;
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

    // 行為記錄：用戶訊息
    try {
      const logger = getLogger();
      logger.logBehavior('user', 'telegram.message', `${parsed.sender}: ${parsed.text.slice(0, 200)}`);
    } catch { /* logger not ready */ }

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

      const result = await this.sendLongMessage(replyText);
      if (result.ok) {
        slog('TELEGRAM', `→ ${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}`);
        // 行為記錄：agent 回覆
        try {
          const logger = getLogger();
          logger.logBehavior('agent', 'telegram.reply', replyText.slice(0, 200));
        } catch { /* logger not ready */ }
      } else {
        // 送出失敗 — 智能診斷 + 通知用戶
        this.logFailedReply(replyText, result);
        await this.notifyError('send', result, replyText.length);
      }

      // Mark all as processed
      for (const m of messages) {
        this.markInboxProcessed(m.timestamp, m.sender);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.stack ?? err.message : String(err);
      slog('TELEGRAM', `Process error: ${errMsg}`);
      await this.notifyError('process', { ok: false, error: errMsg, status: 0 });
    } finally {
      this.processing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Smart Error Notification — 智能錯誤回報
  // ---------------------------------------------------------------------------

  /**
   * 根據錯誤類型，發送簡潔的診斷訊息給用戶
   */
  private async notifyError(
    phase: 'send' | 'process',
    result: SendResult,
    replyLength?: number,
  ): Promise<void> {
    const diag = this.diagnoseError(phase, result, replyLength);

    // 用最簡單的方式送出（無 Markdown，避免二次失敗）
    const msg = `⚠️ ${diag.title}\n\n原因：${diag.reason}\n${diag.detail}`;
    // 直接呼叫 API，不走 sendMessage 避免遞迴
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: msg }),
      });
    } catch {
      // 連錯誤通知都送不出去，只能 log
      slog('TELEGRAM', `Cannot send error notification: ${msg}`);
    }
  }

  /**
   * 分類 Telegram API 錯誤，產出人類可讀的診斷
   */
  private diagnoseError(
    phase: 'send' | 'process',
    result: SendResult,
    replyLength?: number,
  ): { title: string; reason: string; detail: string } {
    const err = (result.error ?? '').toLowerCase();

    if (phase === 'process') {
      // Claude CLI 處理失敗
      if (err.includes('timeout') || err.includes('timed out')) {
        return {
          title: '回覆生成超時',
          reason: '處理你的訊息花太久了（超過 3 分鐘）',
          detail: '建議：試試更簡短的問題',
        };
      }
      if (err.includes('enoent') || err.includes('not found')) {
        return {
          title: 'Claude CLI 不可用',
          reason: '找不到 claude 指令',
          detail: '需要檢查 Claude Code 是否正確安裝',
        };
      }
      return {
        title: '回覆生成失敗',
        reason: result.error?.slice(0, 200) ?? '未知錯誤',
        detail: '我已經記錄了詳細錯誤，稍後可以查看 log',
      };
    }

    // phase === 'send' — Telegram API 發送失敗
    if (err.includes('message is too long')) {
      return {
        title: '回覆太長，無法送出',
        reason: `回覆有 ${replyLength ?? '?'} 字元，超過 Telegram 限制`,
        detail: '我已經記錄了完整回覆到 log，你可以用 mini-agent logs errors 查看',
      };
    }
    if (err.includes("can't parse entities")) {
      return {
        title: '回覆格式錯誤',
        reason: '回覆包含 Telegram 無法解析的格式標記',
        detail: '我已經記錄了完整回覆到 log',
      };
    }
    if (err.includes('chat not found')) {
      return {
        title: 'Chat ID 錯誤',
        reason: '找不到指定的 chat',
        detail: '請檢查 TELEGRAM_CHAT_ID 設定',
      };
    }
    if (err.includes('bot was blocked')) {
      return {
        title: 'Bot 被封鎖',
        reason: '你把我封鎖了！',
        detail: '請到 Telegram 解除封鎖',
      };
    }
    if (result.status === 429) {
      return {
        title: '發送頻率過高',
        reason: 'Telegram API 速率限制',
        detail: '稍等一下再試',
      };
    }
    if (result.status === 0) {
      return {
        title: '網路連線失敗',
        reason: '無法連線到 Telegram 伺服器',
        detail: '請檢查網路連線',
      };
    }

    return {
      title: '回覆發送失敗',
      reason: `${result.error?.slice(0, 200) ?? '未知錯誤'} (HTTP ${result.status})`,
      detail: `回覆長度：${replyLength ?? '?'} 字元。已記錄到 log`,
    };
  }

  /**
   * 記錄發送失敗的回覆內容到 error log
   */
  private logFailedReply(replyText: string, result: SendResult): void {
    slog('TELEGRAM', `Reply send failed (${result.status}): ${result.error} — reply ${replyText.length} chars`);

    // 寫入 error log 以便事後查看完整回覆
    try {
      const logger = getLogger();
      logger.logError(
        new Error(`Telegram send failed: ${result.error}\n\nFull reply (${replyText.length} chars):\n${replyText.slice(0, 2000)}`),
        'telegram.sendMessage',
      );
    } catch {
      // Logger 不可用時至少 server.log 有記錄
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

    // Reply context — 引用的訊息
    let replyContext = '';
    if (msg.reply_to_message) {
      const reply = msg.reply_to_message;
      const replySender = reply.from?.first_name ?? reply.from?.username ?? 'Unknown';
      // 優先用選擇性引用（quote），否則用被回覆訊息的完整文字
      const quoteText = msg.quote?.text
        ?? reply.text
        ?? reply.caption
        ?? '[media]';
      replyContext = `[Replying to ${replySender}: "${quoteText.slice(0, 500)}"]`;
    }

    const fullText = [replyContext, forwardPrefix, messageText, ...attachments].filter(Boolean).join('\n').trim();

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

  private async sendLongMessage(text: string): Promise<SendResult> {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      return this.sendMessage(text);
    }

    const chunks: string[] = [];
    let current = '';

    for (const para of text.split('\n\n')) {
      // 單段超長 → 強制切割
      if (para.length > MAX_LEN) {
        if (current.trim()) chunks.push(current.trim());
        current = '';
        for (let i = 0; i < para.length; i += MAX_LEN) {
          chunks.push(para.slice(i, i + MAX_LEN));
        }
        continue;
      }

      if ((current + '\n\n' + para).length > MAX_LEN) {
        if (current.trim()) chunks.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    let lastError: SendResult = { ok: true };
    for (const chunk of chunks) {
      const result = await this.sendMessage(chunk);
      if (!result.ok) lastError = result;
    }
    return lastError;
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
