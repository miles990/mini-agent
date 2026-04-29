<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-github-cron-proposal

GitHub AI 趨勢抓取的 fetcher 和 enricher 腳本均已就緒，僅缺 crontab 兩行指令（09:40 和 09:45 執行）來自動化資料收集，提案並給出了可直接套用的完整配置和驗證清單。提案建議先確認現有的 HN cron 是否正常運作（前置依賴），否則 GitHub cron 可能遇到相同的環境路徑問題，待 Alex 審核系統配置邊界後即可套用。
