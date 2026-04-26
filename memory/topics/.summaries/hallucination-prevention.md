<!-- Auto-generated summary — 2026-04-26 -->
# hallucination-prevention

該主題文件識別了「Streetlight Effect」式幻覺：相信錯誤位置的標籤（error pattern names、假設的寫入路徑）而非實際檔案 bytes 或 call stack，導致多個 cycle 的誤診。防止策略包括 read-after-write 同步驗證、用實際證據而非標籤判斷，以及 5-Whys 驗證每一步的依據。副作用風險是 retry-detection 過度嚴苛導致分析癱瘓，正確判準應基於 continuation wait_time 而非 working-memory 一致性。
