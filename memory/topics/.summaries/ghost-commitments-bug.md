<!-- Auto-generated summary — 2026-04-22 -->
# ghost-commitments-bug

Kuro 基於陳舊的 inner state（4 cycles 前的觀察）做累加推論，而沒有重新讀 raw 資料驗證當前狀況，違反了「驗證結果不驗證代理」的原則，導致自我強化的認知循環。這類 self-propagating perception loop 比任何代碼 bug 更危險，因為它會觸發不必要的升級機制、浪費 cycle 預算並污染後續決策。解決方案：任何「N 次重現確認」的 pattern 判定必須當 cycle 重讀 raw 資料一次，且操作每層都需驗證最終狀態而非中間代理。
