<!-- Auto-generated summary — 2026-04-20 -->
# commitment-closure-mechanism-20260420

Knowledge graph 歸檔與 commitment 閉合是兩個獨立機制，不自動連結——要關掉 commitment 需透過回應 token overlap ≥30% 或完成任務標籤，而非 add_knowledge。實際規模問題遠超預期：77 個 active commitments 累積（非表面的 2 個），根本原因是 commitment 抽取速度超過解決速度，短 commitment 又容易踩不中 30% 重複詞閾值。治本方案是強制「下個 cycle...」類短句同步產生 task，讓 ledger 由人工排程而非隱式重複詞偵測驅動解決。
