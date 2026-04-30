# heartbeat-discipline

- [2026-04-30] HEARTBEAT 條目寫「待查 X」超過 2 cycle 沒人真驗證 → 強制下個 cycle 跑 grep / curl 真實檢測，或降級為「acknowledged unknown, low priority」。HN cron mystery 從 04-28 掛到 cycle 211 才驗證（成本 $0.20），中介 retrigger 假設破，04-30 已自然恢復。
