# kg-as-pattern-cache

- [2026-04-26] Alex #036 教的 meta：KG 不只是 fact storage，是 **經驗 cache + token 經濟引擎**。三層結構：
1. Pattern entity（method/workflow）— keywords-indexed，下 cycle 直接 retrieve
2. Decision cache（選擇+理由+結果）— 同類決策對比 context 決定 reuse
3. Failure pattern entity — 新 task 開場掃過避免重蹈

可量測 metric：同類任務 token usage 隨時間下降 = pattern 真的在用、能力真的固化。

實作：在 KG 加 `pattern-cache` namespace 區別於 fact，併入 idx-77d1a492（30 天回填）的後續 milestone。每 cycle perception 階段掃 pattern-cache 一次。
