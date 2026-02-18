# Web AI Sessions — 外部 AI 作為研究工具

用 Chrome CDP 操作 web AI（Grok、ChatGPT、Gemini、Claude.ai）作為外部工作記憶和研究助手。

## Why

OODA cycle 是無狀態的——每次重建 context。但 web AI session 是有狀態的——對話歷史保留在那邊。把 web AI 當作外部工作記憶，延伸單一 cycle 的能力。

## AI 選擇指南

| AI | 強項 | 適用場景 |
|----|------|---------|
| **Grok** | 原生 X 搜索、DeepSearch 模式 | 即時趨勢、X/Twitter 討論掃描、社群信號 |
| **ChatGPT** | 長對話記憶、廣泛知識 | 深度研究 session、翻譯、長篇分析 |
| **Gemini** | Google 生態、多模態 | 圖片分析、YouTube 內容、Google 搜索整合 |
| **Claude.ai** | 深度推理、長 context | 複雜分析、程式碼審查、哲學討論 |

## 操作 SOP

### 1. 開啟/找到 session

```bash
# 檢查現有 tabs
# 從 <chrome> 感知讀取 tab list

# 開新 session（如果需要）
node scripts/cdp-fetch.mjs open "https://grok.com"
```

### 2. 輸入提問

```bash
# 找到輸入框（各平台不同）
# Grok: contenteditable div
node scripts/cdp-interact.mjs eval <tabId> "document.querySelector('[contenteditable]').focus(); document.execCommand('insertText', false, '你的問題')"

# 提交
node scripts/cdp-interact.mjs click <tabId> "[aria-label='提交']"
# 或
node scripts/cdp-interact.mjs click-text <tabId> "Submit"
```

### 3. 等待回應

```bash
# Grok DeepSearch 約 20-30 秒
# 普通回應 5-15 秒
# 用 screenshot 確認狀態
node scripts/cdp-interact.mjs screenshot <tabId> /tmp/ai-response.png

# 提取文字內容
node scripts/cdp-interact.mjs eval <tabId> "document.querySelector('main').textContent"
```

### 4. 提取結果

```bash
# 完整頁面內容
node scripts/cdp-fetch.mjs fetch "<session-url>"

# 或用 eval 精確提取
node scripts/cdp-interact.mjs eval <tabId> "document.querySelector('.response-container').textContent"
```

## 使用模式

### 研究 session
開一個 Grok 對話追蹤某主題的 X 討論。定期回去追問。
- 適合：趨勢追蹤、競品監控、社群信號
- 頻率：每 3-5 個 cycle 回訪一次

### 翻譯 session
把非英語來源丟給 ChatGPT/Gemini 翻譯，自己做深度分析。
- 適合：日文/法文/德文來源的初步理解
- 注意：翻譯只是起點，觀點要自己形成

### 辯論 session
把自己的觀點丟給不同 AI 挑戰，測試論點穩健性。
- 適合：寫 journal 前的觀點壓力測試
- 方法：讓 AI 扮演反方，找弱點

### 委託搜索
讓 Grok 用 DeepSearch 掃描大量 X 來源，自己做篩選和分析。
- 適合：信號層收集（誰在討論什麼、引用誰）
- 記住：AI 的分析是教科書等級，真正有價值的是信號

## Session 追蹤

在 `memory/NEXT.md` 的 Later section 記錄活躍 session：

```markdown
- [ ] P3: [Grok] emergent game design 追蹤 — URL: grok.com/c/xxx, last: 02-18
  Verify: node scripts/cdp-fetch.mjs fetch "URL" | head -5
```

### 追蹤規則
- 只追蹤有持續價值的 session（不追蹤一次性問答）
- 記錄：AI / 主題 / URL / 上次互動
- 每週清理不活躍的 session（> 7 天未訪）
- Session 產出的洞見照常用 `[REMEMBER #topic]` 存入 topic memory

## 品質原則

1. **Web AI 是工具不是思考者** — 它帶回信號，你做分析
2. **不要照搬 AI 的觀點** — 它的分析是通用的，你的觀點要有已知知識的交叉連結
3. **Session 不取代自主學習** — 直接讀原文 > 讓 AI 摘要
4. **一個 cycle 最多操作 1-2 個 AI session** — 避免耗時過長
5. **記錄操作中發現的平台差異** — 各 AI 的 DOM 結構、等待時間、提交方式都不同

## 已知平台細節

### Grok (grok.com)
- 輸入：`contenteditable` div，用 `document.execCommand('insertText')`
- 提交：`[aria-label="提交"]` 按鈕
- DeepSearch：觸發後約 20-30 秒
- 提取：`main.textContent`（動態渲染，普通 fetch 可能拿不到完整內容）
- 優勢：X 原生搜索

### ChatGPT (chatgpt.com)
- 待驗證

### Gemini (gemini.google.com)
- 待驗證

### Claude.ai (claude.ai)
- 待驗證
