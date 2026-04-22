# 中台關鍵設計決策

## 決策 1: 單刀切換策略（非漸進）
**選擇**：一次性切換，無 feature flags、無 strangler pattern、無 shadow run
**為什麼**：
- Feature flags 增加複雜度，兩條路徑永遠不會真正同步
- Shadow run 成本高且驗證困難
- 切換是可還原的（git revert），這就是安全網
**風險**：如果新路徑壞了，整個系統停擺
**緩解**：單刀切換但保留 git revert 能力

## 決策 2: Middleware 是本地器官
**選擇**：同主機親和性（same-host affinity），不是遠端服務
**為什麼**：
- 跟 Kuro 同生命週期 = 同身份
- 延遲低（localhost:3200，無網路跳轉）
- crash 後 launchd KeepAlive 自動重啟
- `/health` 整合進感知系統
**意味著**：middleware down = 基礎設施故障（跟磁碟壞掉一樣），不需要 fallback code path

## 決策 3: Forge Slot 留在 mini-agent
**選擇**：worktree 管理不移入 middleware
**為什麼**：
- Forge 知道 Kuro 的政策和私有資產
- Worktree path 作為參數傳給 middleware
- Worker 在該 cwd 中 spawn
- Merge/cleanup 由 mini-agent 控制
**含義**：middleware 不擁有檔案系統政策，只提供 cwd 注入

## 決策 4: Acceptance = Convergence Condition
**選擇**：不用 effort/ETA，用可觀察終態
**為什麼**：
- AI 時間估算是偽精確（坑 #2）
- 規劃語言塑造思考
- Convergence condition 可以自動驗證，ETA 不行
**實踐**：DAG plan request 嵌入 acceptance → 驅動 replan loop → 連結 commitment ledger

## 決策 5: 雙軌是特性不是缺陷
**選擇**：保留 delegate（System 1）和 plan（System 2）兩條路徑
**為什麼**：
- 不是所有任務都值得 DAG 編排的開銷
- 反射（delegate）和思考（plan）是不同認知模式
- 強制統一路徑 = 違反「正確約束放在正確層」
**含義**：寫程式的人需要判斷用哪條路徑

## 決策 6: BAR（Brain-Acceptance-Routing）
**選擇**：有 acceptance 走 /accomplish，無 acceptance 走 /plan
**為什麼**：
- /accomplish 啟用 brain DAG 規劃 + replan loop
- /plan 是 legacy 手動單步，適合已知步驟
- Acceptance 的有無作為路由判斷依據，簡單且語意正確
**Gate 邏輯**：無 acceptance 時 soft warning（不阻塞但提醒）

## 決策 7: Agent-Neutrality 原則
**選擇**：middleware 不只為 Kuro 服務
**為什麼**：
- 原本為 Kuro 建，但 Akari 和 peer agents 也需要相同基礎設施
- 中立化讓基礎設施投資可復用
- 但語意決策仍在各 agent 自己的 head 裡
**含義**：middleware API 不假設特定 agent 的身份或偏好

## 決策 8: 暫時身份不常駐化
**選擇**：Worker = task-scoped identity，完成後解除
**為什麼**：
- Worker 常駐化 = 身份模糊（identity blur）
- 不允許 worker 累積 memory 或 SOUL
- 暫時身份常駐化是病理（pathology）
**紅線**：Workers 只能起草，Kuro 審查後才進 memory
