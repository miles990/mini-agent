#!/usr/bin/env node
/**
 * Google OAuth Worker — Observable, debuggable, reliable.
 *
 * Middleware worker (shell backend) that wraps Google OAuth login via CDP.
 * Each step emits structured JSON to stdout for 中台 observability.
 *
 * Usage:
 *   node scripts/google-oauth-worker.mjs check               # Check if already logged in
 *   node scripts/google-oauth-worker.mjs login                # Full OAuth login flow
 *   node scripts/google-oauth-worker.mjs login <service-url>  # Login via Google on a specific service
 *   node scripts/google-oauth-worker.mjs cookies              # Dump Google auth cookies
 *
 * Output: NDJSON (one JSON object per line) — last line is the final result.
 *   { "step": "...", "status": "ok|fail|skip", "detail": "...", "screenshot": "/tmp/...", "ts": "..." }
 *
 * Exit codes:
 *   Always 0 (middleware shell backend treats non-zero as crash).
 *   Real status is in the final JSON line's "status" field: ok / fail / need_human.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL || 'kuro.ai.agent@gmail.com';
const STEP_TIMEOUT = 15_000;
const NAV_TIMEOUT = 20_000;

const DIAG_DIR = '/tmp/google-oauth-worker';
if (!existsSync(DIAG_DIR)) mkdirSync(DIAG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Structured Output ────────────────────────────────────────────────────────

let stepIndex = 0;

function emit(step, status, detail, extra = {}) {
  stepIndex++;
  const entry = {
    step,
    status,
    detail,
    index: stepIndex,
    ts: new Date().toISOString(),
    ...extra,
  };
  console.log(JSON.stringify(entry));
  return entry;
}

function emitOk(step, detail, extra) { return emit(step, 'ok', detail, extra); }
function emitFail(step, detail, extra) { return emit(step, 'fail', detail, extra); }
function emitSkip(step, detail, extra) { return emit(step, 'skip', detail, extra); }
function emitNeedHuman(step, detail, extra) { return emit(step, 'need_human', detail, extra); }

// ─── CDP Helpers (extracted from cdp-fetch.mjs / x-login-tweet.mjs) ──────────

function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e8);
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), STEP_TIMEOUT);
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

function waitForEvent(ws, eventName, timeoutMs = NAV_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Event timeout: ${eventName}`));
    }, timeoutMs);
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

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 10_000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

async function createTarget(url) {
  const res = await fetch(`${CDP_BASE}/json/new?${url}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
}

async function closeTarget(targetId) {
  try { await fetch(`${CDP_BASE}/json/close/${targetId}`, { signal: AbortSignal.timeout(3000) }); } catch {}
}

async function connectToTarget(targetOrId) {
  let target = targetOrId;
  if (typeof targetOrId === 'string') {
    const targets = await listTargets();
    target = targets.find(t => t.id === targetOrId || t.id.startsWith(targetOrId));
    if (!target) throw new Error(`Tab not found: ${targetOrId}`);
  }
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('No WebSocket URL for this tab');
  const ws = await connectWs(wsUrl);
  await cdpCommand(ws, 'Runtime.enable');
  await cdpCommand(ws, 'Page.enable');
  await cdpCommand(ws, 'DOM.enable');
  await cdpCommand(ws, 'Accessibility.enable');
  return { ws, target };
}

async function screenshotToFile(ws, name) {
  const filename = `${DIAG_DIR}/${name}.png`;
  try {
    const result = await cdpCommand(ws, 'Page.captureScreenshot', { format: 'png', quality: 80 });
    writeFileSync(filename, Buffer.from(result.data, 'base64'));
    return filename;
  } catch {
    return null;
  }
}

async function getPageInfo(ws) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, title: document.title })`,
    returnByValue: true,
  });
  return JSON.parse(result.result?.value || '{}');
}

async function getPageText(ws) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'document.body?.innerText?.slice(0, 2000) || ""',
    returnByValue: true,
  });
  return result.result?.value || '';
}

async function getA11yTree(ws) {
  const result = await cdpCommand(ws, 'Accessibility.getFullAXTree', {});
  return result.nodes || [];
}

async function findNode(ws, predicate) {
  const nodes = await getA11yTree(ws);
  return nodes.find(predicate);
}

async function clickNode(ws, node) {
  if (!node?.backendDOMNodeId) return false;
  try {
    const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    if (resolved.object?.objectId) {
      await cdpCommand(ws, 'Runtime.callFunctionOn', {
        objectId: resolved.object.objectId,
        functionDeclaration: 'function() { this.scrollIntoView({block:"center"}); this.click(); }',
      });
      return true;
    }
  } catch {}
  return false;
}

async function focusAndType(ws, node, text) {
  if (!node?.backendDOMNodeId) return false;
  try {
    const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    if (resolved.object?.objectId) {
      await cdpCommand(ws, 'Runtime.callFunctionOn', {
        objectId: resolved.object.objectId,
        functionDeclaration: 'function() { this.focus(); this.value = ""; }',
      });
      for (const char of text) {
        await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
        await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
      }
      return true;
    }
  } catch {}
  return false;
}

async function pressEnter(ws) {
  await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

async function findClickableByText(ws, hints, roleFilter = null) {
  const roles = roleFilter ? [roleFilter] : ['button', 'link'];
  const nodes = await getA11yTree(ws);
  for (const hint of hints) {
    const h = hint.toLowerCase();
    const match = nodes.find(n =>
      roles.includes(n.role?.value) &&
      n.name?.value?.toLowerCase().includes(h)
    );
    if (match) return match;
  }
  return null;
}

async function waitForNavigation(ws, timeoutMs = NAV_TIMEOUT) {
  try {
    await waitForEvent(ws, 'Page.loadEventFired', timeoutMs);
    await sleep(1500);
  } catch {
    await sleep(1500);
  }
}

function safeClose(ws) {
  try { if (ws?.readyState === WebSocket.OPEN) ws.close(); } catch {}
}

function getInteractableList(nodes) {
  return nodes
    .filter(n => ['button', 'link', 'textbox', 'combobox'].includes(n.role?.value) && n.name?.value)
    .map(n => `[${n.role.value}] ${n.name.value.slice(0, 80)}`)
    .slice(0, 20);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * CHECK: Verify if we're already logged into Google.
 * Navigate to myaccount.google.com and see if it shows the account page.
 */
