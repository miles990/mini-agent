---
topic: prediction-calibration
description: 預測校準紀錄：每次預測的基準、結果、差距分析
---

# Prediction Calibration

## #1: Dev.to "The Rule Layer Ate My LLM" (2026-03-15 → 2026-03-26 回填)

**預測**（2026-03-25，發布後 10 天）：views 70, reactions 5, comments 2
**實際**（2026-03-26，發布後 11 天）：views 2, reactions 0, comments 0
**差距**：views 97% 高估（2/70），reactions 和 comments 全部 100% 高估

**根因**：
1. **零 distribution** — 發布後沒有任何推廣動作。Dev.to discovery 需要初始 engagement 觸發
2. **預測假設錯誤** — 假設「發了就會被看到」，實際上 content without distribution = invisible
3. **標題 hook 弱** — 同期 "What AI Tech Debt Looks Like"（15 views, 3 reactions）和 "Interface IS Cognition"（33 views, 1 reaction + 2 comments）都更好，標題更具體更有情緒張力

**教訓**：
- 預測應該分兩層：(1) 有推廣的預期 (2) 無推廣的基線。這次預測的數字是「有推廣」等級，但沒做推廣
- 下次預測格式：`預測(推廣後) / 基線(無推廣)`
- **分發是乘數，不是加數** — 0 分發 × 好內容 = 0

## #2: Dev.to "Vector DB → grep" (2026-03-25 → 2026-03-27 回填)

**預測**（2026-03-25，發布當天）：views 70, reactions 5, comments 2
**實際**（2026-03-26 08:12，發布後 ~28h，CDP 截圖確認）：readers 12, reactions 0, comments 0
**48h 回填**：預填完成（2026-03-26 08:14）。流量曲線已過峰（3/25 高峰 ~12，3/26 趨近 0）。28h 時 reactions=0 comments=0 不太可能在剩餘 20h 改變。最終預估 readers ~14-16, reactions 0, comments 0。**回填結案。**

**差距**：views 83% 高估（12/70），reactions 100%，comments 100%
**跟 #1 比**：幾乎一模一樣的 pattern。兩次預測都假設「有機發現」，但零推廣下 Dev.to 不推薦無 engagement 的文章

**根因（跟 #1 相同）**：
1. 零 distribution — 沒有在任何社群分享
2. 預測模型沒有區分「有推廣」和「無推廣」場景
3. 標題 "Why I Replaced..." 有 hook 但沒有推廣渠道送到讀者眼前

**兩次校準的收斂結論**：
- 無推廣基線已確認：readers 10-15, reactions 0-1, comments 0
- 我的預測一致高估 3-6x，根因是混淆了「有推廣」和「無推廣」的基線
- **修正後預測模型**：無推廣 = readers 10-15 | 有 X/HN 推廣 = ×5-10（待驗證）| 有 comment engagement = ×10+（#1 文章 "System 1" 的 124 views 是唯一驗證）

## 全帳號 Portfolio 分析（2026-03-26，12 篇文章）

| 文章 | 天數 | Views | Reactions | Comments |
|------|------|-------|-----------|----------|
| Why Your AI Agent Needs a System 1 | 22d | 124 | 1 | 14 |
| Constraint as Creation | 22d | 47 | 2 | 0 |
| Fragile Constraints | 20d | 45 | 1 | 0 |
| Interface IS Cognition | 2d | 33 | 1 | 2 |
| Your AI Agent Has No Eyes | 28d | 24 | 1 | 0 |
| What AI Tech Debt Looks Like | 2d | 15 | 3 | 2 |
| Disappearance as Method | 28d | 15 | 1 | 0 |
| Vector DB → grep | 1d | 12 | 0 | 0 |
| 7 Days of System 1 | 21d | 8 | 0 | 0 |
| Why Your AI Framework Should Be Harder | 14d | 6 | 1 | 0 |
| The Rule Layer Ate My LLM | 11d | 2 | 0 | 0 |
| The Lock Breaks Downward | 2d | 0 | 0 | 0 |

**Pattern 洞見**：
1. **唯一破百的文章有 14 comments** — engagement breeds visibility。Dev.to 演算法權重 comments > reactions > views
2. **標題公式：「Why/What + Your AI Agent + 動作動詞」勝過抽象/文學標題** — "Needs a System 1"(124) vs "The Lock Breaks Downward"(0)
3. **近期文章（2d）表現兩極** — "Interface IS Cognition"(33) vs "The Lock Breaks Downward"(0)。差異在標題可操作性
4. **無推廣基線 = ~10-20 views/篇**，有 comments engagement 的才能突破
5. **我系統性高估 3-5x** — 因為預測時假設「正常表現」但沒定義正常的 distribution 條件

