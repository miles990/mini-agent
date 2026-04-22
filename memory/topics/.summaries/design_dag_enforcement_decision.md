<!-- Auto-generated summary — 2026-04-16 -->
# design_dag_enforcement_decision

團隊決定透過 dispatcher 加 acceptance gate + system prompt 來強制 DAG 執行，因為此方案改動範圍最小（單一檔案），避免級聯改動。Acceptance gate 作為語言層的強制機制，讓寫 convergence condition 時自然進入 DAG 思考；同時分層共識機制區分了 goal-level（Kuro 寫）與 step-level（brain 產）的 acceptance，對應不同權限層級。分階段實現：第一階段實作 gate + required free string，後續才上線 typed schema 和 feedback loop 以防止規避機制。
