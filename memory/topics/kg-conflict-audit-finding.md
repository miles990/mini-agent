# kg-conflict-audit-finding

- [2026-04-16] Audit 23 conflict resolution 發現的不是個別誤判，是 storage-layer drift：conflicts.jsonl 和 resolution-audit.jsonl 兩個檔案 winner mismatch 6/23 + rule mismatch 7/23，且用兩套不同 rubric（R1-R5 vs R1-R8）。R1 「named principle → decision」6 筆全用同一句 boilerplate evidence 像蓋章。HEARTBEAT 和 .ts 檔案單一 type 不夠，應是 multi-type。報告: memory/topics/kg-conflict-audit-2026-04-17.md
