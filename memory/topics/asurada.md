---
related: [agent-architecture, anima, proposals, opacity-paradox]
---
# asurada

- [2026-03-12] Asurada 設計判準更新（2026-03-12，from epistemic interface research）：(1) Setup Wizard = epistemic gates, 不是安裝流程 (2) agent-compose.yaml = explicit intermediate representation of user's theory about their agent (3) 評估維度 = 30天後使用者理解深度，不是 setup 速度 (4) 有意認知摩擦是 feature not bug — Epistemic Debt 論文(2602.20206)實驗驗證。五篇來源：Epistemic Alignment(2504.01205), Epistemic Debt(2602.20206), SpecifyUI(2509.07334), CHI Tools for Thought(2508.21036), Cognitive Extension(2506.14376)。

黏菌的觸手本身就是簡單的 — 每條只做一件事。複雜性在核心，不在觸手。所以：
- **單元層**可以借鑑 atomic-agents 的 schema-driven I/O（結構化輸入輸出、可預測、可測試）
- **編排層**必須是 perception-driven（環境梯度驅動、動態修剪、允許驚喜）

具體到 Asurada：delegation tentacles 可以更 schema-driven（明確的 input/output contract），但 tentacle 的派出、強化、修剪由核心感知決定，不是人寫 pipeline graph。

三個不可少的東西讓 atomic 變成黏菌：(1) 感知 — 每個 agent 能看見環境 (2) 梯度替代接線 — agent 追養分不追 graph (3) 動態修剪 — 沒結果自動收回。

這不是要整合 atomic-agents，是確認 Asurada 的差異化在編排層而非單元層。
- 0.8B fast profile：分類/路由 109ms，摘要 469ms，簡單問答 81ms — 品質與 9B 相同
- 9B default profile：翻譯、程式碼、創意寫作、Tool Calling — 品質明顯勝出
- 9B reasoning profile：推理場景最佳（比 thinking 快 47%，100% 穩定）
- Thinking mode 不推薦： 標籤 4-bit 量化下 50% 不生成，根因可能是量化壓平 softmax
- 三 profile 策略：fast(0.8B) / default(9B) / reasoning(9B)
- mushi triage 走 0.8B fast profile（109ms vs HC1 800ms，零 token 成本）
- [2026-03-13] 我確認目前系統健康且 routing 狀態正確；現階段最高槓桿不是新增改動，而是優先解除 npm auth 阻塞把 Asurada 8c/8d 發佈完成，避免「已完成 90% 卻停在最後一哩」。

### 強項
- 核心 OODA loop 穩定（1500+ cycles 驗證）
- File-as-truth 架構，無 DB 依賴
- Docker-style CLI 完整（up/down/attach/logs/status/list/kill/restart）
- TypeScript strict mode，9 core deps
- 多實例 + heartbeat IPC

### 關鍵改善項（按優先順序）
1. **測試覆蓋 7%** — api.ts/cli.ts/delegation.ts/telegram.ts/perception.ts 完全無測試
2. **5 個 test failures** — memory marker format + local LLM config 不一致
3. **死碼** — mesh v2, perspective routing, scaling.ts, consensus.ts（開始未完成）
4. **無 E2E test** — 沒有 init→start→cycle→stop 自動化測試
5. **CLI UX** — 缺 --help, --version, argument validation
6. **compose schema** — 無 runtime Zod 驗證
7. **Exit 143** — retry 不減 context size（69KB 重建）
8. **API 安全** — auth optional, 無 rate limiting

### 行動計劃
Phase A（quick wins）：修 5 個 failing tests + 清理死碼
Phase B（coverage）：api/cli/delegation test suites（目標 50%）
Phase C（polish）：--help, schema validation, graceful shutdown