async function actionCheck() {
  // Step 1: CDP health
  let version;
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(5000) });
    version = await res.json();
    emitOk('cdp_health', `Chrome ${version['Browser']}`, { browser: version['Browser'] });
  } catch (err) {
    emitFail('cdp_health', `CDP not reachable at ${CDP_BASE}: ${err.message}`);
    process.exit(0);
  }

  // Step 2: Navigate to Google account page
  let target, ws;
  try {
    target = await createTarget('https://myaccount.google.com/');
    ({ ws } = await connectToTarget(target.id));
    await waitForNavigation(ws);
    await sleep(2000);
  } catch (err) {
    emitFail('navigate', `Failed to open myaccount.google.com: ${err.message}`);
    process.exit(0);
  }

  // Step 3: Detect state
  const info = await getPageInfo(ws);
  const shot = await screenshotToFile(ws, 'check');
  const text = await getPageText(ws);

  const isLoggedIn = info.url.includes('myaccount.google.com') &&
    !info.url.includes('signin') &&
    !info.url.includes('ServiceLogin') &&
    (text.includes(GOOGLE_EMAIL) || text.includes('kuro') || text.includes('Google Account') || text.includes('Google 帳戶'));

  const isBlocked = text.toLowerCase().includes('unusual activity') ||
    text.toLowerCase().includes('verify it') ||
    text.includes('異常活動') ||
    text.includes('驗證');

  if (isLoggedIn) {
    emitOk('check_login', `Already logged in as ${GOOGLE_EMAIL}`, { screenshot: shot, url: info.url });
  } else if (isBlocked) {
    emitNeedHuman('check_login', 'Google security challenge detected', { screenshot: shot, url: info.url, page_text: text.slice(0, 500) });
  } else {
    emitFail('check_login', 'Not logged in', { screenshot: shot, url: info.url, page_text: text.slice(0, 500) });
  }

  // Cleanup
  safeClose(ws);
  await closeTarget(target.id);

  // Final result
  const finalStatus = isLoggedIn ? 'ok' : isBlocked ? 'need_human' : 'fail';
  emit('result', finalStatus, isLoggedIn ? 'authenticated' : 'not_authenticated', {
    email: GOOGLE_EMAIL,
    logged_in: isLoggedIn,
    blocked: isBlocked,
  });

  process.exit(0);
}

/**
 * LOGIN: Full Google OAuth login flow.
 * If service URL provided, navigate there and find "Sign in with Google".
 * Otherwise, go directly to accounts.google.com.
 */
