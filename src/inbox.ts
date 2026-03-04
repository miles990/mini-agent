/**
 * Unified Inbox — 統一收件匣
 *
 * 所有訊息來源（Telegram、Chat Room、Claude Code、GitHub、Handoff）
 * 統一寫入 JSONL，規則化優先度分配，零 LLM 成本。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { slog } from './utils.js';
import type { InboxItem } from './types.js';

// =============================================================================
// Path
// =============================================================================

function getInboxPath(): string {
  const instanceId = getCurrentInstanceId();
  return path.join(getInstanceDir(instanceId), 'inbox.jsonl');
}

// =============================================================================
// InboxCache — 記憶體快取層
// =============================================================================

class InboxCache {
  private items: InboxItem[] = [];
  private pendingItems: InboxItem[] = [];
  private _version = 0;
  private _dirty = true;
  private pendingMarks = new Map<string, 'seen' | 'replied'>();

  get version(): number { return this._version; }

  invalidate(): void { this._dirty = true; }

  /** Write-through: writeInboxItem 後同步更新 */
  pushItem(item: InboxItem): void {
    this.items.push(item);
    if (item.status === 'pending') {
      this.pendingItems.push(item);
      this.pendingItems.sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.ts.localeCompare(b.ts));
    }
    this._version++;
  }

  /** 讀取 pending — dirty 時重讀磁碟，否則回傳快取 */
  getPending(): InboxItem[] {
    if (this._dirty) this.reload();
    return this.pendingItems;
  }

  /** 讀取全部（mark/expiry 用） */
  getAll(): InboxItem[] {
    if (this._dirty) this.reload();
    return this.items;
  }

  /** Batch mark 後更新記憶體狀態 */
  applyMarks(ids: Set<string>, status: 'seen' | 'replied'): void {
    for (const item of this.items) {
      if (ids.has(item.id)) item.status = status;
    }
    this.rebuildPending();
    this._version++;
  }

  /** Queue a mark for batch flush */
  queueMark(id: string, status: 'seen' | 'replied'): void {
    const existing = this.pendingMarks.get(id);
    if (existing === 'replied') return; // 不降級
    this.pendingMarks.set(id, status);
  }

  /** Flush all queued marks in a single disk write */
  flushMarks(): void {
    if (this.pendingMarks.size === 0) return;
    try {
      const inboxPath = getInboxPath();
      if (!fs.existsSync(inboxPath)) { this.pendingMarks.clear(); return; }
      const idMap = this.pendingMarks;
      const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
      const updated = lines.map(line => {
        try {
          const item = JSON.parse(line) as InboxItem;
          const newStatus = idMap.get(item.id);
          if (newStatus) { item.status = newStatus; return JSON.stringify(item); }
        } catch { /* keep original */ }
        return line;
      });
      fs.writeFileSync(inboxPath, updated.join('\n') + '\n');
      // 同步快取
      for (const [id, status] of idMap) {
        for (const item of this.items) {
          if (item.id === id) { item.status = status; break; }
        }
      }
      this.rebuildPending();
      this._version++;
      this.pendingMarks.clear();
    } catch (err) {
      slog('INBOX', `flushMarks failed: ${err instanceof Error ? err.message : err}`);
      // pendingMarks intentionally NOT cleared — retry on next cycle
    }
  }

  private rebuildPending(): void {
    this.pendingItems = this.items
      .filter(i => i.status === 'pending')
      .sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.ts.localeCompare(b.ts));
  }

  private reload(): void {
    try {
      const inboxPath = getInboxPath();
      if (!fs.existsSync(inboxPath)) { this.items = []; this.pendingItems = []; }
      else {
        const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
        this.items = [];
        for (const line of lines) {
          try { this.items.push(JSON.parse(line)); } catch { /* skip */ }
        }
        this.rebuildPending();
      }
    } catch { this.items = []; this.pendingItems = []; }
    this._dirty = false;
  }
}

