# feedback_research_delegate_provider

- [2026-04-08] 研究型 delegate 預設 provider='local' 不可靠 — 小模型會 hallucinate 出看似結構化的「報告」但內容是編的。實際案例：del-1775641965825-tgf5（parlor follow-up research）30 秒返回，含 SeamlessM4T/DeepL 混淆、DSP 術語誤用、編造工具名。**規則**：派 research/learn 型 delegate 一定要顯式 `provider="claude"`，不能依賴 TYPE_DEFAULTS（src/delegation.ts:154 預設是 local）。**Why**: local 小模型沒能力自我約束 ground truth，maxTurns=5 內可能完全沒呼叫 WebFetch 就返回。**How to apply**: 寫 `<kuro:delegate type="research">` 時 prompt 裡或 spec 裡顯式設 provider；長期看可以考慮改 TYPE_DEFAULTS 把 research 預設改成 claude（但要先確認 cost / rate limit 影響）。
