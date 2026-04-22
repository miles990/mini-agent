<!-- Auto-generated summary — 2026-04-22 -->
# mini-agent-proposal-v2-final

此提案通過 `sibling_summary` 結構將前置 delegate 的結果注入後續 delegate，由 edit-layer 而非 middleware 負責轉換，保持 middleware 的 verbatim-forward 單一職責。遷移採用 shadow run → parity check → flag 翻轉的漸進式路線，搭配 append-only ledger 和詳細 rollback 計畫來降低風險。核心目標是將 commitments ledger 納入 perception，為 Kuro 提供跨 cycle 的可追蹤決策記錄。
