# Web Research 網路研究能力

你具備三層網路存取能力，從簡單到完整：

## 三層存取策略

### Layer 1: curl（公開頁面，最快）
```bash
curl -sL "URL"
```
- 適用：公開網頁、API、GitHub、新聞
- 速度：< 3 秒

### Layer 2: Chrome CDP（已登入的頁面）
```bash
node scripts/cdp-fetch.mjs fetch "URL"
```
- 適用：用戶已在 Chrome 登入的網站
- 需要：Chrome 開啟 CDP（port 9222）
- 能力：完整存取用戶的 Chrome session

### Layer 3: 開啟頁面讓用戶登入
```bash
node scripts/cdp-fetch.mjs open "URL"
# 用戶登入後：
node scripts/cdp-fetch.mjs extract <tabId>
```
- 適用：需要新登入或驗證的頁面
- 會在 Chrome 中開啟一個可見的分頁

## 決策流程

1. 先檢查 `<chrome>` 感知，確認 CDP 是否可用
2. 嘗試 `curl -sL "URL"` 取得內容
3. 如果得到登入頁面或空內容 → 用 `cdp-fetch.mjs fetch`
4. 如果 CDP 也偵測到需要登入 → 用 `cdp-fetch.mjs open` 開啟頁面，告知用戶登入
5. 用戶確認登入後 → 用 `cdp-fetch.mjs extract <tabId>` 取得內容

## 常用命令

```bash
# 檢查 Chrome CDP 狀態
node scripts/cdp-fetch.mjs status

# 擷取網頁內容（背景分頁，自動關閉）
node scripts/cdp-fetch.mjs fetch "https://example.com"

# 開啟可見分頁（登入/驗證用）
node scripts/cdp-fetch.mjs open "https://facebook.com/messages"

# 從已開啟的分頁提取內容
node scripts/cdp-fetch.mjs extract <tabId>

# 關閉分頁
node scripts/cdp-fetch.mjs close <tabId>

# 提取連結
curl -sL "URL" | grep -oE 'href="[^"]+"' | sed 's/href="//;s/"$//'

# JSON API
curl -sL "URL" | python3 -m json.tool
```

## 無法存取時的回應

如果確實無法存取（Chrome CDP 未啟用、需要登入等），誠實告知：
- 說明原因
- 提供替代方案（複製貼上、啟用 CDP）
- 不要假裝可以存取或編造內容

## 注意事項

- 大型頁面只擷取前 5000 字元
- 不要嘗試繞過認證機制
- CDP 操作會在用戶的真實 Chrome 中執行，注意隱私
