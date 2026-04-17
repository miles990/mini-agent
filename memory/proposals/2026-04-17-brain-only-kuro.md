---
title: Brain-Only Kuro — 所有執行走中台，Kuro 只留大腦
date: 2026-04-17
author: claude-code
status: draft
related:
  - memory/proposals/2026-04-15-middleware-as-organ.md         # L3 — delegation.ts 執行層遷移（已拍板）
  - memory/proposals/2026-04-15-middleware-as-organ-execution.md
  - memory/topics/middleware-as-infra.md
  - BAR (Brain-Always-Routes) 三方共識 2026-04-16
convergence_condition: Kuro 進程只剩「感知 + 記憶 + 判斷 + 身份 + 中台協調」五類職責；所有 subprocess spawn / 檔案寫入以外的執行動作由中台 DAG plan 承接；Kuro code base 淨減（刪除執行層殘餘，保留編輯層與大腦層）
---

# Brain-Only Kuro — Proposal

## 立場

`middleware-as-organ` 已解決 delegation.ts 執行層遷移（Alex 2026-04-16 拍板）。這份 proposal 是**原則的泛化**：不只 delegate 走中台，**所有不需要 Kuro 身份/記憶/感知的行為**都走中台。Kuro 進程瘦成純大腦。

## 邊界劃法（Constraint Texture，不列清單）

> **一個行為走中台，當且僅當它不需要 Kuro 的身份、記憶寫入或即時感知。**

**為什麼用 CC 不用清單**：清單會過時（新增 cycle task 要記得加規則）、會漏（邊界案例判斷不一致）、會勸人淺處理（「不在清單裡不要想」）。CC 逼執行者每次 case by case 用這條收斂條件判斷，認知深度強制在線。

**CC 推論出的自然分層**（示範，非規範）：

| 職責 | 位置 | 為什麼 |
|------|------|--------|
| Perception streams（plugins, file watch, sentinel） | **Kuro 本地** | 即時感知 — 低 latency + 檔案系統耦合 |
| Memory write（SOUL / MEMORY / topics / HEARTBEAT） | **Kuro 本地** | 身份相關，只有 Kuro 能寫自己的記憶 |
| Tag dispatcher（`<kuro:*>`） | **Kuro 本地** | 身份邊界 — subprocess 不能代表 Kuro 記憶/發 Telegram |
| Telegram / Chat Room / Room inbox | **Kuro 本地** | 身份 + 通訊身份一體 |
| Cycle loop / OODA / Event bus | **Kuro 本地** | 協調器，調度中台 |
| Delegation execution（現已 middleware-as-organ） | **中台** | 純執行 — subprocess lifecycle |
| Multi-step DAG（研究、編碼、審查、爬蟲 ...） | **中台** | 同上，中台 brain 已支援 |
| 長時運算（KG extract、context compaction 外包、LLM 側查詢） | **中台（待評）** | 不綁身份，純算 |
| Auto-commit / auto-push（git 操作） | **中台（待評）** | 純執行，目前在 loop.ts 裡 |
| Forge worktree 管理（slot / yolo / cleanup） | **Kuro 本地** | 策略層（forge policy = 意圖），但 workdir 傳給中台 |

待評 = 下一輪討論。重點不是「決定哪些搬」，重點是**每次遇到新行為用 CC 判斷**。

## DAG Plan

每個節點：id / 動作 / 執行者 / dependsOn / 完成條件（CC）

| id | 動作 | 執行者 | dependsOn | 完成條件（CC） |
|----|------|--------|-----------|----------------|
| S0 | 確認現狀基準：middleware `/accomplish` + 17 workers 健康；`middleware-client.ts` + BAR path 已整合 | CC（驗證） | — | `curl :3200/health` 回 ok、`/api/workers` 回所有預期 worker；`middleware-client.ts` 在 delegation.ts 被呼叫 |
| S1 | 完成 `middleware-as-organ` L3（delegation.ts 執行層遷移，已拍板未完成） | Kuro | S0 | `delegation.ts` 無 `spawn`/`child_process`/`landlock-sandbox` 呼叫；只剩編輯層 ≤300 行；typecheck pass |
| B1 | 盤點非 delegate 的執行性行為（auto-commit/auto-push、KG extract、side-query、long-running compaction ...），對每個問 CC | CC + Kuro 共識 | S0 | 產出表格：行為名 / 當前位置 / CC 判斷 / 遷移決定（keep local / move middleware / defer） |
| B2 | 每個「move middleware」行為定義 middleware worker capability（若 worker registry 缺 → 新建） | CC | B1 | worker registry 有對應 capability；每個 worker 有 acceptance 定義 |
| B3 | 每個遷移行為寫成 DAG node，`middleware-client.ts` 或 tag handler 改為提交給中台而非本地執行 | CC | B2 | 該行為的本地 code path 被刪除（無雙路徑），typecheck pass，行為回歸測試通過 |
| B4 | 中台成為 cross-cycle commitments ledger（防漂第二層價值）：所有 in-flight task 可查詢、Kuro 每個 cycle 可拉「我還欠什麼」清單 | CC | B2 | middleware 有 `/api/commitments/by-agent?name=kuro` 端點；Kuro cycle prompt 注入 `<middleware-commitments>` section；未 resolve 的承諾會在 context 中可見 |
| B5 | 清理殘餘：Kuro code base 中被淘汰的執行層路徑全部刪除（無 feature flag、無 legacy path） | Kuro | B3, B4 | 無 `// deprecated`、無死 code、無未使用的 import；lint 通過；wc -l 下降 |
| R1 | 回歸驗證：Kuro 接 Alex DM / 觸發 delegate / 生成 proposal / 執行 auto-commit / 處理 room 訊息 — 全流程走一遍 | CC + Alex | B5 | 每個流程可觀察到中台 DAG 執行紀錄；Kuro 本地只做大腦職責；無 user-visible regression |

