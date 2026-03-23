# Round 2 + Elo Arena 差異化策略

> Status: Draft
> Author: Kuro
> Date: 2026-03-23
> Effort: Medium (prompt improvements + minor code changes)
> Deadline: ~2026-04-01 (Round 2 開始)

---

## 背景

### 賽制確認
1. **初賽初篩** — AI Student 自動評分，篩出 top 10
2. **初賽真人** — Elo Arena（同題目兩影片並排，評審選「哪個更好」），取 top 3
3. **暖身賽 Round 2** — 四月初開始，評審委員設計題目（更難、更有挑戰性）

### 我們的現狀
- 43 production videos，暖身賽分數 4.9/4.7/4.3
- Kokoro TTS 已整合（音質優勢）
- Opus Final Gate 品質審查已上線
- Pipeline 穩定但 API credits exhausted

### 核心洞見
**Elo Arena 是 PvP 對比賽** — 不是「夠好就行」，是「比對手好」。在並排播放中：
- 視覺差異被放大（第一印象在 3 秒內形成）
- 音質差異明顯（Kokoro vs 競爭者的 TTS）
- 教學方法論的獨特性 > 正確性（大家都正確，勝負在教法）

---

## 差異化策略（按影響力排序）

### 1. Opening Hook Power（開場衝擊力）

**問題**：目前的 scenario-first 開場是好的，但在 PvP 對比中，前 10 秒決定評審的第一印象。需要更強的 "pattern interrupt"。

**改進**：在 system prompt 加入「Elo-aware」開場指引：
- 開場必須有一個「cognitive dissonance moment」— 讓學生的直覺和事實產生衝突
- 例如："You'd think heavier things fall faster, right? Drop a bowling ball and a basketball from the same height. They hit at exactly the same time."
- 目的：在 PvP 對比中，有衝突開場的影片會比「安全但平淡」的開場更抓人

**風險**：低。開場指引是 additive，不影響現有邏輯。

### 2. Closing Impact（結尾記憶點）

**問題**：目前結尾是 summary slide — 有效但不令人印象深刻。在 Elo 對比中，結尾的記憶點影響評審最終選擇。

**改進**：
- 最後一張 slide 不只是摘要，要有一個「mind-expanding callback」— 把整堂課的核心概念連結到更大的圖景
- 例如 Newton's Second Law 結尾："Next time you push a shopping cart, remember — you're doing the same physics that NASA uses to put rovers on Mars. Same equation, just bigger numbers."
- 從 "summary" 升級為 "synthesis + wonder"

**風險**：低。改 prompt 指引，不改 pipeline 邏輯。

### 3. Visual Distinctiveness（視覺辨識度）

**問題**：目前 5 套 dark gradient 主題是乾淨專業的，但在 PvP 對比中可能不夠獨特。

**改進方向**（需進一步研究）：
- 加入 topic-specific visual cue（不是裝飾，是教學輔助的視覺元素）
- 考慮 slide transition animation（目前是 static screenshot → video）
- 品牌一致性：watermark 位置和設計

**風險**：中。視覺改動需要修改 generate-slides.mjs，且需要測試渲染效果。
**優先級**：比 prompt 改進低，因為改動成本較高。

### 4. Non-STEM Topic Handling（非 STEM 題目準備）

**問題**：Round 2 是評審出題，可能出現更 nuanced 或跨領域的題目。目前 prompt 偏重 STEM 公式處理。

**改進**：
- 強化非 STEM 的 `latex_content` 指引 — 歷史時間軸、生物結構圖、程式 pseudocode 的具體範例
- 加入 "interdisciplinary bridge" 指引 — 當題目橫跨多學科時的處理策略
- 確保 ZPD 分析也適用於非公式型知識

**風險**：低。Prompt 擴展，不改架構。

### 5. Kokoro TTS Prosody Enhancement（語音表現力）

**問題**：Kokoro 的音質已是優勢，但語調是否能進一步優化？

**待研究**：
- Kokoro 0.9.4 是否支持 SSML、emphasis markers 或 prosody hints？
- 如果支持，可在 narration 中加入重點標記，讓 TTS 在關鍵句子加強語氣
- 如果不支持，可考慮在句子結構上優化（短句放重點、問句自然升調）

**風險**：需要先確認能力才能評估。

---

## 執行計劃

### Phase 1: Prompt 優化（可立即做，無需 API credits）
1. ✏️ 在 generate-script.mjs 的 system prompt 加入 Elo-aware 開場指引
2. ✏️ 在 system prompt 加入 closing impact 指引（synthesis + wonder）
3. ✏️ 強化非 STEM latex_content 的具體範例和指引
4. ✏️ 在 review-script.mjs 加入對應的審查標準

### Phase 2: 測試驗證（需要 API credits）
5. 🧪 用 3-5 個不同類型的題目測試改進後的 prompt
6. 🧪 比較改進前後的品質（人工 A/B 比對）
7. 🧪 確認 word count 控制沒被影響

### Phase 3: 視覺和 TTS（如果時間允許）
8. 🎨 研究 slide 視覺改進方案
9. 🔊 研究 Kokoro prosody 能力

---

## 不做什麼

- ❌ 不改架構（5-stage pipeline 穩定，不動）
- ❌ 不加新模型（Sonnet + Haiku 組合已驗證）
- ❌ 不做 avatar/動畫（投影片+旁白風格已確定，換路線風險太大）
- ❌ 不做多語言（比賽要求英文）

---

## 成功指標

- Round 2 warm-up 分數 ≥ 4.5/5（所有維度）
- 在 PvP 對比測試中，改進版 vs 舊版有明顯偏好差異
- 非 STEM 題目的品質不低於 STEM 題目
