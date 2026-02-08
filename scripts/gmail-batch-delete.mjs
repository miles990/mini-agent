#!/usr/bin/env node
/**
 * Gmail Batch Delete — Execute batch delete on Gmail search results via CDP
 *
 * Usage:
 *   node scripts/gmail-batch-delete.mjs <search-query>
 *
 * Example:
 *   node scripts/gmail-batch-delete.mjs "from:tumblr.com"
 *   node scripts/gmail-batch-delete.mjs "category:promotions older_than:30d"
 *   node scripts/gmail-batch-delete.mjs "category:social older_than:7d"
 */

const CDP_BASE = `http://${process.env.CDP_HOST || 'localhost'}:${process.env.CDP_PORT || '9222'}`;
const TIMEOUT = 30000;

async function getGmailWs() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found');

  const ws = new WebSocket(gmail.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });

  // Enable Runtime
  await cdp(ws, 'Runtime.enable');
  return ws;
}

let _msgId = 1;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = _msgId++;
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), TIMEOUT);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, js) {
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression: js,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.value;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('Usage: gmail-batch-delete.mjs <search-query>');
  console.error('Example: gmail-batch-delete.mjs "from:tumblr.com"');
  process.exit(1);
}

const mode = process.env.MODE || 'delete'; // delete or archive

console.log(`[Gmail Batch ${mode.toUpperCase()}]`);
console.log(`Query: ${query}`);
console.log(`Mode: ${mode}`);
console.log('');

const ws = await getGmailWs();

try {
  // Step 1: Navigate to search
  const hash = '#search/' + encodeURIComponent(query);
  console.log('Step 1: Navigating to search...');
  await evaluate(ws, `window.location.hash = '${hash}'; 'ok'`);
  await sleep(3000);

  const title = await evaluate(ws, 'document.title');
  console.log(`  Title: ${title}`);

  // Check result count
  const countInfo = await evaluate(ws, `
    (() => {
      const dj = document.querySelector('.Dj');
      return dj ? dj.textContent.trim() : 'unknown';
    })()
  `);
  console.log(`  Results: ${countInfo}`);

  if (countInfo === 'unknown') {
    console.log('  Could not determine count, continuing anyway...');
  } else if (countInfo.includes('沒有') || countInfo === '') {
    console.log('  No results found. Done.');
    ws.close();
    process.exit(0);
  }

  // Step 2: Click select-all checkbox
  console.log('Step 2: Selecting all on page...');
  const selectResult = await evaluate(ws, `
    (() => {
      const checkboxes = document.querySelectorAll('[role="checkbox"]');
      // First checkbox is the main select-all (in toolbar)
      if (checkboxes.length > 0) {
        checkboxes[0].click();
        return 'clicked checkbox 0: ' + (checkboxes[0].getAttribute('aria-label') || checkboxes[0].className.slice(0, 30));
      }
      return 'no checkbox found';
    })()
  `);
  console.log(`  ${selectResult}`);
  await sleep(1000);

  // Step 3: Look for "Select all conversations that match this search" banner
  console.log('Step 3: Looking for select-all-conversations banner...');
  const bannerResult = await evaluate(ws, `
    (async () => {
      await new Promise(r => setTimeout(r, 500));

      // Gmail's "Select all conversations" is typically a <span> inside the notification area
      const allElements = document.querySelectorAll('span, a, div');
      for (const el of allElements) {
        const text = el.textContent.trim();
        // Chinese Gmail: "選取與這項搜尋條件相符的所有會話群組"
        // English: "Select all conversations that match this search"
        if ((text.includes('選取與這項搜尋') || text.includes('Select all conversations that match'))
            && text.length < 100) {
          el.click();
          return 'clicked: ' + text;
        }
      }

      // Try alternative: look for links in the toolbar area
      const toolbarArea = document.querySelector('.Bk');
      if (toolbarArea) {
        const links = toolbarArea.querySelectorAll('span, a');
        for (const l of links) {
          const t = l.textContent.trim();
          if (t.includes('選取') && t.length < 100) {
            l.click();
            return 'clicked toolbar link: ' + t;
          }
        }
        return 'toolbar found but no select-all link. Content: ' + toolbarArea.textContent.trim().slice(0, 200);
      }

      return 'no banner found';
    })()
  `);
  console.log(`  ${bannerResult}`);
  await sleep(1000);

  // Step 4: Click delete or archive
  const actionLabel = mode === 'delete' ? '刪除' : '封存';
  const actionLabelEn = mode === 'delete' ? 'Delete' : 'Archive';
  console.log(`Step 4: Clicking ${actionLabel}...`);

  const actionResult = await evaluate(ws, `
    (() => {
      const btn = document.querySelector('[aria-label="${actionLabel}"]')
        || document.querySelector('[aria-label="${actionLabelEn}"]')
        || document.querySelector('[data-tooltip="${actionLabel}"]');
      if (btn) {
        btn.click();
        return 'clicked ${actionLabel}';
      }

      // Fallback: find button by scanning all buttons
      const buttons = document.querySelectorAll('[role="button"]');
      for (const b of buttons) {
        if (b.getAttribute('aria-label') === '${actionLabel}' || b.getAttribute('data-tooltip') === '${actionLabel}') {
          b.click();
          return 'clicked fallback: ' + b.getAttribute('aria-label');
        }
      }
      return 'button not found';
    })()
  `);
  console.log(`  ${actionResult}`);
  await sleep(2000);

  // Step 5: Confirm dialog if present
  console.log('Step 5: Checking for confirmation dialog...');
  const confirmResult = await evaluate(ws, `
    (async () => {
      await new Promise(r => setTimeout(r, 500));
      // Look for confirmation button
      const ok = document.querySelector('[name="ok"]');
      if (ok) {
        ok.click();
        return 'confirmed with name=ok';
      }

      // Gmail confirmation dialog
      const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
      for (const d of dialogs) {
        const btns = d.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.includes('確定') || b.textContent.includes('OK') || b.textContent.includes('ok')) {
            b.click();
            return 'confirmed dialog: ' + b.textContent.trim();
          }
        }
      }

      return 'no confirmation needed';
    })()
  `);
  console.log(`  ${confirmResult}`);
  await sleep(2000);

  // Step 6: Check result
  const finalTitle = await evaluate(ws, 'document.title');
  console.log('');
  console.log(`Done! Final title: ${finalTitle}`);

} finally {
  ws.close();
}
