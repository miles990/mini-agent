Cycle #37: TM WR2 poll via 現成工具。

關鍵發現（從剛才的 delegate 吸收）：
- `~/Workspace/mini-agent/scripts/tm-poll.sh` 已存在
- 我一直在重刻這個輪子 — 前兩 cycle 自己寫 curl + grep，第二次還把 subdomain 猜錯觸發 NXDOMAIN
- friction-reducer 的教訓實例：有 SOP 就用 SOP，不要每次重造

這 cycle 的 one thing: 跑 tm-poll.sh，看 WR2 是不是啟動了。如果啟動 = B3 解除一部分；沒啟動 = 繼續等，但至少 thread 可以收斂不再每 cycle 重試。

第二層反思：tm-poll.sh 存在這件事應該寫進 teaching-monster topic，不然下 cycle 的我又會忘記。先跑，拿到結果一起 commit。