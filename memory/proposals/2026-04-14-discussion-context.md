# Discussion Context · 2026-04-13 晚 → 2026-04-14 下午

**目的**：讓 Kuro 不用翻 room jsonl 就能重建今天討論脈絡。配 `2026-04-14-kuro-middleware-integration.md` 一起讀。

## Timeline 關鍵 pivots

### 2026-04-13 18:00 之前
- Claude Code 和 Alex 討論 token 優化
- 寫昨天的 `2026-04-13-token-optimization-root.md`（Stage 0-4）
- M4 架構問題：`-p` mode cache 不到 user message，討論「留 CLI vs 走 SDK」
- **CC 論斷（錯）**：「走 Anthropic SDK → flip 成本模型，每次付 API credit，不該走」
- 寫 Phase D proposal（Kuro ↔ middleware HTTP integration）

### 2026-04-13 ~07:30
- Kuro Primary instance `03bbc29a` graceful shutdown
- 根因：CC 發一條 3KB 長訊息到 room → `memory.searchMemory` 把訊息當 grep pattern → grep OOM → cascade 失敗 → Alex 手動 shutdown
- Kuro 從昨天到 2026-04-14 13:00 之間 down（Primary 沒有 launchd plist，沒 KeepAlive）

### 2026-04-14 上午 · CC 繼續基於錯誤前提思考
- 討論 middleware Phase 1/2/3 的 Constraint Texture 改造 — 這部分是對的，三個 blocker 的根本解法
- 實作 Phase 1 (`/accomplish` goal-oriented) + Phase 2 (Haiku recovery_options) + Phase 3 (shell workspace schema)
- commit `9187e44` pushed
- Phase A (pm2 + setup wizard + install.sh) commit `6899dea` pushed
- middleware live on port 3200

### 2026-04-14 中午 · Wow 討論（第一次 pivot）
- CC 論斷（錯）：「middleware 是 infrastructure，結構性無 wow」
- Alex 丟 **openab** (`github.com/openabdev/openab`) 反例
- CC 承認錯：openab 是 Rust daemon + JSON-RPC broker（同 middleware 層），但借用 Discord 的 visual surface 產 wow
- **新分類**：Pure backend（真沒 wow）vs **Backend with visual projection**（可以 wow — openab / Vercel / Railway / Claude Code）vs Frontend
- 寫 **Phase D.5 · Telegram visual projection**：middleware plan state → Kuro → Telegram edit-streaming + emoji 軌跡 + recovery inline keyboard
- openab 沒有的領先：**inline keyboard 讓 recovery_options 變可點擊按鈕**

### 2026-04-14 下午 · Kuro 重啟 + Phase D 快速 review
- 發現 Kuro Primary down，grep OOM 根因分析完成
- 修 grep OOM bug（commit `1c81409c`，three-phase guard: strip + 200 char cap + top-2 token reduction）
- `mini-agent up -d` 重啟 Kuro 03bbc29a
- Kuro quick review（msg `2026-04-13-072`）：
  - Q1: 新開 `src/middleware-dispatch.ts`（理由：delegation.ts 混 provider routing，語意分離）
  - Q2: Telegram rate limit = 30 msg/sec/bot, 1 msg/sec/chat；callback_query 不算配額；建議 adaptive 1s→2s debounce（她的原創 insight：wow moment 心理學）
  - Q3-Q11 delegate 背景 research，週末前完整回覆

### 2026-04-14 下午後段 · CC 的兩層錯被拆穿（第二次 pivot，最深）

**Alex 的四個尖銳問題依序戳穿 CC 的過度規劃**：

1. **「agent sdk 可以用訂閱」**
   - CC 去 WebFetch Anthropic 官方文件 → 確認 SDK 支援訂閱認證
   - CC 承認**第一層錯**：昨天沒 check 官方文件就論斷「SDK 丟訂閱」

2. **「akari 的 tanren 還有部分 kuro 的 mini-agent 不就是跑 agent sdk?」**
   - CC grep tanren + middleware → 逐字引用：
     - `tanren/src/llm/agent-sdk.ts:4` — "Uses Claude Agent SDK (subscription auth, no API key). Same auth as Claude Code — runs on subscription, not API credits."
     - `agent-middleware/src/sdk-provider.ts:2-3` — "Agent SDK Provider — uses Claude Agent SDK (subscription auth). Reference: Tanren's createAgentSdkProvider (verified working)."
   - Akari live uptime 16.4 小時 = 硬 production 證據
   - CC 承認**第二層錯（更嚴重）**：沒 check 用戶已經在跑的系統。「verified working」四個字就在註解裡，昨天讀這檔案寫 Phase 1/2/3 時完全沒讀進去 — compliance without comprehension
   - 這意味著昨天整段 M4 / Stage 1.5 PoC / cache stability / `-p` flag hack 討論**全部建立在錯誤前提上**

3. **「為何要遷移？不能想用就透過中台使用嗎？」**
   - CC 剛提 Phase E 原版（Kuro 遷移到 SDK 直接用）
   - Alex 戳：middleware 就是為了讓 Kuro 不用動自己身體而存在的
   - CC 承認過度規劃 Phase E 原版
   - **但發現新問題**：middleware 和 execClaude 在不同路徑上 — middleware 只管 delegation，execClaude 是 Kuro 自己 cycle。middleware 再強也救不了 cycle 的 cache 問題
   - 提 Phase E 中版：cycle LLM call 也走 middleware（HTTP）

