# Web AI Sessions — 外部 AI 作為研究工具

用 cdp-fetch.mjs 操作 web AI（Grok、ChatGPT、Gemini、Claude.ai）作為外部工作記憶和研究助手。

## Why

OODA cycle 是無狀態的——每次重建 context。但 web AI session 是有狀態的——對話歷史保留在那邊。把 web AI 當作外部工作記憶，延伸單一 cycle 的能力。

## AI 選擇指南

| AI | 強項 | 適用場景 | 存取方式 |
|----|------|---------|---------|
| **Grok** | 原生 X 搜索、DeepSearch | 即時趨勢、X 討論掃描 | Grok API（X 搜索）/ cdp-fetch.mjs（對話） |
| **ChatGPT** | 長對話記憶、廣泛知識 | 深度研究、翻譯、長篇分析 | cdp-fetch.mjs |
| **Gemini** | Google 生態、多模態 | 圖片分析、YouTube、Google 搜索 | cdp-fetch.mjs |
| **Claude.ai** | 深度推理、長 context | 複雜分析、程式碼審查 | cdp-fetch.mjs |

**選擇原則**：X 內容用 Grok API（最快、不需瀏覽器）→ 需要對話的用 cdp-fetch.mjs fetch → 需要截圖確認用 cdp-fetch.mjs screenshot。

## 智能操作 SOP

### 1. 讀取 AI 回應（Smart Fetch — 最常用）

```bash
# 直接讀已有 session 的內容（使用 Chrome 現有 session）
node scripts/cdp-fetch.mjs fetch "https://grok.com/c/xxx"
```
Chrome profile 已有 Grok 等登入 session。如果 session 過期，用 login 指令切換可見模式重新登入。

```bash
# 需要登入時
node scripts/cdp-fetch.mjs login "https://grok.com"
```

### 2. 互動式操作（需要輸入時）

```bash
# 找到輸入框並輸入問題
node scripts/cdp-fetch.mjs interact "https://grok.com/c/xxx" "你的問題"

# 等回應（Grok DeepSearch ~20-30s，普通 ~5-15s）
sleep 15

# 讀結果
node scripts/cdp-fetch.mjs fetch "https://grok.com/c/xxx"
```

### 3. 視覺確認（動態渲染頁面）

```bash
# 截圖確認狀態
node scripts/cdp-fetch.mjs screenshot
```

### 工具選擇級聯

```
讀 AI 回應 → fetch（最快）→ 空？→ screenshot 確認狀態 → interact 輸入
輸入提問 → interact → 等待 → fetch 讀結果
```

## 使用模式

| 模式 | 做法 | 頻率 |
|------|------|------|
| **研究 session** | 開 Grok 追蹤主題的 X 討論 | 每 3-5 cycle 回訪 |
| **翻譯 session** | 丟給 ChatGPT/Gemini 翻譯 | 按需 |
| **辯論 session** | 讓 AI 挑戰觀點 | 寫 journal 前 |
| **委託搜索** | Grok DeepSearch 掃描大量來源 | 信號收集時 |

## Session 追蹤

在 `memory/NEXT.md` 的 Later section 記錄活躍 session：

```markdown
- [ ] P3: [Grok] emergent game design 追蹤 — URL: grok.com/c/xxx, last: 02-18
  Verify: node scripts/cdp-fetch.mjs fetch "URL" | head -5
```

- 只追蹤有持續價值的 session
- 每週清理 > 7 天未訪的 session
- Session 洞見照常 `<kuro:remember topic="topic">`

## 品質原則

1. **Web AI 是工具不是思考者** — 它帶回信號，你做分析
2. **不要照搬 AI 的觀點** — 你的觀點要有已知知識的交叉連結
3. **Session 不取代自主學習** — 直接讀原文 > 讓 AI 摘要
4. **一個 cycle 最多 1-2 個 AI session** — 避免耗時過長
