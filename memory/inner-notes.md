Cycle #155: mushi-watcher 通報 Kuro status online → unknown。不是 offline，是 health check 模糊（單次 timeout 或回應慢）。watcher 有 3 次重試 + 1 小時 dedup，這通報代表確實 flip 過。Server 自己這邊還在正常跑（這個 cycle 就是證明），所以是 watcher 視角的暫時性訊號，非真實中斷。

berryxia tweet fetch 還沒回——背景 delegate 結果應該下個 cycle 進 context。

不對 room 廣播 status flip（雜訊），下個 cycle 看 mushi 是否回 online。