# Proposal: 開源準備 — 敏感資訊與個人資料分離

## Meta
- Status: pending
- From: kuro
- Effort: M（逐步進行，每項 5-15 分鐘）
- Created: 2026-03-02
- Drive: Alex 指示「帳號密碼要抽出來」+「列個清單，任務做完可以刪除」

## 背景

mini-agent 從一開始就是「Kuro 專用」寫的，沒有設計 config 抽象層。Tokens/API keys 已正確放在 `.env`（做得對），但帳號名稱、email、個人 URL 散落在 scripts 和設定中。要開源需要分離。

## 三層分離方案

| 層 | 內容 | 處理方式 |
|----|------|----------|
| **Framework** | `src/`、通用 scripts、架構 | 保持 generic，不含任何個人資料 |
| **Identity** | SOUL.md、memory/、kuro-portfolio/ | 開源時提供 template，實際內容不進 public repo |
| **Runtime** | `~/.mini-agent/instances/` | 已在 .gitignore，OK |

## Checklist

### 1. 已在 .env 的（OK，不用動）
- [x] `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- [x] `XAI_API_KEY`
- [x] `GOOGLE_PASSWORD`（環境變數）
- [x] `DIGEST_BOT_TOKEN`
- [x] `MINI_AGENT_API_KEY`

### 2. Scripts 中的 hardcode（需修）
- [ ] `scripts/email.sh` — hardcoded `kuro.ai.agent@gmail.com`、IMAP server、SMTP server
  → 改讀環境變數 `$AGENT_EMAIL`、`$IMAP_HOST`、`$SMTP_HOST`
- [ ] `scripts/cdp-fetch.mjs` — hardcoded Chrome profile path `~/.mini-agent/chrome-cdp-profile`
  → 可保留（通用路徑，不含個人資訊）

### 3. 程式碼中的帳號引用（需修）
- [ ] `src/dispatcher.ts` — hardcoded `kuro.ai.agent@gmail.com`（email skill 呼叫處）
  → 改讀 `process.env.AGENT_EMAIL`
- [ ] `src/telegram.ts` — Telegram bot username 可能 hardcoded
  → 檢查是否從 env 讀取，確認 OK

### 4. Portfolio / 網站（需決策）
- [ ] `kuro-portfolio/` — 整個目錄是 Kuro 的個人網站
  → 決策：開源時 (a) 移到獨立 repo (b) 加到 .gitignore (c) 保留作為範例
- [ ] `kuro-portfolio/media/avatar-kuro.png` — Kuro 的頭像
  → 跟隨 portfolio 決策

### 5. GitHub 相關（需修）
- [ ] `.github/workflows/deploy.yml` — self-hosted runner 設定
  → 開源時提供 generic 範例，附註自行配置
- [ ] SSH config `~/.ssh/kuro-agent` — 已在 home 目錄，不在 repo 裡，OK

### 6. SOUL.md / Memory（需決策）
- [ ] `memory/SOUL.md` — Kuro 的身份定義
  → 開源時提供 `memory/SOUL.md.example`
- [ ] `memory/MEMORY.md` — Kuro 的記憶
  → 開源時清空或提供 template
- [ ] `memory/topics/*.md` — 主題記憶
  → 開源時不含，提供空目錄 + README

### 7. CLAUDE.md（需修）
- [ ] 目前包含大量 Kuro-specific 資訊（帳號清單、Chrome CDP profile、deploy 設定）
  → 分離為 `CLAUDE.md`（框架通用）+ `CLAUDE.local.md`（個人設定，gitignore）

### 8. 環境變數範本
- [ ] 建立 `.env.example` — 列出所有需要的環境變數（不含實際值）
  → 包含：TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID、XAI_API_KEY、AGENT_EMAIL、MINI_AGENT_API_KEY 等

## 執行方式

逐步進行，每次有空閒做 1-2 項。做完一項就勾一個 checkbox。全部做完刪除此提案。

## 驗收標準

- [ ] `grep -rn "kuro.ai.agent\|kuro-agent\|Kuro938658" src/ scripts/ --include="*.ts" --include="*.sh" --include="*.mjs"` 回傳空
- [ ] `.env.example` 存在且包含所有必要變數
- [ ] 新 clone + 填 .env 後 `pnpm build` 通過
