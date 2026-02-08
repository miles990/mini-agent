#!/usr/bin/env node
/**
 * Gmail Batch Operation — Repeats select-all + delete/archive until no results
 *
 * Usage:
 *   node scripts/gmail-batch-op.mjs delete "from:tumblr.com"
 *   node scripts/gmail-batch-op.mjs archive "category:social older_than:30d"
 *   node scripts/gmail-batch-op.mjs delete "category:promotions older_than:30d"
 */

const CDP_BASE = `http://${process.env.CDP_HOST || 'localhost'}:${process.env.CDP_PORT || '9222'}`;

async function getGmailWs() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found');
  const ws = new WebSocket(gmail.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WS error')); });
  });
  await cdp(ws, 'Runtime.enable');
  return ws;
}

let _id = 1;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = _id++;
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 30000);
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function navigateAndWait(ws, hash) {
  await evaluate(ws, `window.location.hash = '${hash}'; 'ok'`);
  await sleep(3000);
}

async function getResultCount(ws) {
  const r = await evaluate(ws, `
    (() => {
      const rows = document.querySelectorAll('tr.zA');
      const dj = document.querySelector('.Dj');
      const djText = dj ? dj.textContent.trim() : '';
      // Check for "no results" message
      const noResults = document.querySelector('.TC');
      const noResultsText = noResults ? noResults.textContent.trim() : '';
      return JSON.stringify({ rows: rows.length, status: djText, noResults: noResultsText });
    })()
  `);
  try { return JSON.parse(r); } catch { return { rows: 0, status: r, noResults: '' }; }
}

async function selectAllOnPage(ws) {
  return await evaluate(ws, `
    (async () => {
      const checkboxes = document.querySelectorAll('[role="checkbox"]');
      if (checkboxes.length === 0) return 'no checkboxes';

      // First checkbox is the main select-all
      checkboxes[0].click();
      await new Promise(r => setTimeout(r, 800));

      // Try to find and click "Select all conversations" banner
      const allElements = document.querySelectorAll('span, a');
      for (const el of allElements) {
        const text = el.textContent.trim();
        if ((text.includes('選取與這項搜尋') || text.includes('Select all conversations that match'))
            && text.length < 150 && !text.includes('已選取')) {
          el.click();
          await new Promise(r => setTimeout(r, 800));
          return 'selected-all-matching: ' + text.slice(0, 80);
        }
      }

      return 'selected-page-only';
    })()
  `);
}

async function clickAction(ws, action) {
  const labels = action === 'delete'
    ? ['刪除', 'Delete']
    : ['封存', 'Archive'];

  return await evaluate(ws, `
    (async () => {
      const btn = document.querySelector('[aria-label="${labels[0]}"]')
        || document.querySelector('[aria-label="${labels[1]}"]');
      if (!btn) return 'button not found';
      btn.click();

      // Wait for possible confirmation dialog
      await new Promise(r => setTimeout(r, 1500));

      // Check for confirmation
      const ok = document.querySelector('[name="ok"]');
      if (ok) {
        ok.click();
        await new Promise(r => setTimeout(r, 500));
        return '${action}-confirmed';
      }

      // Also check dialog buttons
      const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
      for (const d of dialogs) {
        const btns = d.querySelectorAll('button');
        for (const b of btns) {
          const t = b.textContent.trim();
          if (t === '確定' || t === 'OK') {
            b.click();
            await new Promise(r => setTimeout(r, 500));
            return '${action}-dialog-confirmed';
          }
        }
      }

      return '${action}-done';
    })()
  `);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const action = process.argv[2]; // delete or archive
const query = process.argv.slice(3).join(' ');

if (!action || !query) {
  console.error('Usage: gmail-batch-op.mjs <delete|archive> <search-query>');
  process.exit(1);
}

console.log(`=== Gmail Batch ${action.toUpperCase()} ===`);
console.log(`Query: ${query}`);
console.log('');

const ws = await getGmailWs();
const hash = '#search/' + encodeURIComponent(query);
let round = 0;
const MAX_ROUNDS = 50;

try {
  while (round < MAX_ROUNDS) {
    round++;

    // Navigate to search
    console.log(`--- Round ${round} ---`);
    await navigateAndWait(ws, hash);

    // Check if there are results
    const count = await getResultCount(ws);
    console.log(`  Results: ${count.status} (${count.rows} visible rows)`);

    if (count.rows === 0 || count.noResults.includes('沒有') || count.noResults.includes('No results')) {
      console.log('  No more results. Done!');
      break;
    }

    // Select all
    const selectResult = await selectAllOnPage(ws);
    console.log(`  Select: ${selectResult}`);

    // Perform action
    const actionResult = await clickAction(ws, action);
    console.log(`  Action: ${actionResult}`);

    if (actionResult.includes('not found')) {
      console.log('  ERROR: Action button not found. Stopping.');
      break;
    }

    // Wait for Gmail to process
    await sleep(3000);
  }

  if (round >= MAX_ROUNDS) {
    console.log(`Reached max rounds (${MAX_ROUNDS}). There may still be more emails.`);
  }

  // Final check
  await navigateAndWait(ws, hash);
  const final = await getResultCount(ws);
  console.log('');
  console.log(`=== Final Status ===`);
  console.log(`Remaining: ${final.status} (${final.rows} visible)`);
  console.log(`Rounds completed: ${round}`);

} finally {
  ws.close();
}
