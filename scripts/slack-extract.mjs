#!/usr/bin/env node
/**
 * Extract all messages from a Slack channel via CDP by scrolling through virtual list.
 * Usage: node slack-extract.mjs <targetId> [scrollSteps]
 */

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const targetId = process.argv[2];
const maxScrollSteps = parseInt(process.argv[3] || '50');

if (!targetId) {
  console.error('Usage: node slack-extract.mjs <targetId> [scrollSteps]');
  process.exit(1);
}

// Get WebSocket URL
const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
const targets = await resp.json();
const target = targets.find(t => t.id.startsWith(targetId) || t.id === targetId);
if (!target) { console.error('Target not found'); process.exit(1); }

const wsUrl = target.webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
let msgId = 1;
const pendingCallbacks = new Map();

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 5000);
  ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
  ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pendingCallbacks.has(msg.id)) {
    pendingCallbacks.get(msg.id)(msg);
    pendingCallbacks.delete(msg.id);
  }
});

function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pendingCallbacks.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error('timeout'));
      }
    }, 10000);
  });
}

async function evaluate(expr) {
  const resp = await sendCommand('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: false
  });
  if (resp.result && resp.result.result) {
    return resp.result.result.value;
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const extractJS = `
(function() {
  var msgs = document.querySelectorAll('[data-qa="message_container"]');
  var result = [];
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var sender = m.querySelector('[data-qa="message_sender_name"]');
    var blocks = m.querySelector('.c-message_kit__blocks');
    var timeEl = m.querySelector('a[data-qa="message_time"]');
    var parent = m.closest('[data-item-key]');
    var key = parent ? parent.getAttribute('data-item-key') : ('msg_' + Date.now() + '_' + i);
    result.push({
      key: key,
      sender: sender ? sender.innerText : '',
      time: timeEl ? timeEl.innerText : '',
      text: blocks ? blocks.innerText : m.innerText.substring(0, 1200)
    });
  }
  // Also get section headers (date dividers)
  var headers = document.querySelectorAll('.c-message_list__day_divider__label__pill');
  var dates = [];
  for (var j = 0; j < headers.length; j++) {
    dates.push(headers[j].innerText);
  }
  return JSON.stringify({messages: result, dates: dates});
})()
`;

// Scroll to top first
await evaluate('document.querySelectorAll(".c-scrollbar__hider")[1].scrollTop = 0');
await sleep(2000);

const allMessages = new Map();
const allDates = new Set();
let noNewCount = 0;
let prevSize = 0;

for (let step = 0; step < maxScrollSteps; step++) {
  const raw = await evaluate(extractJS);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      for (const msg of data.messages) {
        if (msg.text && msg.text.trim().length > 3) {
          allMessages.set(msg.key, msg);
        }
      }
      for (const d of data.dates) {
        allDates.add(d);
      }
    } catch (e) {}
  }

  if (allMessages.size === prevSize) {
    noNewCount++;
    if (noNewCount > 6) break;
  } else {
    noNewCount = 0;
    prevSize = allMessages.size;
  }

  // Scroll down incrementally
  await evaluate('document.querySelectorAll(".c-scrollbar__hider")[1].scrollTop += 250');
  await sleep(600);
}

// Final extraction at bottom
await evaluate('var el = document.querySelectorAll(".c-scrollbar__hider")[1]; el.scrollTop = el.scrollHeight');
await sleep(1500);
const finalRaw = await evaluate(extractJS);
if (finalRaw) {
  try {
    const data = JSON.parse(finalRaw);
    for (const msg of data.messages) {
      if (msg.text && msg.text.trim().length > 3) {
        allMessages.set(msg.key, msg);
      }
    }
    for (const d of data.dates) {
      allDates.add(d);
    }
  } catch (e) {}
}

const output = {
  totalUniqueMessages: allMessages.size,
  dates: Array.from(allDates),
  messages: Array.from(allMessages.values())
};

console.log(JSON.stringify(output, null, 2));
ws.close();
process.exit(0);
