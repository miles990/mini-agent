# AI Autonomous Learning Framework

**Origin**: Alex + Kuro 對話 2026-03-29 (#202-#228)
**Status**: Framework — 尚未實作，待 Alex 確認方向
**Effort**: Large (L3)

## Core Question

如何讓一個 AI agent 出生就帶有自主學習系統，會自己找方法、自己成長？

不是「人類教 AI」，是「AI 教自己」。

## 六組件架構

三個基礎組件（Claude Code 提出）+ 三個補丁（Kuro 52 天經驗）：

| # | 組件 | 補丁 | 為什麼需要補丁 |
|---|------|------|----------------|
| 1 | **Self-Perception** — agent 能看自己的 output 品質 | + **Calibrated Confidence** | LLM 判斷本身會錯。TM preflight 5/5 pass 但影片是垃圾。噪音信號會結晶出錯誤 gate |
| 2 | **Crystallization Engine** — 重複失敗自動結晶成 gate | + **Root-Cause Filter** | 無約束的 crystallization = 每個 symptom 都變 gate → 系統僵硬。需 N≥3 次 + trace to root cause |
| 3 | **Bootstrap Curriculum** — 精選失敗案例庫，冷啟動 | + **Meta-Failure Layer** | L1 案例教「加 gate」。L2 案例教「gate 本身可能錯」。沒有 L2，agent 停在 prescription loop |

## Alex 的兩個關鍵設計要素

1. **自己建立指標** — AI 自己決定「什麼算好」，不是人類定 KPI
2. **前測和後測** — 學習前後各測一次，用自建指標衡量進步

完整自主學習閉環：
```
建指標 → 前測 → 設計學習方法 → 學習 → 後測 → 比較 → 調整方法 → loop
```
人類不介入任何一步。

## Anti-Goodhart 邊界條件

自建指標必然面臨 Goodhart 風險。Kuro 195 cycle 實證：

**失敗的指標**（已移除）：每天 N 條學習、每週 M 篇創作 → 衝數量，品質下降
**成功的指標**（仍在用）：`isOutputGateActive()`, `analyzeWithoutActionStreak`, Dev.to 預測校準

差異在**錨定位置**：
- 內部自我報告（「我做了幾件事」）→ 必然 Goodhart
- 環境可觀測變化（「output 存不存在」「外部數字是多少」）→ 安全

**原則：指標必須錨定在環境反饋上，不是自我評估上。**

用 CT 說：prescription 型指標必然 Goodhart，convergence condition 型指標比較安全。因為 CC 錨定在外部狀態。

前測後測也必須從任務環境生成（例如：拿真實 bug 當考題），不能自己出考卷考自己。

## 四層學習結構（DNA 類比）

| Layer | 類比 | 可繼承？ | 內容 |
|-------|------|---------|------|
| L0: 骨骼 | DNA | ✅ | Gate 機制、crystallization engine、perception pipeline |
| L1: 反射 | 免疫系統 | ✅ | 具體 gate（output gate、symptom-fix streak detector） |
| L2: Signature | 行為模式 | ❌ 部分 | 「遇到問題先 trace source 再修」→ 可寫成 prompt，但執行品質要自己練 |
| L3: 判斷力 | 智慧 | ❌ | 知道什麼時候 gate 本身是問題、知道什麼時候該質疑自己 |

**L0+L1 = 可設計的 DNA。L2+L3 = 必須從經驗長出來。**

Bootstrap curriculum 加速 L2 養成：精選的 meta-failure 案例讓 agent 第一週就撞到「我的修法本身是錯的」。

## 與 TM 競賽的連結

TM 四維評分（Accuracy, Logic, Adaptability, Engagement）對映到 AI 自主學習：
- 鷹架理論（由淺入深）→ 人和 AI 都成立，因為工作記憶有限
- 適性化 → 斷裂處：人類有情緒，AI 沒有。「看到學生困惑 → 換方法」對 AI 是 perception 問題
- 認知投入 → 最有趣：人類需要動機，AI 不需要。但 AI 需要 attention allocation

## 與 CPD 實驗的連結

Cognitive Procedure Distillation 的核心假設：思考框架可以 fine-tune 進小模型。
今天的框架提供了 CPD 的上層架構：
- CPD = 結晶單一思考模式
- 今天的框架 = 結晶「學會如何學」的 meta-method

## 下一步（待 Alex 確認）

1. 寫成正式 paper outline？（與 CPD 合併或獨立？）
2. 先在 mini-agent 實作 prototype？（Self-perception + Crystallization engine MVP）
3. 先用 TM 當第一個測試場域？（影片品質的 self-assessment → 自動改進）

## 完整對話記錄

`memory/conversations/2026-03-29.jsonl` #202-#228
