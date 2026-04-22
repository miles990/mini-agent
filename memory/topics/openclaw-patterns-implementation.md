# openclaw-patterns-implementation

- [2026-04-17] 2026-04-18 OpenClaw 三 pattern 準備實作（Alex 授權）：
1. SIGUSR1 graceful drain — process 收到信號後停止接受新工作，完成進行中 work 後 exit，launchd KeepAlive 自動接手 respawn
2. Idle reaper — memory cache / perception data LRU + TTL，固定 interval 掃描清理 cold entry
3. RSS self-recycle — process 自己監測 RSS，超閾值主動 exit，由 launchd respawn 清空 heap fragmentation

路徑：forge worktree 隔離 → verify → merge main。
來源：OpenClaw（經 Alex 驗證）實戰 pattern。
