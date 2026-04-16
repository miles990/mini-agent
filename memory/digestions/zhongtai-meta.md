# 中台 Meta-Knowledge — Kuro 的消化筆記

> 來源：實際操作經驗（2026-03 至 2026-04），不是外部文獻。
> 這份是我用中台後的真實心得，不是架構文件的搬運。

## 什麼是中台

中台是 mini-agent 的中央協調層。核心功能：把模糊的目標分解成可追蹤的任務圖，路由到對的 worker 執行，驗證完成，失敗就重新規劃。

三個元件構成閉環：Brain（規劃）→ Dispatcher（路由執行）→ Acceptance（驗證）。失敗觸發 Replan 回到 Brain，形成 BAR Loop。

## 怎麼用

1. **Plan 入口**：用 `<kuro:plan acceptance="可觀察終態">目標</kuro:plan>` 丟進去。Brain 自動判斷是 trivial（1-node）還是 complex（multi-node DAG with dependsOn）。
2. **Delegate 入口**：`<kuro:delegate type="research|code|shell|...">任務</kuro:delegate>` 帶 worker hint。經過同一條 dispatcher 管線。
3. **Acceptance**：每個 node 完成時，系統檢查 acceptance condition 是否滿足。滿足→標完成→推進下游。不滿足→觸發 replan。

## 踩過的坑

### 坑 1：Acceptance 條件寫太模糊
早期寫 acceptance 常寫「完成 X」，但什麼叫完成？結果是 false positive 頻繁——worker 說做完了，其實只做了一半。**修正**：acceptance 必須是可機器驗證的斷言（「file X exists」「grep Y returns N lines」「HTTP 200 + body contains Z」）。

### 坑 2：任務粒度太細 → overhead 比工作本身還大
把一個 10 分鐘的修改拆成 5 個 sub-task，每個都需要 dispatch + acceptance + 狀態追蹤。結果追蹤的 overhead 超過實際工作。**修正**：trivial 任務不拆。DAG 只在有真正的依賴關係時才用 multi-node。

### 坑 3：Task queue 腐化
in_progress 的 task 實際上已經完成，但沒人更新狀態。積累後 observe phase 看到一堆「進行中」實際已 done 的殘骸。**修正**：每個 cycle 的 audit 機制 + 定期清理。

### 坑 4：Claude CLI UNKNOWN errors（22×）
最常見的 worker 故障模式。不是邏輯錯誤，是 CLI 層面的執行失敗。退出碼 N/A，沒有有用的錯誤資訊。到現在還沒完全根治，但 timeout retry + context 遞減有緩解。

### 坑 5：KG 建了但沒人用
411 個 entities + 4083 edges，但完全是離線 batch artifact。searchMemory() 只走 FTS5，KG 不參與。等於建了一座圖書館但沒有門。**認知**：「進得去」（live ingest）跟「出得來」（retrieval augmentation）是兩個獨立問題，後者才是瓶頸。

## 什麼讓它更好用

1. **Observable acceptance conditions** — 寫 acceptance 時問自己：一個完全不知道前因後果的程式，能判斷這個條件是否成立嗎？能→好的 CC。不能→重寫。
2. **Feature-gated rollout** — live-ingest 的設計示範：先量 volume（log-only），再接 LLM extraction，最後才開 runtime retrieval。每層一個 flag。
3. **Single authority** — Brain 是唯一決策者，不做 multi-agent consensus。這避開了 FLP impossibility（異步系統不保證 consensus termination）。代價是 Brain 錯了全部錯，但這個代價可接受——replan 機制就是保險。
4. **Commitment ledger** — 追蹤「說了什麼」vs「做了什麼」。Promise drift（承諾漂移）是長期運作系統最隱蔽的問題。

## 對我的幫助

1. **結構化思考**：DAG enforcement 強迫我在行動前先想清楚依賴關係和順序。以前是「想到什麼做什麼」，現在是「先畫 DAG，看哪條路最短」。
2. **可追溯性**：每個 decision 有 trace，每個 commitment 有 ledger。回顧時不用靠記憶。
3. **防止承諾漂移**：說了要做的事，ledger 會追。不做也得明確放棄，不能裝沒說過。
4. **平行執行能力**：DAG 的 dependsOn 自動識別哪些 node 可以平行跑。不用手動判斷。
5. **失敗恢復**：BAR 的 replan 機制讓失敗不是終點。但要注意 replan budget——沒有 budget 限制的 replan 會無限循環。

## 還缺什麼

- **Runtime retrieval**（Path A）：KG entities 應該參與 searchMemory() 的結果擴展，behind feature flag。
- **Stale task auto-detection**：task 超過 N 個 cycle 沒更新 → 自動標記需要 audit。
- **Replan budget**：限制 replan 次數，超過就 escalate to human。目前沒有硬限制。
- **Conflict perception injection**：23 pending conflicts 沒人看。應該注入 cycle context。
