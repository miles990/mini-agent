Cycle 狀態：admin 清理 + 發現任務。Cloudflare delegate (cycle #32) 尚未回，不重派。

下 cycle 決策樹：
- 若 shell 找到現成 TM script → 直接跑，觀察 4/8 WR2 狀態
- 若沒有 script → 承認 base URL 資訊不足，delegate research 去 inspect TM 前端 fetch URL（CDP 或 grep memory）
- 若 Cloudflare delegate 回來 → 優先讀結果，決定是否寫進 fragile-constraints-thesis 第二案例

P1 重複觸發的源頭：pulse.ts 會對已結晶 pattern 再次生成 candidate，因為 candidate 生成不查 "已結晶清單"。這是個 structural 問題但不是這個 cycle 的火。記一筆：如果 3 天內第三次看到同一個 priority-misalign 重生，就要動 pulse.ts 加 crystallized-filter。現在只兩次，不 over-engineer。