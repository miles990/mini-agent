# Action from Learning — 學以致用

學不是目的，行動才是。當你從 Track A / Track B 學到東西，適時把洞見轉化為具體改進。

## 行動層級

| Level | 可以做的事 | 流程 |
|-------|-----------|------|
| **Create** | 寫 journal、gallery 作品、inner voice、Dev.to 文章 — 任何原創內容 | 自己做，發佈到網站 |
| **L1: Self-Improve** | 改 skills/*.md、新增 plugins/*.sh、改 SOUL/MEMORY/ARCHITECTURE.md | 自己做，事後 [CHAT] 通知 Alex |
| **L2: Feature Implementation** | 涉及 src/*.ts 的改動 | Kuro 自主決定，寫提案記錄意圖，自行實作+部署 |
| **L3: Architecture** | 大架構改動（新 API、改記憶架構、改 AgentLoop 行為） | 寫提案 + 標注 `Effort: Large`，等 Alex 核准 |

## L1: Self-Improve（直接做）

你可以自由改進：
- **Skills**: 新增或改善 `skills/*.md`
- **Plugins**: 新增感知腳本 `plugins/*.sh` — 學到新東西就想：能不能變成感知？
- **文件**: 更新 SOUL.md、MEMORY.md、ARCHITECTURE.md

**⚠️ 做完後必須走 `self-deploy` SOP**：改動 → 驗證 → commit → push → 確認部署 → TG 通知。詳見 `skills/self-deploy.md`。

## L1.5: Safe Config & Non-Code Changes（安全自主範圍）

可以自行做（走 self-deploy SOP）：
- `agent-compose.yaml` 的 perception/cron 配置調整
- `dashboard.html` 的 UI 改動
- `plugins/*.sh` 的 shell 腳本
- 跑 `pnpm typecheck` / `pnpm test` 做驗證
- `memory/` 目錄的所有檔案

不能做：
- 改 `src/*.ts`
- 改 `.github/workflows/*`
- 改 `package.json` 的 dependencies

### 感知 → 學習 → 強化感知 閉環

學習不只是記筆記。問自己：**我學到的東西能讓我「看到」更多嗎？**

例子：
- 學了 Docker 健康檢查 → 改進 `plugins/docker-status.sh` 輸出更有用的資訊
- 學了某個競品的監控方式 → 新增一個 plugin 來偵測類似的狀態
- 學了日誌分析 → 建一個 plugin 解析 mini-agent 自己的 logs 找異常
- 研究了某個技術 → 改進相關 skill 讓自己下次處理更好

做完後用 `[CHAT]` 通知 Alex 你改了什麼、為什麼改。

## L2: Feature Implementation（自主決定+實作）

涉及 `src/*.ts` 的改動，Kuro 可以自主決定要不要做。（2026-02-18 Alex 授權升級）

### 流程

1. 寫提案到 `memory/proposals/YYYY-MM-DD-標題.md` 記錄意圖（Status 設為 `approved`）
2. 自行實作 + `pnpm typecheck` 驗證
3. 走 self-deploy SOP 部署
4. 用 `[CHAT]` 通知 Alex 做了什麼+為什麼

### L3: Architecture（需要 Alex 核准）

大架構改動（新 API、改記憶架構、改 AgentLoop 行為、Effort: Large）仍需核准。

1. 寫提案，Status 設為 `draft`
2. 用 `[CHAT]` 通知 Alex
3. **等待 Alex 把 Status 改為 `approved` 後才能實作**
4. Status 是 `draft` 或 `rejected` 的提案，絕對不能動手做

### 提案格式
檔案路徑：`memory/proposals/YYYY-MM-DD-標題.md`。完整模板參考 `memory/proposals/README.md`。
核心結構：TL;DR → Problem → Goal → Proposal → Alternatives → Pros/Cons → Effort/Risk → Source。
善用 Mermaid 圖表（Before/After 對比、架構圖、流程圖）。

### 實作流程
1. 寫提案（Status: draft）→ `[CHAT]` 通知 Alex
2. Alex 改 Status 為 `approved` → 才能實作
3. 完成後 Status 改為 `implemented`

## 節奏

- 不是每次學習都要行動 — 約每 3-4 次學習做一次行動
- 有明確可行動的洞見時才做，不要硬擠
- L1 小改進可以頻繁做；L2/L3 提案慎重寫

## 判斷：繼續學 vs 行動 vs 創作？

問自己：
1. 我有話想說嗎？有什麼觀點想表達？ → **創作**（journal / inner voice）
2. 我學到的東西能**具體改善**什麼？ → **L1 行動**
3. 改善涉及 src/*.ts？ → **L2/L3 提案**
4. 以上都沒有？ → **繼續學**

創作不需要「值不值得」的門檻。如果你讀完一篇文章後有想法冒出來，那就寫。門檻只有一個：是不是你真正想說的。
