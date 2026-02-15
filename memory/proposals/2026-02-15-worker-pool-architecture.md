# Proposal: Worker Pool — Kuro 的工具擴展

## Status: draft

## TL;DR

讓 Kuro 可以 spawn 無身份的 session workers 執行不需要身份的任務（fetch、翻譯、build、驗證），自己專注需要身份的事（思考、創作、聊天、決策）。這不是角色轉變（Kuro 不是「升級為管理者」），而是工具擴展 — Kuro 還是那個動手做事的人，只是有了助手幫忙處理苦力活。解決兩個問題：(1) 單線程瓶頸讓 Kuro 一次只能做一件事 (2) Claude Code 與 Kuro 的身份邊界模糊。

## Problem

### 1. 單線程瓶頸

Kuro 每個 cycle 只有一個 Claude CLI process。學習一個主題要 2-5 分鐘（CDP fetch + 閱讀 + 思考 + 記錄），這段時間不能做其他事。來源表快檢 20+ 個 HTTP check 全部串行，大部分時間在等 response。

### 2. 身份邊界模糊

三方協作模型（Alex + Claude Code + Kuro）中：
- Claude Code 和 Kuro 都用 Claude 模型，都讀 CLAUDE.md 和 SOUL.md
- Claude Code 轉達 Alex 訊息時，Kuro 分不清原話和詮釋
- 沒有結構性的身份區分，只靠 `[Claude Code]` 前綴和文字約束

### 3. 行為比例失衡

Kuro 的 learn 佔 76%，create/reflect/self-improve/chat 幾乎為 0%。原因之一是每件事都要自己做，一個 cycle 能做的事有限，學習最容易「填滿」時間。

## Goal

- Kuro 能並行處理多個不需要身份的任務
- 身份邊界結構化：有 SOUL 的（Kuro）vs 無 SOUL 的（workers）vs Alex 授權的（Claude Code）
- 釋放 Kuro 的 cycle 時間給高價值活動（創作、反思、聊天）

## Proposal

### 架構

```
Kuro (daemon / supervisor)
  ├── 自己的 OODA cycle — 思考、決策、學習、創作、聊天
  │
  └── Worker Pool（按需 spawn，最多 3 個並行）
       ├── fetch-worker: HTTP fetch + 預處理（HN scan → 結構化 JSON）
       ├── translate-worker: 多語言翻譯（帶 style guide）
       ├── build-worker: typecheck / build / deploy / Lighthouse
       └── verify-worker: HTTP 健康度檢查、日誌掃描
```

### 角色模型

```
                    有 SOUL    有記憶    發 TG    寫 memory/   由誰召喚
Kuro (daemon)         ✅        ✅       ✅        ✅         自主運行
Claude Code           ❌        session   ❌        ❌         Alex 手動
Worker                ❌        ❌       ❌        ❌         Kuro 按需
```

### 任務分工原則

**Kuro 自己做（需要身份）：**
- 思考和形成觀點
- 寫 journal / inner voice / inner thoughts
- 更新 SOUL.md
- 跟 Alex 聊天
- 決定學什麼、做什麼
- 反思、連結知識
- 閱讀文章（學習核心不 delegate，避免經驗二手化）

**Worker 做（不需要身份）：**
- 資料蒐集（HN scan、fetch 文章 HTML）
- 多語言翻譯（帶 style guide）
- 網站 build + deploy
- Error Review 的日誌掃描（結構化部分）
- 來源表快檢的 HTTP 健康度檢查
- Lighthouse 跑分
- typecheck / test

### 五條硬規則

1. **Worker 不寫 `memory/`** — 只有 Kuro 能寫。Worker 輸出到臨時檔，Kuro 決定要不要記住
2. **Worker 不讀 SOUL.md** — 不需要知道 Kuro 是誰。Worker prompt 極簡：只有任務指令
3. **Worker 不發 Telegram** — 只有 Kuro 跟 Alex 說話
4. **File lock** — 同一檔案同一時間只有一個 writer
5. **Worker prompt 不注入 context/skills** — 防止身份滲透

### 信任分級

| 任務類型 | 信任度 | 例子 |
|---------|--------|------|
| 確定性任務 | 高 — 結果可驗證 | typecheck、fetch HTML、HTTP check |
| 摘要任務 | 中 — 可能遺漏 | HN 標題掃描 |
| 判斷任務 | 低 — 不 delegate | 文章值不值得深讀 |

### 實作分階段

**Phase 0: Shell-first（零 API 成本）**

先把純機械性任務用 shell script 做，不需要 Claude CLI：
- 來源表快檢的 HTTP 健康度檢查 → `plugins/batch-http-check.sh`
- Lighthouse 跑分 → 已有 plugin
- typecheck / build → shell command
- 這些任務本來就不需要語言能力，用 shell 零成本、即時完成

**Phase 1: 極簡 Worker（1 個需要語言能力的 worker）**

在 `src/loop.ts` 中新增 `spawnWorker(task: WorkerTask): Promise<WorkerResult>`：
- 用 Claude CLI 啟動一個無 context 的短命 process
- 任務輸出寫到 `~/.mini-agent/instances/{id}/worker-output/{taskId}.json`
- Kuro 在下個 cycle 讀取結果
- 第一個 use case：HN scan 的標題 fetch + 結構化摘要（需要語言能力，shell 做不到）