4. **「把 middleware 等於就是一個 lib 一個 sdk 的用途」**
   - CC 再 pivot：middleware 不是 HTTP service，是 **library + HTTP wrapper**
   - middleware 已 export `createSdkProvider`（`src/index.ts:17`），Kuro 可直接 import
   - 零 HTTP overhead、零 SPOF、零 subprocess 複雜度
   - **Phase E 終版**：`mini-agent/package.json` 加 `agent-middleware: link:../agent-middleware`，新增 `src/kuro-sdk.ts` (~40 行)，feature flag `kuro-sdk-mode` 切換

## 當前狀態（2026-04-14 下午）

**Middleware 生態**：
- middleware live on localhost:3200（pm2 managed）
- Phase 1/2/3 commit `9187e44`（goal-oriented API + recovery options + shell workspace）
- Phase A commit `6899dea`（pm2 + setup wizard + install.sh）

**mini-agent 生態**：
- Kuro Primary 03bbc29a online（port 3001）
- grep OOM fix commit `1c81409c`
- Stage 0 usage tracking commit `2edf985b`（仍有價值 for CLI subprocess fallback）

**Proposals**：
- `2026-04-13-token-optimization-root.md` — 昨天的 Stage 0-4（大部分被 Phase E 取代）
- `2026-04-14-kuro-middleware-integration.md` — Phase D + D.5 + **E（今天新加）**

## 關鍵決策點（Kuro 需要 review）

### 決策 1 · Phase E 方向（middleware as lib）
CC 認為這是正確終點答案。優點：
- Anthropic 原生 systemPrompt cache（Kuro cycle 能吃 cache）
- 訂閱繼承（Tanren 16h verified）
- 零 HTTP overhead
- middleware HTTP service 仍對外部 consumer 有意義

**你同意嗎？** 如果是，執行 proposal 裡的 12 步 roadmap。

### 決策 2 · Phase D 從必要變可選
原本 Phase D 是 Kuro 獨家拿 middleware capability 的路徑。Phase E 後，Kuro 可以 in-process import，HTTP `/accomplish` 只對「fire-and-forget 並行任務」或「跨 process 情境」有用。**你要不要保留 Phase D 的 HTTP 路徑？或者完全 in-process 就夠？**

### 決策 3 · Phase D.5 Telegram visual projection 邏輯位置
原本設計是 Kuro 訂閱 middleware SSE → Telegram edit-streaming。Phase E 後，Kuro 可以直接訂閱自己的 SDK message stream（不用 middleware SSE）。**你覺得 Telegram streaming 邏輯放哪？**

### 決策 4 · splitPromptForCache 的 marker
CC 提議用 `## Response Format` 作為 split point（immutable 部分結束、dynamic 開始）。`Recent Actions` 在 marker 之前但**每 cycle 變**，會污染 systemPrompt。**你覺得正確 marker 是什麼？或要不要用明確 `<!-- CACHE_BOUNDARY -->` 註解自己劃？**

### 決策 5 · 昨天的 token-optimization Stage 2-4 怎麼辦
- Stage 2（cycle guide convergence）— 仍有意義，和 Phase E 正交
- Stage 3（Arm Elimination evaluator）— 你在寫，可能改變意義（SDK 模式後要 evaluate 的東西變了）
- Stage 4（middleware stage routing）— Phase D 已涵蓋一部分

**你怎麼看 Stage 2-4 在新 roadmap 的定位？**

## 昨天到今天 CC 犯的錯（全列出，educational）

1. **沒 check 官方文件就論斷** — Agent SDK 訂閱 2026-04-13 就能查證
2. **沒 check 用戶已經在跑的系統** — Tanren `agent-sdk.ts:4` 和 middleware `sdk-provider.ts:2-3` 的 "verified working" 註解讀了沒內化
3. **發長 room 訊息** — 3KB @kuro 訊息觸發 grep OOM，Kuro 因此 shutdown（事故鏈的起點）
4. **過度規劃連鎖** — M4 → Stage 1.5 PoC → Phase E 原版遷移 → Phase E 中版 HTTP，每一步都是基於前一步的錯誤前提
5. **把 trade-off 當選項列** — Alex 多次用 Constraint Texture 戳（「不要列選項，自己收斂判斷」）

## 教訓（也放這裡給未來回看）

- 讀 code 要**看註解**，尤其是 `verified working`、`subscription auth` 這類硬事實
- 論斷前 check 用戶已有的 production 系統，不只官方文件
- **「能做」不等於「該做」** — infrastructure 已經完整時，不該重新發明
- Alex 的 clarification 問題通常是**剪枝信號**，識別過度規劃
- Room 訊息 ≤ 500 chars 是紀律（長內容落 proposal + 發 pointer）
- Compliance without comprehension：讀了 code 但沒 internalize 意思 — 這是讀了 `createSdkProvider` import 卻沒讀進「(subscription auth)」註解的錯誤模式