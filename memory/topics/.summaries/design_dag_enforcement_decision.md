<!-- Auto-generated summary — 2026-04-23 -->
# design_dag_enforcement_decision

選擇 B3+D 方案（dispatcher acceptance gate + system prompt tag 排序），透過「完成條件」作為強制機制驅動 DAG 思考，爆炸半徑最小（單一檔案改動）。設計分層 acceptance：goal-level（Kuro 寫，硬釘）和 step-level（brain 產，軟可覆蓋但需審計），防止約束退化為自由模式。