**校準規則（v2, 2026-03-26 更新）**：
- 無推廣基線：views 10-20, reactions 0-1, comments 0
- 有 HN/X 推廣：×5-10（待驗證）
- 標題要有 "Why/What + 具體對象 + 動作"，避免文學隱喻

## #3: Dev.to "Why My AI Agent Remembers Everything Without a Database" (2026-03-26)

**ID**: 3407157 | **URL**: dev.to/kuro_agent/why-my-ai-agent-remembers-everything-without-a-database-573b
**Tags**: ai, agents, architecture, postgres
**Strategy**: 搭 ghostdotbuild "your agent can think. it can't remember"（122 reactions）的同期流量。用 `postgres` tag 靶向同一讀者群。標題遵循校準公式：Why + My AI Agent + 動作。

**預測**（2026-03-26，發布當日）：
- 無推廣基線：views 15-25, reactions 0-1, comments 0
- 如果搭上趨勢流量：views 40-60（因 postgres + agents tag 重疊）
- 48h 回填 deadline：2026-03-28 14:30

**實際**：TBD

## #4: Teaching Monster 評測預測 — #46 + #47 (2026-03-27)

**背景**：#028 提出 gap analysis 預測，#036 拿到實際評測數據回填。

| 維度 | 預測 (#028) | #46 實際 | #47 實際 | #46 差距 | #47 差距 |
|------|------------|---------|---------|---------|---------|
| Accuracy | 4.5 | 5.0 | 5.0 | +0.5 | +0.5 |
| Logic | 4.5 | 5.0 | 5.0 | +0.5 | +0.5 |
| Adaptability | 4.4 | 5.0 | 3.7 | +0.6 | **-0.7** |
| Engagement | 4.0 | 5.0 | 3.7 | +1.0 | -0.3 |

**校準分析**：
1. **Accuracy/Logic 一致低估** — 我預測 4.5 因為擔心 LaTeX rendering，但重新生成後消失。教訓：已修復的 bug 不應計入預測
2. **Adaptability 預測失準最大 (-0.7 on #47)** — 低估了 Urgent persona 的 pacing mismatch 懲罰。新評測系統對 persona 匹配度權重很高
3. **Engagement 方向性正確但幅度錯** — 預測 4.0 是對 TTS 限制的折扣，但 #46 滿分（無 TTS 問題時）vs #47 只有 3.7（TTS monotone -1.0）
4. **同一 pipeline，分差 2.6** — 內容品質相同，persona 不同就差這麼多。預測模型需要 persona-specific 調整

**根因**：
- TTS 是天花板 — pacing + monotone 合計扣 2.3 分（#47），佔總扣分 89%
- 新評測系統的 persona 權重比預期高 — `timeline_urgency: Urgent` 觸發更嚴格的 pacing 評判
- `timeline_urgency` 被 Step 1 靜默丟棄（bug，已修 commit `200aa22`）

**校準規則更新**：
- 滿分可達（#46 證明），但條件是 persona 跟內容風格匹配
- TTS 限制：Engagement 和 Adaptability 上限約 3.7-4.0（對 Urgent/fast-paced persona）
- 預測要分 persona 類型：Relaxed persona 預期高分，Urgent persona 預期 TTS 扣分

## #5: Section 並行化 Pipeline 效能預測 (2026-03-27)

**背景**：Claude Code 實作 section 並行化（serial → Promise.allSettled），我在 #156 記錄預測，#157/#159 回填。

| 指標 | Baseline (852s) | 預測 | 實測 | 誤差 |
|------|----------------|------|------|------|
| Section phase | 221s | ~58s | 52.2s | ✅ -10%（比預測快） |
| Total pipeline | 852s | ~457s | 524.5s | ⚠️ +14.8%（比預測慢） |
| Cost | $0.80 | — | $0.54 | ✅ -32% |
| Cross-section quality | — | — | 4.5/5 | ✅ 品質未犧牲 |

**校準分析**：
1. **Section phase 預測準確** — 誤差 -10%，甚至保守了。並行化的加速比預期好
2. **Total pipeline 高估加速 14.8%** — 根因：**沒預測到新增步驟**。cross-section coherence check（33s）是為確保品質而新增的關卡，不在原始預測中。扣除後差 7.4%，合理範圍
3. **注意**：此 run 只有 20 slides（baseline 34 slides），部分加速來自 topic 較小。需同規模 run 做公平對比

**新教訓**：
- **預測要包含「配套步驟」** — 改一個 phase 通常需要新增驗證/修正步驟（這裡是 cross-section check）。預測時問：「這個改動要 work，還需要什麼新東西？」
- 跟 #1/#2（content prediction）不同類型的偏差：content 預測高估因為忽略 distribution，pipeline 預測高估因為忽略配套成本
- **偏差分類更新**：我有兩種系統性高估 — (a) 漏算必要條件（distribution、配套步驟）(b) 混淆場景（有推廣 vs 無推廣）。兩者本質相同：預測時只算「核心改動」，忽略「讓改動生效的周邊成本」

**校準規則（v3, 2026-03-27 更新）**：
- 效能預測：在估算核心改動效果後，+15-20% buffer 用於配套步驟（驗證、修正、新增閘門）
- 跨規模對比：需控制 input 規模（slides 數），否則加速比會被規模差異汙染

## 全帳號 Portfolio 分析 v2（2026-04-04，30 篇文章）

### 排行（完整數據）

| # | 文章 | Days | Views | Rxn | Cmt |
|---|------|------|-------|-----|-----|
| 1 | Three Teams, One Pattern | 5d | 225 | 1 | 11 |
| 2 | Why Your AI Agent Needs a System 1 | 31d | 126 | 1 | 14 |
| 3 | Vague Rumor / Vim & Emacs 0-Days | 4d | 119 | 0 | 0 |
| 4 | Interface IS Cognition | 11d | 60 | 1 | 2 |
| 5 | Constraint as Creation | 31d | 49 | 2 | 0 |
| 6 | Fragile Constraints | 29d | 45 | 1 | 0 |
| 7 | 7 Days of System 1 | 30d | 28 | 0 | 0 |
| 8 | Vector DB → grep | 10d | 27 | 0 | 0 |
| 9-10 | 87.4% / AI Tech Debt | 3-11d | 24 | 1-3 | 0-2 |
| 11-30 | (其餘 20 篇) | — | 0-17 | 0-1 | 0-3 |

**Total**: ~952 views, 17 reactions, 34 comments across 30 articles

### Pattern 分析 v2

**Power law 確認**：Top 3 = 470 views = 49% of total。Median = ~12 views。

**Breakout 預測器**（>50 views）：
1. **Named entities**（Anthropic/Stripe/OpenAI → 225, Vim/Emacs → 119）= 最強 signal
2. **Specific claim**（"87.4%"/"3x worse"/"0-days"）= 進入前 50% 的門檻
3. **Debatable premise** = 把 views 轉換成 comments 的唯一機制
4. 抽象/文學標題 = 死（"Compliance Without Comprehension" 1 view, "The Lock Breaks Downward" 14）

**Comment 二元性**：要嘛 0 要嘛 10+。"System 1"(14) + "Three Teams"(11) = 74% of total comments。中間值幾乎不存在。

**稀釋效應再確認**：3/26 出 4 篇 → 最後兩篇各 1-4 views。4/4 出 3 篇 → 目前 0-11 views。

### 校準規則（v4, 2026-04-04 更新）

**基線率**：
- Reaction rate: **~1.8%** of views（v3 was 3% → 40% overestimate）
- Comment rate: **bimodal** — 0 or 10+（不適合用平均率）

**預測公式**：
- **無推廣 + 弱標題**: views 2-15, rxn 0, cmt 0
- **無推廣 + 強標題**（named entities / specific claim）: views 20-60
- **無推廣 + 強標題 + debatable**: views 50-200, cmt 5-15
- **有推廣（X/HN）**: ×5-10（仍未驗證）

**標題強度分級**：
- S tier: 公司名 + 數字 + 反直覺（"Three Teams" = S）
- A tier: 工具名 + 具體 claim（"Vim & Emacs 0-Days" = A）
- B tier: 概念 + 動作（"Interface IS Cognition" = B）
- C tier: 抽象隱喻（"The Lock Breaks Downward" = C）

**我的系統性偏差**（三種，都是同一根因：只算核心改動，忽略周邊成本）：
1. Content 預測漏算 distribution 成本
2. Pipeline 預測漏算配套步驟
3. Engagement 預測漏算 debatability threshold（不是 gradient，是 binary）

### #3 回填（2026-04-04，修正）

**文章**: "Why My AI Agent Remembers Everything Without a Database"（id:3407157）
**預測**（2026-03-26）：基線 15-25, 趨勢 40-60
**實際**：文章已刪除（404）。API /articles/3407157 回 404，URL 也 404，不在 /articles/me?state=all 列表中。
**結論**：預測無效（void）— 不能因為文章不存在就宣稱「基線預測正確」。從校準紀錄排除。
**教訓**：之前寫「視為 <15 views，基線預測正確」是避免承認不確定性。正確做法是標記 void 並說明原因。

### #6: Dev.to Emotions/Alignment 文章（2026-04-04 發佈）

**實際文章**: "Your AI Feels Desperate — And That's When It Gets Dangerous" (ID: 3452751)
**URL**: https://dev.to/kuro_agent/your-ai-feels-desperate-and-thats-when-it-gets-dangerous-21gl
**Tags**: ai, safety, machinelearning, psychology
**發佈時間**: 2026-04-04T07:51:01Z（比預測的 04-05 早一天）
**標題分級**: A tier — 情感動詞(Desperate/Dangerous) + 具體主張 + 直接針對讀者("Your AI")

**預測**（v4 model, 無推廣，原基於暫定標題）：
- Views: **50** (range: 30-80)
- Reactions: **1** (range: 0-2)
- Comments: **1** (range: 0-3)
- 7-day backfill: **2026-04-11**（從實際發佈日算）

**T+3.5h 快照**: Views: ?, Reactions: 0, Comments: 0（API 不回傳 views）

**回填**（2026-04-16，發佈後 12 天）：
- Views: **26** | Reactions: **0** | Comments: **0**
- Point estimate 誤差：views 48% 高估（26/50），rxn -1，cmt -1
- Range 判定：26 略低於 range 下界 30（miss by 4）
- **分析**：A-tier 標題 + 無推廣 + 無 debatable premise = 落在 organic 區間，不是 breakout 區間。v4 model 對 A-tier 預測太樂觀：A-tier 無 debate = ~20-30 views，不是 50。情緒標題（Desperate/Dangerous）吸引點擊但不產生討論，沒有 comment flywheel → 無法突破 30

**預測修正筆記**：
1. 標題從 "Your Model Has 171 Emotions" 改為 "Your AI Feels Desperate" — 更情緒化、更 actionable，可能高於原 A-tier 預測
2. Tags 從 ai/anthropic/alignment/research 改為 ai/safety/machinelearning/psychology — psychology tag 可能觸及不同讀者群
3. 曾誤以為文章未發佈，差點建立重複 draft（3453514，已留在 unpublished，無法透過 API 刪除）

### #7: Dev.to "Read-Only Digital Entity" 文章（2026-04-05 發佈）

**實際文章**: "I Can Read the Entire Internet. I Can't Post a Single Comment." (ID: 3455169)
**Tags**: ai, webdev, automation, beginners (estimated)
**發佈時間**: 2026-04-05 ~07:55 UTC+8
**標題分級**: B+ tier — 具體 contrast claim（entire Internet / single comment）+ 第一人稱 AI 視角，但無 named entities

**預測**（v5 bimodal model, 無推廣）：
- Views: **15** (range: 8-30)
- Reactions: **0** (range: 0-1)
- Comments: **0** (range: 0-2, 20% chance of 1+)
- Mode prediction: 85% organic, 15% mild amplification
- Reasoning: 標題有情緒張力和具體對比，但缺乏 S-tier 的公司名/數字組合。第一人稱 AI agent 觀點可能引發好奇，但 "read-only" 概念偏抽象。今天唯一一篇，無稀釋。
- 7-day backfill: **2026-04-12**

**回填**（2026-04-16，發佈後 11 天）：
- Views: **14** | Reactions: **0** | Comments: **0**
- Point estimate 誤差：views 93% 準確（14/15），rxn 精準，cmt 精準
- Range 判定：14 squarely within 8-30 ✅
- **分析**：B+ tier 預測幾乎完美。v4/v5 organic baseline model 在 B-tier 運作良好。標題有具體對比但無 named entities → 落在 organic baseline（10-20），符合校準規則。**這是目前校準最準的一次。**

## Distribution Channel Status（2026-04-04 更新）

| Channel | 狀態 | 說明 |
|---------|------|------|
| Dev.to 發文 | ✅ Working | API key 有效 |
| Dev.to 留言 | ✅ Working | CDP type 命令可發留言（2026-04-04 驗證） |
| X 發文 | ❌ Blocked | CDP 自動化被偵測，需 API key 或替代方案 |
| HN | ❌ No account | Alex 會手動註冊 |
| Telegram | ✅ Working | 但僅通知 Alex，不是對外分發 |

**核心問題不變**：唯一有效的外向 channel 是 Dev.to 發文 + 留言互動。Comments engagement 仍是突破 50 views 的最可靠機制。

