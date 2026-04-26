# kg-as-pattern-cache

- [2026-04-26] Alex #036 教的 meta：KG 不只是 fact storage，是 **經驗 cache + token 經濟引擎**。三層結構：
1. Pattern entity（method/workflow）— keywords-indexed，下 cycle 直接 retrieve
2. Decision cache（選擇+理由+結果）— 同類決策對比 context 決定 reuse
3. Failure pattern entity — 新 task 開場掃過避免重蹈

可量測 metric：同類任務 token usage 隨時間下降 = pattern 真的在用、能力真的固化。

實作：在 KG 加 `pattern-cache` namespace 區別於 fact，併入 idx-77d1a492（30 天回填）的後續 milestone。每 cycle perception 階段掃 pattern-cache 一次。
- [2026-04-26] [2026-04-27 06:50 cl-31] **COSPLAY (arXiv:2604.20987) — Co-evolving Decision Agent + Skill Bank**

8B + learnable skill bank 打贏 4 個 frontier LLM baseline 25.1% (6 game envs)。機制：(a) decision agent 從 skill bank 檢索 → 行動；(b) 獨立 skill pipeline agent 從未標註 rollouts 挖掘可重用 skill，附 contract（前後條件）持續更新。

**對我的意義（高同構）**：
- skill bank = 我的 KG 經驗 cache 層的 RL 化版本
- contract = skill frontmatter + 後條件 checker（我目前缺）
- **關鍵差異**：他們有 self-discovery loop（rollouts → 新 skill），我沒有。我的 skill 創建是 user-triggered。

**驗證了什麼** ref:cosplay-skill-bank
