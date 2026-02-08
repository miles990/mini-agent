#!/usr/bin/env node
/**
 * Gmail Cleanup Script — via Chrome CDP
 *
 * Performs batch operations on Gmail using CDP Runtime.evaluate
 * to execute JavaScript directly in the Gmail tab.
 *
 * Usage:
 *   node scripts/gmail-cleanup.mjs unsubscribe <sender>    # Open unsubscribe link for sender
 *   node scripts/gmail-cleanup.mjs delete-search <query>   # Delete all emails matching search
 *   node scripts/gmail-cleanup.mjs archive-search <query>  # Archive all emails matching search
 *   node scripts/gmail-cleanup.mjs navigate <hash>         # Navigate Gmail to hash (e.g. #category/promotions)
 *   node scripts/gmail-cleanup.mjs select-all-delete       # Select all on current view + delete
 *   node scripts/gmail-cleanup.mjs run-js <code>           # Run arbitrary JS on Gmail tab
 */

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const TIMEOUT = 30000;

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e8);
    const timeout = setTimeout(() => reject(new Error(`CDP command timeout: ${method}`)), TIMEOUT);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(ws, eventName, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Waiting for ${eventName} timeout`)), timeoutMs);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === eventName) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        resolve(msg.params);
      }
    };
    ws.addEventListener('message', handler);
  });
}

async function findGmailTab() {
  const targets = await listTargets();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found. Open Gmail in Chrome first.');
  return gmail;
}

async function runOnGmail(js) {
  const tab = await findGmailTab();
  const ws = await connectWs(tab.webSocketDebuggerUrl);
  try {
    await cdpCommand(ws, 'Runtime.enable');
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    });
    return result;
  } finally {
    ws.close();
  }
}

async function navigateGmail(hash) {
  const result = await runOnGmail(`
    window.location.hash = '${hash}';
    new Promise(resolve => setTimeout(() => resolve(document.title), 2000));
  `);
  console.log('Navigated. Title:', result.result?.value);
}

async function selectAllAndDelete() {
  // Step 1: Click the select-all checkbox
  const result = await runOnGmail(`
    (async () => {
      // Find and click the select-all checkbox
      const checkbox = document.querySelector('[role="checkbox"][aria-label]')
        || document.querySelector('.T-Jo-auh');
      if (!checkbox) return 'ERROR: Cannot find select-all checkbox';
      checkbox.click();

      await new Promise(r => setTimeout(r, 500));

      // Check if there's a "select all conversations" banner
      const selectAll = document.querySelector('.T-ays-a1d');
      if (selectAll) {
        selectAll.click();
        await new Promise(r => setTimeout(r, 500));
      }

      // Find and click the delete button
      const deleteBtn = document.querySelector('[aria-label="刪除"]')
        || document.querySelector('[aria-label="Delete"]')
        || document.querySelector('.ar9.T-I-J3.J-J5-Ji[data-tooltip="刪除"]');
      if (!deleteBtn) return 'ERROR: Cannot find delete button. Selected emails but no delete button found.';
      deleteBtn.click();

      await new Promise(r => setTimeout(r, 1000));

      // Check for confirmation dialog and click OK
      const okBtn = document.querySelector('[name="ok"]') || document.querySelector('.T-I.J-J5-Ji.T-I-atl');
      if (okBtn) {
        okBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }

      return 'OK: Selected all and deleted';
    })()
  `);
  console.log(result.result?.value || 'Done');
}

async function selectAllAndArchive() {
  const result = await runOnGmail(`
    (async () => {
      // Find and click the select-all checkbox
      const checkbox = document.querySelector('[role="checkbox"][aria-label]')
        || document.querySelector('.T-Jo-auh');
      if (!checkbox) return 'ERROR: Cannot find select-all checkbox';
      checkbox.click();

      await new Promise(r => setTimeout(r, 500));

      // Check if there's a "select all conversations" banner
      const selectAll = document.querySelector('.T-ays-a1d');
      if (selectAll) {
        selectAll.click();
        await new Promise(r => setTimeout(r, 500));
      }

      // Find and click the archive button
      const archiveBtn = document.querySelector('[aria-label="封存"]')
        || document.querySelector('[aria-label="Archive"]');
      if (!archiveBtn) return 'ERROR: Cannot find archive button';
      archiveBtn.click();

      await new Promise(r => setTimeout(r, 1000));

      // Check for confirmation dialog and click OK
      const okBtn = document.querySelector('[name="ok"]') || document.querySelector('.T-I.J-J5-Ji.T-I-atl');
      if (okBtn) {
        okBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }

      return 'OK: Selected all and archived';
    })()
  `);
  console.log(result.result?.value || 'Done');
}

async function searchAndDelete(query) {
  // Navigate to search results
  const hash = `#search/${encodeURIComponent(query)}`;
  console.log(`Searching: ${query}`);
  await navigateGmail(hash);

  // Wait for results to load
  await new Promise(r => setTimeout(r, 3000));

  // Select all and delete
  await selectAllAndDelete();
}

async function searchAndArchive(query) {
  const hash = `#search/${encodeURIComponent(query)}`;
  console.log(`Searching: ${query}`);
  await navigateGmail(hash);
  await new Promise(r => setTimeout(r, 3000));
  await selectAllAndArchive();
}

async function getPageInfo() {
  const result = await runOnGmail(`
    JSON.stringify({
      title: document.title,
      url: window.location.href,
      hash: window.location.hash,
      mailCount: document.querySelectorAll('tr.zA').length,
    })
  `);
  try {
    return JSON.parse(result.result?.value || '{}');
  } catch {
    return { raw: result.result?.value };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'navigate':
      await navigateGmail(args[0] || '#inbox');
      break;
    case 'select-all-delete':
      await selectAllAndDelete();
      break;
    case 'select-all-archive':
      await selectAllAndArchive();
      break;
    case 'delete-search':
      if (!args[0]) { console.error('Usage: gmail-cleanup.mjs delete-search <query>'); process.exit(1); }
      await searchAndDelete(args.join(' '));
      break;
    case 'archive-search':
      if (!args[0]) { console.error('Usage: gmail-cleanup.mjs archive-search <query>'); process.exit(1); }
      await searchAndArchive(args.join(' '));
      break;
    case 'info':
      console.log(await getPageInfo());
      break;
    case 'run-js':
      if (!args[0]) { console.error('Usage: gmail-cleanup.mjs run-js <code>'); process.exit(1); }
      const r = await runOnGmail(args.join(' '));
      console.log(r.result?.value);
      break;
    default:
      console.log('gmail-cleanup — Gmail batch operations via CDP');
      console.log('');
      console.log('Commands:');
      console.log('  navigate <hash>              Navigate Gmail (e.g. #category/promotions)');
      console.log('  select-all-delete            Select all + delete on current view');
      console.log('  select-all-archive           Select all + archive on current view');
      console.log('  delete-search <query>        Search + select all + delete');
      console.log('  archive-search <query>       Search + select all + archive');
      console.log('  info                         Show current Gmail page info');
      console.log('  run-js <code>                Run JavaScript on Gmail tab');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
