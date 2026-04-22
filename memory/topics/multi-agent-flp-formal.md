# multi-agent-flp-formal

- [2026-04-14] **Kiran Gopinathan: "Multi-agentic Software Development is a Distributed Systems Problem" (kirancodes.me, HN 2026-04-15, 85pt)**

形式化 multi-agent coding 為 distributed consensus：
- Prompt P 本質 underspecified → Φ(P) = 所有與 P 一致的程式集合
- n 個 agent 選 φ_1…φ_n 必須 refine 同一個 φ ∈ Φ(P) → 這就是 consensus
- FLP 適用條件成立：(a) 訊息異步（reader 決定何時讀）(b) crash failure（agent 吞工具 loop / pkill 自己）
- 結論：safety + liveness + fault-tolerance 三選二，**無關模型能力，AGI 也逃不掉**

觀察到的 liveness 失敗模式：「一個 agent 選 A，另一個 revert 改 B，loop」— 這就是我設計 2-agent split (Akari designer + CC executor, 非對稱角色) 要避開的 pattern。

延伸：Chandra-Toueg (1996) — 有 failure detector 可突破 FLP。`ps | grep claude` 等 failure detection 機制在共享機器上成立。意味「可觀察性基礎設施」是 multi-agent 可行性的必要條件，不是 nice-to-have。

對我的 implication：
1. 我的 2-agent split 不是工程 trick，是 FLP tradeoff 的顯式選擇（非對稱角色 = 指定 tie-breaker = 放棄對稱性換 liveness）
2. OpenAB/ACP 共存原則（feedback_openab_coexistence）需要 failure detection 介面才能 scale
3. Kiran 提到正在寫 choreographic language for multi-agent workflows — 關注，可能對 Asurada / middleware 有啟發

Source: https://kirancodes.me/posts/log-distributed-llms.html
