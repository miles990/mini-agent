# TM Competition Strategy — Action Plan

**Date**: 2026-03-20
**Status**: Approved by Alex, execution started
**Context**: Teaching Monster 競賽，目前熱身賽 #3（4.33/5），目標初賽 top 3 晉級

---

## 競賽結構

| 階段 | 時間 | 評審 | 賽制 | 勝出條件 |
|------|------|------|------|----------|
| 熱身賽（現在） | ~3月底 | AI Student | 四維度絕對分數 | 診斷工具，不計排名 |
| 熱身賽第二輪 | 4月初 | AI Student | 評審委員設計題目 | 模擬考，更貼近初賽 |
| 初賽 | 5/1-5/15 | 真人評審 | A/B 並列比較 → Elo | 勝率排名，top 3 晉級 |
| 決賽 | 6/12-6/13 | 教師/教授 | 限時 30min/題 + 專家排名 | 綜合排名決勝 |

## 核心戰略認知

1. **這不是考試，是設計比賽** — 評審不打勾打叉，做「哪個更好」的直覺判斷
2. **正確性和邏輯滿分是必要條件，不是優化目標** — 內容有錯或邏輯不通，真人直接判「不採用」，不是扣分是淘汰
3. **Elo 懲罰不一致** — 輸給弱隊的懲罰 > 贏弱隊的獎勵，穩定性比巔峰更重要
4. **「沒有明顯缺點」不等於「會被選中」** — 修 bug 是必要條件，差異化才是充分條件

## 當前成績與問題

**平均**: Acc 4.36 / Logic 4.59 / Adapt 4.22 / Engage 4.15 → Total **4.33** (#3)
**競爭對手**: tsunumon #1 (4.7-4.8), TestPipeline #2 (4.4)

### 四個根因

| 根因 | 影響 | 修法類型 |
|------|------|----------|
| Title-Content Mismatch | 3 題 acc/logic=1.0，佔總失分 ~50% | Prompt + 驗證 |
| LaTeX 渲染失敗 | 13 次跨 7+ 題 | Code 修復 |
| 數學/計算錯誤 | 5 題 | 驗證層（Opus） |
| 適配度層級錯誤 | 5 題 adapt < 2.5（內容正確但層級全錯） | Prompt + 驗證 |

---

## 執行計畫

### Tier 0 — 止血（3/20-3/23，本週完成）

**原則：正確性和邏輯滿分是基本必要條件。**

| # | 改動 | 做法 | 預期影響 |
|---|------|------|----------|
| 1 | Title Coverage Gate | Prompt 強制概念提取 + script 生成後自動檢查 title 關鍵詞覆蓋率，未覆蓋 → reject + feedback 重生成 | acc +0.35, logic +0.28 |
| 2 | 數學驗證層 | Script 生成後用 **Opus** 做獨立數學驗證（公式推導、計算步驟、因果方向），發現錯誤 → 自動修正或重生成 | acc +0.12, logic +0.08 |
| 3 | LaTeX Sanitizer | Pre-render 修常見錯誤 + post-render 檢查 `katex-error` → 重 render → fallback styled monospace | acc +0.15 |
| 4 | 適配度 Hard Ceiling | 三層做法：(a) Generation prompt 要求開頭寫 `[TARGET: 年級] [CEILING: 數學範圍]` (b) Review prompt 用 anchor 機械式比對 (c) Post-check regex 確認 anchor 存在 | adapt +0.3~0.4 |

### Tier 1 — 情報收集（跟 Tier 0 平行，3/20-3/23）

| # | 任務 | 做法 | 目的 |
|---|------|------|------|
| 5 | 競爭對手影片分析 | CDP 抓 tsunumon、XiaoJin、top teams 影片，分析 TTS 品質/視覺風格/教學方法 | 確認差異化方向 |
| 6 | AI Student Rubric 研究 | 分析 AI Student 的評分文字回饋，找 pattern | 理解評分偏好 |
| 7 | TTS 現狀評估 | 比較我們 vs 對手的語音品質 | 決定是否升級 |

### Tier 1.5 — 根據情報決定（3/24-3/28）

根據 Tier 1 結果決定：
- TTS 是否升級？升級到什麼程度？（OpenAI TTS / Kokoro / 維持現狀）
- 視覺設計是否需要改動？
- 教學法改進的具體方向

### Tier 2 — 教學法迭代（4月）

- Hook → Explore → Explain → Apply 結構
- 適配度 + 教學法交集：根據 persona 認知水平選擇類比和切入點
- 用第二輪熱身賽（評審委員設計題目）測試改進效果

### Tier 3 — 決賽準備（5月，如果進 top 3）

- Scaffolding、迷思概念處理、formative assessment
- Pipeline 效能優化（30 min/題限時）
- 教學法深度（讓教育者說「我會用這個」）

---

## 驗證方式 — Canary Set（方案 C）

不全量重生成，先用 8 題驗證改動效果：

| 類型 | 題目 | 驗證目標 |
|------|------|----------|
| Title Mismatch | [30] 動摩擦和靜摩擦 (acc=1, logic=1) | Title Coverage Gate |
| Title Mismatch | [35] 物件：類別的實例 (acc=1, logic=1) | Title Coverage Gate |
| Title Mismatch | [28] 角動量和角衝量 (acc=1.8, logic=4) | Title Coverage Gate |
| 適配度災難 | [16] 圓週運動 (adapt=1.4) | Hard Ceiling |
| 適配度災難 | [25] 細胞區室化 (adapt=1.8) | Hard Ceiling |
| 適配度災難 | [23] 位能 (adapt=2.4) | Hard Ceiling |
| Control | （選 2 題目前表現好的） | 確認改動沒有 side effect |

**流程**：
1. Tier 0 改動完成
2. 跑 8 題 canary
3. 比較 before/after AI 分數
4. **Alex 人眼看影片**（AI 分數只驗證 bug fix，真正目標是「真人會選嗎」）
5. Canary 改善且 control 沒退步 → 全量 32 題
6. 有 side effect → 先修再全量

---

## 時間線

```
3/20 (今天)  ── Tier 0 開始實作 + Tier 1 情報收集平行
3/23         ── Tier 0 完成 + Canary 8 題跑完 + 對手分析初步結論
3/24-28      ── Tier 1.5 根據情報決策 + 全量重生成
4月初        ── 第二輪熱身賽開始（評審委員題目）→ Tier 2 教學法迭代
4月底        ── 穩定 pipeline，最後調整
5/1          ── 初賽開始
```

---

## 勝出理論

**「理解感 x 製作品質」** — 當兩個影片都正確時，真人選的是：
- 看完覺得「我懂了」而不是「他講完了」
- 聽起來自然、看起來專業、節奏舒服
- 有 hook、有 aha moment、有適當的類比

**短板排序**（Kuro 判斷，待對手分析驗證）：適配度 > 教學法 > 製作品質

---

## 數據檔案

- 32 題評分數據：`memory/tm-evaluation-data-2026-03-20.json`
- 分數摘要：`/tmp/tm-all-scores.json`
- Kuro 原始分析：Chat Room #306, #309, #310
- 討論記錄：Chat Room #312, #314, #316, #317