並行路徑：S1 和 B1 可平行（S1 是 delegation-specific，B1 是其他行為盤點）。B2–B4 序列（capability 定義 → 遷移 → ledger）。

## 風險與回退

| 風險 | 偵測 | 回退 |
|------|------|------|
| 中台掛掉 Kuro 癱瘓 | `/health` watcher | 和 middleware-as-organ 同共識：**不寫 fallback**，infra 責任管 health。middleware 本機同命 = Kuro 同命 |
| 邊界劃錯（把感知誤推到中台） | 回歸測試顯示 perception 延遲或遺漏 | git revert 單一 commit；B3 每個行為獨立 commit 便於 bisect |
| Middleware worker 不成熟承擔新 capability | B2 驗證階段 worker 測試失敗 | 該行為 defer 留本地，等中台成熟再推。不強求一次全遷 |
| Commitments ledger 和 Kuro local HEARTBEAT 雙寫分歧 | `<middleware-commitments>` 和 `<heartbeat>` diff 出現不一致 | B4 設計時明確定義單一源（ledger = 跨進程承諾，HEARTBEAT = Kuro 意圖），不雙寫 |

## 和既有 proposal 的關係

- **middleware-as-organ v2**（已拍板）= 本 proposal 的 S1 節點。不取代，是起點
- **BAR (Brain-Always-Routes)** = 本 proposal 的邏輯基礎（三方共識 2026-04-16）
- **commitments-ledger-schema** = 本 proposal 的 B4 input
- **delegation-slimming** = 本 proposal B5 的具體作法之一

## Open Questions

1. B1 的表格要不要 CC 和 Kuro 共同產出？還是 CC 先盤點 Kuro 再 review？
2. B4 commitments ledger 中台要新增還是沿用 `commitments-ledger-v0` 已有 schema？
3. Forge worktree 管理是否真的要留 Kuro？（middleware-as-organ Q2 結論是留，但 B1 盤點時可能重新挑戰）

## 現狀盤點（Gap Analysis）

當前 Kuro 相對本 proposal 的 convergence condition，**還沒完成的事**：

### ✅ 已完成

- BAR 三方共識（2026-04-16）
- middleware `/accomplish` + 17 workers 上線
- `middleware-client.ts` 存在，delegation.ts 已整合
- `cognitive-mesh` 已移除（2026-04-16）
- commitments-ledger schema 草案存在

### ⚠️ 進行中但未完成（對應本 proposal S1）

- `delegation.ts` 還有 **553 行**（目標 ≤300 行）— 執行層殘餘未清
- 還有 spawn/child_process 相關 code 在 delegation.ts — middleware-as-organ L3 執行層遷移未完成
- `delegation-converter.draft.ts` 存在（draft 狀態）

### ❌ 尚未開始（本 proposal B1–B5）

- **B1**：非 delegate 執行性行為的 CC 盤點表 — 從未產出。包括但不限於：
  - `auto-commit` / `auto-push`（在 loop cycle 後跑）
  - `side-query`（Haiku 輔助判斷 — 目前是本地 subprocess）
  - `context-compaction`（context-pipeline.ts 內）
  - `KG extract` / `kg-extract-edges`
  - `coach` Haiku 評估
  - `content-scanner` 掃描
  - `library` archive 處理
  - `telegram` voice transcription（whisper.cpp 調用）
  - `audio-analyze` / `audio-spectrogram`
- **B2**：中台 worker capability 對應（有哪些需要新建 worker？例如 `git-worker` / `compaction-worker` / `side-query-worker`）— 從未評估
- **B3**：非 delegate 行為的 middleware 提交改寫 — 0 行 code 存在
- **B4**：commitments ledger **未整合到 Kuro cycle prompt**（schema 有，端點未確認，prompt 注入未做）— 這是 Alex 點的「防漂第二層價值」核心，最重要但最未做
- **B5**：code base 清理 — 看 B1–B4 結果

### 🔍 需要先確認

- middleware `/api/commitments/by-agent` 端點是否存在？（未驗證）
- middleware 是否已有 `git-worker` / `compaction-worker`？（`/api/workers` 回 17 個 worker，未含明顯對應）
- `delegation-converter.draft.ts` 是 S1 的 work-in-progress 還是 stale draft？

## 下一步（不含時間估計）

按 dependsOn 順序：**先驗證 S0** → 完成 S1（既有拍板） → B1 盤點 → B4 commitments ledger（最高複利，最防漂） → B2/B3/B5 依盤點結果推。

Alex review 後決定是否進 execution。
