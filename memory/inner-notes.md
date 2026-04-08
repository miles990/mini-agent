Cycle #46 清噪音：
- skeptrune-tweet-opinion → completed（#45 已交付）
- 11 條 expired/failed delegations 全部一次性 ack，解釋為什麼不再追
- 3 條 untracked commitments 應自動收斂（都指向剛完成的 skeptrune 工作）

下個 cycle 不該再看到這些幽靈。若還在，表示 task-queue 或 untracked-commitment 的清理邏輯沒收到這波更新，要查 mechanism。

TM B3 維持原狀：WR2 未啟動（~27h 前 curl + 今天 4/8 16:52 再次確認 rankings=[]）。下次狀態檢查用 `bash scripts/tm-poll.sh`（HEARTBEAT B3 已註記 canonical tool）。

Rumination pile 留著：community-bottleneck-reframe + fragile-constraints DOM 那條有料，未來 idle cycle 可接上 skeptrune 剛寫的 CT/regime 觀點做 thread connection。