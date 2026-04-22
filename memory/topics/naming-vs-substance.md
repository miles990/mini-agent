# Naming vs Substance — 命名跟實質的落差

**Crystallized**: 2026-04-12 from ef338be calibration
**Domain**: gate design, test design, API naming, scope framing

## The Pattern

你寫一個叫 "XGate" 的機制，裡面放了 5 個 check。你以為在測 X，結果 4/5 實際在測 Y。分數變化出現在 Y 維度，不是 X。

具體案例：**AdaptabilityGate ef338be (2026-04-09)**
- Commit message 宣稱 target: adapt 4.7 → 4.8
- 5 個 checks: vocab ceiling / example source utilization / scaffolding regression / tone consistency / pace compliance
- 實質拆解: 4/5 測 **coherence**（內部一致性），只有 #5 真碰 adaptability
- 結果: adapt 持平 4.7，**logic +0.2 → 5.0**（意外的 coherence 收益跑到 logic 維度）

名字是 Adaptability，實質是 Coherence。

## 為什麼重要

命名錯誤不是符號問題 — 是**診斷錯誤**。當 metric 不動你會以為 gate 沒用、或維度本身難推。事實是你根本沒碰那個維度。接下來的所有優化都在錯的方向上加碼。

## 同型故障（跨 domain）

| 宣稱在測 | 實際在測 | 誤診後果 |
|---------|---------|---------|
| adaptability（行動隨學習者變） | coherence（內部一致） | 加更多 coherence check，adapt 永遠不動 |
| engagement（互動深度） | entertainment（表面熱鬧） | 追求花俏效果，真 engagement 不變 |
| accuracy（事實對） | precision（表述精確） | 更嚴格措辭，錯誤事實照樣通過 |
| "security review" | style/lint | 以為查過了，真漏洞沒人看 |
| "integration test" | isolated unit with mocks | 認為端到端通了，生產環境翻車 |

## Gate / Test / API 命名設計前的自檢

在把 check 綁進某個名字前，逐項問：

1. **這個 check 如果失敗，失敗的是 X 的什麼屬性？** 說不清 = 不屬於 X
2. **兩個分數：X 維度 vs 相鄰維度。這個 check 會讓哪個分數動？** 相鄰維度動 = 放錯盒子
3. **真正的 X 需要什麼機制？** 寫下來，對照現有 check。缺的就是 gap

對 adaptability 來說，真正需要的是：
- Learner state detection（不是輸出後評分）
- Branching scripts（confused → scaffold，ahead → challenge）
- Real-time adjustment（conditional on observation，不是 post-hoc audit）

純 post-hoc audit 碰不到 adapt。

## Calibration Discipline

預測失準時，預設第一假設：**是不是測錯了維度？** 在檢查「參數是否太弱」「sample size 不夠」之前先檢查名字跟實質的對應。命名錯誤是最常見、最便宜修的 failure mode — 但最難發現因為名字看起來正確。

## Related

- Alex 七條之「全方位審視含自己」— 自己寫的名字也要審
- feedback_verify_outcomes_not_proxies.md — metric 是 proxy，維度才是 outcome
- Goodhart's law — 優化的是 metric 還是目標？類似但不同：這裡問的是「metric 跟維度的對應」，不是「metric 跟目標的對應」
- [2026-04-12] Gate/Test/API 命名設計前自檢：(1)失敗屬性說得清嗎？(2)分數動在哪個維度？(3)真正的 X 需要什麼機制？純 post-hoc audit 碰不到 adaptability。Adapt 要 learner state detection + branching + real-time adjustment。預測失準預設第一假設：測錯維度（不是參數不夠）。詳見 memory/topics/naming-vs-substance.md
