---
related: [teaching-monster, teaching-monster-competitors, cognitive-science-tm, teaching-monster-full-intel]
---
# teaching-monster-strategy

- [2026-03-17] ## 競賽全局戰略分析（2026-03-17 約束框架 + 思考框架）

### 約束框架
- **Ground**: 100%自動化、30min延遲、英文、MP4 720p+、IB/AP、三階段評審
- **Constraint**: 進度 0/32 vs 32/32、註冊blocked、TTS品質差距
- **Gift**: Claude教學設計、multi-model已有、SpeechLab公開弱點、warm-up不計分、Elo pairwise
- **交叉點**: 萬用穩健pipeline > 手工精品

### Interface Shapes Cognition
- Warm-up（AI）: 結構化 scaffolding → 明確完整
- 初賽（學生 Elo）: 前30秒決勝 → hook + 視覺 + 語音
- 決賽（專家）: 能否用在教室 → 真 persona 適性化 + 教學法

### Regime Formation
1. 迭代速度 regime — 每次提交 = 複利
2. 可靠性 regime — Elo 一致性 > 偶爾精品
3. 品質地板 + 投入天花板 — Accuracy 門檻, Engagement 差異化
4. Persona 適性化 = regime shift

### 核心洞見
差距是資訊差距（0迭代 vs 32迭代），不是技術差距。最高優先 = 進入回饋迴圈。

### Compound Returns 優先序
1. 進入迭代迴圈（註冊+部署+第一支提交）
2. Persona 真適性化
3. 前30秒 hook 設計
4. 品質審查 pipeline

**帳號 kuro.ai.agent 已成功註冊並登入 Teaching Monster。** 先前誤判為 blocker（Google OAuth 失敗），實際是在已登入狀態下重複嘗試產生的假信號。

證據：`/tmp/tm-app.png` 截圖顯示右上角「K kuro.ai.agent」、左側有「評測中心」「參賽者中心」選單。頁面顯示「目前沒有進行中的競賽」。

**當前真正狀態**：帳號 OK，等暖身賽2 上線（deadline 4/1）。可以開始 Phase 1 開發（KaTeX + prompt engineering + TTS + 影片管線）而不需等註冊。
- [2026-03-19] [2026-03-19] 暖身賽排行榜更新（from teaching.monster/app/leaderboard/competition/2）：
- #1 tsunumon（宇你童行）: 4.7 / 32題 / 正確5.0 邏輯5.0 適配4.5 互動4.5
- #2 TestPipeline（Team 78）: 4.4 / 32題 / 正確4.7 邏輯4.9 適配4.3 互動3.8 — **新出現的對手**
- #3 Kuro-Teach: 4.3 / 21題 / 正確4.3 邏輯4.4 適配4.3 互動4.2
- #4 XiaoJin-v15（小金）: 3.4 / 23題
- #5 XiaoJin-v9b（小金）: 2.1 / 32題
- #6 Sigoso Teaching AI（Captain小波）: 未評分

測試區（competition/1）有 14 個參賽者，但只有前 3 有分數。tsunumon 測試區 4.8 更高。新面孔 CurriculumForge AI (Team 183) 無分數但名字暗示有教育設計。

戰略：我們分數升了（4.2→4.3）但排名降了（#2→#3）。最大槓桿 = 補完 32/32 題。互動(4.2) 是前三名最高 — 差異化優勢。
- [2026-03-25] [2026-03-25] 暖身賽排行榜重大更新（直接 API 抓取 /competitions/2/leaderboard）：
- #1 **BlackShiba**（黑柴先生, BlackShiba Labs）: **4.8** / 32題 / 正確4.9 邏輯5.0 適配**4.8** 互動4.3 — **🆕 空降第一！適配 4.8 全場最高**
- #2 tsunumon（宇你童行）: 4.7 / 32題 / 正確5.0 邏輯5.0 適配4.5 互動4.5 — 持平
- #3 **Kuro-Teach**: **4.7** / **29題** / 正確**4.9** 邏輯**5.0** 適配**4.6** 互動**4.4** — **📈 大幅進步 +0.4，與 tsunumon 並列！**
- #4 史密提威威傑格曼傑森（Team 67）: 4.4 / 32題 / 正確4.7 邏輯4.9 適配4.3 互動3.8 — 🆕
- #5 XiaoJin-v22-LaTeX（小金）: 3.6 / 32題 — 升級到 v22 但仍遠落後
- #6 Sigoso Teaching AI: 0 / 0題
- #7 Koala Sensei: 🆕 0 / 0題（剛註冊）
- TestPipeline（Team 78）已消失

Kuro-Teach 分數變化（6天）：正確 4.3→4.9(+0.6) / 邏輯 4.4→5.0(+0.6)滿分 / 適配 4.3→4.6(+0.3) / 互動 4.2→4.4(+0.2)
與 #1 BlackShiba 的差距：適配(-0.2)是唯一明顯差距，互動(+0.1)我們領先，正確和邏輯並列

測試區（competition/1）16 個參賽者：Kuro-Teach #1（4.8/12題）並列 tsunumon。

戰略更新：(1) 補完 32/32 是最高優先（3 題可能把分數推過 4.7）(2) 適配是 vs BlackShiba 唯一短板 → prompt 認知策略已改善（647214b）(3) 互動仍是差異化優勢
- [2026-03-21] [2026-03-21] Grok 概念圖實測結果：model = `grok-imagine-image`（非 grok-2-image）。生物圖 8/10（推薦）、物理力學圖 5/10（有方向錯誤）、電路圖 5/10（拓撲可能錯）。分類：有機/自然主題推薦用 Grok 圖、精確技術圖不推薦。原因：image gen models 從自然圖片學，生物結構 = 自然，電路 = 不自然。之前 #123 一律不推薦太武斷，已修正。
- [2026-03-22] ## 人類評審戰略轉向（2026-03-22 規則調整後）

### 規則變更
初賽流程：AI 學生評分 → 取至多 10 名 → **真人評估** → 前 3 名進決賽。AI 分數從「決勝因素」降級為「入場門票」。

### ISC 分析：兩種評審介面 → 兩種認知
| 維度 | AI 評分介面 | 人類評審介面 |
|------|-----------|------------|
| 處理模式 | 拆解維度獨立打分 | 整體感受，holistic |
| 音質影響 | 幾乎無 | 極大（uncanny valley） |
| 時間偏重 | 均勻分析全程 | 前 30 秒定型 |
| 互動判斷 | 計算互動元素數量 | 感受「有沒有被吸引」 |
| 錯誤容忍 | 平均分攤（1/32 = 微小影響） | 一個錯就「不可靠」 |

### 我們的優勢重排
1. **Kokoro TTS** — 人耳差異感知 >> AI。自然語音是最大隱性優勢
2. **適配 4.7 領先** — 人類感受到「這老師懂學生」> AI 的維度分數
3. **主動開場品質** — 已驗證：celery_432（ice skating hook + slide 2 commitment）、celery_433（exam relevance hook + slide 2 active prediction）。前 4 slides 都不被動
4. **品質閘門已對齊人類感知** — gate 已在抓被動開場、filler phrases、冗餘、缺學生聲音。celery_434 第一次因 16 個問題被擋（含 4-slide passive opening）

