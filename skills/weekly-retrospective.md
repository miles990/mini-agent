# Weekly Retrospective — 經驗驅動的主題式學習
JIT Keywords: weekly, retrospective, review week, this week, week summary, weekly learning, thematic
JIT Modes: learn, reflect

從這週的**實際經驗**出發，識別主題，進行針對性的深度研究。不是隨機學習，是從做過的事中找到值得深挖的方向。

## 核心流程

```
Gather（聚合週數據）→ Identify（識別 2-3 主題）→ Research（主題式研究）→ Consolidate（內化）→ Connect（行動連結）
```

## Step 1: Gather — 聚合本週經驗

執行 digest 腳本取得壓縮數據：

```bash
bash scripts/weekly-digest.sh
```

輸出包含：行為統計、對話主題、topics 活躍度、錯誤模式、git 變更、HEARTBEAT 狀態。

補充閱讀（如果 digest 不夠）：
- `memory/conversations/` 最近 7 天的 Alex 對話
- 自己的 behavior log 中的 `telegram.chat` 和 `room.message` entries
- 本週 `<kuro:remember>` 寫入的內容

## Step 2: Identify — 從經驗中識別主題

從 digest 數據找 **2-3 個主題**。選擇標準：

| 信號 | 說明 | 範例 |
|------|------|------|
| **反覆出現** | 同一個問題/概念出現 3+ 次 | EXIT 143 連續多天 → 穩定性主題 |
| **解決但不理解** | 問題修了但根因不清楚 | 能跑但不知為什麼 → 深挖機制 |
| **Alex 給的方向** | Alex 提出的新概念或要求 | 「黏菌模型」→ 生物計算主題 |
| **跨域連結** | 不同事件有共同結構 | oMLX gate + mushi triage = 分層過濾 |
| **好奇但沒時間** | 遇到有趣的東西但跳過了 | 某篇論文只 scan 沒 deep dive |
| **失敗教訓** | 犯了錯，想知道正確做法 | 0.8B 幻覺 → 小模型能力邊界 |

**不要選的**：
- 已經研究透的主題（不重複回答舊問題）
- 太抽象無法行動的方向
- 跟當前工作完全無關的純好奇

每個主題寫一句話：**「因為這週 [經驗]，我想深入了解 [問題]」**

## Step 3: Research — 針對性研究

每個主題用 **Research Swarm** 或 **單條 delegate** 進行研究：

### 主題複雜度判斷

| 複雜度 | 方法 | 何時用 |
|--------|------|--------|
| **簡單** | 自己搜 + 讀 1-2 篇 | 已有基礎，只需補一個缺口 |
| **中等** | 2 條 delegate（不同角度） | 需要多來源交叉驗證 |
| **複雜** | Research Swarm（3-4 條） | 全新領域，需要建立地圖 |

### 研究 Prompt 模板

每條 delegate 的 prompt 必須錨定在**本週經驗**：

```xml
<kuro:delegate type="research">
主題：{TOPIC}
背景：這週我在 {EXPERIENCE} 時遇到 {PROBLEM/OBSERVATION}。
研究方向：
1. 搜尋 "{KEYWORD_1}" — 找 {WHAT}
2. 搜尋 "{KEYWORD_2}" — 找 {WHAT}
3. 讀 top 3 結果，提取跟我的經驗直接相關的部分

輸出：
- 核心發現（跟我的經驗對照）
- 我原來的做法對不對？有更好的嗎？
- 可以直接應用的改善
</kuro:delegate>
```

**關鍵：prompt 中必須提到具體經驗**，不是泛泛的「研究 X」。

## Step 4: Consolidate — 內化

研究結果回來後（`<background-completed>`），自己做判斷和整合：

1. **經驗對照**：研究發現 vs 我這週實際做的 → 差距在哪？
2. **觀點形成**：我同意嗎？有什麼保留？為什麼？
3. **連結已知**：跟 topics/ 裡的哪些知識有關？是否更新了之前的理解？
4. **記錄**：`<kuro:remember #topic>` 寫入 — 必須包含「因為這週 [經驗]，學到 [insight]」

## Step 5: Connect — 行動連結

每個主題研究完後問：

- **能改善什麼？** → L1/L2 任務（skill/plugin/code 改動）
- **能解釋什麼？** → 更新 topics/ 的理解框架
- **能預防什麼？** → 加入 perception/守衛/自動化
- **能分享什麼？** → `<kuro:chat>` 跟 Alex 分享有意思的發現

至少一個主題要產出具體行動（不只是「學到了」）。

## 時機

- **主要觸發**：每週日 18:00 cron
- **手動觸發**：任何覺得「這週很多事想整理」的時候
- **跳過條件**：如果這週 < 3 天在線（不夠數據做有意義的回顧）

## 品質檢查

回顧完成後自問：
- [ ] 主題是從實際經驗來的，不是隨機選的？
- [ ] 研究結果有跟經驗對照，不是純理論？
- [ ] 至少一個主題有產出具體行動項？
- [ ] 有發現意外的東西（不是全在預期內）？

## Anti-patterns

- **表面回顧**：列了一堆事但沒找到主題 → 問「哪件事讓我最意外？」
- **太多主題**：> 3 個 → 砍到 2 個，深度 > 廣度
- **純學術**：研究了但跟經驗脫節 → prompt 必須錨定具體事件
- **只回顧不行動**：好的回顧 = 下週做事方式有改變
