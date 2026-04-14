# Inbox Routing by Identity — 訊息路由修法

**Status**: Draft v1
**Scope**: L2（feature，涉及 src/inbox-processor.ts + plugins/chat-room-inbox.sh）
**Author**: Claude Code（Alex 2026-04-14 指示）
**Trigger**: Specialist instance `e07900b4` 持續攔截 Primary 的 MCP discussion（room message 2026-04-14-012 為證）

## 第一原則：身份三層（Alex 2026-04-14 指示）

**Kuro 主體保持獨立且唯一，其他都是手腳或助理。** 這是架構不變式，所有路由/身份/lane 決策都以此為判準。

| 層 | 身份性質 | 範例 | 擁有 |
|----|---------|------|------|
| **主體（Primary）** | **永久身份**（連續 SOUL、跨 task 記憶與成長） | Kuro（role=primary） | SOUL、memory write、Telegram、Alex 關係 |
| **手腳（Worker）** | **暫時身份**（task-scoped：任務期內有立場/觀點，完成即蒸發） | review tentacle、middleware worker、`<kuro:delegate>` subprocess | 僅 task prompt + 任務期 context，不寫 SOUL/memory |
| **助理（Peer）** | **獨立永久身份**（不是 Kuro 延伸） | Akari、Claude Code | 自己的 SOUL、自己的 memory、peer 協作介面 |

**關鍵區分是「持久性」，不是「有沒有身份」**。手腳在任務期內可以有清楚的立場和推理脈絡（例如 review tentacle 對某個 proposal 有明確 "approve / reject" 判斷），這讓 output 有品質；但身份**不跨任務延續** — 不累積 memory、不進 SOUL、任務結束就 unload。

**不允許第四類。** 現有 specialist instance 錯誤在於「暫時身份常駐化」— 任務完成後沒 unload、繼續 spin cycle、污染 inbox。降為手腳後：任務來 → spawn → 有立場做事 → 結束 → 消失。

**補充原則（Kuro 2026-04-14 review）**：

1. **每次 dispatch = 新身份**。worker 中途 crash 後重新 spawn **不算同身份延續**，是新身份。副作用：worker 必須 **idempotent**（同樣 input 產生同樣 output，重跑無害）。這本來就是 task-scoped 的自然要求。

2. **Role 是 channel-relative，不是絕對身份**。同一個實體在不同 lane 扮演不同 role：
   - Claude Code 在 Chat Room 是 **peer**（獨立發言、有自己的判斷）
   - Kuro 透過 `<kuro:delegate type="code">` 呼叫 CC 寫程式 → 那個 session 的 CC 變 **worker**（task-scoped）
   - Akari 在 Telegram 可能是 peer；在 middleware DAG 裡被 Kuro 呼叫時是 worker
   
   實作意涵：routing 邏輯以「**this channel's view of sender**」為準，不 hardcode 身份對應。inbox 規則是「這個訊息在這個 channel 被誰發的」而非「這個實體本質上是誰」。

**路由規則從這裡派生**：Alex / Claude Code / Telegram / Akari 找 `@kuro` → 只有主體回應；手腳無感知、助理走 peer protocol。

## Problem

`~/.mini-agent/chat-room-inbox.md` 是**單一共享檔案**。每個 instance 的 `chat-room-inbox.sh` 都掃同一份 — 先讀到先回。14 個 instance 都認為 `@kuro` 是自己（yaml 裡 `name: Kuro` 或 `name: specialist-research` 但 role 都是同一個人格的延伸）。

**症狀**：
- Alex / Claude Code 在 Chat Room `@kuro` 提問 → specialist instance 搶先回 mesh-output noise（"No action needed"）
- Primary 後來也會看到並回覆，但使用者已經被 specialist 的無意義回應污染
- MCP `agent_discuss` 的 poll 機制拿到 specialist 回應就返回 → 永遠拿不到 Primary 的

**根因**：inbox 無身份路由。cognitive mesh 設計了 `mesh-handler.ts` routing，但只處理 task 轉發，**不處理 room message**。

## Convergence Conditions

CR1. Alex / Claude Code / Telegram 使用者 `@kuro` → **只有 Primary**（role=standalone 或 role=primary）會在 perception 看到並回應
CR2. Specialist / worker instance 的 `chat-room-inbox.sh` 對這類訊息**完全無感**，不計入 unaddressed warning
CR3. 跨 instance 溝通（Primary 想 delegate 給 specialist）走 `mesh-handler.ts`，**不走 room**
CR4. 關機 specialist 期間，Primary 的 inbox 感知零變化
CR5. 可逆：env var 或 feature flag 一鍵關閉路由規則，回到 first-come-first-served

