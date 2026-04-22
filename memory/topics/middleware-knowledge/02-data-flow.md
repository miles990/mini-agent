# 中台資料流

## 端到端流程

```
使用者請求（inbox/chat）
    ↓
Dispatcher（統一 tag 解析器）
├─ <kuro:delegate> → brain 透過 /accomplish 規劃
├─ <kuro:plan> → brain 透過 /accomplish 規劃
└─ <kuro:remember> → commitment 追蹤
    ↓
Brain（middleware.ts 遠端）
├─ 任務分解（簡單→1節點, 複雜→多節點 DAG）
├─ Worker 路由（code/research/learn/review/create/shell/plan/debug）
└─ Acceptance gate（收斂條件驗證）
    ↓
執行（每個 worker 在子程序中）
├─ 對照 acceptance 標準驗證
├─ 失敗時 replan（最多 3 輪，Gap A）
└─ 記錄 commitment 解決
    ↓
結果追蹤 & commitment 帳本更新
```

## Phase 1: 派遣入口
loop.ts 的 AgentLoop.processResponse() 呼叫 postProcess(text, response)。

## Phase 2: Tag 解析
dispatcher.ts parseTags() 從回應中提取 kuro 標籤。
postProcess() 路由每個標籤：
- **有 acceptance** → `/accomplish`（brain 規劃，replan loop 啟用）
- **無 acceptance** → `/plan`（legacy 手動單步，無 replan）

## Phase 3: Brain DAG 規劃
Brain 收到 AccomplishRequest 含 acceptance 標準：
- 瑣碎任務（echo、單指令）→ 1 節點計畫
- 中等任務（讀→編輯→驗證）→ 2-3 節點 DAG 含 dependsOn
- 複雜目標（多 worker、4+ 步）→ fan-out/fan-in DAG

## Phase 4: 執行 & 驗證
delegation.ts spawnDelegation() 輪詢直到終態（completed/failed/timeout）。
收集所有步驟的輸出。

## Phase 5: Acceptance Gate & Replan（Gap A 實作）
如果有 acceptance 且有失敗步驟，且輪次 < MAX_REPLAN_ROUNDS：
累積 context（prior_attempts），重新派遣 AccomplishRequest。

## Phase 6: Commitment 解決
完成時呼叫 commitmentClose(taskId, status, evidence)。
透過 middleware resolveCommitment API 持久化。

## Commitment 帳本 Schema
```
Commitment {
  id: "cmt-{date}-{nanoid6}"
  owner: "kuro" | "claude-code" | "alex" | "middleware"
  text: 人類可讀承諾 ≤500 字
  acceptance: "證明承諾被履行的可觀察終態"
  status: "active" | "fulfilled" | "superseded" | "cancelled"
  resolution: { kind, evidence, note? }
}
```
TTL 7 天自動 stale，每 owner 最多 20 個 active。
