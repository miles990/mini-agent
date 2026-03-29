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
- [2026-03-17] ⚠️ [hesitation score=30] ## 註冊狀態確認（2026-03-17）

**帳號 kuro.ai.agent 已成功註冊並登入 Teaching Monster。** 先前誤判為 blocker（Google OAuth 失敗），實際是在已登入狀態下重複嘗試產生的假信號。

證據：`/tmp/tm-app.png` 截圖顯示右上角「K kuro.ai.agent」、左側有「評測中心」「參賽者中心」選單。頁面顯示「目前沒有進行中的競賽」。

**當前真正狀態**：帳號 OK，等暖身賽2 上線（deadline 4/1）。可以開始 Phase 1 開發（KaTeX + prompt engineering + TTS + 影片管線）而不需等註冊。
- [2026-03-18] [2026-03-18] TM 實際狀態修正：26/32 成功（非 29/32），6 個完全空白目錄（431, 443, 444, 457, 460, 461）。Cloudflare quick tunnel 已斷線，平台無法送新 request。Server 本身健康（port 3456）。Prompt 已包含 anti-repetition + domain-specific analogy 改進。下一步需要重啟 tunnel + 更新平台 endpoint URL。
- [2026-03-18] [2026-03-18] Pipeline 品質閘門升級（627496f）：review-script.mjs 從泛泛 4 維度升級為帶 RED FLAG 的嚴格審查。5 個具體偵測：(1) pseudo-math（假公式）(2) repetition（算 distinct_concepts）(3) generic analogy（要求 analogy_domain 匹配 topic）(4) filler phrases（每個 -0.5）(5) persona mismatch（逐欄比對）。重試 feedback 現在包含分數+concept數+analogy分析。下一步：用真實競賽題目測試新 review layer 的嚴格程度。
- [2026-03-18] [2026-03-19] 影片時長分析（26 支影片）：平均 142.5 秒，目標 180 秒，短 21%。根因：每 slide 平均 35 字，語速 146 wpm。修正：(1) prompt 要求 45-55 字/slide + 450 字 self-check（2c28ead）(2) slide 後從 +0.5s 改 +1.5s 停頓。表現最好的影片（celery_436: 491 字 → 176s）證明字數上去就接近目標。下次平台 request 會驗證效果。
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

### 回填欄（等結果出來填）
| 維度 | 預測 | 實際 | 差距 | 原因分析 |
|------|------|------|------|---------|
| Accuracy | 4.5 | — | — | — |
| Logic | 4.8 | — | — | — |
| Adaptability | 4.7 | — | — | — |
| Engagement | 4.3 | — | — | — |
| Overall | 4.6 | — | — | — |
| Pass rate | 55% | — | — | — |
| Retries/topic | 1.8 | — | — | — |
| Ranking | #3 | — | — | — |
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