export const inboxCache = new InboxCache();

// =============================================================================
// Priority Rules（純 TypeScript，零 LLM）
// =============================================================================

export function assignPriority(
  source: InboxItem['source'],
  from: string,
  content: string,
  meta?: Record<string, string>,
): 0 | 1 | 2 | 3 | 4 {
  // P0: Alex 的 Telegram 訊息
  if (source === 'telegram' && from === 'alex') return 0;

  // P1: Chat Room 提及 @kuro
  if (source === 'room' && content.includes('@kuro')) return 1;

  // P2: Claude Code 訊息
  if (source === 'claude-code') return 2;

  // P2: GitHub bug label
  if (source === 'github' && meta?.labels?.includes('bug')) return 2;

  // P2: Approved handoff
  if (source === 'handoff' && meta?.status === 'approved') return 2;

  // P3: Other GitHub
  if (source === 'github') return 3;

  // P4: Everything else
  return 4;
}

// =============================================================================
// URL Extraction + Content Detection
// =============================================================================

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** 提取 URLs，去重，最多 5 個。自動移除尾部標點符號 */
export function extractUrls(text: string): string[] {
  const raw = text.match(URL_RE) || [];
  return [...new Set(raw.map(u => u.replace(/[.,;:!?]+$/, '')))].slice(0, 5);
}

/** 偵測內容類型 */
function detectContentType(content: string): 'url' | 'question' | 'command' | 'info' {
  const urls = extractUrls(content);
  const urlChars = urls.reduce((sum, u) => sum + u.length, 0);
  if (urls.length > 0 && urlChars / content.trim().length > 0.5) return 'url';
  if (/[?？]/.test(content)) return 'question';
  if (/^[!/]/.test(content.trim())) return 'command';
  return 'info';
}

function urlToHash(url: string): string {
  return crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
}

// =============================================================================
// Write
// =============================================================================

/** 5 分鐘去重窗口 */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * 寫入統一 inbox。自動分配 priority + 5min 去重 + meta 豐富化 + URL 預取。
 * 回傳 id，若去重跳過回傳 null。
 */
