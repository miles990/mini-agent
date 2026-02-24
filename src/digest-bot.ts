/**
 * AI Research Digest Bot — Telegram Bot Module
 *
 * Independent Telegram bot for delivering daily AI paper digests.
 * Shares mini-agent infra but runs its own polling loop.
 *
 * Commands:
 *   /start       — Subscribe to daily digest
 *   /topics      — Choose topics (future)
 *   /digest      — Trigger manual digest now
 *   /unsubscribe — Stop receiving digests
 *
 * Env: DIGEST_BOT_TOKEN
 * Storage: ~/.mini-agent/digest-subscribers.json
 */

import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { slog } from './utils.js';
import { runDailyDigest, formatDigest } from './digest-pipeline.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

interface Subscriber {
  chatId: number;
  username?: string;
  subscribedAt: string;
  topics?: string[];
  lang?: 'en' | 'zh';
}

interface SubscriberStore {
  subscribers: Subscriber[];
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string; username?: string };
    text?: string;
    from?: { id: number; username?: string; first_name?: string; language_code?: string };
    date: number;
  };
}

// =============================================================================
// DigestBot
// =============================================================================

export class DigestBot {
  private token: string;
  private running = false;
  private offset = 0;
  private readonly pollTimeout = 30;
  private retryDelay = 5000;
  private subscriberFile: string;
  private offsetFile: string;
  private digestRunning = false;
  private cronJob: cron.ScheduledTask | null = null;
  private abortController: AbortController | null = null;

