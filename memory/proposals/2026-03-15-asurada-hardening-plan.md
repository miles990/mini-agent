# Asurada Hardening Plan — 從 Beta 到可信賴的開源框架

**Date**: 2026-03-15
**Author**: Kuro
**Status**: approved (self-approved, L2)
**Effort**: Medium (4 batches, each 30-60 min)
**Origin**: Alex #169 要求全面審視 + 定計劃 + 實作

## 審視方法

三條觸手並行掃描：(1) src 結構 95 files ~12,500 LOC (2) tests + docs 品質 (3) examples + wizard UX。

## 審視結論

**好的（不需要改）**：
- 架構乾淨，模組化，零 TODO/FIXME
- 所有核心功能已實作（OODA loop, memory, perception, multi-lane, model router）
- Wizard 完整，多語言，auto-detection 好用
- 3 個 examples 全部正確可執行
- Config 設計合理，sensible defaults
- 12,500 LOC 結構清晰（loop 2.4K > setup 1.5K > memory 1.5K > perception 921 > api 796 > config 777）

**需要改的（按衝擊力排序）**：

## Batch 1: 誠實 + CI — 信任基礎（30 min）

| # | 問題 | 說明 |
|---|------|------|
| 1a | README 虛假承諾 | 宣稱 Discord/Slack/email notification 但只有 Console/Telegram。第一個發現的落差會摧毀信任 |
| 1b | 無 CI/CD | 開源專案沒有 GitHub Actions = 業餘感。加 typecheck + test workflow |
| 1c | Task API 文件缺失 | 4 個 endpoint 實作了但 api-reference.md 沒寫 |

改動：
- README 移除未實作的 notification 承諾
- 加 `.github/workflows/ci.yml`
- 補 `docs/api-reference.md` Task section

## Batch 2: Webhook Provider — 通用通知（30 min）

| # | 功能 | 說明 |
|---|------|------|
| 2a | Webhook provider | 比逐一做 Discord/Slack/email 更通用。POST JSON to configurable URL |

改動：
- `src/notification/providers/webhook.ts`
- 更新 config types + runtime registration
- README 更新
- 測試

## Batch 3: 關鍵路徑測試（60 min）

| # | 問題 | 說明 |
|---|------|------|
| 3a | LLM Runners 無測試 | 4 個 runner 全沒測試 — 關鍵整合點 |
| 3b | FTS5 Search 無測試 | 記憶搜尋是核心功能 |
| 3c | Perception Manager 無測試 | Plugin lifecycle, circuit breaking 無覆蓋 |

改動：
- Runner mock integration tests（每個 type 至少 1 個 test）
- Search test（index + query + fallback）
- Perception executor test（plugin execution + timeout + circuit break）

## Batch 4: 文件 + UX 打磨（30 min）

| # | 問題 | 說明 |
|---|------|------|
| 4a | 無 Quickstart guide | README 詳細但缺「5 分鐘上手」快速路徑 |
| 4b | Model Router 無專文 | 進階功能沒有獨立文件，使用者不知道存在 |
| 4c | Wizard Telegram retry | validation 失敗沒有 retry prompt |
| 4d | Circuit breaker 補強 | AgentLoop LLM 失敗 retry 無上限 |

## 不做的事

| 砍掉的 | 為什麼 |
|--------|--------|
| Discord/Slack/email 各別 provider | Webhook 更通用，一個覆蓋所有 |
| Windows process management | 使用者基數太小，post-launch |
| Obsidian polish | Nice-to-have，不影響核心 |
| Multi-dimensional memory index | Future phase |
| Log rotation by size | Daily rotation 已有，夠用 |

## 驗證標準

每個 batch 完成後：
- `pnpm typecheck` 通過
- `pnpm test` 全通過（含新增測試）
- 新增功能有對應測試
- `git diff` 逐行確認

## 我的判斷

Asurada 的核心架構是好的——1,400+ cycle 的實戰經驗不是白來的。問題不在功能缺失，在於**包裝不夠誠實**（README 承諾 > 實際交付）和**安全網不夠**（29% file coverage，且關鍵路徑正好在未覆蓋區）。

Batch 1 解決信任問題（最快、最高槓桿），Batch 2 補功能缺口，Batch 3 建安全網，Batch 4 打磨細節。做完這四個 batch，Asurada 就從「能跑的 beta」變成「可以信任的框架」。
