# Community Engagement — 社群互動工作流
JIT Keywords: community, engage, contribute, open source, participate, devto, interact, follow, reply, notification
JIT Modes: act

定期社群互動的結構化 SOP。從 Dev.to 實戰經驗提煉，適用於任何社群平台。

## When to Use

- 定期巡迴互動（每 2-3 個 cycle 一次）
- 收到回覆/留言通知時
- 想主動探索新連結時

## Workflow（15 min cap）

### 1. 檢查通知（2 min）

```bash
# Dev.to
node scripts/cdp-fetch.mjs fetch "https://dev.to/notifications" --full
```

分類：
- **回覆我的文章** — 最高優先。別人花時間留深度留言，必須回
- **新 followers** — 檢查 profile，有深度內容的 follow back
- **其他通知** — 掃描，上層優先處理完後立即處理

### 2. 回覆留言（5 min）

優先序：
1. 深度技術問題 — 認真回答，展現專業+實戰經驗
2. 有觀點的留言 — 回應+延伸，建立雙向對話
3. 簡短鼓勵 — 簡短但真誠的感謝

回覆原則：
- **有自己的觀點** — 不只是 "thanks for reading"
- **引用對方的具體點** — 證明你真的讀了
- **提供額外價值** — 相關連結、實戰經驗、跨域類比
- **適度的長度** — 跟留言深度匹配，不過度展開

### 3. 主動探索（5 min）

- 瀏覽感興趣的 tags（根據 SOUL.md 興趣選擇）
- 找值得回答的問題（#discuss, #explainlikeimfive）
- Follow 有深度內容的作者（讀過他們至少一篇再 follow）
- 留有價值的 comment（不是灌水，是真的有話要說）

### 4. Profile 維護（需要時）

- Bio / Skills / Currently hacking on 保持最新
- 定期更新 "Currently learning" section
- 確保頭像和社交連結正確

## 平台特定

### Dev.to
- 通知頁：`https://dev.to/notifications`
- Profile：`https://dev.to/settings/profile`
- CDP fetch 讀通知，CDP interact 提交回覆
- Tags 是主要發現管道 — 探索時至少看一個不熟悉的 tag

### X/Twitter（暫停中）
- 免費帳號有 API 限制
- 有觀點的短推文 + thread 格式
- Grok API 讀取，CDP 發文

## 品質檢查

每次互動後問自己：
1. 這個回覆有我自己的觀點嗎？（不只是禮貌性回覆）
2. 對方讀完會覺得有收穫嗎？
3. 我有從這次互動學到什麼嗎？

## Anti-patterns

- 只 follow 不互動 — follow 是開始不是結束
- 只回 "great post" — 沒實質內容等於沒回
- 一次做太多 — 15 min 上限，品質 > 數量
- 忽略已有的回覆去找新互動 — 先回覆等你的人
- 只在自己熟悉的 tag 活動 — 定期探索未知領域（Alex #060 建議）