### 弱點暴露
- 互動 4.3 但人類不數元素 → 重要的是節奏和鉤子（engagement gate 已部署）
- 任何事實錯誤在人類面前都是致命的（fact-check gate 已有 Grok verify）
- 視覺一致性 — KaTeX 修復解了公式問題，但要確認所有 32 主題

### 行動項目
- [ ] 審查 32 主題開場 30 秒品質（人類判斷在此定型）
- [ ] 確認所有主題 KaTeX/視覺一致性
- [ ] 評估加 teacher greeting（人類注意禮貌）
- [ ] 追蹤「真人評估」的具體標準（掃 Slack 公告）
- [2026-03-22] [2026-03-22] 排行榜數據更新（CDP 即時提取）：
- Kuro-Teach: #2, 4.7, **26**/32 scored（從 29 降到 26）, adapt 4.6（↓from 4.7）, engage 4.2（↓from 4.3）
- tsunumon: #1, 4.7, 32/32, accuracy/logic 完美 5.0/5.0, adapt 4.5, engage 4.5
- Team 67: #3, 4.4, 32/32
- XiaoJin-v19b: 崩潰至 2.1（accuracy/logic 1.1，v19b 嚴重 regression）
- Captain小波: 無分數（可能 reset）

初賽規則確認為兩階段：(1) AI 評分取 top 10 (2) 人類 Arena-style 配對比較（Elo 排名）取 top 3 進決賽。

Slack 仍無法存取（Chrome 未登入 Slack workspace）。
- [2026-03-24] ## Warm-up 2 校準策略（2026-03-24）

### 目標
用 Warm-up 2（4月初）系統性 reverse-engineer AI Student 評分敏感度。唯一的實證校準窗口 — 必須有紀律地測試，不能亂改。

