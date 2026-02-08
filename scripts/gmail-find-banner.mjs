#!/usr/bin/env node
/**
 * Debug script: Find the "Select all conversations" banner in Gmail
 */

const CDP_BASE = `http://localhost:${process.env.CDP_PORT || '9222'}`;

async function getGmailWs() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found');
  const ws = new WebSocket(gmail.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('error')); });
  });

  let _id = 0;
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++_id;
    const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(t);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await cdp('Runtime.enable');
  const evaluate = async (js) => {
    const r = await cdp('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  return { ws, evaluate, close: () => ws.close() };
}

const { evaluate, close } = await getGmailWs();

const step = process.argv[2] || 'search';

if (step === 'search') {
  // First navigate to search
  console.log('Navigating to Tumblr search...');
  await evaluate("window.location.hash = '#search/from%3Atumblr.com'; 'ok'");
  await new Promise(r => setTimeout(r, 3000));
  console.log('Page:', await evaluate('document.title'));
}

if (step === 'select' || step === 'search') {
  // Click select-all
  console.log('\nClicking select-all checkbox...');
  const r = await evaluate(`
    (() => {
      const cbs = document.querySelectorAll('[role="checkbox"]');
      if (cbs.length === 0) return 'no checkboxes found';
      cbs[0].click();
      return 'clicked first checkbox (' + cbs.length + ' total)';
    })()
  `);
  console.log(r);

  // Wait for banner to appear
  await new Promise(r => setTimeout(r, 1500));
}

if (step === 'find' || step === 'select' || step === 'search') {
  // Deep scan for the banner
  console.log('\nScanning for "select all" banner...');

  const result = await evaluate(`
    (async () => {
      const results = [];

      // Method 1: Check the Gmail toolbar area (.aqJ is the main toolbar container)
      const toolbarArea = document.querySelector('.aqJ');
      if (toolbarArea) {
        results.push('aqJ toolbar text: ' + toolbarArea.textContent.trim().slice(0, 200));
      }

      // Method 2: Look for any span containing "選取" or "Select all"
      const allSpans = document.querySelectorAll('span');
      const selectSpans = [];
      for (const s of allSpans) {
        const t = s.textContent.trim();
        if ((t.includes('選取') || t.includes('Select all')) && t.length > 5 && t.length < 200) {
          selectSpans.push({
            text: t.slice(0, 100),
            class: s.className.slice(0, 50),
            parent: s.parentElement?.className?.slice(0, 50) || '',
            visible: s.offsetParent !== null,
          });
        }
      }
      results.push('select spans: ' + JSON.stringify(selectSpans));

      // Method 3: Check .ya class (Gmail banner area)
      const yaElements = document.querySelectorAll('.ya');
      for (const y of yaElements) {
        results.push('.ya element: ' + y.textContent.trim().slice(0, 200) + ' | class: ' + y.className);
      }

      // Method 4: Check all divs with short text that mentions "已選取" or "selected"
      const divs = document.querySelectorAll('div');
      const selectedDivs = [];
      for (const d of divs) {
        const t = d.textContent.trim();
        if ((t.includes('已選取') || t.includes('are selected') || t.includes('所有會話')) && t.length < 300) {
          if (!selectedDivs.some(s => s.text === t.slice(0, 100))) {
            selectedDivs.push({
              text: t.slice(0, 150),
              class: d.className.slice(0, 50),
              tag: d.tagName,
              display: getComputedStyle(d).display,
            });
          }
        }
      }
      results.push('selected divs: ' + JSON.stringify(selectedDivs.slice(0, 5)));

      // Method 5: Check the notification banner area (.Bk)
      const bk = document.querySelector('.Bk');
      if (bk) {
        results.push('.Bk text: ' + bk.textContent.trim().slice(0, 200) + ' | display: ' + getComputedStyle(bk).display);
      }

      return results.join('\\n---\\n');
    })()
  `);

  console.log(result);
}

close();
