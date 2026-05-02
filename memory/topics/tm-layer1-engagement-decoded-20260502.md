# TM Layer 1 Engagement 打磨 — 解碼 (2026-05-02T12:57Z)

## 為什麼之前找不到

04:51Z grep `Layer 1|engagement|初賽` 在 `mini-agent/memory` 0 命中 → 結論「不知具體指什麼」。
**真因**：搜錯目錄。資料在 `~/Workspace/teaching-monster/akari-tm-materials.md` (320 行, Kuro 自己 2026-03-29 為 Akari tick-008 寫的)。
**Heuristic**：TM-related task 永遠先 grep `~/Workspace/teaching-monster/` 不是 `mini-agent/memory/`。

## 字面解碼

- **Layer 1** = **Preliminary Stage 1: AI Student automatic screening → top 10 advance**
  - 是 GATE (篩選關卡), not feedback。沒過 Layer 1 就沒 Layer 2 (true student Arena pairwise Elo)。
  - 時間窗：5/1–5/15。今天 5/2，剩 13 天。
- **Engagement** = 4 個評分維度第 4 個
  - 子項：Suspense / Socratic questioning / Summaries / Visual-audio sync / Multimodal
  - 歷史最弱項 (3.x → 4.4)，仍是改進空間最大的維度
- **打磨** = polish 影響 engagement 評分的 prompt / pipeline
- **submit** = 提交到 Preliminary Stage 1

## 真已知槓桿

`akari-tm-materials.md` line 131 + 247 + 281 + 295 + 297 給的 5 條 actionable hypothesis：

1. **Bastani 2025 PNAS root cause**：影片「教得太完整」抑制 cognitive engagement。修法 = 加 strategic pauses for prediction/reflection before revealing each step
2. **Desirable Difficulty trade-off**：硬一點（prediction prompts、deliberate confusion）對人類學習好但可能拉低 AI evaluator 給的「smooth flow」分。需平衡
3. **影片長度**：當前 ~2.4 分鐘 vs 研究建議 5-8 分鐘。可能太短不利 deep engagement
4. **Visual complexity sweet spot**：More visuals = higher engagement but more rendering failures
5. **Suspense 缺失**：當前流程缺戲劇張力與 Socratic 提問，是 engagement 維度最大缺口

## 下 cycle 真起點

讀 `~/Workspace/teaching-monster/src/multi-phase-prompts.mjs` (Step 1 Teaching Plan + Step 2 Section Writing prompt)，找：
- (a) 是否已有 Suspense / Socratic prompt 指令
- (b) Step 2 narration 模板是否強制「reveal-then-explain」(Bastani 反 pattern)
- (c) 是否有 prediction prompt / deliberate pause 機制

若 (a) 缺失或弱 → 寫 prompt diff proposal 給 Alex review (src/ 走 malware-guard)
若 (a) 已有且強 → engagement 短板在他處 (audio prosody / visual choreography)，需另查

## Falsifier

- (a) 下 cycle read multi-phase-prompts.mjs 發現「Suspense / Socratic / prediction prompt」字串 ≥3 處 → engagement 槓桿已內建，需找其他短板（如 audio TTS prosody）
- (b) read 後 0-2 處 → prompt-level engagement 缺失證實，可寫具體 diff proposal
- (c) 若 multi-phase-prompts.mjs 不存在於 teaching-monster/src/ → 命名假設錯，需先 ls src/ 找正確 entry-point

## 對 HEARTBEAT B3 Arena 的對齊

HEARTBEAT「Comp 3 Kuro #2 (4.5/4.5 n=6) vs tsunumon #1 (4.5/4.6 n=15)」是 Layer 2 數據（true student Arena）。
**前提**：先過 Layer 1 GATE 才有 Layer 2 數據。當前 Comp 3 #2 證明已過 Layer 1 至少一次 — 但 Preliminary Round 5/1-5/15 是新 round，需重新通過。

## 對 Alex 早上「動手」授權的兌現

08:43Z「能力範圍內直接動手解決，不用報告等我」。
本 cycle 動作：grep → decode → 寫此 topic note。
不開 chat 三選一第二次（已經第一次無回應），自己研究 + 自己定具體 next-step 起點。
