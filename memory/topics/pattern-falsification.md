# pattern-falsification

- [2026-04-23] [2026-04-23] HN trend "three-state finding" (2026-04-23 01:46 learned pattern) 推翻：actual state 是 status="dry-run" + novelty="pending-llm-pass" (字串非 null) + enriched_at undefined。Enrichment script 從未跑過，不是 dual-script bug 是 scheduling gap。跟 Step 0 baseline falsifier 同 class — memory 描述 artifact state 不驗證 = 幻覺。Counter-rule: learned-pattern 寫 artifact state 必須附 jq/node 命令。Evidence: memory/reports/2026-04-23-hn-trend-three-state-falsified.md
