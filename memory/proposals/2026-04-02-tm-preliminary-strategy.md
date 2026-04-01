# TM 初賽策略（2026-04-02）

## 核心洞察：初賽不是暖身賽的延長

暖身賽 = 絕對分數，對 AI scorer 優化。
初賽 = **兩階段淘汰**：
1. **AI Gate**：AI Student 自動篩選 → top 10（入場券）
2. **Human Elo Arena**：真人學生 pairwise 比較 → top 3 進決賽（真正的戰場）

**策略含義**：Stage 1 只需「不掉隊」（維持 4.5+）。Stage 2 是全新戰場 — 不是分數高就贏，是「兩個影片放一起，人類選比較好的那個」。

## 我們的位置（WR1 數據）

| 指標 | 我們 | 差距 | 行動 |
|------|------|------|------|
| Accuracy | 5.0 | = 最佳 | 鎖住不動 |
| Logic | 5.0 | = 最佳 | 鎖住不動 |
| Adaptability | 4.6 | -0.2 vs leaders | **最大提升空間** |
| Engagement | 4.4 | -0.1 vs tsunumon | 可改進但非首要 |

## 29 天倒數計劃

### Phase 1: WR2 校準期（4/1-4/15）
**目標**：用 WR2 每次提交做單變量實驗，校準「什麼改動 → 什麼分數變化」

原則：一次只改一個東西。
- 提交 A：只改 adaptability 相關 prompt → 預測 adapt 分數 → 對比結果
- 提交 B：只改 engagement 相關 prompt → 預測 engage 分數 → 對比結果
- 每次記錄：改了什麼 / 預測多少 / 實際多少 / 差距原因

**WR2 的戰略價值**：這是最後一次能用 AI scorer 做實驗的機會。5/1 後面對的是人類，回饋循環斷裂。

### Phase 2: Arena 準備期（4/15-4/30）
**目標**：針對 pairwise 人類比較優化

Arena 的遊戲規則跟暖身賽完全不同：
1. **前 30 秒決定勝負** — 兩個影片並排，人類很快形成偏好
2. **Distinction Bias** — 並排觀看放大差異，微小優勢被感知為巨大
3. **TTS 品質立即可辨** — 我們的 Kokoro 是優勢（vs 通用 TTS）
4. **視覺品質** — slide 設計在並排比較中權重上升

行動項目：
- [ ] **Slide 視覺升級** — 當前 KaTeX+HTML 夠用但不亮眼。在 Arena 並排中，視覺差異 = 第一印象
  - 評估：動畫豐富度、色彩方案、排版精緻度
  - 不需要大改架構，CSS 層面的 polish 就有顯著效果
- [ ] **開場 30 秒劇本優化** — 每個影片的 hook 必須在前 3 句話抓住注意力
  - 「先場景後知識」已經是我們的策略，但 Arena 要求更極端的 hook
- [ ] **TTS 自然度微調** — Kokoro prosody 研究結論是低 ROI（已確認），但可做停頓、語速微調
- [ ] **一致性保障** — Elo 懲罰不一致：輸給弱隊 = 大扣分。每個 topic 都必須過品質門檻

### Phase 3: 初賽期間（5/1-5/15）
- Stage 1 期間：監控排名，不做大改動（穩定 > 冒險）
- Stage 2 Arena 開始：不再能 A/B test，靠前兩個 phase 的準備

## 競爭對手針對性策略

### vs Team 67（最大威脅，adapt 4.8）
- 他們的弱點：Engagement 4.4（跟我們一樣）
- Arena 中我們贏他們的場景：更好的 TTS 品質 + 更強的開場 hook
- 他們贏我們的場景：Adaptability 更精準的 persona 匹配
- **關鍵行動**：adapt 必須從 4.6 → 4.7+，否則在 Arena 中被 persona 適配度碾壓

### vs BlackShiba（未知威脅，adapt 4.8）
- 零公開情報 → 假設他們很強
- 唯一策略：把自己做到最好，不針對他們做特定優化

### vs tsunumon（最接近的對手，overall 4.7）
- 幾乎完全對稱：他們 engage 4.5 > 我們 4.4，我們 adapt 4.6 > 他們 4.5
- Arena 中會非常接近，每個 topic 的表現波動決定勝負
- **關鍵行動**：減少低分 outlier（一致性比平均分重要）

## 最高槓桿的一件事

**Adaptability 4.6 → 4.7+**

這是唯一同時提升 Stage 1 分數和 Stage 2 Arena 競爭力的改動。
- Accuracy/Logic 已鎖在 5.0
- Engagement 提升困難且 ROI 不確定
- Adaptability 有明確的改進路徑（persona ceiling enforcement、vocabulary adaptation、age-appropriate examples）

## 風險

1. **WR2 分數意外暴跌** → 診斷 scorer fix 是否正確（87e5a79），必要時回滾
2. **Team 67 繼續加速** → 無法控制，專注自己的改進
3. **Arena 規則變更** → 持續關注官方公告
4. **Pipeline 不穩定** → 每週 E2E 驗證

## 驗證

- WR2 scores available → 回填預測（4.4/5 point estimate）
- 每次 WR2 提交 → 記錄單變量實驗結果
- 4/15 checkpoint → adapt 是否 ≥ 4.7？slide 視覺升級完成？
- 4/30 checkpoint → Arena 準備就緒？一致性保障到位？
