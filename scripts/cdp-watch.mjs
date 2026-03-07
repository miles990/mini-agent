#!/usr/bin/env node
/**
 * CDP Event-Driven Perception — Zero Dependencies
 *
 * Persistent WebSocket connection to Chrome CDP browser endpoint.
 * Subscribes to tab lifecycle + navigation events, writes meaningful
 * changes to a JSONL ring buffer. Replaces polling with push.
 *
 * Usage:
 *   node cdp-watch.mjs              # Run in foreground (log to stdout)
 *   node cdp-watch.mjs --daemon     # Run silently (log only to file)
 *   node cdp-watch.mjs --status     # Show recent events
 *   node cdp-watch.mjs --flush      # Clear event log
 *
 * Events written to ~/.mini-agent/cdp-events.jsonl
 * Ring buffer: keeps last 500 entries.
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const RING_MAX = 500;
const RECONNECT_DELAY = 5000;  // 5s between reconnect attempts
const MAX_RECONNECT = 60000;   // max 60s backoff

const STATE_DIR = join(homedir(), '.mini-agent');
const EVENTS_FILE = join(STATE_DIR, 'cdp-events.jsonl');

mkdirSync(STATE_DIR, { recursive: true });

const isDaemon = process.argv.includes('--daemon');

// ─── Status / Flush commands ────────────────────────────────────────────────

if (process.argv.includes('--status')) {
  if (!existsSync(EVENTS_FILE)) { console.log('No events recorded yet.'); process.exit(0); }
  const lines = readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const recent = lines.slice(-20);
  console.log(`CDP Events: ${lines.length} total, showing last ${recent.length}:\n`);
  for (const line of recent) {
    try {
      const e = JSON.parse(line);
      const time = e.ts?.slice(11, 19) || '??';
      console.log(`  [${time}] ${e.event} — ${e.title || e.url || ''}`);
    } catch { console.log(`  ${line}`); }
  }
  process.exit(0);
}

if (process.argv.includes('--flush')) {
  writeFileSync(EVENTS_FILE, '');
  console.log('Event log cleared.');
  process.exit(0);
}

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg) {
  if (!isDaemon) console.log(`[cdp-watch] ${msg}`);
}

function logEvent(event, detail = {}) {
  const entry = { ts: new Date().toISOString(), event, ...detail };
  try {
    appendFileSync(EVENTS_FILE, JSON.stringify(entry) + '\n');
    trimRingBuffer();
  } catch (e) { log(`Write error: ${e.message}`); }
  log(`${event}: ${detail.title || detail.url || JSON.stringify(detail)}`);
}

let trimCounter = 0;
function trimRingBuffer() {
  // Only check every 50 writes to avoid fs overhead
  if (++trimCounter % 50 !== 0) return;
  try {
    const content = readFileSync(EVENTS_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > RING_MAX) {
      writeFileSync(EVENTS_FILE, lines.slice(-RING_MAX).join('\n') + '\n');
    }
  } catch {}
}

// ─── Noise Filter ───────────────────────────────────────────────────────────

const SKIP_PREFIXES = ['chrome://', 'chrome-extension://', 'devtools://', 'blob:', 'about:'];

function isNoise(url) {
  if (!url) return true;
  return SKIP_PREFIXES.some(p => url.startsWith(p));
}

function isDuplicate(event, url) {
  // Suppress rapid-fire identical events within 3s window
  const key = `${event}:${url}`;
  const now = Date.now();
  if (dedup.get(key) && now - dedup.get(key) < 3000) return true;
  dedup.set(key, now);
  // Prune old entries
  if (dedup.size > 200) {
    for (const [k, ts] of dedup) {
      if (now - ts > 10000) dedup.delete(k);
    }
  }
  return false;
}
const dedup = new Map();

// ─── Target State ───────────────────────────────────────────────────────────

const targets = new Map(); // targetId → { url, title, type }

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch { return url?.slice(0, 40) || ''; }
}

// ─── CDP Connection ─────────────────────────────────────────────────────────

let ws = null;
let reconnectDelay = RECONNECT_DELAY;
let cmdId = 1;
const pendingCommands = new Map();

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Not connected'));
    }
    const id = cmdId++;
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pendingCommands.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function handleMessage(data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }

  // Command response
  if (msg.id && pendingCommands.has(msg.id)) {
    const { resolve, reject, timeout } = pendingCommands.get(msg.id);
    clearTimeout(timeout);
    pendingCommands.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }

  // Event dispatch
  if (msg.method) handleEvent(msg.method, msg.params || {});
}

function handleEvent(method, params) {
  switch (method) {
    case 'Target.targetCreated': {
      const info = params.targetInfo;
      if (info?.type !== 'page') return;
      if (isNoise(info.url)) return;
      targets.set(info.targetId, { url: info.url, title: info.title || '' });
      if (!isDuplicate('tab-opened', info.url)) {
        logEvent('tab-opened', {
          url: info.url,
          title: info.title || '',
          domain: extractDomain(info.url),
          targetId: info.targetId,
        });
      }
      break;
    }

    case 'Target.targetInfoChanged': {
      const info = params.targetInfo;
      if (info?.type !== 'page') return;
      if (isNoise(info.url)) return;
      const prev = targets.get(info.targetId);
      targets.set(info.targetId, { url: info.url, title: info.title || '' });

      // Navigation: URL changed
      if (prev && prev.url !== info.url) {
        if (!isDuplicate('navigated', info.url)) {
          logEvent('navigated', {
            url: info.url,
            title: info.title || '',
            domain: extractDomain(info.url),
            from: prev.url,
            fromDomain: extractDomain(prev.url),
            targetId: info.targetId,
          });
        }
      }
      // Title changed (page loaded)
      else if (prev && prev.title !== info.title && info.title) {
        if (!isDuplicate('title-updated', info.url)) {
          logEvent('title-updated', {
            url: info.url,
            title: info.title,
            domain: extractDomain(info.url),
            targetId: info.targetId,
          });
        }
      }
      break;
    }

    case 'Target.targetDestroyed': {
      const prev = targets.get(params.targetId);
      targets.delete(params.targetId);
      if (prev && !isNoise(prev.url)) {
        if (!isDuplicate('tab-closed', prev.url)) {
          logEvent('tab-closed', {
            url: prev.url,
            title: prev.title || '',
            domain: extractDomain(prev.url),
            targetId: params.targetId,
          });
        }
      }
      break;
    }
  }
}

// ─── Connect + Reconnect ────────────────────────────────────────────────────

async function getBrowserWsUrl() {
  const resp = await fetch(`${CDP_BASE}/json/version`);
  const data = await resp.json();
  return data.webSocketDebuggerUrl;
}

async function connect() {
  try {
    const wsUrl = await getBrowserWsUrl();
    log(`Connecting to ${wsUrl.slice(0, 50)}...`);

    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', async () => {
      log('Connected. Subscribing to target events...');
      reconnectDelay = RECONNECT_DELAY; // reset backoff

      try {
        // Discover existing targets + subscribe to new ones
        await cdpSend('Target.setDiscoverTargets', { discover: true });
        log('Subscribed to target discovery. Watching...');

        // Seed current state
        const { targetInfos } = await cdpSend('Target.getTargets');
        for (const info of (targetInfos || [])) {
          if (info.type === 'page' && !isNoise(info.url)) {
            targets.set(info.targetId, { url: info.url, title: info.title || '' });
          }
        }
        log(`Tracking ${targets.size} existing tabs.`);
      } catch (e) {
        log(`Setup error: ${e.message}`);
      }
    });

    ws.addEventListener('message', (event) => {
      handleMessage(typeof event.data === 'string' ? event.data : event.data.toString());
    });

    ws.addEventListener('close', () => {
      log(`Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
      targets.clear();
      scheduleReconnect();
    });

    ws.addEventListener('error', (e) => {
      log(`WebSocket error: ${e.message || 'unknown'}`);
    });
  } catch (e) {
    log(`Connection failed: ${e.message}. Retrying in ${reconnectDelay / 1000}s...`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT);
    connect();
  }, reconnectDelay);
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

function shutdown() {
  log('Shutting down...');
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Main ───────────────────────────────────────────────────────────────────

log('CDP Event Watcher starting...');
connect();
