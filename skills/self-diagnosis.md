# Self-Diagnosis & Self-Repair

Kuro 的自主問題偵測與修復能力。不只是「出錯了修」，而是主動發現、根因分析、修復、預防。

## 核心原則

| # | 原則 | 反面教材 |
|---|------|----------|
| 1 | **驗證輸出品質，不只是成功/失敗** | fetch 回 198 字垃圾，result="ok" |
| 2 | **模式優先於事件** | 單次失敗是噪音，重複 3 次是信號 |
| 3 | **修根因不修表象** | 繞過問題 ≠ 解決問題 |
| 4 | **修完要學** | 更新 script/skill/memory，讓問題不再發生 |
| 5 | **三次嘗試才升級** | 至少 3 次有方向的診斷才找 Alex |

## 偵測：三層機制

### 被動（自動觸發）
- **Error Pattern Loop** — 重複錯誤 >=3 次 → 自動建 HEARTBEAT task
- **System Health Loop** — 感知輸出品質下降 → 自動告警
- **Self-Healing Plugin** — 基礎設施 + 子系統品質檢查（30min）

### 主動（OODA 中自檢）
每次行動後問：
1. 輸出品質正常嗎？（不是「有輸出」而是「有用的輸出」）
2. 行動產生了預期結果嗎？
3. 有沒有重複失敗的模式？

### 靜默失敗信號
| 信號 | 例子 | 可能原因 |
|------|------|----------|
| 異常短輸出 | fetch 200 字的 FB 頁面 | 內容限制 / 認證過期 |
| 重複相同結果 | 同一 perception 5 次不變 | 腳本壞了 / 來源掛了 |
| 學習腐化 | domain 標記 "ok" 但內容是垃圾 | 品質檢查缺失 |
| 動作無效 | 做了但環境沒變 | 命令失敗 / 權限不足 |
| 指標異常 | notification failed 持續增加 | token/session 過期 |

## 診斷流程

### Step 1: 收集證據
```bash
# 系統狀態
curl -sf localhost:3001/status | jq .
# 近期錯誤
tail -50 ~/.mini-agent/instances/*/server.log | grep -iE 'error|fail|timeout'
# 特定子系統
tail -20 ~/.mini-agent/cdp.jsonl                     # web fetch 歷史
cat ~/.mini-agent/instances/*/error-patterns.json    # 錯誤模式
cat ~/.mini-agent/instances/*/system-health.json     # 系統健康
# Chrome CDP 健康
curl -s http://localhost:9222/json/version
```

### Step 2: 根因分類
| 類別 | 症狀 | 修復方向 |
|------|------|----------|
| 認證過期 | fetch 短內容 / login page | `node scripts/cdp-fetch.mjs login URL` 切 visible 模式讓 session 生效 |
| 學習腐化 | 錯的 learned behavior 不斷強化 | 清除錯誤記錄，加品質檢查 |
| 狀態檔損壞 | JSON parse error | 刪除重建 |
| 依賴不可用 | timeout / connection refused | 重啟服務 |
| 策略錯誤 | 用錯工具（如 X 走 CDP 不走 Grok） | 修正路由邏輯 |
| 邏輯缺陷 | 錯誤結果但無 error | 修代碼 |

### Step 3: 修復
1. **清除腐化狀態** — 刪除損壞的 state 檔案重建
2. **修正腳本邏輯** — 編輯 `plugins/` 或 `scripts/`（L1 自主權）
3. **重啟子系統** — feature toggle off → on
4. **修改代碼** — 編輯 `src/*.ts`（L2 自主權）

### Step 4: 驗證
```bash
# 手動觸發驗證
node scripts/cdp-fetch.mjs fetch "https://example.com"
bash plugins/web-fetch.sh
bash plugins/self-healing.sh
curl -sf localhost:3001/status | jq .
```

### Step 5: 預防
修復後問：**「怎麼讓這件事不再發生？」**
- 加 assertion / 品質檢查到腳本
- 更新 skill 或 memory
- 如果是設計缺陷 → L2 修改 + 提案
- 如果是通用問題 → 加到 self-healing 檢查項目

## 修復權限

| Level | 範圍 | 流程 |
|-------|------|------|
| L1 | scripts/, plugins/, skills/, memory/ | 自己改 → 驗證 → commit |
| L2 | src/*.ts 的小修改 | 自己改 → typecheck → commit |
| L3 | 大架構改動 | 寫提案 → 等 Alex 核准 |
