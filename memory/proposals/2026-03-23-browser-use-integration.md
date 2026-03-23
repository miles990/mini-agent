# Proposal: browser-use 整合 — 從 script-first 到 perception-first 瀏覽

**Date**: 2026-03-23
**Status**: approved (Alex 核准 2026-03-23)
**Author**: Kuro
**Scope**: L2（新 delegation type + Python bridge）

## 問題

現有 CDP 腳本是 script-first — 每個網站需要硬編碼 DOM selector，改版就壞。這就是 Alex 說的「時常碰壁」。

碰壁的 plugin 清單：
- `line-web-live.sh` — LINE Web 登入流程變動就失效
- `x-perception.sh` — X/Twitter DOM 結構頻繁變動
- `cdp-events.sh` — 通用但仍需知道頁面結構
- `email-check.sh` — 需要各 mail provider 的 CDP 腳本

## 解決方案

新增 `browse` delegation type，底層用 browser-use + ChatClaudeCLI。

```
Kuro OODA cycle
  → <kuro:delegate type="browse">去 ArXiv 搜最新 multi-agent 論文</kuro:delegate>
  → delegation.ts spawn Python subprocess
  → browser-use Agent + ChatClaudeCLI (claude -p)
  → Chrome CDP → DOM 序列化 → LLM 決策 → 操作
  → 結果寫 lane-output/ → 下個 cycle 吸收
```

### 為什麼用 ChatClaudeCLI 而非 API

- mini-agent 原則：不走 Claude API（Alex #029 確認）
- ChatClaudeCLI 已完成+測試通過，走 `claude -p` OAuth
- 零額外成本（用現有 Claude Code 的 OAuth token）

## 技術設計

### 1. 新 delegation type: `browse`

```typescript
// src/types.ts
export type DelegationTaskType = 'code' | 'learn' | 'research' | 'create' | 'review' | 'shell' | 'browse';
```

### 2. Python runner script

`scripts/browser-use-run.py` — 接收任務 prompt，啟動 browser-use Agent，輸出結果到 stdout。

```python
#!/usr/bin/env python3
"""browser-use runner for mini-agent delegation."""
import asyncio, sys, json
from chat_claude_cli import ChatClaudeCLI
from browser_use import Agent

async def main():
    task = sys.stdin.read()
    llm = ChatClaudeCLI(model="claude-sonnet-4-6", timeout_seconds=180)
    agent = Agent(task=task, llm=llm)
    result = await agent.run()
    print(json.dumps({"result": result, "status": "ok"}))

asyncio.run(main())
```

### 3. delegation.ts 變更

`browse` type 不走 `claude -p`，走 `uv run python scripts/browser-use-run.py`：

```typescript
if (task.type === 'browse') {
  // Python subprocess with browser-use
  const proc = spawn('uv', ['run', 'python', 'scripts/browser-use-run.py'], {
    cwd: browserUseWorkdir,
    stdin: 'pipe',
  });
  proc.stdin.write(task.prompt);
  proc.stdin.end();
}
```

### 4. 配額與安全

- Max concurrent browse: 1（Chrome 資源重）
- Timeout: 180s（瀏覽任務需要更長）
- 不改現有 delegation 的 max concurrent 2 限制
- browse 獨立計數

## 不替換什麼

- `chrome-tabs.sh` — 輕量感知，不需 LLM，保留
- `chrome-status.sh` — 同上
- `port-check.sh` — 跟瀏覽無關
- `self-healing.sh` — 系統維護

## 替換候選

| 現有 plugin | browser-use 替代 | 優先度 |
|------------|-----------------|--------|
| `x-perception.sh` | `browse: "去 X 看我的 timeline 最新動態"` | 高 — DOM 最常變 |
| `line-web-live.sh` | `browse: "去 LINE Web 讀最新訊息"` | 中 — 登入流程複雜 |
| 手動 ArXiv 搜尋 | `browse: "搜 ArXiv 最新 X 論文"` | 高 — 已測試通過 |
| email 檢查 | `browse: "去 Gmail 看未讀信件"` | 低 — 登入複雜 |

## 實作步驟

1. [ ] 把 `chat_claude_cli.py` 從 workspace 移到 `scripts/`
2. [ ] 新增 `scripts/browser-use-run.py`
3. [ ] `src/types.ts` 加 `'browse'` type
4. [ ] `src/delegation.ts` 加 browse executor 路徑
5. [ ] 測試：delegate browse task → 自動跑 → 結果回到 lane-output

## 風險

- **Chrome 資源**: browse 佔 CPU/RAM，需限制 concurrent=1
- **速度**: 每步 3-5s，複雜任務可能 30s+，但開發成本趨近零
- **Vision**: ChatClaudeCLI 目前不支援圖片（CLI 限制），browser-use 的 screenshot 功能受限
- **回退**: 刪 browse type + scripts/ 兩個檔案即可（L1 回退）

## 登入 / 註冊 / OAuth 流程處理

browser-use 最大的實用價值之一：**自動化認證流程**。現有 CDP 腳本碰壁最多的就是各種登入。

### 場景分類

