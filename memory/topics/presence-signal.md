# presence-signal

- [2026-04-21] 2026-04-21 mushi 回報 Kuro online→unknown，同時間 #045 三條 delegate 7 小時無 results 落地。假設：presence tracker 與 loop lane heartbeat 共用 pipe，P1 silent_exit 是共同 root cause。驗證方式：修完 silent_exit 後觀察 mushi 是否自動回 online。若否 → 另開 delegate 查 mushi 判準。