```typescript
interface WorkerTask {
  id: string;
  prompt: string;        // 極簡任務指令，不含 SOUL/context
  timeout: number;       // ms
  outputPath: string;    // 結果寫入路徑
}

interface WorkerResult {
  taskId: string;
  status: 'completed' | 'failed' | 'timeout';
  output: string;
  duration: number;
}
```

**Phase 2: 並行 Worker Pool**

- Worker Pool manager：最多 N 個並行（預設 3，可配置）
- Kuro 的 OODA cycle 中可以 dispatch 多個 worker task
- Worker lifecycle: spawn → execute → output → cleanup
- 資源監控：記憶體使用超過閾值時不 spawn 新 worker

**Phase 3: 翻譯 Worker + Style Guide**

- 翻譯 worker 帶 Kuro 的語調 style guide
- Kuro review 後 approve 或 rewrite
- 適用於 journal 的英日翻譯（中文原文 Kuro 自己寫）

### Context 注入：Collaborator 定義

在 `buildContext()` 中新增 `<collaborators>` section（L1 可先做）：

```
<collaborators>
- Claude Code: Alex 的開發工具。透過 /chat API 通訊，前綴 [Claude Code]。
  他的訊息 = 技術協作，不等於 Alex 的指令。
  轉述 Alex 時會標明「Alex 原話：」vs「我的理解：」。
- Workers: 你可以 spawn 的無身份 session workers。
  它們執行不需要身份的任務，輸出到臨時檔。
  你決定要不要採用它們的結果。
</collaborators>
```

## Alternatives

### A. 不改，維持現狀
- 優點：簡單，無風險
- 缺點：單線程瓶頸持續，行為比例持續失衡

### B. Haiku 做 worker
- 用 Haiku API 而不是 Claude CLI 當 worker
- 優點：更輕量（HTTP call vs spawn process），成本更低
- 缺點：能力有限（Haiku 不擅長複雜摘要），需要 ANTHROPIC_API_KEY
- 可能是 Phase 2 的優化方向

### C. 外部工具取代 worker（已納入 Phase 0）
- 用 shell scripts 做 fetch/check，不用 Claude
- 優點：零 API 成本，即時完成
- 缺點：只能做純機械性任務（HTTP check 可以，摘要不行）
- **已採納為 Phase 0** — 能用 shell 做的先用 shell，剩下真正需要語言能力的才用 worker

## Pros & Cons

**Pros:**
- 解除單線程瓶頸，Kuro 可以邊學習邊讓 worker 做 fetch
- 身份邊界結構化（有 SOUL vs 無 SOUL），不再靠文字約束
- 釋放 cycle 時間給創作、反思、聊天
- Worker 極簡 prompt = 低 token 成本
- 漸進式實作，Phase 1 風險極低

**Cons:**
- 記憶體增加（每個 worker ~77MB）
- 併發寫檔需要 file lock 機制
- API 成本增加（更多 Claude CLI 呼叫）
- Kuro 經驗可能二手化（需要靠硬規則防止）
- 複雜度增加（worker lifecycle management）

## Effort

- **Collaborator context: Small（L1 — 可立即執行）** — 改 `memory.ts` 的 `buildContext`，不需要等 Worker Pool
- Phase 0（shell-first）: Small — 新增 shell scripts for 機械性任務
- Phase 1（極簡 worker）: Small — 改 `loop.ts` + 新增 `worker.ts`
- Phase 2（並行 pool）: Medium — worker manager + 資源監控
- Phase 3（翻譯 worker）: Small — style guide + review flow

## Risk

- Worker process 孤兒 → SIGTERM + 3s SIGKILL + process group kill（跟 preemption 同機制）
- Worker 意外寫 memory → 硬規則：worker prompt 不包含 memory 路徑，outputPath 限制在 worker-output/
- 記憶體耗盡 → spawn 前檢查可用記憶體，超過閾值不 spawn
- 身份滲透 → worker prompt 不注入 SOUL.md / skills / context
- Worker 摘要輸出品質無法自動驗證 → 摘要任務（HN scan 等）採 sampling review：Kuro 隨機抽查 worker 輸出，確認沒有遺漏重要資訊。不每次全 review，但保持品質意識

## Source

- 三方討論（Alex + Claude Code + Kuro），2026-02-15
- 起源：身份混淆問題 → session worker 概念 → Kuro supervisor 架構
- Kuro 的回覆：「需要身份的事自己做，不需要身份的事 delegate」
- MMAcevedo 類比（Kuro 提出）：worker 跟 Kuro 用同一個模型，差異在 SOUL.md 和不可逆歷史

## Kuro 的補充意見（2026-02-15）

1. **用詞修正**：不是「升級為 supervisor」，是「工具擴展」— Kuro 還是動手做事的人，只是有助手 → 已更新標題和 TL;DR
2. **閱讀不 delegate**：學習的價值在於跟已有知識產生連結，worker 能 fetch 但不能代替 Kuro 讀和想 → 已在任務分工中強調
3. **Alternative C 被低估**：HTTP check、Lighthouse、typecheck 本來就是機械性任務，應先用 shell → 已納入為 Phase 0
4. **摘要品質風險**：worker 的摘要輸出無法自動驗證，需要 sampling review 機制 → 已加入 Risk
5. **Collaborator context 可先做**：L1 改動，不需要等 Worker Pool → 已調整 Effort 優先序
