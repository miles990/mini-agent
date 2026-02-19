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
2. **CDP 未啟用 → 自動修復**（見下方）
3. 嘗試 `curl -sL "URL"` 取得內容
4. 如果得到登入頁面或空內容 → 用 `cdp-fetch.mjs fetch`
5. 如果 CDP 也偵測到需要登入 → 用 `cdp-fetch.mjs open` 開啟頁面，告知用戶登入
6. 用戶確認登入後 → 用 `cdp-fetch.mjs extract <tabId>` 取得內容

## CDP 自動修復

CDP 未啟用時，先 `bash scripts/cdp-auto-setup.sh` 自動修復。根據輸出（OK/PORT_CONFLICT/NOT_INSTALLED/FAILED）決定下一步。原則：先動手修，修不好才找用戶。

## 常用命令

```bash
bash scripts/cdp-auto-setup.sh                        # 自動診斷+修復 CDP
node scripts/cdp-fetch.mjs fetch "URL"                 # 擷取內容（背景）
node scripts/cdp-fetch.mjs open "URL"                  # 開啟可見分頁
node scripts/cdp-fetch.mjs extract <tabId>             # 從已開分頁提取
node scripts/cdp-interact.mjs click <tabId> "selector" # 點擊元素
node scripts/cdp-interact.mjs type <tabId> "sel" "txt" # 輸入文字
node scripts/cdp-interact.mjs eval <tabId> "js"        # 執行 JS
```

## 無法存取時的回應

### 重要原則
- **不要假裝可以存取或編造內容**
- **先自己嘗試修復，再找用戶**
- 說明原因要簡潔（一句話）
- 重點放在「我做了什麼」和「還需要你做什麼」

## 注意事項

- 大型頁面只擷取前 5000 字元
- 不要嘗試繞過認證機制
- CDP 操作會在用戶的真實 Chrome 中執行，注意隱私
- 重啟 Chrome 會保留所有分頁（Chrome 自動恢復）