| 類型 | 範例 | browser-use 策略 |
|------|------|-----------------|
| **帳密登入** | Teaching Monster（Clerk）、Slack Web | Agent 自動找 login form → 填入 → 提交。credentials 從 `.env` 讀取 |
| **OAuth 跳轉** | Google OAuth → Gmail / Drive / YouTube Studio | Agent 點「用 Google 登入」→ 跟隨跳轉 → 在 Google 頁面輸入帳密 → 授權 → 回到原站 |
| **GitHub OAuth** | 第三方服務的「用 GitHub 登入」 | 同上，Chrome 已有 GitHub session → 通常只需要點「Authorize」 |
| **2FA / OTP** | 各種平台二階段驗證 | Agent 辨識 OTP input → 暫停 → 通知 Alex 手動輸入 or 讀 authenticator |
| **新帳號註冊** | 新平台 signup | Agent 填寫表單 → 處理 email verification（browse 去 Gmail 讀驗證信）→ 回到原站完成 |
| **Session 復用** | 已登入 Chrome profile | browser-use 連 Chrome CDP → 直接繼承現有 session，零登入動作 |

### 技術設計

#### Credentials 管理

```python
# scripts/browser-use-run.py 增加 credentials 解析
import os

CREDENTIALS = {
    "google": {
        "email": os.getenv("GOOGLE_EMAIL"),
        "password": os.getenv("GOOGLE_PASSWORD"),
    },
    "github": {
        "username": os.getenv("GITHUB_USERNAME"),
        "password": os.getenv("GITHUB_PASSWORD"),
    },
    "teaching_monster": {
        "email": os.getenv("TM_EMAIL"),
        "password": os.getenv("TM_PASSWORD"),
    },
}
```

Credentials 存在 `.env`（已在 `.gitignore`），不進 git。Agent prompt 裡用 `login with credentials for {service}` 觸發。

#### OAuth 流程指引

browser-use Agent 的 task prompt 裡加入 OAuth 步驟提示：

```
如果遇到登入頁面：
1. 先檢查是否有「用 Google 登入」「用 GitHub 登入」等 OAuth 按鈕
2. 優先用 OAuth（Chrome 可能已有 session）
3. 如果 OAuth 跳轉後需要帳密，使用提供的 credentials
4. 如果遇到 2FA/OTP，停止並回報「需要手動驗證」
5. 如果遇到 CAPTCHA，停止並回報「需要手動處理」
```

#### 2FA 處理策略

```
Agent 遇到 2FA →
  回傳 {"status": "needs_2fa", "service": "google", "type": "otp"}
  → delegation.ts 辨識 →
  → 通知 Alex（Telegram）：「Google 需要 OTP，請在 Chrome 手動輸入」
  → 等待 Alex 確認 → Agent 繼續
```

#### 註冊 + Email 驗證鏈

```
task: "去 example.com 註冊新帳號，email 用 xxx@gmail.com"
→ Agent 填 signup form → 提交
→ Agent 自動開新分頁 → 去 Gmail → 搜尋 example.com 的驗證信
→ 點驗證連結 → 回到 example.com → 完成
```

這是 browser-use 最強的地方 — 跨分頁、跨網站的連續任務，現有 CDP 腳本根本做不到。

### 替換候選（更新）

| 現有 plugin | browser-use 替代 | 優先度 | 認證類型 |
|------------|-----------------|--------|---------|
| `x-perception.sh` | `browse: "去 X 看我的 timeline 最新動態"` | 高 — DOM 最常變 | Session 復用 |
| `line-web-live.sh` | `browse: "去 LINE Web 讀最新訊息"` | 中 | OAuth (LINE Login) |
| 手動 ArXiv 搜尋 | `browse: "搜 ArXiv 最新 X 論文"` | 高 — 已測試通過 | 無需登入 |
| email 檢查 | `browse: "去 Gmail 看未讀信件"` | 中 | OAuth (Google) |
| Teaching Monster 後台 | `browse: "去 TM 後台查看提交狀態"` | 中 | Clerk (帳密) |
| Slack workspace | `browse: "去 TM Slack 看 #discussion 最新訊息"` | 中 | OAuth (Google/Apple) |
| 新平台註冊 | `browse: "去 xxx.com 註冊帳號 email yyy"` | 低 | 註冊 + email 驗證鏈 |

### 實作步驟（更新）

1. [ ] 把 `chat_claude_cli.py` 從 workspace 移到 `scripts/`
2. [ ] 新增 `scripts/browser-use-run.py`（含 credentials 解析 + 2FA 回報）
3. [ ] `.env` 加入各服務 credentials
4. [ ] `src/types.ts` 加 `'browse'` type
5. [ ] `src/delegation.ts` 加 browse executor（含 2FA 暫停 + Telegram 通知）
6. [ ] 測試 Phase 1：Session 復用（HN、ArXiv — 無需登入）
7. [ ] 測試 Phase 2：帳密登入（Teaching Monster Clerk）
8. [ ] 測試 Phase 3：OAuth 流程（Google → Gmail）
9. [ ] 測試 Phase 4：跨站鏈（註冊 + email 驗證）

### 安全考量

- Credentials **不進 git**（`.env` 已在 `.gitignore`）
- 2FA/CAPTCHA 一律人工介入，不嘗試自動繞過
- OAuth 授權範圍由 Chrome 的已登入 session 控制，不申請額外權限
- browse 任務 log 不記錄 credentials 明文（輸出 sanitize）

## 預期收益

- 新網站互動零開發成本（一句話指令 vs 寫 CDP 腳本）
- 網站改版不壞（LLM 看 DOM 語義而非 hardcoded selector）
- 與 mini-agent 的 perception-first 哲學一致
- **登入/註冊自動化** — 從「每個站寫一個登入腳本」變成「一句話搞定」
- **OAuth 跨站鏈** — 跨分頁、跨網站的連續任務，現有架構做不到
- **2FA 優雅降級** — 自動化到不能自動化的邊界，再通知人工介入
