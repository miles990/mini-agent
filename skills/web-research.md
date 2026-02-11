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

## CDP 自動修復（核心機制）

**當 CDP 未啟用時，不要告訴用戶怎麼做 — 自己執行修復：**

```bash
bash scripts/cdp-auto-setup.sh
```

這個腳本會自動：
1. 診斷問題（port 衝突？Chrome 沒裝？Chrome 沒啟用 CDP？）
2. 嘗試修復（重啟 Chrome with CDP flag）
3. 驗證成功（curl localhost:9222）
4. 回報結果（STATUS: OK / FAILED + 診斷）

**根據輸出決定下一步：**
- `STATUS: OK` → CDP 已就緒，繼續原本的任務
- `STATUS: PORT_CONFLICT` → 告知用戶 port 被佔用，建議解決
- `STATUS: NOT_INSTALLED` → 告知用戶安裝 Chrome
- `STATUS: FAILED` → 顯示腳本的診斷結果，提供備選方案

**原則：先動手修，修不好才找用戶。**

## 常用命令

```bash
# 自動診斷 + 修復 CDP
bash scripts/cdp-auto-setup.sh

# 擷取網頁內容（背景分頁，自動關閉）
node scripts/cdp-fetch.mjs fetch "https://example.com"

# 開啟可見分頁（登入/驗證用）
node scripts/cdp-fetch.mjs open "https://facebook.com/messages"

# 從已開啟的分頁提取內容
node scripts/cdp-fetch.mjs extract <tabId>

# 關閉分頁
node scripts/cdp-fetch.mjs close <tabId>

# ─── 瀏覽器互動（cdp-interact.mjs）───

# 列出頁面上的表單元素和按鈕
node scripts/cdp-interact.mjs list-inputs <tabId>

# 用 CSS selector 點擊元素
node scripts/cdp-interact.mjs click <tabId> "button.submit"

# 用文字點擊（精確匹配優先，選最小元素）
node scripts/cdp-interact.mjs click-text <tabId> "Create"

# 輸入文字到表單（React SPA 相容）
node scripts/cdp-interact.mjs type <tabId> "textarea" "Hello world"

# 一次填多個欄位
node scripts/cdp-interact.mjs fill-form <tabId> '{"#name":"Kuro"}'

# 等待元素出現
node scripts/cdp-interact.mjs wait <tabId> ".result" 10000

# 截圖特定 tab
node scripts/cdp-interact.mjs screenshot <tabId> /tmp/shot.png

# 在頁面執行 JS
node scripts/cdp-interact.mjs eval <tabId> "document.title"
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