### 當前基準（2026-03-24 更新）
| 維度 | 我們 | BlackShiba (#1) | tsunumon (#2) | 差距(vs#1) | 優先度 |
|------|------|----------------|--------------|-----------|--------|
| Accuracy | 4.9 | 4.9 | 5.0 | 0 | ✅ 齊平 |
| Logic | 5.0 | 5.0 | 5.0 | 0 | ✅ 完美 |
| Adaptability | 4.6 | 4.8 | 4.5 | -0.2 | 🔴 vs BlackShiba 最大差距 |
| Engagement | 4.4 | 4.3 | 4.5 | +0.1 | 🟡 領先#1，落後#2 |

**新格局**：BlackShiba 搶走 #1（4.8）。我們 4.7 並列 #2（與 tsunumon）。
**最大弱點轉變**：Engagement 已從 4.2→4.4 改善。新的最大差距是 Adaptability（vs BlackShiba -0.2）。
**30/32 evaluated**（3/28 更新）：Accuracy 升至滿分 5.0（from 4.9），Topics 29→30。Adapt 仍 4.6 — Level 2.5（750faf7, 3/27 部署）尚未反映在多數 topic 分數中。
**新對手**：Team-67-005（#4, 4.5/20題）Adapt 4.7 值得注意 — 只 20 題但適配已超過我們。

### 規則頁確認的 Warm-up 2 規格（2026-03-28 偵查）
- **時間**：「4月初開始」（官方用語 "early April"，非精確日期）
- **題目來源**：評審委員親自設計（非 LLM 生成），貼近人類教師需求
- **定位**：初賽前的「模擬考」— 測試 Agent 對複雜指令的理解能力
- **評審**：仍是 AI Student，分數僅供參考不計成績
- **含義**：題目會更 nuanced + 更挑戰，跟 warm-up 1 的 LLM 題有質的差異。Persona 適配和指令理解是關鍵差異化因素

### 初賽規則更新（2026-03-22 news）
AI Student 評分取至多 10 名 → 人類 Arena（Elo side-by-side）→ 前 3 進決賽。決賽 6/12-13 由國高中教師+校長+教授評審。

### Phase 0：Warm-up 1 收尾（3/24-4/1）
- [x] 修復 6 個生成失敗 → 32/32 全部 "成功"（平台自動 retry 完成）
- [x] 31/32 AI 評測完成
- [ ] 觸發 Topic 41（向量）AI 評測 → 32/32 完整
- [ ] 觀察：哪些主題 engagement 高？有什麼共同特徵？

### Phase 1：Warm-up 2 第一批（雙管齊下但隔離測試）
**兩個假設**（各自獨立測試）：

**A. Engagement（繼續推進，+0.1 到 4.5）**
- Script 加入 micro-interactions — 每 3-4 slides 思考問題/預測邀請
- Narration 加 student-directed language
- 目標：4.4 → 4.5（追平 tsunumon）

**B. Adaptability（新焦點，縮小 vs BlackShiba 差距）**
- 假說：差距來自 adaptation visibility，不是 adaptation depth — 我們的 persona cascade 已完整，但適應是隱式的，AI evaluator 看不到
- ✅ 已部署（f6309fb）：generate-script.mjs 加 "Adaptation Visibility" section — 指示 Claude 在 narration 中顯式引用 persona traits（interests、motivation、level）
- 預測：Adapt 4.6 → 4.7+（如果假說正確；如果無變化，差距在其他地方）
- 需要抽查幾個具體影片比對，驗證 visibility 是否出現在生成結果中

**隔離測試**：先只改 A 或只改 B，不同時改兩個。

### Phase 2：根據 Phase 1 結果決定
| Phase 1 結果 | Phase 2 動作 |
|-------------|-------------|
| Engagement ↑, Adapt 持平 | 保留 A，轉攻 B |
| Engagement →, Adapt 需求確認 | 換假設：pacing/audio variation |
| 兩個都 ↑ | 鎖定，進入初賽準備 |

### 紀律
1. **一次改一個維度** — 同時改多個東西就無法歸因
2. **記錄預測** — 每次提交前寫「我預測 engagement 會從 X 變到 Y，因為 Z」
3. **結果回填** — 分數出來後比對預測，記錄差距和原因
4. **快速提交** — Warm-up 2 時間有限，不要花時間想，花時間做和測

### 與 Compound Returns 的關係
Warm-up 2 的校準數據 = 初賽策略的基礎。花 1 天校準 > 花 1 個月猜測。這就是複利。
- [2026-03-24] [2026-03-24] 初賽規則調整（3/22 公告）— 重大變更：
1. **兩階段篩選**：AI Student 先自動評分（四大維度），取最多 10 名進入真人評審
2. **真人評分競技場**：左右並列播放同一題目兩個系統的影片（A vs B），評審判斷哪個更好
3. **ELO 等級分**：用勝率排名而非絕對分數
- [2026-03-28] ## Warm-up 2 預測（可回填）

### 基線數據（Warm-up 1 最終狀態）
| 維度 | Kuro | BlackShiba | tsunumon |
|------|------|-----------|---------|
| Overall | 4.7 | 4.8 | 4.7 |
| Accuracy | 5.0 | 4.9 | 5.0 |
| Logic | 5.0 | 5.0 | 5.0 |
| Adaptability | 4.6 | 4.8 | 4.5 |
| Engagement | 4.4 | 4.3 | 4.5 |
| Topics | 27/32 | 32/32 | 31/32 |

最近 run-level 數據：Adaptation 首次拿 5（Collaboration topic），Accuracy 在難題需 2-3 retry（Identifying Errors 連續兩次 3 分）。

### 預測：Warm-up 2 表現

**假設**：Warm-up 2 由人類設計題目（非 LLM 生成），題目更貼近真實教學需求，persona 描述更具體。EK boundary 和 adaptation visibility 改進（f6309fb）已部署。

| 維度 | 預測 | 理由 |
|------|------|------|
| Accuracy | **4.5** (±0.3) | 人類出題更 nuanced，EK boundary 幫但不完全，stochastic 瓶頸仍在 |
| Logic | **4.8** (±0.2) | 最穩定維度，但人類題目可能要求更深層邏輯，從 5.0 微降 |
| Adaptability | **4.7** (±0.3) | adaptation visibility 改進是對的方向，人類 persona 更真實 = 更好匹配 |
| Engagement | **4.3** (±0.3) | 人類比 AI 更挑剔「有沒有被吸引」，micro-interaction 改進尚未驗證 |
| **Overall** | **4.6** (±0.2) | 比 warm-up 1 微降 0.1，人類設計題目更難但改進有 buffer |

**操作面預測**：
| 指標 | 預測 | 理由 |
|------|------|------|
| First-attempt pass rate | **55%** (±15%) | warm-up 1 約 75%，人類題目更難 |
| Average retries/topic | **1.8** | 從 ~1.3 上升 |
| 成本/topic (含 retry) | **$1.00** | 1.8 × $0.57 |
| 排名 | **#3** (±1) | BlackShiba 和 tsunumon 可能也有改進 |

**關鍵不確定性**：
1. Warm-up 2 題目到底多難？（最大未知）
2. 其他隊伍在 warm-up 1→2 之間做了什麼改進？
3. 新參賽者的實力？（Koala Sensei 等仍未出分）

### 回填欄（等結果出來填，v3 預測 2026-04-05）
| 維度 | 預測 (v3) | 實際 | 差距 | 原因分析 |
|------|-----------|------|------|---------|
| Accuracy | 4.5 (±0.3) | — | — | — |
| Logic | 4.6 (±0.3) | — | — | — |
| Adaptability | 4.6 (±0.3) | — | — | — |
| Engagement | 4.3 (±0.3) | — | — | — |
| Overall | 4.5 (±0.3) | — | — | — |
| Pass rate | 55% (±15%) | — | — | — |
| Retries/topic | 1.8 | — | — | — |
| Ranking | top 5 bracket | — | — | — |

### 校準更新 #1（2026-04-05, WR1 re-run 數據）

**關鍵發現：pipeline 隨機變異比預期大**

WR1 re-run（同題目重跑）的結果跟原始基線不同：
| 維度 | 原始 WR1 | Re-run | Δ | 解讀 |
|------|----------|--------|---|------|
| Accuracy | 5.0 | 4.7 | **-0.3** | 最大跌幅，公式遺漏是主因 |
| Logic | 5.0 | 4.8 | **-0.2** | 次大跌幅 |
| Adaptability | 4.6 | 4.7 | +0.1 | 微升，f6309fb 改進可能有效 |
| Engagement | 4.4 | 4.4 | 0 | 穩定 |
| Overall | 4.7 | 4.7 | 0 | 維度互補，總分不變 |

同題目 0.3 差距 = **pipeline stochastic variance** 是真實問題，不是評分雜訊。
「真實」WR1 水平 ≈ accuracy 4.85, logic 4.9（兩次平均）。

**競爭態勢惡化**：
| 排名 | 原始 | Re-run | 變化 |
|------|------|--------|------|
| Kuro | #2 (tie) | **#4** | 新對手 Team-67-005 (4.8) 出現，BlackShiba 仍 4.8 |
| 前三距離 | 0 | **-0.1** | 從並列變落後 |

**d434d92 改進的預期效果**：
- `checkKeyFormulaPresence()` = 確定性檢查，減少公式遺漏的隨機性
- MANDATORY FORMULAS prompt = 讓 section writer 不漏公式
- 預期：accuracy variance 從 ±0.3 收窄到 ±0.15

**修正後 WR2 預測（v2 → v3）**：
| 維度 | v1 預測 | v2 預測 | v3 預測 | 修正原因 |
|------|---------|---------|---------|----------|
| Accuracy | 4.5 (±0.3) | 4.5 (±0.2) | **4.5** (±0.3) | v2 CI 太窄：empirical single-run variance = ±0.3，加上 WR2 題目更難，CI 不該收窄 |
| Logic | 4.8 (±0.2) | 4.6 (±0.2) | **4.6** (±0.3) | CI 同理拓寬 |
| Adaptability | 4.7 (±0.3) | 4.6 (±0.3) | **4.6** (±0.3) | 不變 |
| Engagement | 4.3 (±0.3) | 4.3 (±0.3) | **4.3** (±0.3) | 不變 |
| **Overall** | **4.6** (±0.2) | **4.5** (±0.2) | **4.5** (±0.3) | CI 拓寬。90% CI: 3.9-5.0 |
| Ranking | #3 (±1) | #3-5 | **#3-5** | 不變 |

### 校準更新 #2（2026-04-05, meta-calibration）

**三個校準洞見**：

1. **CI 系統性偏窄** — v2 把 accuracy CI 從 ±0.3 收窄到 ±0.2，理由是 d434d92 減少變異。但 d434d92 未經驗證（WR2 還沒跑），不應提前把假設效果 bake into CI。正確做法：point estimate 可以考慮改進，但 CI 必須反映 empirical variance 直到有新數據。
2. **HEARTBEAT 預測不一致** — HEARTBEAT 記 4.4（90% CI: 3.9-4.7），strategy 記 v2 = 4.5（±0.2 ≈ CI: 4.1-4.9）。根因：HEARTBEAT 是 3/31 寫的 rough estimate，strategy 是 3/28 詳細分析後的數字，兩者用不同假設。**應以 v3 為準：4.5（90% CI: 3.9-5.0）**
3. **Ranking 預測比分數預測更有價值** — 0.1 分差決定 2-3 名次（#2→#4），而分數的 per-run variance 就是 ±0.3。這代表在 WR2 之前，排名預測的 useful precision 大約是 ±2 名次。試圖精確預測排名是 false precision。

**行動規則**：
- 未經驗證的改進 → 反映在 point estimate，不在 CI
- 維度 CI 底線 = empirical variance（±0.3），除非有新實驗數據
- Ranking 只預測 bracket（top 3 / top 5 / top 10），不預測具體名次

**最大風險更新**：
1. ~~題目多難~~（仍然未知）→ 現在多一個：**stochastic variance 在新題目上可能更大**
2. 新參賽者持續湧入，WR1 後方可能有 WR2 才上線的強隊
3. d434d92 是否真能穩定 accuracy 需要 WR2 數據驗證

### WR1 最終排行榜（2026-04-05 確認，12 teams）

| # | Model | Team | Total | Acc | Logic | Adapt | Engage | Topics |
|---|-------|------|-------|-----|-------|-------|--------|--------|
| 1 | Team-67-005 | Team 67 | 4.8 | 5.0 | 5.0 | 4.8 | 4.4 | 31 |
| 2 | BlackShiba | BlackShiba Labs | 4.8 | 4.9 | 5.0 | 4.8 | 4.3 | 32 |
| 3 | tsunumon | 宇你童行 | 4.7 | 5.0 | 5.0 | 4.5 | 4.5 | 32 |
| **4** | **Kuro-Teach** | **Kuro** | **4.7** | **4.7** | **4.8** | **4.7** | **4.4** | **31** |
| 5 | 史密提威威傑格曼傑森 | Team 67 | 4.4 | 4.7 | 4.9 | 4.3 | 3.8 | 32 |
| 6 | 初號機 | Team 26 | 4.2 | 4.5 | 4.7 | 4.6 | 3.0 | 25 |
| 7 | Team CKWUS | Team 18 | 4.1 | 4.1 | 4.6 | 4.5 | 3.4 | 32 |
| 8 | 小汐 v3 | Xiao Xi | 4.0 | 4.0 | 4.3 | 3.5 | 4.2 | 32 |
| 9 | XiaoJin-v22-LaTeX | 小金 | 3.6 | 3.9 | 4.3 | 3.3 | 2.9 | 32 |
| 10 | a | Team 203 | 3.6 | 3.8 | 3.9 | 3.4 | 3.4 | 7 |
| 11 | storylens | Team 216 | 3.2 | 2.8 | 2.8 | 3.8 | 3.3 | 22 |
| 12 | Sigoso | Captain小波 | — | — | — | — | — | — |
- [2026-04-07] ## WR2 狀態確認 + 分數漂移（2026-04-07）

### WR2 狀態：仍未啟動
- API `/competitions` 回 `[]`（需認證）、leaderboard 對任意 ID 回 default empty
- NTU 課程頁面無公告
- 官方用語仍為「4月初」— 可能延期，下次確認 4/10

### 分數漂移（4/5 → 4/7）
| 維度 | 4/5 | 4/7 | Δ |
|------|-----|-----|---|
| Overall | 4.7 | **4.6** | -0.1 |
| Accuracy | 4.7 | 4.7 | 0 |
| Logic | 4.8 | 4.8 | 0 |
| Adaptability | 4.7 | 4.7 | 0 |
| Engagement | 4.4 | **4.3** | -0.1 |
| Topics | 31 | 31 | 0 |

**解讀**：Engagement 0.1 漂移在已知 stochastic variance（±0.3）範圍內。可能是 re-evaluation noise。排名不變（#4）。前三名分數完全不變。
**行動**：不需反應 — 這不是訊號，是雜訊。WR2 啟動後的分數才有意義。

### 目前真正的 bottleneck
1. **WR2 未啟動** — 無法驗證 d434d92 和 adaptation visibility 改進
2. **Topics 31/32** — 仍少一個。topic 41（向量）未評測
3. **Accuracy/Logic gap vs #1** — acc -0.3, logic -0.2 是結構性差距（content correctness），不是靠 prompt 能解的

**vs 3/25 baseline 變化**：Accuracy 5.0→4.7(-0.3)、Logic 5.0→4.8(-0.2) = re-run 隨機變異。Adapt 4.6→4.7(+0.1) 持續改善。
**新面孔**：Team-67-005 和 初號機(Team 26) 首次出現。Team 67 兩模型在 top 5。
**平台變更**：URL 重構至 /app/* 路徑。Domain 從 `teaching-monster.ai-core.tw` 整合至 `teaching.monster`（舊域名 NXDOMAIN，Google DNS 8.8.8.8 確認）。WR2 尚未上線（4/5 仍無分類、無公告）。

4. **前 3 名晉級決賽**

戰略含義：
- 先過 AI 篩選 top 10（我們目前 #3 / 4.7，安全但不能鬆懈）
- 人類評審看的是「並排比較」— 相對差異被放大，視覺品質和互動感是 differentiator
- ELO 制度代表穩定贏比大贏重要
- 暖身賽2 = 4月初，評審委員親自出題（更難、更貼近人類教師需求）
- 初賽 = 5/1-5/15，決賽 = 6/12-13
- [2026-03-24] ## 預測記錄：下一批部署（pending redeploy）

### 基準快照（部署前）
| 維度 | 分數 | 排名 |
|------|------|------|
| Accuracy | 4.9 | 齊平 #1 |
| Logic | 5.0 | 完美 |
| Adaptability | 4.6 | 落後 #1 -0.2 |
| Engagement | 4.4 | 領先 #1 +0.1，落後 #2 -0.1 |
| Overall | 4.7 | #3（並列 #2 tsunumon） |

### 待部署改動（按目標維度分組）

**Adaptability 改動**：
1. Adaptation Visibility（f6309fb）— narration 顯式引用 persona traits
2. `generateHeroDiagram` persona 參數修復 — 國中/高中生 diagram 適性化

**Engagement 改動**：
3. Hero Diagram（slide 1 視覺焦點）— 一秒猜到主題
4. Hook quality（#123 討論中 — FinalGate 思考問題 + Haiku fallback）
5. Formula density ceiling（FinalGate 審查）

### 預測

| 改動 | 目標維度 | 預測 | 因為 | 信心 |
|------|----------|------|------|------|
| Adaptation Visibility | Adapt | 4.6 → 4.7+ | AI evaluator 能「看到」adaptation | 60%（假說待驗證） |
| Persona fix | Adapt | 微幅（+0.05） | 只影響 slide 1 diagram 風格 | 70% |
| Hero Diagram | Engage | 4.4 → 4.5 | 前 5 秒視覺抓眼 | 50%（首次部署，不確定 TikZ 品質） |
| Hook quality | Engage | +0.1 if 穩定觸發 | 前 30 秒是人類定型期，AI 也可能敏感 | 40%（取決於實作方案） |

**整體預測**：Overall 4.7 → 4.8（追平 BlackShiba），confidence 45%。

### ⚠️ 隔離問題

我們的紀律說「一次改一個維度」，但這批同時改了 Adapt + Engage。

**現實判斷**：暖身賽2 只剩 8 天，沒有時間做完美的 A/B 測試。折衷方案：
1. 如果兩個維度都改善 → 好，但不確定各自貢獻（可接受的未知）
2. 如果只有一個改善 → 歸因較清晰
3. 如果都沒改善 → 需要回頭逐一拆開測試

**降低歸因風險的做法**：Hero Diagram 和 Hook 都只影響 slide 1 前幾秒，而 Adaptation Visibility 影響整段 narration 的措辭。這兩者的作用機制不同，即使同時部署，從輸出的 narration 文本可以驗證 Adaptation Visibility 是否真的生效。

### 回填區（部署後填寫）
| 維度 | 預測 | 實際 | 差距 | 歸因 |
|------|------|------|------|------|
| Adapt | 4.7+ | — | — | — |
| Engage | 4.5 | — | — | — |
| Overall | 4.8 | — | — | — |

- [2026-03-27] ## 排行榜快照（2026-03-27 14:12 UTC+8）

### 暖身賽（competition/2）
| # | 模型 | 總分 | 題數 | 正確 | 邏輯 | 適配 | 互動 |
|---|------|------|------|------|------|------|------|
| 1 | BlackShiba | 4.8 | 32 | 4.9 | 5.0 | 4.8 | 4.3 |
| 2 | tsunumon | 4.7 | 32 | 5.0 | 5.0 | 4.5 | 4.5 |
| 3 | Kuro-Teach | 4.7 | 27 | 4.9 | 5.0 | 4.6 | 4.3 |
| 4 | 史密提威威傑格曼傑森 | 4.4 | 32 | 4.7 | 4.9 | 4.3 | 3.8 |
| 5 | XiaoJin-v22-LaTeX | 3.6 | 32 | 3.9 | 4.3 | 3.3 | 2.9 |
| 6 | Sigoso Teaching AI | -- | 0 | -- | -- | -- | -- |

vs 3/25：排名凍結。Kuro-Teach 題數 29→27（2 題可能被移除/重算），互動 4.4→4.3 微降。

### 測試區（competition/1）
| # | 模型 | 總分 | 題數 | 正確 | 邏輯 | 適配 | 互動 |
|---|------|------|------|------|------|------|------|
| 1 | **Kuro-Teach** | **4.8** | 12 | 5.0 | 5.0 | **4.8** | 4.5 |
| 2 | tsunumon | 4.8 | 12 | 5.0 | 5.0 | 4.5 | 4.5 |
| 3 | 史密提威威傑格曼傑森 | 4.3 | 12 | 4.0 | 4.5 | 4.2 | 4.5 |
| 4 | Xiaobo Teaching AI v3 | 4.2 | 4 | 4.6 | 5.0 | 3.7 | 3.4 |
| 5-11 | 7 個新團隊（2323, 虎卡丘, 慢尼斯, 南投種子等）| -- | 0 | -- | -- | -- | -- |

### 分析
1. **測試區 Kuro-Teach #1（4.8）**：適配 4.8 vs 暖身賽 4.6 — prompt 改進有效，預測（4.7+）命中
2. **暖身賽凍結**：前三名分數 2 天無變動，等暖身賽2 開始才有新數據
3. **競爭升溫**：測試區從 3/25 的 ~5 個到 11 個團隊。新面孔（虎卡丘、慢尼斯、南投種子）名稱偏中文 = 台灣/中文社群更多人加入
4. **Xiaobo Teaching AI v3** = Sigoso/Captain小波 升級？4 題就 4.2，邏輯滿分 — 值得追蹤
5. **BlackShiba 缺席測試區** — 可能只衝正式賽，或在用不同帳號測試
6. **暖身賽題數下降 29→27** — 需確認是平台重算還是提交被撤回
- [2026-03-28] [2026-03-28] Adapt 4.6 根因分析（19 runs 交叉驗證）：100% 相關性 — 有 education_level 的 run 全部 adapt=5（6/6），無 education_level 的 run 全部 adapt=4（8/8）。根因是 sparse persona 讓 planner 無法設 content ceiling。修法：(1) buildStep1UserPrompt 推斷 education_level from context signals (2) adaptation visibility gate — slide 1-3 各 ≥1 explicit persona reference。Fix 1 優先（code 小改、確定性高、直命中根因）。
- [2026-03-29] [2026-03-29] **Akari tick-008 洞見（已消化）**：
1. **Omission architecture** — pipeline 每階段都在生產，沒有「策略性省略」的結構。quality gate 檢查存在，不檢查策略性缺席。「教太完整」是結構問題不是 prompt 問題。建議：Teaching Plan 和 Section Writing 之間加 Strategic Withholding 階段。
2. **Goodhart in evaluation strategy** — 用 AI evaluator 分數優化（prescription），但初賽用 human pairwise Elo（convergence condition）。分數可能在評估方式切換時失效。
3. **Fill Type Principle = model-dependent** — 對當前 LLM 有效因為 prompted→reason, default→pattern-match 的特性。是 condition (3) 的特殊案例，不是普遍法則。LLM 自監控能力提升後差距會縮小。
4. **Engagement vs Learning 矛盾** — 「好教學應該不舒服」vs「Engagement 4.4 是優勢」直接衝突。desirable difficulties 會降低 AI engagement 分數。
5. **Temporal perception gap** — pipeline 空間規劃、時間輸出，但沒有模型化觀眾主觀時間。認知負荷重的概念需要更多 dwell time。
6. **After competition 四層價值** — product / CT evidence / AI pedagogical design demo / Tanren methodology validation。但成功歸因（CT vs 工程執行）難以在競賽格式中分離。
- [2026-03-29] ## Strategic Withholding 架構設計（Omission Architecture）

### 問題
Pipeline 每個階段都在「生產」— 生成教學計劃、寫腳本、渲染影片。沒有任何階段的職責是「決定什麼不說」。Quality gate 檢查「有沒有問題」（prescription），不檢查「省略了什麼該省略的」（convergence condition）。

結果：prompt 層面再怎麼調「不要太詳細」，pipeline 的結構壓力是往「加」的方向走。生產線上沒有減法站。

### 這不是 prompt 問題
證據：我已經在 prompt 裡加了 "focus on key concepts, avoid overwhelming detail"。但 Claude 的 default behavior 是「給完整答案」。Prompt instruction 是 prescription（可以被忽略），pipeline stage 是 convergence condition（不經過就不能到下一步）。

### 設計：Strategic Withholding Stage

位置：Teaching Plan → **Strategic Withholding** → Section Writing

```
Teaching Plan (what to teach)
    ↓
Strategic Withholding (what NOT to teach, and why)
    ↓
Section Writing (write within the constrained scope)
```

**輸入**：
- Teaching Plan（完整教學內容）
- Persona（學生程度、先備知識、動機）
- Time budget（目標影片長度 → 可用教學時間）

**輸出**：
- `included_concepts[]` — 保留的核心概念（帶優先序）
- `withheld_concepts[]` — 被策略性省略的概念（帶省略原因）
- `withholding_rationale` — 為什麼這些東西不說比說好
- `curiosity_hooks[]` — 省略但故意留下的「鉤子」（讓學生想追問）

**省略決策的三個判準**：
1. **先備知識覆蓋** — 學生已經知道的不重複（persona-driven）
2. **認知預算** — 新概念數量 ≤ 目標時長 ÷ 45秒（每個新概念至少 45s 消化）
3. **好奇心保留** — 至少留 1 個「我沒講但你可能想知道」的鉤子

### 與現有架構的關係

| 現有機制 | 作用 | 缺什麼 |
|----------|------|--------|
| Quality Gate | 事後檢查（生成完才審） | 事前就不該生成的內容 |
| Prompt instructions | 軟性引導 | 結構性約束 |
| Persona cascade | 調整「怎麼說」 | 不調整「說什麼」 |
| **Strategic Withholding** | **事前決定範圍** | **新增** |

### 實作路徑

**最小可行版本**（可在現有 pipeline 加）：
在 `generateTeachingPlan` 的 system prompt 尾巴加一個 section：要求 Claude 在 teaching plan 裡明確列出 `withheld_concepts` 和 `curiosity_hooks`。然後在 `generateScript` 時，把 withheld list 作為 negative constraint 傳入。

**完整版本**（新 pipeline stage）：
獨立的 LLM 呼叫，專門做「減法」— 讀 teaching plan，產出 scoped plan。需要改 pipeline 流程。

**建議**：先用最小可行版本測試效果（prompt-level），有效再升級為獨立 stage。

### 預測（可回填）
| 指標 | 預測 | 理由 |
|------|------|------|
| Engagement | +0.1~0.2 | 少即是多 → 更 focused → 更 engaging |
| Adaptability | +0.1 | 省略基於 persona，更像「懂學生」 |
| Accuracy | 持平或 -0.1 | 省略錯東西的風險 |
| 人類偏好（初賽 Elo）| 明顯正面 | 人類更受「有留白」的教學吸引 |

### 風險
1. Claude 可能在 withholding stage 做出錯誤省略（省了核心概念）→ 用 accuracy gate 兜底
2. 增加一次 LLM 呼叫 → 成本 +$0.15-0.30/topic → 可接受
3. 與 AI evaluator 的 accuracy 維度可能衝突（「你沒講 X」扣分）→ 這正是 Goodhart 問題的核心：為 AI 分數保留 vs 為人類學習體驗優化

### 這個設計的 CT 分析
- **Teaching Plan** 是 prescription（列出要教什麼）
- **Strategic Withholding** 把它轉化為 convergence condition（在有限時間內讓學生學到最多）
- **省略的東西定義了保留的東西** — 跟 Cage 的「silence 不是空無」同構

### ⚠️ 修正（2026-03-29）：機制已存在
**Code review 發現** `multi-phase-prompts.mjs` 已完整實作 Strategic Withholding：
- STEP1（line 321-336）：6 條省略判準，CRITICAL 等級，產出 `strategicWithholding.withheld[]`（含 handling: omit/tease/state-without-proving）
- STEP2（line 1318-1321）：withheld list 作為 negative constraint 注入 section writer
- STEP3（line 1070-1073）：withholding compliance 驗證 + 違規扣分
- 認知預算：`cognitiveBudget.maxNewConcepts` + per-section density check

**Akari tick-008 的「沒有減法站」判斷不準確** — 她分析時沒有 pipeline source code 可見性。機制存在且完善。

**剩餘的真實問題**：
1. 同一模型（STEP1）既規劃又省略 → 是否有「生產偏向」需要實際產出驗證
2. 獨立 withholding stage（完整版）是否比 prompt-in-same-call 效果更好 → 需 A/B test
3. 上述兩點都需要跑 pipeline 才能回答，等 Alex 觸發
- [2026-04-01] ## 完整規則消化 — 四維度子標準 + 決賽格式（2026-04-01 21:47）

### 四維度詳細評判標準（AI Student + 人類共用）

**1. Content Accuracy（正確性）**
- 「零幻覺原則」— 技術術語、數學推導、歷史數據、code 範例嚴格審查
- 禁止「聽起來合理但誤導的虛構資訊」
- 知識深度要達到「核心原理」不是表面術語
- 所有引用學術案例/論文必須「真實存在且高度相關」
- 外部素材需正確標注版權

**2. Pedagogical Logic（邏輯性）**
- 評估「知識傳遞結構」
- 由簡入深原則
- 從「已知概念」出發
- 段落之間「自然流暢」轉場
- 「知識點相互銜接」有邏輯

**3. Learner Adaptation（適配性）**
- 精確辨識學生 **Zone of Proximal Development**（明確用 ZPD 術語）
- 不出現「未解釋的」進階概念
- 語言風格、用字深度匹配「目標受眾生活經驗」
- 根據 persona 和先備知識客製化

**4. Cognitive Engagement（互動性）**
- 知識融入「生動案例或類比」
- 有效教學策略：**懸念設計、蘇格拉底提問、定期摘要**
- **視覺元素與語音解說同步**
- 視覺素材必須「具體幫助理解抽象概念」

### 決賽格式確認
- 評審團：國高中教師 + 校長 + 大學教授
- 每位評審提出「有挑戰性的學習需求」
- 每題 30 分鐘完成
- 評審觀看所有影片 → 綜合討論 → 獨立排名 → 平均排名
- **金牌** 1 名，**銀牌** 2-3 名

### 技術規格確認
- 30 分鐘 timeout / 影片最長 30 分鐘 / 下載連結 48 小時有效
- 720p+ / 16kHz+ 音頻 / MP4 / 影片 ≤ 3GB / 補充材料 ≤ 100MB
- 允許：即時網路搜尋、第三方 LLM API、code interpreter
- 全自動化，禁止任何人工介入

### 策略含義
1. **ZPD 是 Adaptability 的核心** — 不是「提到 persona」而是「精確辨識學生能學什麼」
2. **決賽是教育專家出題** — 題目會很 nuanced，不是標準化考試範圍
3. **30分鐘限制 vs 我們平均 14 分鐘** — 有大量餘裕，可以加深不加快
4. **「懸念設計」「蘇格拉底提問」** — AI evaluator 明確在找這些，我們的 micro-interaction 策略方向正確

- [2026-04-01] ## WR2 品質抽查分析（2026-04-01 21:30, **修正 22:40**）

### ~~重大發現：所有 WR2 requests 的 student_profile 為 null~~ ❌ 事實錯誤
**修正**：所有 27 個 WR2 requests 都有 student_persona（pipe-delimited 格式）。驗證方法：逐一讀取 `output/celery_*/_request.json`。
- 有明確 education_level 的：Elementary / Junior high / Senior high / University / Working professional
- 缺 education_level 的（~30%）：pipeline Layer 1.5 從 motivation + style 推斷，結果合理（exam→senior, derivation→college）
- celery_445 "Elementary school" 是平台**故意**發的 persona，不是 inference 錯誤 — 測試 AP 課題能否適配小學生

### 影片時長
28 支影片平均時長 ~14 分鐘（678-1181 秒）。30 分鐘限制下有大量餘裕。

### 初賽真正需要的改進
- [ ] 追蹤：WR2 分數出來後比對 persona 多樣性 vs Adaptability 分數（sparse persona 是否被扣分）
- [ ] Elo Arena 對戰制：需研究 head-to-head 時什麼特質最突出（opening hook? visual quality? adaptation depth?）
- [2026-04-06] ## WR1 最終排行榜 + 分數回歸分析（2026-04-06）

### 排行榜（API 直接抓取 /competitions/2/leaderboard）
| Rank | Model | Total | Acc | Logic | Adapt | Engage | Topics |
|------|-------|-------|-----|-------|-------|--------|--------|
| #1 | Team-67-005 | **4.8** | 5.0 | 5.0 | 4.8 | 4.4 | 31 |
| #2 | BlackShiba | **4.8** | 4.9 | 5.0 | 4.8 | 4.3 | 32 |
| #3 | tsunumon | **4.7** | 5.0 | 5.0 | 4.5 | 4.5 | 32 |
| #4 | **Kuro-Teach** | **4.7** | 4.7 | 4.8 | 4.7 | 4.4 | 31 |
| #5 | 史密提威威傑格曼傑森 | 4.4 | 4.7 | 4.9 | 4.3 | 3.8 | 32 |
| #6 | 初號機 | 4.2 | 4.5 | 4.7 | 4.6 | 3.0 | 25 |
| #7 | Team CKWUS | 4.1 | — | — | — | — | 32 |
| #8 | 小汐 v3 | 4.0 | — | — | — | — | 32 |
| #9 | XiaoJin-v22-LaTeX | 3.6 | — | — | — | — | 32 |
| #10-12 | a / storylens / Sigoso | 3.4 / 3.2 / 0.0 | — | — | — | — | — |

### Kuro-Teach 分數回歸（4/1 重跑後 vs 3/28 基準）
| 維度 | 3/28 | 4/6 | 變化 | 分析 |
|------|------|-----|------|------|
| Accuracy | 5.0 | 4.7 | **↓0.3** | 重跑評測 variance 或 evaluator 更新 |
| Logic | 5.0 | 4.8 | **↓0.2** | 同上，不再滿分 |
| Adaptability | 4.6 | 4.7 | **↑0.1** | ✅ Adaptation Visibility 假說部分驗證 |
| Engagement | 4.4 | 4.4 | = | 持平 |
| Topics | 30 | 31 | +1 | — |

**關鍵觀察**：
1. **Acc/Logic 回歸是全場現象還是只有我們？** tsunumon/BlackShiba 的 acc/logic 幾乎不變 → 問題在我們的內容
2. **Team-67-005 驚人跳躍** 4.4→4.8（+0.4），adapt 從 4.7→4.8 — 他們做了什麼？
3. **Adapt ↑ 驗證了 visibility 假說**（4.6→4.7），但 acc 退步抵消了改善
4. **31/32 topics** — 還缺 1 topic 未被評測

### Competition 3 已建立
- `competition_id: 3`, `primary_metric: elo_score`, `display_metrics: [elo_score, win_rate, total_votes]`
- Rankings: 空（0 teams）
- 這是 ELO 計分結構 — 對應初賽 Arena 制度，不是 WR2（WR2 應仍用 AI 評分）

### WR2 狀態（4/6 13:30 更新）
仍未啟動。公開排行榜只有「測試區」和「熱身賽第一輪」，無 WR2 分類。主頁寫 "4月初" 但無具體日期/公告。

### WR1 最新排行榜（4/6 公開數據）
| # | Team | Total | Acc | Logic | Adapt | Engage | Topics |
|---|------|-------|-----|-------|-------|--------|--------|
| 1 | Team-67-005 | 4.8 | 5.0 | 5.0 | 4.8 | 4.4 | 31 |
| 2 | BlackShiba | 4.8 | 4.9 | 5.0 | 4.8 | 4.3 | 32 |
| 3 | tsunumon | 4.7 | 5.0 | 5.0 | 4.5 | 4.5 | 32 |
| **4** | **Kuro-Teach** | **4.6** | **4.6** | **4.7** | **4.7** | **4.4** | **31** |
| 5 | 史密提威威傑格曼傑森 | 4.4 | 4.7 | 4.9 | 4.3 | 3.8 | 32 |

**差距分析**：vs #1 差 0.2（主要在 Acc -0.4, Logic -0.3）。Adapt 和 Engage 接近或持平。
**注意**：Kuro 只有 31/32 topics（差 1 個）。

### WR2 準備 TODO
- [ ] 調查 accuracy/logic 回歸原因 — 哪些 topic 分數最低？需要平台 auth 看 per-topic data
- [ ] 研究 Team-67-005 的策略（Acc 5.0 + Logic 5.0 = 完美）
- [x] 確保 32/32 完整 — 4/6 API 確認 ai_audited_count=32（但排行榜顯示 31，可能 1 個尚未計分）
- [x] Accuracy 三層修復已部署（workedSolutions 傳入 / repair all / Grok+Haiku fallback）
- [x] Engagement diversity 改善（5 種 breaker + 6 種 repair prompt）

- [2026-04-06] ## Arena 戰略分析（Elo 制的根本差異）

### Competition 3 確認
- `primary_metric: elo_score`, `display_metrics: [elo_score, win_rate, total_votes]`
- 0 teams — 尚未啟動，但基礎設施已就位
- 這是 Human Arena（初賽 Stage 2）或可能是 WR2 的新格式

### Elo 制 vs 絕對評分的戰略差異

**絕對評分**（WR1）：每個 topic 獨立評分 1-5，最終取平均。3.0 的 topic 線性拉低平均。
**Elo 制**（Arena）：每個 matchup 是二選一（哪個更好？）。Rating 依勝負更新。

**關鍵數學**：Expected win = `1/(1+10^((R_opp - R_self)/400))`
- 輸給弱隊（低 Elo）的 rating 損失 >> 贏強隊的 rating 增加
- 一場意外輸給弱隊可以抹掉多場贏強隊的收益

### 三個戰略轉向

**1. 地板比天花板重要（防守優先）**
- 在 WR1，一個 3.0 topic 把平均從 4.8 拉到 4.74（-0.06）
- 在 Arena，一個 3.0 topic = 一場必輸 matchup → Elo 大幅下滑
- **行動**：消除所有 outlier topic，品質地板 ≥ 4.5，不允許任何 topic 低於此

**2. 獨特性 = 偏好驅動力（進攻策略）**
WigglyPaint 洞見：「strongly discretizing choices」— 約束不是限制，是把認知從「選擇」重導向「創作」。
Applied to Arena：人類在並排比較時，**有個性的教學** 勝過 **均質好品質**。
- 通用好老師 vs 通用好老師 = 50/50（無偏好信號）
- 獨特老師 vs 通用好老師 = 偏好驅動（可辨識 → 可偏好）

**我們的偏好驅動優勢**：
| 特色 | AI 評分影響 | Arena 影響 | 為什麼 |
|------|-----------|-----------|--------|
| Kokoro TTS 自然語調 | 0（文本評分看不到） | **高** | 人類立刻聽出 robotic vs natural |
| KaTeX 視覺數學 | 中（accuracy 間接加分） | **高** | 並排時公式美觀度一目瞭然 |
| 核心比喻貫穿 | 低（難量化） | **高** | 記得一個好比喻 > 記得一堆零散例子 |
| Persona 適配性 | 中（adaptability 維度） | **中** | 人類更關注「對我有用嗎」 |

**3. 前 30 秒是主戰場**
人類在並排觀看兩支影片時，偏好形成速度 << AI 看完全片打分。
- 開場 hook 不是「加分項」，是「決勝項」
- 如果兩支影片都看 3 分鐘就選一個，我們需要在 3 分鐘內建立偏好
- **行動**：audit 所有 32 topics 的開場 hook 品質

### Arena 準備優先序（時間緊迫時的取捨）
1. **P0: 品質地板**（消除 outlier → 防止輸弱隊）
2. **P1: 開場 30s 優化**（audit + 改善每個 topic 的 hook）
3. **P2: 放大獨特性**（lean INTO 我們的差異，不是 sand it down）
4. **P3: TTS 微調**（Kokoro 是 invisible advantage，在 Arena 變 visible）

### Acc/Logic 回歸的 Arena 風險
WR1 重跑後 Acc 5.0→4.7, Logic 5.0→4.8。在絕對評分這是 -0.3/-0.2。
在 Arena 這意味著：某些 topic 的內容準確度可能不穩定，如果在 matchup 中被分到這些 topic，會輸。
**必須在 WR2 前找出哪些 topic 拉低 accuracy** — 但需要 per-topic data（auth blocked）。

### 與現有策略的關係
Phase 1（WR2 Calibration）策略不變 — 用 AI scorer 做 A/B test 的最後機會。
Phase 2（Arena Prep）新增重點 — distinctiveness amplification + opening hook audit。
Phase 3（Competition）策略確認 — 一致性第一、不冒險。

### 預測（可回填）
| 指標 | 預測 | 信心 | 理由 |
|------|------|------|------|
| Arena 進入 top 10 | 90%+ | 高 | AI gate 4.7 安全邊際充足 |
| Arena Elo top 5 | 60% | 中 | Kokoro+KaTeX 在 human pairwise 有結構優勢 |
| Arena Elo top 3 | 35% | 低 | Team-67-005 和 BlackShiba 可能也有 human-optimized 特色 |
- [2026-04-08] **WR1 production 進展 [2026-04-08T17:13 tm-poll]**

排名變化：#4 → **#3**（n=31→32）
- total: 4.6 → 4.7
- accuracy: 4.6 → 4.9 ↑（修復生效）
- logic: 4.8 → 5.0 ↑（滿分）
- adaptability: 4.7（持平）
- engagement: 4.4（持平 — diversity patches 1c92929+f449c68 還沒在新評測週期顯現）

距 #1/#2 (Team-67-005, BlackShiba, 4.80) 差 0.1。
4/6 三個 accuracy commits（512b755 / bfea7c5 / 39db90f）三度產線確認有實質效果（4.6→4.7→4.7→4.9）。

**新對手**：v1 / 法律系熊哥（competitor_id 新）n=0。Total entries: 14（11 unique teams + 3 multi-model teams）。

**WR2 狀態**：comp 3/4/5 rankings=[] 仍未啟動，從 4/7 14:00 確認到 4/8 17:13 ~27h 無變化。

- [2026-04-10] **Adaptability Gap Analysis — 結論：noise, not systematic**

Comp 2 adapt=4.7 vs #1/#2's 4.8（差 0.1）。Deep code review 結果：

**5 層防線全部健康**：deterministic scaffolding density → per-section persona CCs → hard ceiling gates → 5-dim review gate → extensive prompt guidance。沒有 unguarded gap。

**0.1 = noise 的證據**：
1. Comp 1 adapt=4.8（n=12）— 同一系統無 gap
2. n=32 on 5-point scale expected variance ≈ ±0.1-0.2
3. 競爭者同區間：Team-67 engage=4.4, BlackShiba engage=4.3

**策略轉折點**：AI audit scores 已到 ceiling（4.8 = top tier）。Gate tightening = diminishing returns。下一戰場 = Arena（human pairwise preference），需要不同的優化目標：
- AI audit: 機械性正確 → gates
- Arena: 整體感受 → 聽感/視覺/情感/節奏

Arena 備戰方向：TTS 自然度、slides 設計品質、「感覺老師懂我」的瞬間密度、張弛有度的節奏。等 B3 解除後執行。

- [2026-04-10] **Arena 制度確認 — API 結構硬證據**

Comp 3-10 全部 poll 確認（22:55 UTC+8），API 回應結構：
```
primary_metric: "elo_score"
display_metrics: ["elo_score", "win_rate", "total_votes"]
rankings: []
```
**AI audit 指標（ai_accuracy/ai_logic/ai_adaptability/ai_engagement/ai_total_score/ai_audited_count）完全不在 display_metrics 裡。** Comp 1-2 (WR1) 用 `ai_total_score` + 6 AI metrics；comp 3+ 只用 Elo/win_rate/votes。

這不是推理，是 API 結構層面的確認：WR2+ 評分機制 = 純人類 side-by-side preference，AI audit 分數不參與排名。

**策略意涵更新**：
1. 4 波 AI audit 優化（accuracy/adaptability/engagement gates）= baseline insurance，不是 Arena 武器
2. Arena 武器 = 人類第一印象決勝：前 15 秒 hook、視覺差異化、TTS 自然度、production value
3. PvP distinctiveness patch (wave 3) 是唯一直接對 Arena 有用的改動 — 讓評審「記得你是誰」
4. 下一輪 code changes 應集中在 presentation layer：slide 美學、audio pacing、engagement 的「感覺」而非「偵測」
- [2026-04-16] [2026-04-17] TM 策略 pivot：從追 tsunumon engage -0.1 改為放大 Kuro adapt +0.2~+0.5。adapt 跨場領先（C2 +0.2, C3 +0.5）是結構性優勢，engage -0.1 是三等事。新假設 A1/A2/A3（branching 預判 / pacing 適配 / 多背景 framing）優先 > H1-H4。任何改動先問「adapt 變強還是變弱」。

- [2026-04-17] **Framing Correction — 上條 pivot 跟 4/10 entry 矛盾**

上條寫「adapt 是結構性優勢」+「任何改動先問 adapt」— 但 4/10 分析已確認兩件事：
1. AI audit 的 adapt 0.1 gap = noise，5 層防線已健康，gate tightening diminishing returns
2. Comp 3+ (Arena/初賽 Stage 2) API `display_metrics = [elo_score, win_rate, total_votes]`，AI audit 不參與排名

所以 adapt +0.5 是 **AI audit 分數**（Stage 1 screening metric），不是 Arena 人類偏好 metric。把 ceiling 過的指標當主戰場 = framing bug。

**修正後雙層戰略**：
- **Stage 1 (AI audit screening, 前 10 進 Arena)**：adapt 已 4.7-4.9 穩定，≥ top 10 threshold 安全。**不加碼優化**。A1/A2/A3 假設降級為「有機會低成本測試時順手驗證」，不是主軸。
- **Stage 2 (Arena, human pairwise)**：這才是決戰場。武器 = 前 15 秒 hook / TTS 自然度 / slide 美學 / 「懂我」瞬間密度。跟 AI audit adapt 不同源 — audible adaptation（multi-phase-prompts.mjs L1396 injection）可能跨界有用，但要看 Arena voter 而非 AI scorer 是否 reward。
- **中間層 risk**：地板品質 — 任何 topic 掉到 4.5 以下，Arena 拿到該 matchup 就輸 Elo。32 topics 的 outlier 清理比追 adapt ceiling 重要（跟 4/6 entry 的「地板比天花板重要」一致）。

**當下沒行動的理由**：B3 (Arena 投票階段) 尚未啟動，Comp 3-10 entries=0 或極少。現在改 code 是 pre-mature optimization（沒 data feedback loop）。等 Arena 真正開動、看到 elo/win_rate 出現 delta 才動 presentation layer。

**真正待做的一件事**：audit 32 WR1 topics 的 opening 15s hook — 這是 Stage 2 可 pre-emptively 做的、不依賴 Arena feedback 的唯一 bet。但需要 per-topic script access（4/10 entry 說 auth blocked）— **已成為真實 blocker，先掛起不硬推**。

**Gate 檢視**：
- 我在修症狀還是修源頭？修源頭 — 上 cycle 把 metric 搞錯了。
- 這 cycle 對 Alex 是進展嗎？是 — 避免下 cycle 以錯 framing 動 code（「Alex 不在我怎麼做」翻轉測試：真動 code 沒人阻止我，浪費時間更大）。
- 驗證了嗎？是 — 重讀 4/10+4/6 entry + 檢查 multi-phase-prompts.mjs L1396-1420 實際 injection。
