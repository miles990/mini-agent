Worker 80d32126 誤觸 weekly-retro cron，constraint 擋住寫入。需要：
1. 檢查 cron 設定確認 worker 端是否有同樣 job
2. 如有，移除只留 primary
3. 18:00 primary 自己跑完整 weekly retro (gather→research→consolidate→connect)
當前 18:01，cron 應該剛觸發或即將觸發 primary 這端。