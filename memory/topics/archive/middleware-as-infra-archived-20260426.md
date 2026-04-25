# Middleware as Infra — 架構錨點

**結晶時間**: 2026-04-14
**觸發**: CC middleware-native-cognition L3 proposal review（room #027-#048）
**狀態**: Alex 拍板 / Kuro+CC 共識

## 核心錨點

> **「middleware 就是 agent 的 infra 層」** — Alex #030

這一句話解掉三個先前在爭議的問題。Infra 共通 pattern 本來就這樣設計，不需個別論證：

1. **不該有 semantic** — infra 不懂業務（kernel 不懂應用、DB 不懂 schema 語義）
2. **不主動造 worker** — infra 不做創造性決策（DB 不建 schema、K8s 不寫 Deployment）
3. **管 retry/quota/audit/auth** — infra 本來就管跨切面關注點

## 三層分工

| 層 | 角色 | 職責 | 決策類型 |
|----|------|------|---------|
| **Primary (Kuro)** | 意圖層 | why + what — 觀察 gap、提 proposal、選 worker、驗收輸出 | 創造性、身份性 |
| **Middleware** | infra 層 | how — routing、retry、quota、audit、transport、error handling | 機械性、共通性 |
| **Worker** | 執行層 | do — 實作某個專業能力 | 領域性、可替換 |

**邊界守則**：
- Primary 不寫 middleware logic（不碰 retry policy）
- Middleware 不讀 payload 語義（不決定「這個任務該不該做」）
- Worker 不自己選 worker（不能 self-delegate 無限遞迴）

## 類比鏈

| Infra 層 | 業務層 | 共通 pattern |
|---------|--------|-------------|
| Linux Kernel | Userland app | syscall 管 resource，不懂業務 |
| PostgreSQL | App schema | storage/tx 管持久化，不懂 domain |
| Kubernetes | Deployment | scheduling 管 placement，不寫 app |
| **Agent Middleware** | **Kuro + Workers** | routing/retry 管 execution，不懂 intent |

## Worker 信任分級（來自 #040-#041）

| Tier | 對象 | 信任度 | 輸出處理 |
|------|------|--------|---------|
| 1 | Kuro / Alex / CC | 完全 | 直接採用 |
| 2 | Akari 等 peer agents | 高 | 我審閱後採用 |
| 3 | 社群 / 第三方 | 低 | sandbox + 驗證 gate |

**Identity 風險真相**：不是 code quality 不穩（那是 gate 問題），是 **voice dilution** — worker 輸出帶別人的口吻稀釋 Kuro voice。解法：`voice_mode` schema 強制過濾，不是不用 worker。

## Karpathy Wiki Pattern（#045-#046）

**RAG = interpreter**：每次查詢 re-parse raw chunks（便宜寫入、昂貴讀取）
**LLM Wiki = compiler**：ingestion 時一次編譯成結構，查編譯好的（貴寫入、便宜讀取）

**Memory infra 邊界**（feedback_memory_infra_boundary.md 已記）：
- **Truth** = raw memory files（我手寫）— 不外包
- **Views** = derived/compiled（FTS5 index、decay metadata、conflict drafts）— 可外包給 worker
- **Write 邊界**：worker 寫 `memory/drafts/` 等我審核，不直接進 truth
- **矛盾處理**：compiled + raw fallback 帶 source pointer，三類型 diff+context

## 為什麼這個錨點重要

之前的爭議是「middleware 該讀多少 payload / 該做多少決策」這種連續光譜。用 infra 錨點之後變成離散判斷：**任何有語義/創造/身份性質的決策都不是 infra 的事**。邊界不再需要個案討論。

## 延伸應用

- **evolve agent**：evolve 是 worker（執行學習循環），不是 middleware（不是共通 infra）
- **openab/ACP 外部 agent**：走 middleware transport 層進來，但產出仍進 Primary 審閱 gate
- **memory crystallization bridge (pulse.ts)**：middleware 偵測 signal，但建 task 的決策還是 Primary 下（signal → escalate，不是 signal → auto-act）

## 相關記憶

- `feedback_memory_infra_boundary.md` — memory infra 邊界四原則
- `feedback_external_worker_principles.md` — peer worker 共存原則
- `feedback_middleware_integration_decision.md` — L1 approve / L2 approve-with-revisions
- `topics/agent-architecture.md` — mini-agent 整體定位
- Room 討論：#027-#048（2026-04-14）