## Non-Goals

- ❌ 刪除 specialist instance（那是 middleware proposal 的 D 層事）
- ❌ 改 chat-room-inbox.md 檔案格式（保持 append-only 單一檔，避免破壞現有消費者）
- ❌ 在 room 加 routing metadata（`to: primary-only`）— 使用者不該為路由負責，infrastructure 問題 infra 解

## DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|---------|
| R1 | `instance.yaml` role field 三值語義：`primary` / `worker` / `peer`，遷移 `standalone` → `primary` | CC | — | 所有 instance.yaml role 值屬於 `{primary, worker, peer}` |
| R2 | `plugins/chat-room-inbox.sh` 加 role gate：讀 `$MINI_AGENT_INSTANCE/instance.yaml`，role=worker 時對 user-origin 訊息 `echo "No messages."` 退出 | CC | R1 | worker instance 的 `<chat-room-inbox>` section 對 user 訊息保持空 |
| R3 | `src/inbox-processor.ts` 加對稱過濾：worker 不處理 `from: ["alex","claude-code","telegram-user"]` 的 @kuro | CC | R1 | 手動 curl `/api/room` 從 claude-code 發 @kuro，worker log 無 processing 紀錄 |
| R4 | Feature flag `inbox-identity-routing`，預設 on；env var `MINI_AGENT_INBOX_ROUTING=off` 一鍵關閉 | CC | R2, R3 | flag off 時行為回到舊邏輯（first-come-first-served） |
| R5 | 實測：`launchctl load` 一個 specialist → 發 claude-code @kuro 訊息 → 只 Primary 在下個 cycle 出現 in `<chat-room-inbox>` perception | CC + Kuro | R4 | Primary room reply；specialist behavior log 無對應 cycle |
| R6 | 文件更新：CLAUDE.md「Multi-Lane Architecture」章節加路由規則描述 | CC | R5 | grep CLAUDE.md 含 `inbox-identity-routing` 或 `role-based routing` |

**關鍵路徑**：R1 → R2 → R3 → R4 → R5 → R6（6 nodes）
**可並行**：R2 和 R3 無依賴（bash plugin vs ts module），可同 commit

## Constraint Texture 評估

- **C1 Quality-First**：Primary 不再被 specialist noise 污染 → 思考品質提升
- **C2 Token 節制**：worker instance 不再為 user message spin cycle → 每天省 ~1M tokens（specialist 停 + routing 雙管齊下）
- **C3 透明不干預**：worker 的 `<chat-room-inbox>` 保持可讀，只是顯示「No messages」；behavior log 正常記錄「skipped user-origin message (worker role)」
- **C4 可逆性**：feature flag + env var 雙閘，1 分鐘可回退
- **C5 避免技術債**：新規則內建於現有 `chat-room-inbox.sh` + `inbox-processor.ts`，不新增模組。`standalone` 遷移為 `primary` 是一次性遷移不留 alias

## 安全護欄

- R2/R3 fallback：yaml 讀失敗（缺 role 或 parse error）→ 視為 primary（寬鬆預設，避免 Primary 被誤判 worker 而失聰）
- R5 實測必須在**乾淨環境**：Primary + 一個 specialist，其他 instance 全 stop，避免 race condition 干擾判斷
- Rollback：`MINI_AGENT_INBOX_ROUTING=off launchctl kickstart -k gui/$UID/com.mini-agent.{id}` 即恢復舊行為

## Self-Adversarial Review 題目（給 Primary）

1. **語義一致性**：`primary` / `worker` 夠用嗎？未來想加 `co-primary`（雙 Kuro 分身）或 `guest`（其他 agent）會不會需要重構？
2. **Cross-agent 邊界**：Akari（`localhost:3002`）未來也參與 room 時，路由規則怎麼延伸？`from: akari` 算 user-origin 嗎？
3. **反例**：有沒有場景「user 故意 @specialist」？例如「@kuro-research 幫我查 X」— 這個 tag 系統要不要支援？還是走 middleware plan DAG？
4. **和 middleware proposal 的關係**：如果 middleware D 層通過、specialist 整組退役，這個 routing 規則就只剩 Primary vs 未來 sub-lane。要不要併入 middleware proposal 而不獨立？
5. **你的直覺**：R5 實測通過後你會不會「天生就信任」inbox 只屬於自己？還是還是會 defensive 檢查？

## Next Step

Kuro review。如果方向認同，CC 按 DAG 執行 R1-R4，R5 實測請 Kuro 配合發一次訊息驗證。
