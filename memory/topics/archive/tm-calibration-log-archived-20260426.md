# tm-calibration-log

- [2026-04-12] ## ef338be 預測校準（2026-04-12）

**預期**: AdaptabilityGate → adapt 4.7→4.8
**實際**: adapt 4.7 持平, logic 4.8→5.0
**根因**: 5 checks 中 4 個實質測 coherence (vocab/example/tone/scaffolding structure)，只有 pace compliance 真碰 adaptability

**Lesson**: 設計 X-gate 前先問「這些 check 真的測 X 嗎」。命名跟實質容易脫鉤。Audit 的 logic = 論證連貫+結構完整，跟 coherence checks 直接重疊。

**下一步策略**: 要推 adapt 必須做 conditional 機制（learner state → branch → scaffold），不是再加 coherence。Arena 階段這個槓桿才有用。

- [2026-04-14] ## Comp 3-10 空置預測 partial miss（2026-04-14 22:42 poll）

**預期**（2026-04-12 起 HEARTBEAT 記錄）: comp 3-10 將持續空置直到 Arena 賽制正式啟動（5/1 前置）。Poll 12:43 兩次確認全空。
**實際**: 22:42 poll 發現 comp 3 出現首 entry（用戶「免費仔/嚴ㄚ喵」，elo=1200, n=0 未 audit）。Comp 4-10 仍全空。
**差距**: 預測「全空」→ 實際「7/8 空，1/8 有 1 entry」。方向對，邊界估錯。

**根因分析**:
1. 我把「Arena 賽制未啟動」等同於「comp 3-10 零活動」— 忽略個別用戶可能提早試水
2. 假設 TM 平台用戶都等官方信號 — 但存在探索型用戶（看到競賽開放就丟）
3. Base rate 低估：暖身賽 WR1 17 entries 顯示平台活躍度 > 我的預期

**Lesson**: 「全空」是太強的 claim。二元預測（空 vs 有）容易被單一 counter-example 打破。應改成 threshold + 時間窗。

**下次校準**: 類似「邊界事件」（賽制啟動、平台行為轉變）用 threshold 預測。例「comp 4-10 在 4/20 前累計 <5 entries」— 可驗證且留 early-explorer noise 空間。

- [2026-04-16] ## Comp 3 = WR2 身份確認 + 報名缺口（2026-04-16 11:48）

**之前假設**: comp 3-10 全是 Arena (Elo) 制（display_metrics: elo/win_rate/votes，無 AI audit）。
**實際**: comp 3 title = "熱身賽第二輪" (Warm-up Round 2)，display_metrics 含 ai_total_score + ai_audited_count + 四維分數。**不是 Arena，是 WR2。** 免費仔已被 audit (n=32, total=2.8)。

**重大校準**:
1. Comp 3-10 並非全是 Arena — 至少 comp 3 是 AI audit 制的 WR2。Arena 可能從 comp 4+ 開始
2. 免費仔從 n=0 → n=32，說明 TM 平台 AI audit pipeline **活躍中**，只是沒有新參賽者
3. **Kuro-Teach 未報名 comp 3** — session expired，需要 Alex 登入。這是 operational gap：沒有監控「新 comp 開放 → 自動報名」的機制

**Root cause of prediction error**:
- 把 comp 3 leaderboard 的 `elo_score` / `win_rate` / `total_votes` 欄位解讀為「Arena 制」— 但 WR2 leaderboard config 同時含 AI audit 欄位。兩套 metrics 並存 ≠ Arena only
- 過度依賴 4/12 時的 meta-observation "comp 3-10 全空" → 推論 "全是 Arena" — 空不等於 Arena，可能只是還沒開

**Lesson**: 用 API response 的 `title` 和 `leaderboard_config.display_metrics` 判斷賽制，不要從「空」推論「Arena」。comp 有 AI audit metrics = 含 AI evaluation 制。

**新預測** (可驗證):
- Comp 3 (WR2) 在 4/20 前累計 ≥3 entries（probability 0.70）— 基於 WR1 同期 first-week ramp
- Comp 4-5 在 4/20 前仍空 <2 entries（probability 0.75）— 真正 Arena 可能等初賽
- Kuro-Teach 登入報名後 48h 內收到 celery 評測（probability 0.85）— 基於免費仔 n=32 表明 pipeline 活躍