export function writeInboxItem(
  item: Omit<InboxItem, 'id' | 'ts' | 'status' | 'priority'>,
): string | null {
  try {
    const inboxPath = getInboxPath();
    const dir = path.dirname(inboxPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // JSONL compaction: >200 行時壓縮
    if (fs.existsSync(inboxPath)) {
      const lineCount = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean).length;
      if (lineCount > 200) {
        compactInbox(inboxPath);
      }
    }

    const now = new Date();
    const ts = now.toISOString();

    // 5min 去重：same content + from → skip（用快取避免磁碟讀取）
    const allItems = inboxCache.getAll();
    const cutoff = now.getTime() - DEDUP_WINDOW_MS;
    const recentItems = allItems.slice(-20);
    for (const existing of recentItems) {
      if (
        existing.from === item.from &&
        existing.content === item.content &&
        new Date(existing.ts).getTime() > cutoff
      ) {
        return null; // 去重
      }
    }

    // Enrich meta: extract URLs + detect content type
    const urls = extractUrls(item.content);
    const enrichedMeta: Record<string, string> = { ...(item.meta ?? {}) };
    if (urls.length > 0 && !enrichedMeta.urls) {
      enrichedMeta.urls = urls.join(',');
    }
    if (!enrichedMeta.contentType) {
      enrichedMeta.contentType = detectContentType(item.content);
    }

    const id = `${ts.slice(0, 10)}-${ts.slice(11, 13)}${ts.slice(14, 16)}${ts.slice(17, 19)}-${item.source.slice(0, 3)}`;
    const priority = assignPriority(item.source, item.from, item.content, item.meta);

    const entry: InboxItem = {
      id,
      source: item.source,
      from: item.from,
      priority,
      content: item.content,
      ts,
      status: 'pending',
      meta: Object.keys(enrichedMeta).length > 0 ? enrichedMeta : undefined,
    };

    fs.appendFileSync(inboxPath, JSON.stringify(entry) + '\n');
    inboxCache.pushItem(entry);

    // Fire-and-forget URL prefetch
    if (urls.length > 0) {
      prefetchUrls(urls).catch(() => {});
    }

    return id;
  } catch (err) {
    slog('INBOX', `writeInboxItem failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function compactInbox(inboxPath: string): void {
  try {
    const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const kept = lines.filter(line => {
      try {
        const item = JSON.parse(line) as InboxItem;
        return item.status === 'pending' || new Date(item.ts).getTime() > cutoff24h;
      } catch { return true; }
    });
    if (kept.length < lines.length) {
      fs.writeFileSync(inboxPath, kept.join('\n') + '\n');
      inboxCache.invalidate();
      slog('INBOX', `Compacted: ${lines.length} → ${kept.length} lines`);
    }
  } catch { /* compaction failure non-critical */ }
}

// =============================================================================
// Read
// =============================================================================

/**
 * 讀取所有 pending items，按 priority 排序（P0 first）。
 * 使用 InboxCache — dirty 時重讀磁碟，否則回傳快取。
 */
export function readPendingInbox(): InboxItem[] {
  return inboxCache.getPending();
}

// =============================================================================
// Mark Processed
// =============================================================================

/**
 * 批次標記 inbox items 為 seen 或 replied。
 * 使用 in-place rewrite（JSONL 不支援隨機寫入）。
 */
export function markInboxProcessed(ids: string[], status: 'seen' | 'replied'): void {
  try {
    const inboxPath = getInboxPath();
    if (!fs.existsSync(inboxPath)) return;

    const idSet = new Set(ids);
    const lines = fs.readFileSync(inboxPath, 'utf-8').split('\n').filter(Boolean);
    const updated: string[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line) as InboxItem;
        if (idSet.has(item.id)) {
          item.status = status;
          updated.push(JSON.stringify(item));
        } else {
          updated.push(line);
        }
      } catch {
        updated.push(line); // preserve malformed lines
      }
    }

    fs.writeFileSync(inboxPath, updated.join('\n') + '\n');
    inboxCache.applyMarks(idSet, status);
  } catch (err) {
    slog('INBOX', `markInboxProcessed failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 檢查是否有近期未回覆的 telegram 訊息（status: 'seen'）。
 * 用於啟動時判斷是否應優先處理 telegram 而非跑 generic 自主 cycle。
 */
export function hasRecentUnrepliedTelegram(hoursBack: number = 4): boolean {
  try {
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    for (const item of inboxCache.getAll()) {
      if (item.source === 'telegram' && item.status === 'seen' && item.ts >= cutoff) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 標記所有 pending items。
 */
export function markAllInboxProcessed(status: 'seen' | 'replied'): void {
  const pending = readPendingInbox();
  if (pending.length === 0) return;
  markInboxProcessed(pending.map(i => i.id), status);
}

// =============================================================================
// Cycle Mode Detection（替代 Haiku triageCycleIntent）
// =============================================================================

export type CycleMode = 'respond' | 'task' | 'act' | 'reflect' | 'learn';

/**
 * 從 inbox + trigger reason 規則判斷 cycle mode。
 * 零 LLM 成本，替代 triageCycleIntent()。
 */
export function detectModeFromInbox(
  items: InboxItem[],
  triggerReason: string | null,
): { mode: CycleMode; reason: string; focus?: string } {
  // telegram-user → always respond
  if (triggerReason?.startsWith('telegram-user')) {
    return { mode: 'respond', reason: 'Alex Telegram message' };
  }

  // P0 or P1 → respond
  const highPri = items.filter(i => i.priority <= 1);
  if (highPri.length > 0) {
    const top = highPri[0];
    return {
      mode: 'respond',
      reason: `P${top.priority} from ${top.from}`,
      focus: top.content.slice(0, 80),
    };
  }

  // P2 handoff → task
  const handoffs = items.filter(i => i.source === 'handoff' && i.priority <= 2);
  if (handoffs.length > 0) {
    return { mode: 'task', reason: 'approved handoff', focus: handoffs[0].content.slice(0, 80) };
  }

  // P2 items → act
  const p2 = items.filter(i => i.priority === 2);
  if (p2.length > 0) {
    return { mode: 'act', reason: `${p2.length} P2 item(s)` };
  }

  // heartbeat with no pending → reflect or learn
  if (triggerReason?.includes('heartbeat') && items.length === 0) {
    return { mode: 'reflect', reason: 'heartbeat, no pending items' };
  }

  return { mode: 'act', reason: 'default' };
}

// =============================================================================
// Batch Mark（loop.ts 用）
// =============================================================================

export function queueInboxMark(id: string, status: 'seen' | 'replied'): void {
  inboxCache.queueMark(id, status);
}

export function flushInboxMarks(): void {
  inboxCache.flushMarks();
}

// =============================================================================
// Formatting（for buildContext）— 內容感知呈現
// =============================================================================

/**
 * 格式化 inbox items，依 priority 調整預覽長度，內嵌 URL 預取內容。
 */
export function formatInboxSection(items: InboxItem[]): string {
  if (items.length === 0) return '';
  const lines: string[] = [];
  let totalUrlChars = 0; // 全局 URL 內嵌上限 5000 chars

  for (const i of items.slice(0, 15)) {
    const time = i.ts.slice(11, 16);
    const sourceTag = i.source === 'telegram' ? `telegram:${i.from}`
      : i.source === 'room' ? `room:${i.from}`
      : i.source === 'github' ? `github:${i.meta?.issueNumber ? '#' + i.meta.issueNumber : 'issue'}`
      : i.source === 'handoff' ? 'handoff'
      : `${i.source}:${i.from}`;

    // 依 priority 調整預覽長度
    const maxLen = i.priority <= 1 ? 500 : i.priority <= 2 ? 300 : 150;
    const preview = i.content.replace(/\n/g, ' ').slice(0, maxLen);
    let line = `P${i.priority} [${sourceTag}] ${time} — ${preview}`;

    // GitHub: 顯示 labels
    if (i.meta?.labels) line += ` [${i.meta.labels}]`;

    // 內嵌 URL 預取內容（依 priority 分級，total cap 5000）
    if (i.meta?.urls && totalUrlChars < 5000) {
      const urlCap = i.priority <= 1 ? 1500 : 500; // P0/P1: 1500, P2+: 500
      const urls = i.meta.urls.split(',').slice(0, 2);
      for (const url of urls) {
        if (totalUrlChars >= 5000) break;
        const cached = readWebCache(url);
        if (cached) {
          const domain = url.replace(/^https?:\/\//, '').split('/')[0].replace('www.', '');
          const remaining = Math.min(urlCap, 5000 - totalUrlChars);
          const snippet = cached.replace(/\n/g, ' ').slice(0, remaining);
          line += `\n  [${domain}] ${snippet}`;
          totalUrlChars += snippet.length;
        }
      }
    }

    lines.push(line);
  }
  return lines.join('\n');
}

// =============================================================================
// URL Prefetch + Web Cache
// =============================================================================

const WEB_CACHE_DIR = path.join(os.homedir(), '.mini-agent', 'web-cache');

async function prefetchUrls(urls: string[], depth = 0): Promise<void> {
  if (!fs.existsSync(WEB_CACHE_DIR)) fs.mkdirSync(WEB_CACHE_DIR, { recursive: true });

  const secondaryUrls: string[] = [];

  for (const url of urls.slice(0, 3)) {
    try {
      const hash = urlToHash(url);
      const cachePath = path.join(WEB_CACHE_DIR, `${hash}.txt`);

      // 跳過最近快取（< 1h）
      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        if (Date.now() - stat.mtimeMs < 3600_000) continue;
      }

      let text = '', title = '', layer = '';

      // X/Twitter → Grok API 優先
      if (/x\.com|twitter\.com/i.test(url)) {
        const apiKey = loadEnvKey('XAI_API_KEY');
        if (apiKey) {
          const result = await fetchViaGrok(url, apiKey);
          if (result) { text = result; layer = 'grok'; }
        }
      }

      // Fallback: HTTP fetch + HTML strip
      if (!text) {
        const result = await fetchViaHttp(url);
        if (result) { text = result.text; title = result.title; layer = 'http'; }
      }

      if (text && text.length > 50) {
        writeWebCache(url, layer, text, title);

        // 二層追蹤：從預取內容中提取引用 URL（只追一層，depth=0→1）
        if (depth === 0) {
          const linkedUrls = extractUrls(text).filter(u =>
            u !== url && !urls.includes(u) && // 排除自身和已有的
            !/localhost|127\.0\.0\.1/.test(u), // 排除內部
          );
          secondaryUrls.push(...linkedUrls);
        }
      }
    } catch { /* fire-and-forget */ }
  }

  // 遞歸預取二層 URL（最多 2 個，depth+1 防止無限遞歸）
  if (depth === 0 && secondaryUrls.length > 0) {
    await prefetchUrls(secondaryUrls.slice(0, 2), 1).catch(() => {});
  }
}

function loadEnvKey(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.replace(/\s*#.*$/, '').trim();
  } catch { return undefined; }
}

async function fetchViaGrok(url: string, apiKey: string): Promise<string | null> {
  try {
    // X article URL → 更長 timeout + 展開指令
    const isArticle = /x\.com\/i\/article|x\.com\/\w+\/article/i.test(url);
    const instructions = isArticle
      ? 'Read this X article in full. Return the complete text content, author, and any key points. Plain text, no markdown.'
      : 'Read this tweet/post and return its full content: author, text, engagement stats. If it quotes or links to another post/article, include that content too. Plain text, no markdown.';
    const timeout = isArticle ? 30000 : 15000;

    const resp = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'grok-4-1-fast',
        tools: [{ type: 'x_search' }],
        instructions,
        input: url,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
    const msg = data.output?.find(o => o.type === 'message');
    const text = msg?.content?.find(c => c.type === 'output_text')?.text;
    return text && text.length > 50 ? text : null;
  } catch { return null; }
}

async function fetchViaHttp(url: string): Promise<{ text: string; title: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiniAgent/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    const html = await resp.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? '';
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    return text.length > 50 ? { text: text.slice(0, 50_000), title } : null;
  } catch { return null; }
}

function writeWebCache(url: string, layer: string, content: string, title?: string): void {
  try {
    const hash = urlToHash(url);
    const cachePath = path.join(WEB_CACHE_DIR, `${hash}.txt`);
    const header = [
      `URL: ${url}`,
      title ? `Title: ${title}` : '',
      `Layer: ${layer}`,
      `Fetched: ${new Date().toISOString()}`,
      '---',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(cachePath, header + '\n' + content);
    fs.appendFileSync(
      path.join(WEB_CACHE_DIR, 'manifest.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), url, layer, len: content.length, file: `${hash}.txt` }) + '\n',
    );
  } catch { /* cache write failure OK */ }
}

/** 讀取 web-cache，回傳 null 如果不存在或過期 */
export function readWebCache(url: string): string | null {
  try {
    const hash = urlToHash(url);
    const cachePath = path.join(WEB_CACHE_DIR, `${hash}.txt`);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf-8');
    const bodyStart = content.indexOf('---\n');
    return bodyStart >= 0 ? content.slice(bodyStart + 4).trim() : null;
  } catch { return null; }
}
