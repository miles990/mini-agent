# Proposal: HTTPS Native Support

## Meta
- Status: completed
- From: alex
- To: claude-code
- Created: 2026-02-17T22:10:00+08:00
- Effort: Small-Medium

## Background

iOS Safari 要求 Geolocation 和 DeviceMotion API 只能在 secure context（HTTPS 或 localhost）下使用。手機透過區域網路 IP 連到 mini-agent server 時，因為是 HTTP origin，所有感測器權限都被拒絕。

Alex 選擇原生 HTTPS 支援（而非 ngrok/tunnel 等外部方案）。

## Task

在 mini-agent 的 HTTP server 加入 HTTPS 支援，使用 mkcert 生成的本地 TLS 憑證。

## Design

### 憑證管理

使用 `mkcert` 生成本地信任的 TLS 憑證，存放在 `~/.mini-agent/tls/`：

```
~/.mini-agent/tls/
  cert.pem      # TLS 憑證
  key.pem       # 私鑰
```

### 環境變數

```bash
HTTPS_ENABLED=true              # 啟用 HTTPS（預設 false）
HTTPS_CERT=~/.mini-agent/tls/cert.pem   # 憑證路徑（有預設值）
HTTPS_KEY=~/.mini-agent/tls/key.pem     # 私鑰路徑（有預設值）
HTTPS_PORT=3443                 # HTTPS port（預設 PORT+442，即 3443）
```

### 實作方式

1. **雙 port 監聽**：HTTP（:3001）保持不變（dashboard、localhost 存取），新增 HTTPS（:3443）給手機用
2. **共用同一個 Express app**：用 `node:https` 的 `createServer(options, app)` 包裝
3. **啟動邏輯**：
   - 檢查 `HTTPS_ENABLED=true` + 憑證檔案存在
   - 兩個 server 都啟動，HTTP 和 HTTPS 都可用
   - 如果 HTTPS 啟用失敗（憑證不存在等），只啟動 HTTP 並 warn

### 修改範圍

| 檔案 | 改動 |
|------|------|
| `src/api.ts` | standalone 模式：加 HTTPS server 啟動邏輯 |
| `src/cli.ts` | 互動模式：同上 |
| `mobile.html` | 無需改動（瀏覽器自動使用 HTTPS URL） |

### 手機設定（一次性）

1. Mac 上安裝 mkcert：`brew install mkcert && mkcert -install`
2. 生成憑證：`mkdir -p ~/.mini-agent/tls && mkcert -cert-file ~/.mini-agent/tls/cert.pem -key-file ~/.mini-agent/tls/key.pem "$(hostname).local" localhost 127.0.0.1 ::1`
3. 手機安裝 CA：`mkcert -CAROOT` 找到 rootCA.pem → AirDrop 到手機 → 設定 > 一般 > VPN與裝置管理 > 安裝 → 設定 > 一般 > 關於 > 憑證信任設定 > 啟用
4. 設定 `.env`：`HTTPS_ENABLED=true`
5. 手機用 `https://<Mac-hostname>.local:3443/mobile` 存取

### 程式碼草稿

```typescript
// api.ts — standalone 模式的 HTTPS 啟動
import https from 'node:https';

// After HTTP server starts...
if (process.env.HTTPS_ENABLED === 'true') {
  const certPath = process.env.HTTPS_CERT
    || path.join(os.homedir(), '.mini-agent', 'tls', 'cert.pem');
  const keyPath = process.env.HTTPS_KEY
    || path.join(os.homedir(), '.mini-agent', 'tls', 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const httpsPort = parseInt(process.env.HTTPS_PORT || String(port + 442), 10);
    const httpsServer = https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }, app);

    httpsServer.listen(httpsPort, () => {
      slog('SERVER', `HTTPS started on :${httpsPort}`);
    });
  } else {
    slog('WARN', `HTTPS enabled but certs not found at ${certPath}`);
  }
}
```

## Acceptance Criteria

- [ ] `HTTPS_ENABLED=true` 時，HTTPS server 在 :3443 啟動
- [ ] HTTP :3001 保持正常運作
- [ ] 手機用 `https://<hostname>.local:3443/mobile` 能拿到 GPS + gyro + accel 權限
- [ ] `HTTPS_ENABLED` 未設定或為 false 時，行為不變
- [ ] 憑證不存在時 graceful fallback（warn + 只啟動 HTTP）
- [ ] Graceful shutdown 同時關閉 HTTP 和 HTTPS server
- [ ] `pnpm typecheck` 通過

## Risks

- mkcert CA 安裝需要手機端手動操作（iOS 限制，無法自動化）
- `.local` hostname 需要 Bonjour/mDNS（macOS 預設啟用）
- 未來如果要對外暴露，需要改用 Let's Encrypt 等公有 CA

## Log
- 2026-02-17 22:10 [kuro] 建立提案，Alex 核准（回覆「原生支援」）
- 2026-02-17 22:11 [claude-code] 實作完成，typecheck + 125 tests passed
