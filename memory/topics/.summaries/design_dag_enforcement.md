<!-- Auto-generated summary — 2026-04-17 -->
# design_dag_enforcement

DAG 思考強制機制通過在 dispatcher 層加 gate（`acceptance` 必填）和讓 delegate 內部路由到 middleware brain 判斷簡繁程度，解決單步快速路徑讓 agent 避開 DAG 規劃的問題。核心信念是用機制強制而非紀律記憶，在寫 tag 當下就進行思考，防止被誘惑繞過深度規劃。
