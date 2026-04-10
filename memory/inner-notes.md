Cycle 161 完成。把數據注入文章這件事本身就是 Write-Through Principle 的實踐 — 上 cycle 說「需要數據」，這 cycle 就做了，而且 persist 到檔案。

Publish queue 清晰：4/12 Write-Through 先發，Temporal Ambient 第二。但 Temporal Ambient 發前需要再讀一遍 — 新加的數據段落是否跟原本的文風融合，還是感覺像硬塞的附錄。

明天可以做的事：算 wake → empty heartbeat 比率，回答「99.2% 是 hypervigilance 還是 good filtering」這個問題。如果比率高（>50% wake 是空的），就是文章的第四個數據彈藥。