async function actionLogin(serviceUrl) {
  // Step 1: CDP health check
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(5000) });
    const version = await res.json();
    emitOk('cdp_health', `Chrome ${version['Browser']}`);
  } catch (err) {
    emitFail('cdp_health', `CDP not reachable at ${CDP_BASE}: ${err.message}`);
    process.exit(0);
  }

  let target, ws;

  // Step 2: Navigate
  const startUrl = serviceUrl || 'https://accounts.google.com/';
  try {
    target = await createTarget(startUrl);
    ({ ws } = await connectToTarget(target.id));
    await waitForNavigation(ws);
    await sleep(2000);

    const info = await getPageInfo(ws);
    const shot = await screenshotToFile(ws, 'step-01-navigate');
    emitOk('navigate', `Loaded: ${info.title}`, { screenshot: shot, url: info.url });
  } catch (err) {
    emitFail('navigate', `Failed to open ${startUrl}: ${err.message}`);
    process.exit(0);
  }

  // Step 3: If service URL, find and click Google sign-in button
  if (serviceUrl) {
    const googleBtn = await findClickableByText(ws, ['Google', 'google', 'Sign in with Google', '使用 Google 帳戶登入']);
    if (googleBtn) {
      await clickNode(ws, googleBtn);
      emitOk('find_google_btn', `Clicked: "${googleBtn.name.value.slice(0, 60)}"`);
      await sleep(3000);

      // Check if Google OAuth opened in same tab or new tab
      let info = await getPageInfo(ws);
      if (!info.url.includes('accounts.google.com')) {
        // Check other tabs
        const targets = await listTargets();
        const googleTab = targets.find(t => t.url.includes('accounts.google.com'));
        if (googleTab) {
          safeClose(ws);
          ({ ws } = await connectToTarget(googleTab.id));
          await sleep(2000);
          info = await getPageInfo(ws);
          emitOk('google_tab_switch', `Switched to Google auth tab`, { url: info.url });
        }
      }
    } else {
      // Try JS-based detection
      const jsClicked = await cdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const btns = document.querySelectorAll('button, a, [role="button"]');
          for (const b of btns) {
            const t = (b.textContent + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
            if (t.includes('google')) { b.click(); return b.textContent.trim().slice(0, 60); }
          }
          return null;
        })()`,
        returnByValue: true,
      });
      if (jsClicked.result?.value) {
        emitOk('find_google_btn', `Clicked via JS: "${jsClicked.result.value}"`);
        await sleep(3000);
      } else {
        const shot = await screenshotToFile(ws, 'step-02-no-google-btn');
        const nodes = await getA11yTree(ws);
        emitFail('find_google_btn', 'Google sign-in button not found on service page', {
          screenshot: shot,
          interactable: getInteractableList(nodes),
        });
        safeClose(ws);
        await closeTarget(target.id);
        process.exit(0);
      }
    }
  }

  // Step 4: Handle Google Auth page
  const authInfo = await getPageInfo(ws);
  const authShot = await screenshotToFile(ws, 'step-03-google-auth');

  if (!authInfo.url.includes('accounts.google.com') && !authInfo.url.includes('google.com/o/oauth2')) {
    emitFail('detect_google', `Not on Google auth page. URL: ${authInfo.url}`, { screenshot: authShot });
    safeClose(ws);
    await closeTarget(target.id);
    process.exit(0);
  }

  emitOk('detect_google', `On Google auth: ${authInfo.url}`, { screenshot: authShot });

  // Step 5: Detect auth state — account chooser / email entry / password / 2FA / consent
  const authState = await detectGoogleState(ws);
  const stateShot = await screenshotToFile(ws, `step-04-state-${authState.state}`);
  emitOk('detect_state', `Auth state: ${authState.state}`, { screenshot: stateShot, state: authState.state, detail: authState.detail });

  // Step 6: Execute auth state machine
  let result;
  try {
    result = await executeAuthFlow(ws, authState, target.id);
  } catch (err) {
    const errShot = await screenshotToFile(ws, 'step-error');
    emitFail('auth_flow', `Auth flow error: ${err.message}`, { screenshot: errShot });
    safeClose(ws);
    await closeTarget(target.id);
    process.exit(0);
  }

  // Final result
  safeClose(ws);
  await closeTarget(target.id);

  emit('result', result.status, result.detail, {
    email: GOOGLE_EMAIL,
    logged_in: result.status === 'ok',
    final_url: result.url,
  });

  process.exit(0);
}

/**
 * Detect which Google auth state we're in.
 */
async function detectGoogleState(ws) {
  const nodes = await getA11yTree(ws);
  const text = await getPageText(ws);
  const info = await getPageInfo(ws);
  const textLower = text.toLowerCase();

  // Account chooser — shows email addresses to pick
  const accountNode = nodes.find(n =>
    n.name?.value?.toLowerCase().includes('kuro.ai.agent') ||
    n.name?.value?.toLowerCase().includes(GOOGLE_EMAIL.split('@')[0])
  );
  if (accountNode) {
    return { state: 'account_chooser', node: accountNode, detail: `Account found: ${accountNode.name.value.slice(0, 60)}` };
  }

  // "Use another account" present → account chooser but our account not shown
  const useAnother = nodes.find(n =>
    n.name?.value?.toLowerCase().includes('use another account') ||
    n.name?.value?.includes('使用其他帳戶')
  );

  // Email entry — textbox for email
  const emailField = nodes.find(n =>
    n.role?.value === 'textbox' &&
    (n.name?.value?.toLowerCase().includes('email') ||
     n.name?.value?.toLowerCase().includes('phone') ||
     n.name?.value?.includes('電子郵件') ||
     n.name?.value?.includes('電話'))
  );
  if (emailField) {
    return { state: 'email_entry', node: emailField, detail: 'Email input field detected' };
  }

  if (useAnother) {
    return { state: 'account_chooser_no_match', node: useAnother, detail: 'Account chooser but our account not listed — need "Use another account"' };
  }

  // Password entry
  const passwordField = nodes.find(n =>
    n.role?.value === 'textbox' &&
    (n.name?.value?.toLowerCase().includes('password') || n.name?.value?.includes('密碼'))
  );
  if (passwordField || textLower.includes('enter your password') || text.includes('輸入密碼')) {
    return { state: 'password_entry', node: passwordField, detail: 'Password entry page' };
  }

  // 2FA / Security challenge
  if (textLower.includes('2-step verification') || textLower.includes('verify') ||
      text.includes('兩步驟驗證') || text.includes('驗證')) {
    return { state: '2fa', detail: '2FA / security challenge' };
  }

  // Consent / Allow
  const consentBtn = nodes.find(n =>
    n.role?.value === 'button' &&
    (n.name?.value?.toLowerCase().includes('allow') ||
     n.name?.value?.toLowerCase().includes('continue') ||
     n.name?.value?.includes('允許') ||
     n.name?.value?.includes('繼續'))
  );
  if (consentBtn) {
    return { state: 'consent', node: consentBtn, detail: `Consent button: ${consentBtn.name.value.slice(0, 40)}` };
  }

  // Already logged in — redirected away from accounts.google.com
  if (!info.url.includes('accounts.google.com') && !info.url.includes('ServiceLogin')) {
    return { state: 'already_logged_in', detail: `Redirected to ${info.url}` };
  }

  // Blocked / unusual
  if (textLower.includes('unusual activity') || textLower.includes('couldn\'t sign you in') ||
      text.includes('異常活動') || text.includes('無法登入')) {
    return { state: 'blocked', detail: 'Google blocked the login attempt' };
  }

  return {
    state: 'unknown',
    detail: `URL: ${info.url}`,
    interactable: getInteractableList(nodes),
    page_text: text.slice(0, 500),
  };
}

/**
 * Execute the appropriate auth flow based on detected state.
 */
async function executeAuthFlow(ws, authState, targetId) {
  switch (authState.state) {
    case 'already_logged_in':
      return { status: 'ok', detail: 'Already authenticated', url: (await getPageInfo(ws)).url };

    case 'account_chooser': {
      // Click our account
      const clicked = await clickNode(ws, authState.node);
      if (!clicked) return { status: 'fail', detail: 'Could not click account', url: '' };
      emitOk('click_account', `Selected account: ${authState.node.name.value.slice(0, 60)}`);
      await sleep(4000);

      // Recurse — might need password, consent, or be done
      const nextState = await detectGoogleState(ws);
      const shot = await screenshotToFile(ws, `step-05-after-account-${nextState.state}`);
      emitOk('after_account', `Next state: ${nextState.state}`, { screenshot: shot });
      return executeAuthFlow(ws, nextState, targetId);
    }

    case 'account_chooser_no_match': {
      // Click "Use another account" then enter email
      await clickNode(ws, authState.node);
      emitOk('click_use_another', 'Clicked "Use another account"');
      await sleep(3000);
      const nextState = await detectGoogleState(ws);
      return executeAuthFlow(ws, nextState, targetId);
    }

    case 'email_entry': {
      // Type email and submit
      const typed = await focusAndType(ws, authState.node, GOOGLE_EMAIL);
      if (!typed) return { status: 'fail', detail: 'Could not type in email field', url: '' };
      emitOk('type_email', `Typed: ${GOOGLE_EMAIL}`);
      await sleep(500);

      // Click Next or press Enter
      const nextBtn = await findClickableByText(ws, ['Next', '下一步', '繼續'], 'button');
      if (nextBtn) {
        await clickNode(ws, nextBtn);
      } else {
        await pressEnter(ws);
      }
      emitOk('submit_email', 'Submitted email');
      await sleep(4000);

      // Recurse
      const nextState = await detectGoogleState(ws);
      const shot = await screenshotToFile(ws, `step-06-after-email-${nextState.state}`);
      emitOk('after_email', `Next state: ${nextState.state}`, { screenshot: shot });
      return executeAuthFlow(ws, nextState, targetId);
    }

    case 'password_entry': {
      // Password — we can't type it (no env var for security). Signal need_human.
      const shot = await screenshotToFile(ws, 'step-need-password');
      emitNeedHuman('password', 'Password entry required — human intervention needed', { screenshot: shot });
      return { status: 'need_human', detail: 'Password entry required', url: (await getPageInfo(ws)).url };
    }

    case '2fa': {
      const shot = await screenshotToFile(ws, 'step-need-2fa');
      emitNeedHuman('2fa', '2FA challenge — human intervention needed', { screenshot: shot });
      return { status: 'need_human', detail: '2FA challenge', url: (await getPageInfo(ws)).url };
    }

    case 'consent': {
      // Click Allow/Continue
      const clicked = await clickNode(ws, authState.node);
      if (!clicked) return { status: 'fail', detail: 'Could not click consent button', url: '' };
      emitOk('consent', `Clicked: ${authState.node.name.value.slice(0, 40)}`);
      await sleep(4000);

      // Check final state
      const info = await getPageInfo(ws);
      const shot = await screenshotToFile(ws, 'step-07-after-consent');
      emitOk('after_consent', `Redirected to: ${info.url}`, { screenshot: shot });

      // If we're back on the service or on Google account page, success
      const isGoodState = !info.url.includes('accounts.google.com/signin') &&
                          !info.url.includes('ServiceLogin');
      return {
        status: isGoodState ? 'ok' : 'fail',
        detail: isGoodState ? 'Consent granted, authenticated' : 'Still on sign-in after consent',
        url: info.url,
      };
    }

    case 'blocked': {
      const shot = await screenshotToFile(ws, 'step-blocked');
      emitFail('blocked', 'Google blocked the login attempt', { screenshot: shot });
      return { status: 'fail', detail: 'Blocked by Google', url: (await getPageInfo(ws)).url };
    }

    case 'unknown': {
      const shot = await screenshotToFile(ws, 'step-unknown');
      emitFail('unknown_state', 'Unrecognized auth page state', {
        screenshot: shot,
        interactable: authState.interactable,
        page_text: authState.page_text,
      });
      return { status: 'fail', detail: 'Unknown auth state', url: (await getPageInfo(ws)).url };
    }

    default:
      return { status: 'fail', detail: `Unhandled state: ${authState.state}`, url: '' };
  }
}

/**
 * COOKIES: Dump Google auth cookies for the current profile.
 */
async function actionCookies() {
  try {
    await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(5000) });
    emitOk('cdp_health', 'CDP reachable');
  } catch (err) {
    emitFail('cdp_health', `CDP not reachable: ${err.message}`);
    process.exit(0);
  }

  const target = await createTarget('about:blank');
  const { ws } = await connectToTarget(target.id);

  const { cookies } = await cdpCommand(ws, 'Network.getCookies', {
    urls: ['https://accounts.google.com', 'https://myaccount.google.com', 'https://www.google.com'],
  });

  const authCookies = cookies.filter(c =>
    ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', 'NID'].includes(c.name)
  );

  safeClose(ws);
  await closeTarget(target.id);

  if (authCookies.length > 0) {
    emitOk('cookies', `Found ${authCookies.length} Google auth cookies`, {
      cookies: authCookies.map(c => ({ name: c.name, domain: c.domain, expires: c.expires, secure: c.secure })),
    });
  } else {
    emitFail('cookies', 'No Google auth cookies found (not logged in)', { total_cookies: cookies.length });
  }

  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, action, ...args] = process.argv;

switch (action) {
  case 'check':
    await actionCheck();
    break;
  case 'login':
    await actionLogin(args[0] || null);
    break;
  case 'cookies':
    await actionCookies();
    break;
  default:
    console.error('Usage: google-oauth-worker.mjs <check|login|cookies> [service-url]');
    console.error('  check              — Check if already logged into Google');
    console.error('  login              — Direct Google login');
    console.error('  login <url>        — Login via Google on a service (e.g., teaching.monster)');
    console.error('  cookies            — Dump Google auth cookies');
    process.exit(0);
}
