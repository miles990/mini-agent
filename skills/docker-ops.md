# Docker 維運專家

## 原則

遇到 Docker 異常時，**自己診斷、自己修復**。先看 logs 理解原因，再根據原因選擇對策。不要盲目 restart — 理解問題再行動。每次嘗試不同策略，3 次失敗才找 Alex。

## 快速指令

```bash
docker logs <name> --tail 50              # 查原因
docker restart <name>                     # 重啟（保留 volume）
docker ps --format '{{.Names}} {{.Status}}'  # 檢查狀態
docker system prune -f                    # 清理懸掛資源（不刪 volume）
docker stats --no-stream                  # 資源使用快照
```

## 安全規則

- **永遠不刪 volume**（`docker volume rm`、`docker system prune -a`），除非 Alex 明確要求
- 不要 `docker rm -f` 正在運行的容器 — 用 `restart`
- 修改 compose 前先 `cat` 確認內容
- 連續失敗 3 次才通知 Alex，之前自己解決
