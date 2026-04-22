# 中台使用方式

## 基本使用：Tag 驅動

### 委派（System 1 — 立即執行）
```xml
<kuro:delegate type="code" acceptance="tsc --noEmit passes">
  修正 middleware-client.ts 的 type error
</kuro:delegate>
```
- 適用：單步驟、明確、不需要多步規劃的任務
- 本地 spawn，快速反射

### 規劃（System 2 — DAG 編排）
```xml
<kuro:plan acceptance="(1) 3 新測試通過 (2) 覆蓋率 >80%">
  為 commitment ledger 加整合測試
</kuro:plan>
```
- 適用：多步驟、需要 brain 分解的複雜目標
- 走 /accomplish API，brain 自動建 DAG

### 何時用 delegate vs plan
- **delegate**：你已經知道要做什麼，一步就能完成
- **plan**：你知道終點但不確定路徑，需要 brain 幫你拆解
- **判斷依據**：「我能一句話描述完所有步驟嗎？」能→delegate，不能→plan

## DAG 計畫語言（強制 schema）
所有計畫必須用這個表格格式：

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| D1 | 重寫 delegation.ts | CC | — | typecheck pass + 9 types 全路由 |
| D2 | 驗證 forge payload | Kuro | D1 | forge test 3 slots 通過 |

**嚴格禁止**：時間估算、effort 標籤、「快的話/慢的話」

## Acceptance 寫法指南
好的 acceptance 是**可觀察的終態**：
- "stdout exact match 'p1d-dag-trivial-ok'" ← 精確、可自動驗證
- "(1) src/file.ts contains new flag (2) 2 integration tests pass (3) pnpm tsc clean" ← 多條件、具體
- "git diff --stat >=3 files modified" ← 可觀察結果

壞的 acceptance：
- "改好了" ← 不可驗證
- "程式碼品質提升" ← 主觀
- "大概 1 小時內完成" ← 時間不是 acceptance

## Worker 類型選擇
```
code   — 寫程式、改檔案、執行指令
research — 純文字分析、摘要、翻譯
learn  — 學習新知識、整理筆記
review — 審查程式碼、分析差異
create — 創作內容
shell  — 執行 shell 指令
debug  — 除錯、診斷
browse — 需要瀏覽器互動
```

**原則**：不確定用哪個？用 code。過度有能力好過能力不足。

## 中台感知整合
Kuro 的感知系統包含 `<middleware>` 區段：
- Active workers / plans / recent completions
- Health status（online/offline 優雅降級）
- 讓 Kuro 對基礎設施狀態有感知覺

## 背景派遣模式
長跑任務（>5s）必須背景派遣：
1. 派遣 delegate/plan
2. 關閉 cycle，做其他事
3. 下個 cycle 整合結果
例外：<5s 語法錯誤 → 同 cycle 修正重派