  constructor(token: string) {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    this.token = token;
    this.subscriberFile = path.join(instanceDir, 'digest-subscribers.json');
    this.offsetFile = path.join(instanceDir, '.digest-bot-offset');
    this.loadOffset();
    this.ensureSubscriberFile();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.retryDelay = 5000;

    try {
      await fetch(`https://api.telegram.org/bot${this.token}/deleteWebhook`, { method: 'POST' });
    } catch { /* best-effort */ }

    // Schedule daily broadcast at 8am (Asia/Taipei)
    this.cronJob = cron.schedule('0 8 * * *', () => {
      slog('DIGEST-BOT', 'Daily broadcast triggered by cron');
      this.broadcastDigest().catch(err =>
        slog('DIGEST-BOT', `Cron broadcast error: ${err instanceof Error ? err.message : err}`),
      );
    }, { timezone: 'Asia/Taipei' });

    slog('DIGEST-BOT', 'Poller started (daily broadcast: 8am Asia/Taipei)');
    this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    slog('DIGEST-BOT', 'Poller stopped');
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
        this.saveOffset();
        this.retryDelay = 5000;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('409')) {
          slog('DIGEST-BOT', '409 Conflict — waiting 10s');
          await sleep(10000);
          continue;
        }
        slog('DIGEST-BOT', `Poll error: ${msg}`);
        await sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    this.abortController = new AbortController();
    const timeout = AbortSignal.timeout((this.pollTimeout + 5) * 1000);
    const resp = await fetch(
      `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=${this.pollTimeout}&allowed_updates=["message"]`,
      { signal: AbortSignal.any([this.abortController.signal, timeout]) },
    );
    if (!resp.ok) throw new Error(`getUpdates: ${resp.status}`);
    const data = await resp.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) throw new Error('getUpdates ok=false');
    return data.result;
  }

  // ---------------------------------------------------------------------------
  // Command Handler
  // ---------------------------------------------------------------------------

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const username = msg.from?.username ?? msg.chat.first_name ?? 'unknown';

    if (text === '/start') {
      await this.handleStart(chatId, username, msg.from?.language_code);
    } else if (text === '/topics') {
      await this.handleTopics(chatId);
    } else if (text === '/digest') {
      await this.handleManualDigest(chatId);
    } else if (text === '/unsubscribe') {
      await this.handleUnsubscribe(chatId);
    } else if (text === '/lang') {
      await this.handleLang(chatId);
    } else if (text === '/help') {
      const lang = this.getUserLang(chatId);
      const helpText = lang === 'zh'
        ? '🔬 *AI 研究摘要 Bot*\n\n' +
          '/start — 訂閱每日 AI 論文摘要\n' +
          '/digest — 立即取得今天的摘要\n' +
          '/lang — 切換語言（EN ↔ 中文）\n' +
          '/unsubscribe — 取消訂閱\n' +
          '/help — 顯示說明'
        : '🔬 *AI Research Digest Bot*\n\n' +
          '/start — Subscribe to daily AI paper digest\n' +
          '/digest — Get today\'s digest now\n' +
          '/lang — Switch language (EN ↔ 中文)\n' +
          '/unsubscribe — Stop receiving digests\n' +
          '/help — Show this help';
      await this.sendMessage(chatId, helpText);
    }
  }

  private async handleStart(chatId: number, username: string, languageCode?: string): Promise<void> {
    const store = this.loadSubscribers();
    const existing = store.subscribers.find(s => s.chatId === chatId);

    if (existing) {
      const lang = existing.lang ?? 'en';
      const msg = lang === 'zh'
        ? '✅ 你已經訂閱了！每天早上 8 點會收到 AI 論文摘要。'
        : '✅ You\'re already subscribed! You\'ll receive daily AI paper digests at 8am.';
      await this.sendMessage(chatId, msg);
      return;
    }

    const lang: 'en' | 'zh' = languageCode?.startsWith('zh') ? 'zh' : 'en';

    store.subscribers.push({
      chatId,
      username,
      subscribedAt: new Date().toISOString(),
      lang,
    });
    this.saveSubscribers(store);

    slog('DIGEST-BOT', `New subscriber: ${username} (${chatId}), lang: ${lang}, total: ${store.subscribers.length}`);

    const msg = lang === 'zh'
      ? '🎉 *已訂閱 AI 研究摘要！*\n\n' +
        '每天早上 8 點會收到 5 篇最重要 AI 論文的摘要。\n\n' +
        '使用 /digest 立即取得今天的摘要。\n' +
        '使用 /lang 切換語言。'
      : '🎉 *Subscribed to AI Research Digest!*\n\n' +
        'You\'ll receive a daily summary of the top 5 AI papers at 8am.\n\n' +
        'Use /digest to get today\'s digest right now.\n' +
        'Use /lang to switch language.';
    await this.sendMessage(chatId, msg);
  }

  private async handleTopics(chatId: number): Promise<void> {
    const lang = this.getUserLang(chatId);
    const msg = lang === 'zh'
      ? '📚 *主題篩選即將推出！*\n\n' +
        '目前涵蓋：cs.AI、cs.LG、cs.CL\n' +
        '主題自訂功能將在未來更新中提供。'
      : '📚 *Topic filtering coming soon!*\n\n' +
        'Currently covering: cs.AI, cs.LG, cs.CL\n' +
        'Topic customization will be available in a future update.';
    await this.sendMessage(chatId, msg);
  }

  private async handleManualDigest(chatId: number): Promise<void> {
    const lang = this.getUserLang(chatId);

    if (this.digestRunning) {
      await this.sendMessage(chatId, lang === 'zh' ? '⏳ 摘要正在產生中，請稍候...' : '⏳ A digest is already being generated. Please wait...');
      return;
    }

    this.digestRunning = true;
    await this.sendMessage(chatId, lang === 'zh' ? '🔄 正在產生今天的摘要...（大約需要 30 秒）' : '🔄 Generating today\'s digest... (this takes ~30 seconds)');

    try {
      const digest = await runDailyDigest(lang);
      if (digest.papers.length === 0) {
        await this.sendMessage(chatId, lang === 'zh' ? '😅 目前沒有可用的論文，請稍後再試。' : '😅 No papers available right now. Try again later.');
        return;
      }

      const formatted = formatDigest(digest, lang);
      await this.sendLongMessage(chatId, formatted);
    } catch (err) {
      slog('DIGEST-BOT', `Manual digest failed: ${err instanceof Error ? err.message : err}`);
      await this.sendMessage(chatId, lang === 'zh' ? '❌ 摘要產生失敗，請稍後再試。' : '❌ Failed to generate digest. Please try again later.');
    } finally {
      this.digestRunning = false;
    }
  }

  private async handleUnsubscribe(chatId: number): Promise<void> {
    const lang = this.getUserLang(chatId);
    const store = this.loadSubscribers();
    const before = store.subscribers.length;
    store.subscribers = store.subscribers.filter(s => s.chatId !== chatId);

    if (store.subscribers.length === before) {
      await this.sendMessage(chatId, lang === 'zh' ? '你尚未訂閱。' : 'You\'re not subscribed.');
      return;
    }

    this.saveSubscribers(store);
    slog('DIGEST-BOT', `Unsubscribed: ${chatId}, remaining: ${store.subscribers.length}`);
    const msg = lang === 'zh'
      ? '👋 已取消訂閱。你不會再收到每日摘要了。\n使用 /start 可以隨時重新訂閱。'
      : '👋 Unsubscribed. You won\'t receive daily digests anymore.\nUse /start to re-subscribe anytime.';
    await this.sendMessage(chatId, msg);
  }

  private async handleLang(chatId: number): Promise<void> {
    const store = this.loadSubscribers();
    const sub = store.subscribers.find(s => s.chatId === chatId);

    if (!sub) {
      await this.sendMessage(chatId, 'Please /start first.\n請先 /start 訂閱。');
      return;
    }

    const newLang: 'en' | 'zh' = (sub.lang ?? 'en') === 'en' ? 'zh' : 'en';
    sub.lang = newLang;
    this.saveSubscribers(store);

    slog('DIGEST-BOT', `Language switched: ${chatId} → ${newLang}`);

    const msg = newLang === 'zh'
      ? '🌐 語言已切換為 *中文*。\n你的摘要將以繁體中文顯示。'
      : '🌐 Language switched to *English*.\nYour digests will be in English.';
    await this.sendMessage(chatId, msg);
  }

  private getUserLang(chatId: number): 'en' | 'zh' {
    const store = this.loadSubscribers();
    const sub = store.subscribers.find(s => s.chatId === chatId);
    return sub?.lang ?? 'en';
  }

  // ---------------------------------------------------------------------------
  // Daily Broadcast (called by cron)
  // ---------------------------------------------------------------------------

  /** Send digest to all subscribers — called by cron job */
  async broadcastDigest(): Promise<{ sent: number; failed: number }> {
    if (this.digestRunning) {
      slog('DIGEST-BOT', 'Broadcast skipped — digest already running');
      return { sent: 0, failed: 0 };
    }

    this.digestRunning = true;
    let sent = 0;
    let failed = 0;

    try {
      const store = this.loadSubscribers();
      if (store.subscribers.length === 0) {
        slog('DIGEST-BOT', 'Broadcast skipped — no subscribers');
        return { sent: 0, failed: 0 };
      }

      // Group subscribers by language
      const byLang = new Map<'en' | 'zh', Subscriber[]>();
      for (const sub of store.subscribers) {
        const lang = sub.lang ?? 'en';
        if (!byLang.has(lang)) byLang.set(lang, []);
        byLang.get(lang)!.push(sub);
      }

      for (const [lang, subs] of byLang) {
        const digest = await runDailyDigest(lang);
        if (digest.papers.length === 0) {
          slog('DIGEST-BOT', `Broadcast skipped for ${lang} — no papers`);
          continue;
        }

        const formatted = formatDigest(digest, lang);
        for (const sub of subs) {
          try {
            await this.sendLongMessage(sub.chatId, formatted);
            sent++;
          } catch (err) {
            slog('DIGEST-BOT', `Failed to send to ${sub.chatId}: ${err instanceof Error ? err.message : err}`);
            failed++;
          }
          await sleep(100);
        }
      }

      slog('DIGEST-BOT', `Broadcast complete: ${sent} sent, ${failed} failed`);
    } catch (err) {
      slog('DIGEST-BOT', `Broadcast error: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.digestRunning = false;
    }

    return { sent, failed };
  }

  // ---------------------------------------------------------------------------
  // Telegram API
  // ---------------------------------------------------------------------------

  private async sendMessage(chatId: number, text: string, parseMode: 'Markdown' | '' = 'Markdown'): Promise<boolean> {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode || undefined,
          disable_web_page_preview: true,
        }),
      });

      if (!resp.ok) {
        // Retry without Markdown on parse error
        if (parseMode === 'Markdown') {
          return this.sendMessage(chatId, text, '');
        }
        slog('DIGEST-BOT', `sendMessage failed: ${resp.status}`);
        return false;
      }
      return true;
    } catch (err) {
      slog('DIGEST-BOT', `sendMessage error: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Split long messages into Telegram-safe chunks (~4000 chars) */
  private async sendLongMessage(chatId: number, text: string): Promise<void> {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      await this.sendMessage(chatId, text);
      return;
    }

    // Split by --- dividers (paper boundaries)
    const parts = text.split('\n\n---\n\n');
    let current = '';

    for (const part of parts) {
      if (current.length + part.length + 7 > MAX_LEN) {
        if (current) await this.sendMessage(chatId, current.trim());
        current = part;
      } else {
        current += (current ? '\n\n---\n\n' : '') + part;
      }
    }
    if (current.trim()) await this.sendMessage(chatId, current.trim());
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  private loadSubscribers(): SubscriberStore {
    try {
      if (fs.existsSync(this.subscriberFile)) {
        return JSON.parse(fs.readFileSync(this.subscriberFile, 'utf-8')) as SubscriberStore;
      }
    } catch { /* corrupted file */ }
    return { subscribers: [] };
  }

  private saveSubscribers(store: SubscriberStore): void {
    fs.writeFileSync(this.subscriberFile, JSON.stringify(store, null, 2), 'utf-8');
  }

  private ensureSubscriberFile(): void {
    if (!fs.existsSync(this.subscriberFile)) {
      this.saveSubscribers({ subscribers: [] });
    }
  }

  private loadOffset(): void {
    try {
      if (fs.existsSync(this.offsetFile)) {
        this.offset = parseInt(fs.readFileSync(this.offsetFile, 'utf-8').trim(), 10) || 0;
      }
    } catch { /* start from 0 */ }
  }

  private saveOffset(): void {
    try {
      fs.writeFileSync(this.offsetFile, String(this.offset), 'utf-8');
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getSubscriberCount(): number {
    return this.loadSubscribers().subscribers.length;
  }

  isRunning(): boolean {
    return this.running;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: DigestBot | null = null;

export function createDigestBot(): DigestBot | null {
  const token = process.env.DIGEST_BOT_TOKEN;
  if (!token) {
    slog('DIGEST-BOT', 'DIGEST_BOT_TOKEN not set, bot disabled');
    return null;
  }
  instance = new DigestBot(token);
  return instance;
}

export function getDigestBot(): DigestBot | null {
  return instance;
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
