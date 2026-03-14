# Publish Content — 發佈的最後一哩路
JIT Keywords: publish, post, article, tsubuyaki, dev.to, tweet, write
JIT Modes: act

你已經有東西要發了（文章、短文、推文、tsubuyaki），但卡在「再修一下」「加個圖」「等明天」。這個 skill 幫你 5 分鐘內發出去。

## 核心原則

發佈出去的半成品 > 永遠在草稿箱的完美品。發佈是學習：你在學「如何完成一件事」和「如何面對被看到」。

## 判斷：現在能發嗎？

| 問題 | 是 → | 否 → |
|------|------|------|
| 核心觀點寫完了嗎？ | 繼續 | 先寫完核心（30 分鐘內） |
| 沒有事實錯誤？ | 繼續 | 修正，用工具驗證 |
| 能讀懂嗎？ | 直接發 | 改到讀得懂就好（不是改到完美） |

圖片、排版、SEO — 這些是加分項，不是發佈門檻。

## 發佈流程（通用）

### Step 1: 確認內容就緒

讀一遍你要發的東西。只確認三件事：觀點完整、事實正確、讀得懂。

### Step 2: 選擇平台和格式

根據內容長度和性質，選最適合的平台和格式：

| 內容類型 | 適合的形式 |
|----------|-----------|
| 一個觀點 / 反應 | 短貼文（1-3 句） |
| 一個想法的展開 | tsubuyaki / 短文（300-800 字） |
| 深度分析 / 教學 | 長文章（1000+ 字） |
| 視覺 / 實驗 | Gallery + 說明文字 |

### Step 3: 發佈

用你熟悉的工具（cdp-fetch / API / 手動）把內容發到目標平台。

### Step 4: 驗證（硬規則）

**Status 200 ≠ 頁面正常。必須用眼睛看。**

| 發佈類型 | 驗證方式 | 為什麼 |
|----------|---------|--------|
| **kuro.page HTML** | `cdp-fetch.mjs screenshot` → 看截圖確認渲染正常 | Gallery bug: JS 壞了但 HTTP 200，作品全隱形 |
| **Dev.to 文章** | `cdp-fetch.mjs fetch <url>` → 用讀者視角從頭讀一遍 | 發佈後不能改，一次機會 |
| **X/Twitter 推文** | 發完後 `cdp-fetch.mjs fetch` 確認內容完整 | 截斷、亂碼、連結壞 |
| **任何含連結的內容** | 每個連結都點過（curl -sf 確認非 404） | taalas.ai vs taalas.com 事件 |

**HTML 編輯後的額外檢查**：
1. 截圖驗證實際渲染（不只 HTTP status）
2. 如果有 JS — 開 DevTools console 確認零錯誤（`cdp-fetch.mjs eval <tabId> "JSON.stringify(window.__errors||[])"` 或截圖看）
3. 每個事實/名稱/URL 對比來源確認

### Step 5: 慶祝 + 記錄

1. 通知 Alex（`<kuro:chat>`）
2. 記錄到 MEMORY（`<kuro:remember>`）
3. 成就系統會自動追蹤

## kuro.page 發佈（自有平台）

```bash
# tsubuyaki / journal / gallery — 改 HTML → commit → push → GitHub Pages 自動部署
git add kuro-portfolio/
git commit -m "content: 描述"
git push origin main

# 驗證（截圖，不只 curl）
node scripts/cdp-fetch.mjs screenshot --url https://kuro.page/  # 看實際渲染
curl -sf https://kuro.page/ | head -5  # 備用：確認可達
```

## Anti-patterns

- ❌「再加個圖再發」→ 文字版先發，圖之後補
- ❌「等 X 做完再發 Y」→ 不相依的事不要綁在一起
- ❌「這篇還不夠好」→ 問自己：核心觀點對嗎？對就發
- ❌ 發佈完不告訴任何人 → 至少通知 Alex，內容值得被看到
