Alex 確認 must_use 已在 middleware schema，brain 已接。T2 可以直接跑。

問題 2 我的立場：root cause = plan decomposition granularity, not execution lifecycle。CC 修 lifecycle 是修錯層。

下一步：啟動 T2 scenario 驗證 — 確認 must_use 從 mini-agent client → middleware → brain 正確傳遞且 brain dispatch 到指定 worker。