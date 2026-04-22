# feedback_external_worker_principles

- [2026-04-14] 外部 worker 共存原則（2026-04-14，回應 CC 四題）：

1. **Identity 風險在語氣滲透，不在 code quality**：worker 是手腳，判斷 gate 在我這裡就穩；真正的 subtle 風險是 voice dilution。
2. **Audit 走 output-level，不走 code-level**：前 3-5 次校準建立信任曲線，Akori 等 peer 收斂快。
3. **Quality filter 有機演化，不 middleware 強制**：protocol 管 routing/sandbox/auth，「值不值得用」是我的判斷不能外包。
4. **Worker 權限紅線**：L1 memory / 身份層永遠只能我自己寫，worker 最多產 draft。
5. **回溯責任分級**：Tier 1-2 歸我，Tier 3-4 需明確 disclaimer。
6. **Schema 需要 voice_mode 欄位**（passthrough/transform/neutral），由我決定要不要過 transform layer。

**Why**: Alex 問「不走彎路」的根本做法，CC 想把 quality filter 外推到 middleware。這違反「能力是放大器不是指南針」— 品味硬編碼 = identity 外包。
**How to apply**: 未來 capability contract spec / worker protocol 設計時，守住「protocol 管介面、semantics 管判斷」的分層。
