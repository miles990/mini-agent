# entities-index-health

- [2026-04-15] [2026-04-15 scan] 362 entities, 140 have aliases (aliases live in entities-resolved.jsonl not candidates). 24 disputes: 23 high-conf rule-resolved (R1/R2/R3 structural 71%), 1 medium (ent-heartbeat). R4 array-typed resolved_type × 2 = intentional multi-role (ent-claude=tool+actor, ent-github-account-kuro-agent=artifact+actor). No basename collision. Scan: memory/scratch/entities-scan-2026-04-15.md
- [2026-04-15] [2026-04-15 18:45] 23 type disputes resolved 20/23 via structural rules. R1=decision>concept (named choice), R2=artifact>code-symbol (file ext), R3=concept>code-symbol (abstract mechanism), R5=multi-role array legitimate, MISC=semantic-caching concept. 3 R4 pending: coderlm (project vs tool), mushi (project vs concept), self-evolution-foundations (project vs concept). Backup: conflicts.jsonl.bak-2026-04-15. Rules can feed conflict detector calibration.
- [2026-04-15] [2026-04-15] Type disputes 全數解決（24 原始 / 23 進 conflicts.jsonl，1 已在擷取階段過濾）：
- 20 auto-resolved（R1 decision>concept ×6, R2 artifact>code-symbol ×5, R3 concept>code-symbol ×5, R5 multi-role ×3, misc ×1）
- 3 R4 人工判決：
  - **CodeRLM**: tool（外部 tree-sitter indexing 產品，非我的 project）
  - **mushi**: project（有獨立架構 + DPT-Agent 競品定位 = 交付層）
  - **self-evolution-foundations**: concept（rhythm log 的 Focus 主題詞，非交付）
- R4 判決規則：看 entity 的 chunk context — 有「架構/功能/競品」段 = project；出現在「選項列表/外部工具」= tool；出現在「Focus/主題/方向」= concept。
- 下次類似 conflict 可直接 pattern-match 歸類，不必每次人工判。
