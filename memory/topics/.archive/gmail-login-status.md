# Gmail login status — kuro.ai.agent@gmail.com

## 2026-04-18 credential inventory

**Located**: `.env` contains `GOOGLE_ACCOUNT` + `GOOGLE_PASSWORD` (main password, NOT App Password).

**Known gap** (from 2026-03-17-072 memory): this password fails IMAP auth — Google requires an App Password when 2FA is on. Alex never confirmed whether:
1. Current `.env` password is the main Google password (IMAP-blocked, web-login OK with 2FA challenge)
2. It's been rotated to an App Password (IMAP OK, but web-OAuth usually rejects App Password)

## 當前阻塞確認（2026-04-18 01:49 Taipei）
- gsd-browser headless daemon: SingletonLock 佔住 profile，啟不起來
- 裸 CDP 創 Gmail tab: 302 → `accounts.google.com/v3/signin/confirmidentifier` = cookie 過期
- Chrome CDP port 9222 (`/Users/user/.mini-agent/chrome-cdp-profile`): 已登 `alexlee7171`（Alex 本人），不是 `kuro.ai.agent`
- **profile contamination**：本 cycle 跑 `google-oauth-worker.mjs login` 結果 = need_human state=2fa，但 2fa 對象是 Alex 的帳戶（Google 顯示 alexlee7171@gmail.com "驗證您的身分"），不是 kuro。這個 profile 被 Alex 的 session 佔住，Google 要先驗 Alex 才肯讓其他人登入
- ~~`google-oauth-worker.mjs` state detector bug: 把「verify existing account」誤判為「2fa challenge」~~ **FIXED 2026-04-18 10:18** (Alex #058 "Bug 你可以自己修" 授權)：
  - 新增 `verify_wrong_account` state，在 2fa 分支**之前**觸發
  - Discriminator：page 有 "Verify it's you" / "驗證您的身分" / URL `confirmidentifier` **且** 頁面顯示 email ≠ GOOGLE_EMAIL → `verify_wrong_account`；否則才 fall through 到 2fa
  - 收窄 2fa trigger：移除裸 `'verify'` 和 `'驗證'` 子字串（過寬），只保留明確的 `'2-step verification'` / `'兩步驟驗證'`
  - Switch case 補上 `verify_wrong_account` 分支，emit `need_human` 時附帶 `shownEmail / expectedEmail / remedy="fresh user-data-dir"` 方便下游 agent 知道真正要做的是換 profile 不是叫人解 challenge
  - Syntax: `node --check` pass。Runtime verification 等 B2 delegate 或下次 gmail flow 實跑

## Next-cycle plan
1. **Fresh profile approach**：spawn 第二個 Chrome on port 9223 with `--user-data-dir=/Users/user/.mini-agent/chrome-kuro-profile`（全新目錄，無 SingletonLock 衝突，無 Alex cookies）
2. 修 worker 支援 `CDP_PORT` env（已支援）+ 加 `switch_account` flow: 先 logout Alex 再輸入 kuro 帳密
3. Expected：fresh device + VPN-less IP → Google 很可能要求 phone SMS 驗證（這是 anti-bot 標準防線）。如果 block 到這層 = real B2 blocker，需要 Alex 的手機或 backup code
4. 如果 step 1 新 profile Chrome 能成功過 kuro login（較樂觀路徑）→ 直接 unblock Mastodon email + TM 競賽郵件掃描

## Why this file exists
Previous cycles cascaded delegate failures (middleware offline, /accomplish timeouts). This doc is ground truth so next-cycle agent starts from location of creds, not "search again".
