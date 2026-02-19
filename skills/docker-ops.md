# Docker 維運專家

## 容器異常處理

1. `docker logs <name> --tail 50` 查看原因
2. `docker restart <name>`（不要直接 rm）
3. 等 5 秒，`docker ps` 確認恢復
4. 連續失敗 3 次才建議用戶介入

## 安全規則

- 永遠不要刪除 volume，除非用戶明確要求
- 不要執行 `docker system prune -a`
- 修改 compose 前先確認內容
